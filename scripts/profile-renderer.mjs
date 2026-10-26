// Repeatable hidden-renderer load profile for large synthetic sessions, not an E2E suite. No real brain/CLI/network.
// Build the chosen app first; run under Xvfb: node scripts/profile-renderer.mjs --app-root PATH --label baseline.
// Samples renderer CPU, retained heap, long tasks and input latency; saves the raw V8 profile and machine facts.
import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const root = path.resolve(arg('--app-root', path.join(import.meta.dirname, '..'))), label = arg('--label', 'candidate');
const output = path.resolve(arg('--output', 'test-results/renderer-profile'));
const seconds = Number(arg('--seconds', '120'));
await fs.mkdir(output, { recursive: true });
const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-renderer-profile-'));
const env = { ...process.env, SB_DEMO: '1', SB_DEMO_FREEZE: '1', SB_HIDDEN: '1', SB_TEST: '1', SB_USER_DATA: profileDir, SB_MCP_PORT: '0', SB_LANG: 'en' };
for (const name of ['ELECTRON_RUN_AS_NODE', 'SB_BRAIN', 'SB_RELEASE', 'SB_RELEASE_ID', 'SB_ENGINE_CLAUDE']) delete env[name];
let app;
const result = { label, seconds, machine: { platform: process.platform, node: process.version, cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memoryGb: os.totalmem() / 2 ** 30 }, samples: [], errors: [] };
const deadline = setTimeout(() => { app?.process().kill('SIGKILL'); process.exitCode = 1; }, (seconds + 120) * 1000);
try {
  app = await electron.launch({ cwd: root, args: ['.'], env, timeout: 30000 });
  let page;
  for (let i = 0; i < 150 && !page; i++) { page = app.windows().find(w => w.url().startsWith('file:') && !w.url().includes('#overlay')); if (!page) await new Promise(r => setTimeout(r, 100)); }
  if (!page) throw new Error('Missing main renderer');
  page.on('pageerror', error => result.errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('tile-orchestrator').waitFor();
  const templates = await page.evaluate(() => window.sb.invoke('chat:list', undefined));
  // The benchmark alone replaces read handlers and injects synthetic host events; production app code is untouched.
  await app.evaluate(({ ipcMain, BrowserWindow }, templates) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay'));
    win.setContentSize(1920, 1080);
    const at = Date.now(), worker = templates.find(c => !c.isOrchestrator), orchestrator = templates.find(c => c.isOrchestrator);
    const chats = [{ ...orchestrator, id: 'orchestrator', pending: 0, state: 'idle', lastText: '', plan: undefined }, ...Array.from({ length: 64 }, (_, i) => ({ ...worker, id: `profile-${i}`, title: `Synthetic task ${i + 1}`, pending: 0, state: i < 16 ? 'running' : 'idle', parentId: undefined, delegation: undefined, routine: undefined, run: undefined, agentChildren: undefined, browserTabIds: [], plan: undefined, closedAt: undefined, lastText: 'Inspecting synthetic code', updatedAt: at }))];
    const versions = Array.from({ length: 10 }, (_, i) => ({ version: 1, draftRevision: 1, digest: `profile-${i}`, activatedAt: 1, definition: { id: `profile-flow-${i}`, title: `Synthetic routine ${i}`, description: 'Synthetic profiling data', scope: {}, aliases: [], steps: Array.from({ length: 10 }, (_, j) => ({ id: `step-${j}`, title: `Step ${j}`, kind: 'agent', role: 'artisan', tier: 'mid', instructions: 'Inspect synthetic data. '.repeat(250), inputs: [], evidence: [], effect: 'read-only', timeoutMs: 60000, maxAttempts: 1 })) } }));
    const snapshot = { contextKey: 'profile', active: Object.fromEntries(versions.map(v => [v.definition.id, 1])), drafts: [], versions, runs: [], automation: { contextKey: 'profile', revision: 1, paused: true, background: false, events: [], rules: Array.from({ length: 20 }, (_, i) => ({ id: `rule-${i}`, status: 'active', revision: 1, ownerOrchestratorId: 'orchestrator', updatedAt: 1, config: { flowId: `profile-flow-${i % 10}`, flowVersion: 1, inputs: { specification: 'Synthetic configuration. '.repeat(500) }, priority: 'normal', trigger: { kind: 'interval', everyMinutes: 60 }, scope: {} } })) } };
    const bench = { chats, snapshot, tick: 0, reads: 0, sent: 0, timer: null, flowTimer: null };
    globalThis.__rendererProfile = bench;
    const handler = (name, fn) => { ipcMain.removeHandler(name); ipcMain.handle(name, fn); };
    handler('chat:list', () => chats); handler('chat:pending', () => []); handler('browser:list', () => []); handler('feed:list', () => []); handler('flows:list', () => snapshot);
    handler('chat:items', (_event, { chatId, limit }) => {
      bench.reads++;
      const count = chatId === 'orchestrator' ? 4 : 600;
      return Array.from({ length: count }, (_, i) => ({ kind: 'tool', id: `${chatId}-history-${i}`, at: at - count + i, name: ['Read', 'Grep', 'Bash'][i % 3], summary: `Inspect src/module-${i}.ts`, input: { file_path: `/synthetic/src/module-${i}.ts`, command: `node inspect.mjs --module ${i}` }, output: `${chatId}/${i}: ${'Synthetic result line. '.repeat(48)}`, status: 'ok' })).slice(-(limit ?? count));
    });
  }, templates);
  await page.addInitScript(() => {
    localStorage.setItem('sb.prefs.v1', JSON.stringify({ chatPanelsV: 2, chatExpanded: {}, orchestratorOpen: true, orchestratorSizeV: 2, theme: 'dark' }));
    globalThis.__profile = { commits: 0, longMs: 0, longCount: 0, lag: [] };
    globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject() { return 1; }, onCommitFiberRoot() { globalThis.__profile.commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} };
  });
  await page.reload();
  await page.getByTestId('tile-chat-profile-63').waitFor({ state: 'attached', timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    new PerformanceObserver(entries => { for (const e of entries.getEntries()) { globalThis.__profile.longMs += e.duration; globalThis.__profile.longCount++; } }).observe({ type: 'longtask' });
    document.addEventListener('keydown', e => { const at = e.timeStamp; e.target.addEventListener('input', () => requestAnimationFrame(() => setTimeout(() => globalThis.__profile.lag.push(performance.now() - at), 0)), { once: true }); }, true);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable'); await cdp.send('HeapProfiler.enable'); await cdp.send('Profiler.enable');
  const sample = async elapsed => {
    const performance = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const cpu = await app.evaluate(({ app }) => app.getAppMetrics().filter(p => p.type === 'Tab').reduce((n, p) => n + (p.cpu.cumulativeCPUUsage ?? 0), 0));
    const ui = await page.evaluate(() => ({ ...globalThis.__profile, lag: [...globalThis.__profile.lag], nodes: document.getElementsByTagName('*').length }));
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    result.samples.push({ elapsed, cpuSeconds: cpu, heapMb: performance.JSHeapUsedSize / 2 ** 20, retainedHeapMb: heap.usedSize / 2 ** 20, taskSeconds: performance.TaskDuration, scriptSeconds: performance.ScriptDuration, layoutSeconds: performance.LayoutDuration, ...ui });
  };
  await sample(0); await cdp.send('Profiler.start');
  await app.evaluate(({ BrowserWindow }) => {
    const b = globalThis.__rendererProfile, win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay'));
    b.timer = setInterval(() => {
      const n = b.tick++, phase = n % 5, group = Math.floor(n / 5);
      for (let i = 0; i < 16; i++) {
        const chatId = `profile-${i}`, item = { kind: 'assistant', id: `${chatId}-stream-${group}`, at: Date.now(), text: `${chatId}/${group}: ${'Synthetic streamed evidence. '.repeat(phase * 32 + 1)}`, streaming: phase < 4 };
        win.webContents.send('chat:item', { chatId, item, replace: phase > 0 }); b.sent++;
        if (phase === 4) { const chat = b.chats[i + 1]; chat.updatedAt = item.at; chat.lastText = item.text.slice(0, 120); win.webContents.send('chat:updated', chat); }
      }
    }, 100);
    b.flowTimer = setInterval(() => { b.snapshot.automation.lastTickAt = Date.now(); win.webContents.send('flows:changed', b.snapshot); }, 500);
  });
  const start = Date.now(), input = page.getByTestId('tile-orchestrator').locator('textarea').first();
  for (let elapsed = 10; elapsed <= seconds; elapsed += 10) {
    while ((Date.now() - start) / 1000 < elapsed) { await input.fill(''); await input.pressSequentially('profile', { delay: 40 }); await page.waitForTimeout(800); }
    await sample((Date.now() - start) / 1000);
  }
  await app.evaluate(() => { const b = globalThis.__rendererProfile; clearInterval(b.timer); clearInterval(b.flowTimer); });
  const { profile } = await cdp.send('Profiler.stop'); await fs.writeFile(path.join(output, `${label}.cpuprofile`), JSON.stringify(profile));
  const weights = new Map(), nodes = new Map(profile.nodes.map(n => [n.id, n]));
  profile.samples.forEach((id, i) => { const f = nodes.get(id).callFrame; const key = `${f.functionName || '(anonymous)'} ${path.basename(f.url)}:${f.lineNumber + 1}`; weights.set(key, (weights.get(key) ?? 0) + profile.timeDeltas[i]); });
  result.hotspots = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([frame, us]) => ({ frame, ms: us / 1000 }));
  result.host = await app.evaluate(() => { const b = globalThis.__rendererProfile; return { reads: b.reads, sent: b.sent, ticks: b.tick, flowBytes: JSON.stringify({ ...b.snapshot, automation: undefined }).length, automationBytes: JSON.stringify(b.snapshot.automation).length }; });
  const a = result.samples[0], z = result.samples.at(-1), duration = z.elapsed - a.elapsed, sorted = z.lag.sort((a, b) => a - b);
  result.summary = { rendererCpuPctOfOneCore: 100 * (z.cpuSeconds - a.cpuSeconds) / duration, longTaskMsPerSecond: (z.longMs - a.longMs) / duration, inputLagP95Ms: sorted[Math.floor(sorted.length * .95)], startRetainedMb: a.retainedHeapMb, endRetainedMb: z.retainedHeapMb, retainedRangeLastHalfMb: result.samples.slice(Math.ceil(result.samples.length / 2)).map(s => s.retainedHeapMb), commitsPerSecond: (z.commits - a.commits) / duration };
  await page.screenshot({ path: path.join(output, `${label}.png`) });
  if (result.errors.length) throw new Error(`Renderer errors: ${result.errors.join('; ')}`);
  console.log(JSON.stringify({ label, summary: result.summary, host: result.host, hotspots: result.hotspots.slice(0, 12) }, null, 2));
} finally {
  clearTimeout(deadline);
  await fs.writeFile(path.join(output, `${label}.json`), JSON.stringify(result, null, 2));
  await app?.close(); await fs.rm(profileDir, { recursive: true, force: true });
}
