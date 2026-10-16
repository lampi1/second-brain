// Performance bench: the built app (out/) with the fake Claude CLI, a Regia and N chats streaming at once; measures
// what the user feels. Why: "lentino, input lag, le risposte arrivano dopo" (owner, 2026-10-11) needs numbers before
// and after each fix. Who: agents working on rendering/streaming performance (`npm run build` first, then
// `node scripts/bench-perf.mjs [--chats 10] [--secs 10] [--json]`). Runs hidden (SB_HIDDEN), isolated profile, no tokens.
// A benchmark under load (with --burn, a load generator): run it only at night, outside the owner's working hours,
// never during the day on their work PC (owner, 2026-10-15; AGENTS.md rule 7).
// Measures, during the window:
//   input lag   keydown (event.timeStamp) → the frame after the input event, typing in the Regia and in a chat
//   cli→screen  the fake stamps each word with Date.now(); the first frame that shows it gives the delay
//   cpu         app.getAppMetrics() cumulative CPU of main (Browser), renderers (Tab), GPU over the window (100 = one core)
//   --profile   prints the renderer's top self-time functions (CDP sampling profiler) over the window
//   --burn N    N busy loops at normal priority while it runs (a PC busy with test suites)
//   --idle      the app at rest: every chat has finished its turn, nothing is typed while CPU is measured; input lag
//               is measured right after the window (the owner's target: the app at rest under 0.1 core, 2026-10-12)
//   --working K --asking A   with --idle: K chats stay inside a long tool call (spinner, timer, "sta lavorando") and
//               A chats wait on a question, like the owner's real mosaic (18 live chats: 5 working, 3 waiting)
//   commits     React commits (devtools hook) per second and per streamed delta; long tasks; frames per second
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const CHATS = Number(arg('--chats', 10));
const SECS = Number(arg('--secs', 10));
const DELAY = Number(arg('--delay', 15));
const IDLE = process.argv.includes('--idle');
const WORKING = Number(arg('--working', 0)), ASKING = Number(arg('--asking', 0));
const promptOf = i => !IDLE ? 'slow' : i < WORKING ? 'toolwait' : i < WORKING + ASKING ? 'ask' : 'ciao'; // ms between deltas per chat (the real CLI: ~10-40 ms)
const root = path.resolve(import.meta.dirname, '..');
const FAKE = path.join(root, 'test', 'fixtures', 'fake-claude.mjs');
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
// --burn N: N busy loops at normal priority during the run, like the test suites other chats start (PC at 100%).
// Each one checks every ~0.2 s that this script is alive and exits otherwise: an 'exit' handler alone is skipped when
// the script is killed (a timeout once left 16 of them spinning). unref: they never keep this script alive.
const BURN = `const p = ${process.pid}; for (let i = 1; ; i++) if (i % 5e7 === 0) { try { process.kill(p, 0); } catch { process.exit(0); } }`;
const burners = Array.from({ length: Number(arg('--burn', 0)) }, () => { const b = spawn(process.execPath, ['-e', BURN], { stdio: 'ignore', windowsHide: true }); b.unref(); return b; });
process.on('exit', () => { for (const b of burners) b.kill(); });

const app = await electron.launch({
  args: ['.'], cwd: root,
  env: {
    ...process.env, SB_USER_DATA: tmp('sb-bench-'), SB_MCP_PORT: '0', SB_TEST: '1', SB_HIDDEN: '1',
    SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: tmp('sb-bench-claude-'),
    FAKE_CLAUDE_STAMP: '1', FAKE_CLAUDE_SLOW_TICKS: String(Math.ceil((SECS + 20) * 1000 / DELAY)), FAKE_CLAUDE_DELAY: String(DELAY), FAKE_CLAUDE_TOOL_MS: String((SECS + 120) * 1000),
  },
});
await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.setSize(1920, 1040); });
let page;
for (let i = 0; i < 100 && !page; i++) {
  page = app.windows().find(w => w.url().startsWith('file:') && !w.url().includes('#overlay'));
  if (!page) await new Promise(r => setTimeout(r, 100));
}
// counters installed before React loads: commits through the devtools hook React looks for at startup
await page.addInitScript(() => {
  const b = { commits: 0, items: 0 };
  globalThis.__bench = b;
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject() { return 1; }, onCommitFiberRoot() { b.commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} };
});
await page.reload();
await page.waitForLoadState('domcontentloaded');
await page.evaluate(() => { window.sb.on('chat:item', () => { globalThis.__bench.items++; }); });

const cwd = tmp('sb-bench-cwd-');
await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, title: 'Regia', regia: true }), cwd);
const ids = [];
for (let i = 0; i < CHATS; i++) ids.push((await page.evaluate(([dir, n, prompt]) => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt, title: `Bench ${n}` }), [cwd, i, promptOf(i)])).id);
// at rest: every tile is there, the working chats show their running tool, the rest have answered or asked
if (IDLE) await page.waitForFunction(([n, w, done]) => document.querySelectorAll('[data-testid^="tile-chat-"]').length >= n
  && document.querySelectorAll('[data-testid^="typing-chat"], [data-testid^="tile-chat-"] [data-testid^="typing-"]').length >= w
  && [...document.querySelectorAll('[data-testid^="tile-chat-"]')].filter(t => /Ciao dal motore/.test(t.textContent ?? '')).length >= done
  && !document.querySelector('.md.streaming'), [CHATS, WORKING, CHATS - WORKING - ASKING], { timeout: 60000 }).catch(async e => { console.error(await page.evaluate(() => [...document.querySelectorAll('[data-testid^="tile-chat-"]')].map(t => (t.textContent ?? '').slice(0, 160)).join('\n'))); throw e; });
else await page.waitForSelector('.md.streaming', { timeout: 20000 });
await page.waitForTimeout(IDLE ? 5000 : 3000); // warm-up: every chat is streaming (or done and settled)

if (process.env.BENCH_DEBUG) console.log(await page.evaluate(() => document.querySelector('[data-testid^="tile-chat-"]')?.innerText));
const view = await page.evaluate(() => ({
  tiles: document.querySelectorAll('[data-testid^="tile-chat-"]').length,
  lists: document.querySelectorAll('[data-testid^="tile-chat-"] .items, [data-testid="tile-regia"] .items').length,
  streaming: document.querySelectorAll('.md.streaming').length,
}));

const cum = () => app.evaluate(({ app: a }) => a.getAppMetrics().map(p => ({ pid: p.pid, type: p.type, s: p.cpu.cumulativeCPUUsage ?? 0 })));
// --still: prefers-reduced-motion (no alive marks stepping): what the rest of the app costs without them
if (process.argv.includes('--still')) await page.emulateMedia({ reducedMotion: 'reduce' });
const m0 = await cum();
// --ui-prio: the app's own UI processes (main, renderers, GPU) at ABOVE_NORMAL, set from here (an experiment)
if (process.argv.includes('--ui-prio')) for (const p of m0) if (['Browser', 'Tab', 'GPU'].includes(p.type)) { try { os.setPriority(p.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL); } catch (e) { console.error('priority', p.pid, e.message); } }
const prof = process.argv.includes('--profile') ? await page.context().newCDPSession(page) : null;
if (prof) { await prof.send('Profiler.enable'); await prof.send('Profiler.setSamplingInterval', { interval: 500 }); await prof.send('Profiler.start'); }
// --trace: where the renderer's native time goes (style, layout, paint, parse HTML...), summed by trace event name
const tr = process.argv.includes('--trace') ? await page.context().newCDPSession(page) : null;
const traceEvents = [];
if (tr) {
  tr.on('Tracing.dataCollected', e => traceEvents.push(...e.value));
  await tr.send('Tracing.start', { categories: 'devtools.timeline,blink', transferMode: 'ReportEvents' });
}
const t0 = Date.now();
const busy = () => os.cpus().reduce((a, c) => { const t = c.times; return { idle: a.idle + t.idle, all: a.all + t.idle + t.user + t.sys + t.irq + t.nice }; }, { idle: 0, all: 0 });
const c0 = busy();
// in-page sampler: frames, long tasks, CLI → screen delays, input lag
await page.evaluate(([secs, idle]) => {
  const b = globalThis.__bench;
  b.commits = 0; b.items = 0; b.frames = 0; b.long = 0; b.lat = []; b.lag = [];
  new PerformanceObserver(l => { for (const e of l.getEntries()) b.long += e.duration; }).observe({ type: 'longtask', buffered: false });
  const seen = new Map();
  const end = performance.now() + secs * 1000;
  const frame = () => {
    b.frames++;
    const now = Date.now();
    document.querySelectorAll('.md.streaming').forEach((el, i) => {
      const t = el.lastElementChild?.textContent ?? ''; // the last paragraph only: reading 10 long answers a frame skewed the run
      const at = t.lastIndexOf('@');
      const stamp = at >= 0 ? Number(t.slice(at + 1, at + 14)) : NaN;
      if (stamp && seen.get(i) !== stamp) { seen.set(i, stamp); b.lat.push(now - stamp); }
    });
    if (performance.now() < end) requestAnimationFrame(frame);
  };
  if (!idle) requestAnimationFrame(frame); // at rest a rAF loop of our own would itself make the frames we measure
  document.addEventListener('keydown', e => {
    const ts = e.timeStamp;
    const onInput = () => { requestAnimationFrame(() => setTimeout(() => b.lag.push(performance.now() - ts), 0)); };
    e.target.addEventListener('input', onInput, { once: true });
  }, true);
}, [SECS, IDLE]);

const type = async (sel, text) => {
  await page.locator(sel).first().click();
  for (const ch of text) { await page.keyboard.type(ch); await page.waitForTimeout(80); }
};
const half = Math.floor(SECS * 1000 / 2) - 600;
const chars = IDLE ? 40 : Math.floor(half / 100);
const typeBoth = async () => {
  await type('[data-testid="tile-regia"] textarea', 'x'.repeat(chars));
  const regia = await page.evaluate(() => globalThis.__bench.lag.splice(0));
  await type(`[data-testid="chat-input-${ids[0]}"]`, 'y'.repeat(chars));
  return [regia, await page.evaluate(() => globalThis.__bench.lag.splice(0))];
};
let lagRegia = [], lagChat = [];
if (!IDLE) [lagRegia, lagChat] = await typeBoth();
await page.waitForTimeout(Math.max(0, SECS * 1000 - (Date.now() - t0)));
const secs = (Date.now() - t0) / 1000;
const c1 = busy();
const machinePct = Math.round(100 * (1 - (c1.idle - c0.idle) / (c1.all - c0.all)));

const m1 = await cum();
const tEnd = Date.now();
if (arg('--shot')) await page.screenshot({ path: arg('--shot') }); // what the window showed while measured
if (tr) {
  const done = new Promise(r => tr.once('Tracing.tracingComplete', r));
  await tr.send('Tracing.end');
  await done;
  const main = traceEvents.filter(e => e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map(e => `${e.pid}:${e.tid}`);
  const by = new Map();
  for (const e of traceEvents) if (e.ph === 'X' && e.dur && main.includes(`${e.pid}:${e.tid}`)) by.set(e.name, (by.get(e.name) ?? 0) + e.dur / 1000);
  const span = (tEnd - t0) / 1000;
  console.log([...by].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${Math.round(v / span)} ms/s  ${k}`).join('\n'));
}
if (prof) {
  const { profile } = await prof.send('Profiler.stop');
  const self = new Map(); const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const dt = profile.timeDeltas; const total = dt.reduce((a, b) => a + b, 0);
  profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url || '').split('/').pop()}:${n.callFrame.lineNumber + 1}:${n.callFrame.columnNumber}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0)); });
  console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${(100 * v / total).toFixed(1)}%  ${k}`).join('\n'));
}
// at rest the typing comes after the measured window (and after the trace/profile): it is the lag, not the load
if (IDLE) [lagRegia, lagChat] = await typeBoth();
const m = m1.map(p => ({ type: p.type, cpu: 100 * (p.s - (m0.find(x => x.pid === p.pid)?.s ?? 0)) / ((tEnd - t0) / 1000) }));
const b = await page.evaluate(() => { const x = globalThis.__bench; return { commits: x.commits, items: x.items, frames: x.frames, long: x.long, lat: x.lat }; });
await app.close();
for (const b of burners) b.kill();

const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
const cpu = t => Math.round(m.filter(p => p.type === t).reduce((s, p) => s + p.cpu, 0));
const deltas = IDLE ? 1 : Math.round(CHATS * secs * 1000 / DELAY);
const r = {
  mode: IDLE ? 'idle' : 'streaming', machineCpuPct: machinePct, chats: CHATS, secs: Math.round(secs), view,
  inputLagRegiaMs: { p50: q(lagRegia, 0.5), p95: q(lagRegia, 0.95), n: lagRegia.length },
  inputLagChatMs: { p50: q(lagChat, 0.5), p95: q(lagChat, 0.95), n: lagChat.length },
  cliToScreenMs: { p50: q(b.lat, 0.5), p95: q(b.lat, 0.95), n: b.lat.length },
  cpuPct: { main: cpu('Browser'), renderers: cpu('Tab'), gpu: cpu('GPU') },
  fps: IDLE ? null : Math.round(b.frames / secs), longTaskMsPerSec: Math.round(b.long / secs),
  commitsPerSec: Math.round(b.commits / secs), ipcItemsPerSec: Math.round(b.items / secs),
  commitsPerDelta: +(b.commits / deltas).toFixed(2),
};
if (process.argv.includes('--json')) console.log(JSON.stringify(r));
else console.log(r);
