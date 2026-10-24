// Captures the hidden frozen dev app for PR visual review, without running the E2E suite or live providers.
// CI builds first and supplies Xvfb on Linux. Native capturePage images and a manifest are uploaded for human review.
import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
  console.error('Dev visual capture exceeded 180 seconds');
  app?.process().kill('SIGKILL');
  process.exitCode = 1;
}, 180_000);
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
  await page.getByTestId('nav-memoria').click();
  await page.getByTestId('bm-memory-page').waitFor();
  await page.getByTestId('mh-tab-statistiche').click();
  await page.getByTestId('mm-insights').waitFor();
  await capture('memory');
  // Synthetic definition only: inspect fullscreen step details without launching any flow or provider.
  const flow = { id: 'visual-flow', title: 'Revisione documento — demo sintetica', description: 'Ogni passaggio mostra descrizione, ruolo, livello e modello.', aliases: [], scope: { project: 'Demo sintetica' }, steps: Array.from({ length: 6 }, (_, i) => ({
    id: `step-${i}`, title: `${i + 1}. ${['Analisi', 'Piano', 'Implementazione', 'Review', 'Verifica', 'Riepilogo'][i]}`,
    kind: 'agent', role: i === 3 ? 'sentinel' : 'artisan', tier: 'mid',
    instructions: `Descrizione completa del passaggio ${i + 1}. Controlla i documenti selezionati e registra il risultato.\nMantieni visibili i vincoli e le evidenze prima di proseguire.`,
    inputs: ['workspace'], evidence: ['Report del passaggio e risultato verificabile.'], timeoutMs: 60000, maxAttempts: 2, effect: 'read-only',
  })) };
  const flowSnapshot = { contextKey: 'synthetic-visual-flow', drafts: [], active: { [flow.id]: 1 }, versions: [{ definition: flow, version: 1, draftRevision: 1, digest: 'visual-only', activatedAt: 1 }], runs: [], roles: Object.fromEntries(['artisan', 'sentinel'].map(role => [role, {
    name: role === 'artisan' ? 'Artisan' : 'Sentinel', avatar: { kind: 'character', value: role }, tier: 'mid', tierMax: 'top', model: null, models: { mid: 'demo-model' },
  }])) };
  await page.getByTestId('nav-flussi').click();
  await app.evaluate(({ BrowserWindow }, snapshot) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay'));
    win.webContents.send('flows:changed', snapshot);
  }, flowSnapshot);
  await page.getByTestId('flow-fullscreen-open').click();
  const fullscreen = page.getByTestId('flow-fullscreen');
  await fullscreen.getByTestId('flow-fullscreen-steps').waitFor();
  await capture('flow-fullscreen-details');
  await fullscreen.locator('.flow-step').last().scrollIntoViewIfNeeded();
  await capture('flow-fullscreen-last-step');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay'));
    win.setContentSize(600, 900);
  });
  await fullscreen.locator('.flow-step').first().scrollIntoViewIfNeeded();
  await capture('flow-fullscreen-narrow');
  await page.keyboard.press('Escape');
  // The demo has no review services. A separate isolated SB_TEST instance reads a clearly synthetic memory
  // store through the real services; no replay/run actions are clicked and all automatic work stays disabled.
  await app.close();
  app = undefined;
  const brain = path.join(profile, 'synthetic-brain'), realProfile = path.join(profile, 'review-profile');
  await fs.mkdir(path.join(brain, 'memory'), { recursive: true });
  await fs.mkdir(realProfile, { recursive: true });
  await fs.writeFile(path.join(realProfile, 'config.json'), JSON.stringify({ theme: 'dark' }));
  const observedAt = '2026-10-11T08:30:00.000Z';
  await fs.writeFile(path.join(brain, 'memory/records.json'), JSON.stringify([{
    memoryId: 'synthetic-visual-memory', scope: { roleId: 'scout', project: 'DEMO SINTETICA', environment: 'sandbox' },
    subject: 'Esempio sintetico', predicate: 'ramo di lavoro', value: 'main — dato dimostrativo, non una preferenza reale',
    sourceEventId: 'synthetic-event', sourceRunId: 'synthetic-run', observedAt, validFrom: observedAt, validTo: null,
    status: 'proposed', supersedes: null, transitions: [{ at: observedAt, status: 'proposed' }],
  }], null, 2));
  const reviewEnv = { ...env, SB_BRAIN: brain, SB_USER_DATA: realProfile, SB_ORCHESTRATOR_EVENTS: '0', SB_RUN_RESULTS: '0', SB_BRAIN_JOBS: '0', SB_COMPARE_QUEUE: '0' };
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
  await page.getByTestId('nav-memoria').click();
  await page.getByTestId('mh-tab-proposte').click();
  await page.getByTestId('pd-chip-fact').click();
  const memory = page.getByTestId('pd-card-top').and(page.locator('[data-card="memory:synthetic-visual-memory"]'));
  await memory.waitFor();
  await memory.getByTestId('pd-more').click();
  await memory.getByTestId('pd-provenance').getByText('synthetic-run', { exact: false }).waitFor();
  await memory.scrollIntoViewIfNeeded();
  await capture('memory-provenance-synthetic');
  // Review panels were replaced by hub tabs; capture the current learning view without running an evaluation.
  await page.getByTestId('mh-tab-apprendimento').click();
  const learning = page.getByTestId('learning-page');
  await learning.getByTestId('lr-counter').waitFor();
  await learning.scrollIntoViewIfNeeded();
  await capture('learning-cold-start-synthetic');
  manifest.reviewFixture = 'Real services; synthetic memory proposal in Proposte and empty learning history in Apprendimento; no decisions, replay or provider launched';
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
