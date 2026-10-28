// Captures the hidden frozen dev app for PR visual review, without running the E2E suite or live providers.
// CI builds first and supplies Xvfb on Linux. Native capturePage images and a manifest are uploaded for human review.
import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build as bundle } from 'esbuild';
import { captureTerminalRoutine, startRoutineTrace, idleRoutineTrace, captureIdlePerformance } from './dev-visual-routines.mjs';
import { captureRoutineWorkbench } from './dev-visual-workbench.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'test-results/dev-visual-smoke');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-dev-visual-'));
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
const manifest = { revision: process.env.GITHUB_SHA ?? 'local', mode: 'hidden frozen demo plus isolated synthetic review fixture', captures: [], rendererErrors: [] };
let app;
// Electron creates its overlay independently; firstWindow is not necessarily the app renderer.
const mainPage = async application => {
  for (let attempt = 0; attempt < 150; attempt++) {
    const found = application.windows().find(w => w.url().startsWith('file:') && !w.url().includes('#overlay'));
    if (found) { await found.waitForLoadState('domcontentloaded'); return found; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Main app renderer not found');
};
const deadline = setTimeout(() => {
  console.error('Dev visual capture exceeded 900 seconds');
  app?.process().kill('SIGKILL');
  process.exitCode = 1;
}, 900_000);
try {
  const env = { ...process.env, SB_DEMO: '1', SB_DEMO_FREEZE: '1', SB_HIDDEN: '1', SB_TEST: '1',
    SB_USER_DATA: profile, SB_MCP_PORT: '0', SB_LANG: 'it' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'SB_BRAIN', 'SB_RELEASE', 'SB_RELEASE_ID', 'SB_ENGINE_CLAUDE']) delete env[key];
  app = await electron.launch({ cwd: root, args: ['.'], env, timeout: 30_000 });
  let page = await mainPage(app);
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => manifest.rendererErrors.push(error.message));
  await page.locator('html[data-clock="frozen"]').waitFor();
  await page.getByTestId('tile-orchestrator').waitFor();
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay'));
    if (!win) throw new Error('Dev window missing');
    win.setContentSize(1600, 1100);
  });
  const capture = async name => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const captured = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay'));
      if (!win) throw new Error('Dev window missing');
      const image = await win.webContents.capturePage(undefined, { stayHidden: true });
      if (image.isEmpty()) throw new Error('Empty dev screenshot');
      return { png: image.toPNG().toString('base64'), size: image.getSize() };
    });
    await fs.writeFile(path.join(output, `${name}.png`), Buffer.from(captured.png, 'base64'));
    manifest.captures.push({ name, ...captured.size });
  };
  await app.evaluate(() => {
    const demo = globalThis.__sbDemo;
    const at = 1791707400000;
    demo.tree();
    demo.plan('tree-plan', { phase: 'done', at, clarified: [], steps: [
      { title: 'Analizzo il requisito', role: 'scout', state: 'done', outcome: 'done' },
      { title: 'Preparo il risultato', role: 'artisan', state: 'done', outcome: 'partial' },
      { title: 'Verifico il risultato', role: 'sentinel', state: 'done', outcome: 'blocked' },
    ] });
    demo.notice('orchestrator', 'resultReady', { role: 'Strategist', title: 'Piano dimostrativo', summary: 'Risultato disponibile con limiti dichiarati.', chatId: 'tree-plan' }, {
      taskId: 'visual-demo', taskVersion: 1, runId: 'visual-run', at, outcome: 'partial', summary: 'Risultato disponibile con limiti dichiarati.',
      output: '## Risultato completo\n\nLa proposta è pronta. La verifica finale resta da completare.',
      questions: ['Quale ambiente usare per la verifica?'], doneWhen: [
        { criterion: 'Proposta disponibile', met: true, evidence: 'Documento dimostrativo' },
        { criterion: 'Verifica completata', met: false, evidence: 'Ambiente non disponibile' },
      ],
    });
  });
  // The frozen demo starts with several requests. Keep a capture of the real modal, then defer each request
  // through its visible control so the plan beneath it is reachable without answering or disabling popups.
  const questions = page.getByTestId('qwin');
  await questions.waitFor();
  await capture('request-queue');
  for (let deferred = 0; await questions.isVisible(); deferred++) {
    if (deferred >= 20) throw new Error('Demo request queue did not clear after postponing 20 requests');
    const key = await questions.locator('[data-request-key]').getAttribute('data-request-key');
    if (!key) throw new Error('Visible request has no identity');
    await questions.getByTestId('qwin-later').click();
    await page.waitForFunction(previous => document.querySelector('[data-testid="qwin"] [data-request-key]')?.getAttribute('data-request-key') !== previous, key);
  }
  await page.getByTestId('qwin-backdrop').waitFor({ state: 'hidden' });
  // Inspect the MCP form shell separately from narrative agent decisions; no connector or provider is called.
  await app.evaluate(() => {
    void globalThis.__sbDemo.ask('qa', { type: 'question', tool: 'mcp__fixture', title: 'MCP fixture: conferma pubblicazione',
      detail: 'Server: fixture\nConfermi la pubblicazione del documento dimostrativo?', input: {}, noAlways: true,
      questions: [{ question: 'Numero di copie', header: 'Obbligatorio · Numero intero · Minimo: 1 · Massimo: 3', multiSelect: false, options: [] }] });
  });
  await questions.locator('[data-testid$="-form-context"]').waitFor();
  await questions.locator('[data-testid$="-form-refuse"]').waitFor();
  await capture('mcp-form-context');
  await questions.locator('[data-testid$="-other"]').click();
  await questions.locator('textarea').fill('2');
  await capture('mcp-form-editing');
  await questions.locator('[data-testid$="-form-refuse"]').click();
  await questions.waitFor({ state: 'hidden' });
  await page.getByTestId('plan-toggle-tree-plan').waitFor();
  await page.getByTestId('tile-chat-tree-plan').scrollIntoViewIfNeeded();
  await capture('plan-compact');
  await page.getByTestId('plan-toggle-tree-plan').click();
  await page.getByTestId('plan-steps-tree-plan').waitFor();
  await capture('plan-expanded');
  const ready = page.getByTestId('tile-orchestrator').getByTestId('result-ready').filter({
    has: page.locator('[data-testid="chatref-open"][data-chat-id="tree-plan"]'),
  });
  await ready.getByTestId('result-ready-toggle').click();
  const result = ready.getByTestId('canonical-result');
  await result.waitFor();
  await result.scrollIntoViewIfNeeded();
  await result.getByText('Proposta disponibile', { exact: false }).waitFor();
  await capture('canonical-result');
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay'));
    w.setSize(1000, 700); w.webContents.setZoomFactor(1.1);
  });
  await page.waitForTimeout(300);
  manifest.compactTopbar = await page.evaluate(() => {
    const bar = document.querySelector('.topbar-main').getBoundingClientRect();
    return { fit: document.querySelector('.topbar').dataset.fit, width: innerWidth,
      clipped: [...document.querySelectorAll('.topbar-main button')].filter(b => b.getBoundingClientRect().width && b.getBoundingClientRect().right > bar.right + .5).map(b => b.dataset.testid) };
  });
  await capture('topbar-compact');
  if (manifest.compactTopbar.clipped.length) throw new Error(`Clipped topbar actions: ${manifest.compactTopbar.clipped.join(', ')}`);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay'));
    w.webContents.setZoomFactor(1); w.setSize(1600, 1100);
  });
  await page.getByTestId('nav-memoria').click();
  await page.getByTestId('bm-memory-page').waitFor();
  await page.getByTestId('mh-tab-statistiche').click();
  await page.getByTestId('mm-insights').waitFor();
  await capture('memory');
  // The Routine page on the package model (ADR 0175, 0176): the demo's packages and runs, no run is started.
  await page.getByTestId('nav-flussi').click();
  await page.getByTestId('routines-page').waitFor();
  await capture('routines');
  await page.locator('[data-testid^="routine-card-"]').first().click();
  await page.getByTestId('routine-detail').waitFor();
  await capture('routine-detail');
  // The demo has no review services. A separate isolated SB_TEST instance reads a clearly synthetic memory
  // store through real services; automatic token-spending work stays disabled. Production read-only pollers are
  // enabled for the subsequent idle trace, so it can expose background process launches and stalls.
  await captureRoutineWorkbench(app, page, capture);
  await app.close();
  app = undefined;
  const brain = path.join(profile, 'synthetic-brain'), realProfile = path.join(profile, 'review-profile');
  await fs.mkdir(path.join(brain, 'memory'), { recursive: true });
  await fs.mkdir(realProfile, { recursive: true });
  await fs.writeFile(path.join(brain, 'brain.json'), JSON.stringify({ machinery: 'product-v1', template: { OWNER: 'Synthetic fixture' } }));
  await fs.writeFile(path.join(realProfile, 'config.json'), JSON.stringify({ theme: 'dark' }));
  const measuredAt = Date.now(), history = Array.from({ length: 5000 }, (_, i) => ({
    runId: `r_${(0xe00000000000 + i).toString(16)}`, chatId: `fixture-${i}`, agentId: 'artisan', version: 1,
    goal: 'Fix the fixture parser and verify the result. '.repeat(14), startedBy: 'user',
    startedAt: measuredAt - (5001 - i) * 300_000, endedAt: measuredAt - (5001 - i) * 300_000 + 120_000,
    endReason: 'completed', executionMs: 120_000, costUsd: 0.2, tokens: null,
    counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null },
    corrections: { tagged: 0, afterReport: 0 }, tags: { skills: ['fixture-skill'] },
  }));
  await fs.writeFile(path.join(realProfile, 'agent-runs.json'), JSON.stringify({ version: 1, runs: history }));
  const baseline = path.join(profile, 'read-baseline.cjs');
  await bundle({ stdin: { contents: "export { estimatesState } from './src/main/agents/run-estimates.ts';", resolveDir: root },
    outfile: baseline, bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    define: { 'import.meta': '__readMeta' }, banner: { js: "const __readMeta = { url: require('node:url').pathToFileURL(__filename).href, dirname: __dirname, filename: __filename };" } });
  const observedAt = '2026-10-11T08:30:00.000Z';
  await fs.writeFile(path.join(brain, 'memory/records.json'), JSON.stringify([{
    memoryId: 'synthetic-visual-memory', scope: { roleId: 'scout', project: 'DEMO SINTETICA', environment: 'sandbox' },
    subject: 'Esempio sintetico', predicate: 'ramo di lavoro', value: 'main — dato dimostrativo, non una preferenza reale',
    sourceEventId: 'synthetic-event', sourceRunId: 'synthetic-run', observedAt, validFrom: observedAt, validTo: null,
    status: 'confirmed', supersedes: null, transitions: [{ at: observedAt, status: 'confirmed' }],
  }], null, 2));
  const routineRuns = path.join(profile, 'terminal-runs');
  const usageFixture = path.join(profile, 'synthetic-usage');
  await fs.mkdir(usageFixture, { recursive: true });
  await fs.writeFile(path.join(usageFixture, 'cursor-ledger.jsonl'), Array.from({ length: 5000 }, (_, i) => JSON.stringify({ at: Date.now() - i * 1000, source: 'hook', conversationId: 'visual-conversation', generationId: `visual-${i}`, model: 'grok-4.7', input: 100, cacheWrite: 0, cacheRead: 0, output: 10 })).join('\n'));
  const reviewEnv = { ...env, ROUTINE_RUNS_DIR: routineRuns, SB_BRAIN: brain, SB_USER_DATA: realProfile, SB_CURSOR_LEDGER: usageFixture, SB_DOWNLOADS: usageFixture, SB_BENCH_TIMERS: '1', SB_ORCHESTRATOR_EVENTS: '0', SB_RUN_RESULTS: '0', SB_BRAIN_JOBS: '0', SB_COMPARE_QUEUE: '0' };
  delete reviewEnv.SB_DEMO;
  delete reviewEnv.SB_DEMO_FREEZE;
  app = await electron.launch({ cwd: root, args: ['.'], env: reviewEnv, timeout: 30_000 });
  page = await mainPage(app);
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => manifest.rendererErrors.push(error.message));
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay'));
    win.setContentSize(1600, 1100);
  });
  await page.getByTestId('nav-home').waitFor();
  const setup = page.getByTestId('first-interview');
  await setup.waitFor({ timeout: 3000 }).catch(() => {});
  if (await setup.isVisible()) { await page.keyboard.press('Escape'); await setup.waitFor({ state: 'hidden' }); }
  // Same 5,000-run history: former synchronous calculation vs the real asynchronous IPC handler.
  const runIds = history.slice(-3).map(r => r.runId);
  manifest.readPerformance = { startedAt: new Date().toISOString(), runs: history.length,
    bytes: (await fs.stat(path.join(realProfile, 'agent-runs.json'))).size };
  manifest.readPerformance.before = await app.evaluate(async (_electron, { baseline, history, runIds, now }) => {
    const { estimatesState } = process.getBuiltinModule('module').createRequire(baseline)(baseline);
    const start = performance.now(); const value = estimatesState(history, runIds, now);
    return { mainBlockedMs: performance.now() - start, accuracyN: value.accuracy.n };
  }, { baseline, history, runIds, now: measuredAt });
  await app.evaluate(() => {
    let previous = performance.now();
    const trace = globalThis.__readTrace = { maxDelayMs: 0, samples: 0 };
    trace.timer = setInterval(() => { const now = performance.now(); trace.maxDelayMs = Math.max(trace.maxDelayMs, now - previous - 10); trace.samples++; previous = now; }, 10);
  });
  const requested = Date.now();
  const readResult = await page.evaluate(async runIds => ({ estimates: await window.sb.invoke('agents:estimates', { runIds }), brain: await window.sb.invoke('brainmodel:state', undefined) }), runIds);
  await page.waitForTimeout(30);
  manifest.readPerformance.after = await app.evaluate(() => { const trace = globalThis.__readTrace; clearInterval(trace.timer); return { mainMaxDelayMs: trace.maxDelayMs, samples: trace.samples }; });
  manifest.readPerformance.after.requestMs = Date.now() - requested;
  manifest.readPerformance.after.accuracyN = readResult.estimates.accuracy.n;
  manifest.readPerformance.endedAt = new Date().toISOString();
  if (readResult.estimates.accuracy.n !== manifest.readPerformance.before.accuracyN) throw new Error('Worker estimate differs from synchronous reference');
  await fs.writeFile(path.join(output, 'read-performance.json'), JSON.stringify(manifest.readPerformance, null, 2));
  await startRoutineTrace(app, [routineRuns, path.join(realProfile, 'flows'), path.join(realProfile, 'routines'), path.join(realProfile, 'routine-runs')]);
  manifest.routineIdle = await idleRoutineTrace(app, 'home before opening routines');
  await captureTerminalRoutine({ app, page, capture, root, profile, runs: routineRuns, output, manifest });
  manifest.idlePerformance = await captureIdlePerformance(app, page, output);
  await page.getByTestId('nav-memoria').click();
  // Facts no longer enter the proposals deck (ADR 0150). Inspect the saved fact in Approvate and check
  // its source through the read-only review API, without resurrecting the retired approval path.
  await page.getByTestId('mh-tab-approvate').click();
  const memory = page.getByTestId('mh-ap-fact-synthetic-visual-memory');
  await memory.waitFor();
  const records = await page.evaluate(() => window.sb.invoke('memory:reviewList', undefined));
  if (!records.some(record => record.memoryId === 'synthetic-visual-memory' && record.sourceRunId === 'synthetic-run')) throw new Error('Synthetic memory provenance missing');
  await memory.scrollIntoViewIfNeeded();
  await capture('memory-saved-fact-synthetic');
  // Review panels were replaced by hub tabs; capture the current learning view without running an evaluation.
  await page.getByTestId('mh-tab-apprendimento').click();
  const learning = page.getByTestId('learning-page');
  await learning.getByTestId('lr-counter').waitFor();
  await learning.scrollIntoViewIfNeeded();
  await capture('learning-cold-start-synthetic');
  manifest.reviewFixture = 'Real services; synthetic saved fact in Approvate and empty learning history in Apprendimento; no decisions, replay or provider launched';
  if (manifest.rendererErrors.length) throw new Error('Renderer errors; inspect manifest.json');
  console.log(`Captured ${manifest.captures.length} dev views in ${output}`);
} catch (error) {
  manifest.error = String(error);
  process.exitCode = 1;
  console.error(error);
} finally {
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  try { await app?.close(); } finally {
    clearTimeout(deadline);
    await fs.rm(profile, { recursive: true, force: true });
  }
}
