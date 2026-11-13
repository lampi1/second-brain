// Main-process stall bench: the built app (out/) on a COPY of a real profile, with the fake Claude CLI, idle or with N
// chats streaming; counts how often the main process is blocked (the window freezes) and can CPU-profile the main
// process to name what ran. Why: "si freeza ogni 2-3 secondi" (owner, 2026-10-27) only shows with real, large profile
// files (~75 chats, multi-MB JSON stores), never with the empty profile of bench-perf.mjs. Who: agents working on
// main-process performance.
//   node scripts/bench-stalls.mjs --snapshot <dir>            copy %APPDATA%/second-brain (data files only: no browser
//                                                             profile, caches, vaults or keys) and the brain (no .git)
//   node scripts/bench-stalls.mjs --snap <dir> [--chats 3] [--secs 120] [--profile <file.cpuprofile>] [--json]
// Each run starts from a fresh copy of the snapshot (same data before and after a fix), SB_TEST=1 (fake engines only,
// no schedulers, no network calls), SB_HIDDEN=1, its own MCP port. Never points at the live profile.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const root = path.resolve(import.meta.dirname, '..');
const FAKE = path.join(root, 'test', 'fixtures', 'fake-claude.mjs');

// ── snapshot ──
const SKIP = /^(Cache|Code Cache|GPUCache|GPUPersistentCache|DawnGraphiteCache|DawnWebGPUCache|GrShaderCache|ShaderCache|Partitions|Network|Local Storage|Session Storage|blob_storage|IndexedDB|Service Worker|WebStorage|Crashpad|logs|recordings|evidence|voice|memory-.*|Local State|Preferences|DIPS.*|declarative_performance_observer.*|lockfile|quitting\.json|ready\.json|personal-browser\.json|.*secret.*|.*vault.*|.*token.*|mcp-servers.*\.json)$/i;
const copyTree = (from, to, skip) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip(e.name)) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyTree(a, b, () => false);
    else if (e.isFile()) fs.copyFileSync(a, b);
  }
};
if (arg('--snapshot')) {
  const dir = path.resolve(arg('--snapshot'));
  const live = path.join(process.env.APPDATA, 'second-brain');
  const cfg = JSON.parse(fs.readFileSync(path.join(live, 'config.json'), 'utf8'));
  copyTree(live, path.join(dir, 'userData'), n => SKIP.test(n));
  if (cfg.brainRoot) copyTree(cfg.brainRoot, path.join(dir, 'brain'), n => n === '.git' || n === 'node_modules');
  console.log(`snapshot in ${dir}`);
  process.exit(0);
}

// ── run ──
const SNAP = path.resolve(arg('--snap', ''));
const CHATS = Number(arg('--chats', 0));
const SECS = Number(arg('--secs', 120));
const WARM = Number(arg('--warm', 20));
const PROFILE = arg('--profile');
if (!fs.existsSync(path.join(SNAP, 'userData'))) { console.error('--snap <dir> (made with --snapshot) is needed'); process.exit(2); }
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stall-run-'));
copyTree(path.join(SNAP, 'userData'), path.join(run, 'userData'), () => false);
if (fs.existsSync(path.join(SNAP, 'brain'))) copyTree(path.join(SNAP, 'brain'), path.join(run, 'brain'), () => false);
const cfgFile = path.join(run, 'userData', 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
cfg.brainRoot = fs.existsSync(path.join(run, 'brain')) ? path.join(run, 'brain') : null;
cfg.projectsRoot = null;
delete cfg.mcpPort;
fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const cwd = path.join(run, 'cwd'); fs.mkdirSync(cwd);

const app = await electron.launch({
  args: ['.'], cwd: root,
  env: {
    ...process.env, SB_USER_DATA: path.join(run, 'userData'), SB_MCP_PORT: '0', SB_TEST: '1', SB_HIDDEN: '1',
    SB_BENCH_TIMERS: process.argv.includes('--no-pollers') ? '' : '1', SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: path.join(run, 'claude'),
    FAKE_CLAUDE_SLOW_TICKS: String(Math.ceil((WARM + SECS + 60) * 1000 / 30)), FAKE_CLAUDE_DELAY: '30',
  },
  timeout: 120000,
});
await app.firstWindow();
let page; // the app page, not the overlay window
for (let i = 0; i < 200 && !page; i++) {
  page = app.windows().find(w => w.url().startsWith('file:') && !w.url().includes('#overlay'));
  if (!page) await new Promise(r => setTimeout(r, 100));
}
await page.waitForLoadState('domcontentloaded');
await new Promise(r => setTimeout(r, WARM * 1000));
for (let i = 0; i < CHATS; i++) await page.evaluate(([dir, n]) => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'slow', title: `Stall bench ${n}` }), [cwd, i]);
if (CHATS) await new Promise(r => setTimeout(r, 5000));

// our own watch, same rule as perf.ts (a 100 ms tick late by 200 ms or more), every stall kept (no once-a-minute cap)
await app.evaluate(() => {
  const g = globalThis;
  g.__stalls = [];
  let last = performance.now();
  g.__stallTimer = setInterval(() => { const t = performance.now(), late = t - last - 100; last = t; if (late >= 200) g.__stalls.push({ at: Date.now(), ms: Math.round(late) }); }, 100);
});
if (PROFILE) {
  await app.evaluate(() => {
    const inspector = process.getBuiltinModule('node:inspector');
    const s = new inspector.Session(); s.connect(); globalThis.__prof = s;
    s.post('Profiler.enable', () => s.post('Profiler.setSamplingInterval', { interval: 1000 }, () => s.post('Profiler.start')));
  });
}
const t0 = Date.now();
await new Promise(r => setTimeout(r, SECS * 1000));
const stalls = await app.evaluate(() => { clearInterval(globalThis.__stallTimer); return globalThis.__stalls; });
if (PROFILE) {
  const profile = await app.evaluate(() => new Promise(res => globalThis.__prof.post('Profiler.stop', (e, r) => res(e ? null : r.profile))));
  fs.writeFileSync(PROFILE, JSON.stringify(profile));
}
await app.close();

// the app's own perf log of the same window (one entry a minute, the rest in sinceLast)
const logs = path.join(run, 'userData', 'logs');
let logged = 0, steps = {};
for (const f of fs.existsSync(logs) ? fs.readdirSync(logs) : []) for (const line of fs.readFileSync(path.join(logs, f), 'utf8').split('\n')) {
  if (!line.includes('main process blocked')) continue;
  try {
    const e = JSON.parse(line); const at = Date.parse(e.t ?? e.ts ?? '');
    if (at && at < t0) continue;
    logged += 1 + (e.data?.sinceLast ?? 0);
    for (const s of e.data?.steps ?? []) steps[s.label] = (steps[s.label] ?? 0) + 1;
  } catch { /* not a log line */ }
}
const min = SECS / 60;
const ms = stalls.map(s => s.ms).sort((a, b) => a - b);
const out = {
  chats: CHATS, secs: SECS, stalls: stalls.length, perMinute: +(stalls.length / min).toFixed(1),
  p50: ms[Math.floor(ms.length / 2)] ?? 0, max: ms.at(-1) ?? 0, totalMs: ms.reduce((a, b) => a + b, 0),
  loggedPerMinute: +(logged / min).toFixed(1), loggedSteps: steps, run,
};
console.log(process.argv.includes('--json') ? JSON.stringify(out) : out);
