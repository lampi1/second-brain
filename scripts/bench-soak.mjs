// Soak bench: does the app stay as fast after a day of chats as it was at start? Opens a batch of chats with the fake
// Claude CLI, lets each one take a few streamed turns, closes them all (archive, then close, like the ✕ after its
// 6-second Annulla), and measures the app AT REST after each batch: idle CPU of main/renderer, React commits per second,
// retained heap (after a forced GC) of main and renderer, DOM nodes and JS event listeners, active timers/handles in
// main, live child processes, and typing lag in the Orchestrator. Anything that keeps growing from batch to batch is a
// leak the owner feels as "va a scatti a fine giornata, anche dopo aver chiuso le chat" (2026-10-29).
// Who: agents working on performance (`npm run build` first, then `node scripts/bench-soak.mjs [--cycles 6]
// [--chats 8] [--turns 3] [--json]`). Runs hidden, isolated profile, fake engines, no tokens. A load bench: AGENTS.md
// rule 7 (never during the day on the owner's work PC).
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const CYCLES = Number(arg('--cycles', 6)), CHATS = Number(arg('--chats', 8)), TURNS = Number(arg('--turns', 3));
const IDLE_SECS = Number(arg('--idle', 8));
// --archive-only: the chats are archived and stay (what the auto-close does, up to 60 kept), never removed by ✕
const ARCHIVE_ONLY = process.argv.includes('--archive-only');
// --orch N: N messages to the Orchestrator per batch (its transcript grows all day with mail and news)
const ORCH = Number(arg('--orch', 0));
const JSON_OUT = process.argv.includes('--json');
const root = path.resolve(import.meta.dirname, '..');
const FAKE = path.join(root, 'test', 'fixtures', 'fake-claude.mjs');
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));

const app = await electron.launch({
  args: ['--js-flags=--expose-gc', '.'], cwd: root,
  env: {
    ...process.env, SB_USER_DATA: tmp('sb-soak-'), SB_MCP_PORT: '0', SB_TEST: '1', SB_HIDDEN: '1',
    SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: tmp('sb-soak-claude-'), FAKE_CLAUDE_DELAY: '15',
  },
});
await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.setSize(1920, 1040); });
let page;
for (let i = 0; i < 100 && !page; i++) {
  page = app.windows().find(w => w.url().startsWith('file:') && !w.url().includes('#overlay'));
  if (!page) await new Promise(r => setTimeout(r, 100));
}
await page.addInitScript(() => {
  const b = { commits: 0 };
  globalThis.__bench = b;
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject() { return 1; }, onCommitFiberRoot() { b.commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} };
});
await page.reload();
await page.waitForLoadState('domcontentloaded');
await page.getByTestId('tile-orchestrator').waitFor({ timeout: 30000 });
// the first-run setup opens on a fresh profile: «Later», like a user who set up before
await page.getByRole('button', { name: 'Later' }).click({ timeout: 8000 }).catch(() => {});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');

const cwd = tmp('sb-soak-cwd-');
await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, title: 'Orchestrator', orchestrator: true }), cwd);
const mainPid = await app.evaluate(() => process.pid);

/** every process under the app's main process (Linux: ps), minus Chromium's own helpers */
const descendants = () => {
  try {
    const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).trim().split('\n').map(l => l.trim().split(/\s+/));
    const kids = new Map();
    for (const [pid, ppid, comm] of rows) { if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push({ pid, comm }); }
    const out = [], stack = [String(mainPid)];
    while (stack.length) for (const k of kids.get(stack.pop()) ?? []) { out.push(k); stack.push(k.pid); }
    return out.filter(k => !/electron|chrome|zygote/i.test(k.comm)).length;
  } catch { return null; }
};

const settle = async ids => {
  for (let i = 0; i < 600; i++) {
    const list = await page.evaluate(() => window.sb.invoke('chat:list', undefined));
    const mine = list.filter(c => ids.includes(c.id));
    if (mine.length === ids.length && mine.every(c => c.state === 'idle' || c.state === 'error') && !mine.some(c => c.queued)) return;
    await page.waitForTimeout(250);
  }
  throw new Error('chats never settled');
};

const cum = () => app.evaluate(({ app: a }) => a.getAppMetrics().map(p => ({ pid: p.pid, type: p.type, s: p.cpu.cumulativeCPUUsage ?? 0, mem: p.memory.privateBytes ?? p.memory.workingSetSize })));
const typeLag = async () => {
  await page.evaluate(() => {
    const b = globalThis.__bench; b.lag = [];
    if (b.lagOn) return; b.lagOn = true;
    document.addEventListener('keydown', e => { const ts = e.timeStamp; e.target.addEventListener('input', () => requestAnimationFrame(() => setTimeout(() => b.lag.push(performance.now() - ts), 0)), { once: true }); }, true);
  });
  const box = page.locator('[data-testid="tile-orchestrator"] textarea').first();
  if (process.env.SOAK_SHOT) await page.screenshot({ path: process.env.SOAK_SHOT });
  await box.click();
  for (let i = 0; i < 20; i++) { await page.keyboard.type('x'); await page.waitForTimeout(60); }
  await box.fill('');
  const lag = await page.evaluate(() => globalThis.__bench.lag.splice(0));
  const s = [...lag].sort((a, b) => a - b);
  return { p50: Math.round(s[Math.floor(s.length / 2)] ?? 0), p95: Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? 0) };
};

/** One chat streaming for 6 s (a ~40 deltas/s answer): what one frame of streaming costs the renderer now, by CDP
 *  Performance metrics (script, style, layout per second of wall time) and the renderer's CPU. */
const probe = async () => {
  const id = (await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'slow', title: 'Probe' }), cwd)).id;
  if (process.env.SOAK_DEBUG) console.error('probe', id);
  await page.getByTestId(`chat-expand-${id}`).click({ timeout: 10000 }); // its work open, like a strip the user watches
  await page.waitForSelector('.md.streaming', { timeout: 20000, state: 'attached' });
  await page.waitForTimeout(1000);
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const a = await metric(), m0 = await cum(), t0 = Date.now();
  await page.waitForTimeout(6000);
  const b = await metric(), m1 = await cum(), secs = (Date.now() - t0) / 1000;
  const per = k => Math.round((b[k] - a[k]) * 1000 / secs);
  const cpu = type => Math.round(m1.filter(p => p.type === type).reduce((s, p) => s + 100 * (p.s - (m0.find(x => x.pid === p.pid)?.s ?? p.s)) / secs, 0));
  await page.evaluate(chatId => window.sb.invoke('chat:stop', { chatId }), id);
  await page.waitForTimeout(500);
  await page.evaluate(chatId => window.sb.invoke('chat:archive', { chatId, auto: false }), id).catch(() => {});
  await page.evaluate(chatId => window.sb.invoke('chat:close', { chatId }), id).catch(() => {});
  return { scriptMsPerS: per('ScriptDuration'), styleMsPerS: per('RecalcStyleDuration'), layoutMsPerS: per('LayoutDuration'), rendererCpu: cpu('Tab'), mainCpu: cpu('Browser') };
};

const measure = async label => {
  await page.waitForTimeout(3000);
  const m0 = await cum(); const c0 = await page.evaluate(() => globalThis.__bench.commits); const t0 = Date.now();
  await page.waitForTimeout(IDLE_SECS * 1000);
  const m1 = await cum(); const c1 = await page.evaluate(() => globalThis.__bench.commits); const secs = (Date.now() - t0) / 1000;
  const cpu = type => Math.round(m1.filter(p => p.type === type).reduce((s, p) => s + 100 * (p.s - (m0.find(x => x.pid === p.pid)?.s ?? p.s)) / secs, 0) * 10) / 10;
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  const main = await app.evaluate(() => {
    globalThis.gc?.();
    const handles = process._getActiveHandles(), kinds = {};
    for (const h of handles) { const k = h?.constructor?.name ?? 'other'; kinds[k] = (kinds[k] ?? 0) + 1; }
    return { heapMb: Math.round(process.memoryUsage().heapUsed / 1048576 * 10) / 10, handles: handles.length, kinds, requests: process._getActiveRequests().length };
  });
  const lag = await typeLag();
  const stream = label.endsWith('open') ? undefined : await probe();
  const row = {
    label, idleCpu: { main: cpu('Browser'), renderer: cpu('Tab'), gpu: cpu('GPU') }, commitsPerSec: Math.round((c1 - c0) / secs * 10) / 10,
    mainHeapMb: main.heapMb, rendererHeapMb: Math.round(heap.usedSize / 1048576 * 10) / 10, domNodes: dom.nodes, listeners: dom.jsEventListeners,
    mainHandles: main.handles, handleKinds: main.kinds, children: descendants(), typeLag: lag,
    privMb: Math.round(m1.reduce((s, p) => s + p.mem, 0) / 1024), ...(stream ? { stream } : {}),
  };
  if (!JSON_OUT) console.log(JSON.stringify(row));
  return row;
};

const rows = [await measure('start')];
for (let c = 1; c <= CYCLES; c++) {
  const ids = [];
  for (let i = 0; i < CHATS; i++) ids.push((await page.evaluate(([dir, n]) => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'stream edit', title: `Soak ${n}` }), [cwd, `${c}.${i}`])).id);
  await settle(ids);
  for (let o = 0; o < ORCH; o++) {
    const orch = (await page.evaluate(() => window.sb.invoke('chat:list', undefined))).find(c => c.isOrchestrator);
    await page.evaluate(([chatId, n]) => window.sb.invoke('chat:send', { chatId, text: `stream edit nota ${n}` }), [orch.id, o]);
    await settle([orch.id]);
  }
  for (let t = 1; t < TURNS; t++) {
    for (const id of ids) await page.evaluate(([chatId, n]) => window.sb.invoke('chat:send', { chatId, text: `stream edit turno ${n}` }), [id, t]);
    await settle(ids);
  }
  const busy = await measure(`cycle ${c} open`);
  for (const id of ids) await page.evaluate(chatId => window.sb.invoke('chat:archive', { chatId, auto: false, undoable: true }), id);
  await page.waitForTimeout(1000);
  if (!ARCHIVE_ONLY) for (const id of ids) await page.evaluate(chatId => window.sb.invoke('chat:close', { chatId }), id);
  rows.push(busy, await measure(`cycle ${c} closed`));
}
await app.close();
if (JSON_OUT) console.log(JSON.stringify(rows));
