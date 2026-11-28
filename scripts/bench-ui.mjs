// UI bench for the restyle's speed targets (issue #491, ADR 0366): with N chats working at once (20 people animating on
// the Grindhouse) it measures the renderer's frames, then how long a chat takes to open from a click on its strip.
// Why: the owner asked for numbers ("no frame over 16 ms with 20 sprites, chat open under 100 ms"), not a feeling.
// Who: anyone touching the Grindhouse, the strips or the chat view: `node scripts/build.mjs` first, then
// `node scripts/bench-ui.mjs [--chats 20] [--secs 10] [--opens 10] [--json]`. Hidden window, isolated profile, the fake
// Claude CLI (test/fixtures/fake-claude.mjs): no tokens, no network. A measurement, not a test: numbers depend on the PC,
// so nothing here passes or fails; run it before and after a change on the same machine.
// Measures:
//   frames     rAF intervals over the window: p50, p95, max and the share over 16.7 ms (a missed 60 Hz frame);
//              long tasks (> 50 ms) in the renderer, summed
//   chat open  click on a strip's name → the first frame that shows that chat's transcript, per chat: p50 and max
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const CHATS = Number(arg('--chats', 20)), SECS = Number(arg('--secs', 10)), OPENS = Number(arg('--opens', 10));
const root = path.resolve(import.meta.dirname, '..');
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = x => x === null ? null : Math.round(x * 10) / 10;

const app = await electron.launch({
  args: ['.'], cwd: root,
  env: {
    ...process.env, SB_USER_DATA: tmp('sb-bench-ui-'), SB_MCP_PORT: '0', SB_TEST: '1', SB_HIDDEN: '1',
    SB_CLAUDE_PATH: path.join(root, 'test', 'fixtures', 'fake-claude.mjs'), CLAUDE_CONFIG_DIR: tmp('sb-bench-ui-claude-'),
    // every chat stays inside one long tool call: its person works (animates) for the whole run
    FAKE_CLAUDE_TOOL_MS: String((SECS + 180) * 1000),
  },
});
try {
  await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.setSize(1920, 1040); });
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    page = app.windows().find(w => w.url().startsWith('file:') && !w.url().includes('#overlay'));
    if (!page) await new Promise(r => setTimeout(r, 100));
  }
  if (!page) throw new Error('app window not found');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: /^(Later|Più tardi|Später)$/ }).click({ timeout: 8000 }).catch(() => {});

  const cwd = tmp('sb-bench-ui-cwd-');
  await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, title: 'Orchestrator', orchestrator: true }), cwd);
  const ids = [];
  for (let i = 0; i < CHATS; i++) ids.push((await page.evaluate(([dir, n]) => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'toolwait', title: `Bench ${n}` }), [cwd, i])).id);
  // every chat working (its running tool shown on the strip), then a few seconds to settle
  await page.waitForFunction(n => document.querySelectorAll('[data-testid^="typing-c"]').length >= n, CHATS, { timeout: 90_000 });
  await page.waitForTimeout(3000);
  const view = await page.evaluate(() => ({
    strips: document.querySelectorAll('[data-testid^="tile-chat-"]').length,
  }));

  // 1. frames: rAF intervals and long tasks over the window, nothing typed or clicked
  const frames = await page.evaluate(secs => new Promise(resolve => {
    const gaps = [], long = [];
    const obs = new PerformanceObserver(list => { for (const e of list.getEntries()) long.push(e.duration); });
    obs.observe({ type: 'longtask', buffered: false });
    let last = performance.now();
    const end = last + secs * 1000;
    const tick = now => {
      gaps.push(now - last); last = now;
      if (now < end) requestAnimationFrame(tick); else { obs.disconnect(); resolve({ gaps, long }); }
    };
    requestAnimationFrame(t => { last = t; requestAnimationFrame(tick); });
  }), SECS);

  // 2. chat open: click on the strip's name, the first frame that shows its transcript; folded again before the next
  const opens = [];
  for (const id of ids.slice(0, OPENS)) {
    const ms = await page.evaluate(chatId => new Promise((resolve, reject) => {
      const btn = document.querySelector(`[data-testid="chat-expand-${chatId}"]`);
      if (!btn) { reject(new Error(`no strip for ${chatId}`)); return; }
      // visible, not just mounted: a folded strip keeps its item list in the DOM (store/ui.ts setChatExpanded)
      const shown = () => [...document.querySelectorAll(`[data-testid="tile-chat-${chatId}"] .items`)].some(el => el.getBoundingClientRect().height > 40);
      const t0 = performance.now();
      btn.click();
      const check = () => { if (shown()) resolve(performance.now() - t0); else if (performance.now() - t0 > 5000) reject(new Error(`chat ${chatId} not shown in 5 s`)); else requestAnimationFrame(check); };
      requestAnimationFrame(check);
    }), id);
    opens.push(ms);
    // back to the benches (AgentStrips «bench-back»), as the user does
    await page.getByTestId('bench-back').click({ timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
    await page.getByTestId(`chat-expand-${ids[ids.length - 1]}`).waitFor({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  const result = {
    chats: CHATS, secs: SECS, ...view,
    frames: {
      count: frames.gaps.length, p50Ms: r1(pct(frames.gaps, 0.5)), p95Ms: r1(pct(frames.gaps, 0.95)), maxMs: r1(Math.max(...frames.gaps)),
      over16: `${Math.round(100 * frames.gaps.filter(g => g > 16.7 * 1.5).length / Math.max(1, frames.gaps.length))}%`,
      longTasks: frames.long.length, longTaskMs: Math.round(frames.long.reduce((a, b) => a + b, 0)),
    },
    chatOpen: { n: opens.length, p50Ms: r1(pct(opens, 0.5)), maxMs: r1(opens.length ? Math.max(...opens) : null) },
  };
  if (process.argv.includes('--json')) console.log(JSON.stringify(result));
  else {
    console.log(`${result.strips} strips, each with its person, ${CHATS} chats working, ${SECS} s`);
    console.log(`frames      p50 ${result.frames.p50Ms} ms · p95 ${result.frames.p95Ms} ms · max ${result.frames.maxMs} ms · missed 60 Hz frames ${result.frames.over16} · long tasks ${result.frames.longTasks} (${result.frames.longTaskMs} ms)`);
    console.log(`chat open   p50 ${result.chatOpen.p50Ms} ms · max ${result.chatOpen.maxMs} ms (${result.chatOpen.n} chats)`);
  }
} finally {
  await app.close().catch(() => {});
}
