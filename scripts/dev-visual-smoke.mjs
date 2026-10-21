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
const manifest = { revision: process.env.GITHUB_SHA ?? 'local', mode: 'hidden frozen synthetic demo', captures: [], rendererErrors: [] };
let app;
const deadline = setTimeout(() => {
  console.error('Dev visual capture exceeded 120 seconds');
  app?.process().kill('SIGKILL');
  process.exitCode = 1;
}, 120_000);
try {
  const env = { ...process.env, SB_DEMO: '1', SB_DEMO_FREEZE: '1', SB_HIDDEN: '1', SB_TEST: '1',
    SB_USER_DATA: profile, SB_MCP_PORT: '0', SB_LANG: 'it' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'SB_BRAIN', 'SB_RELEASE', 'SB_RELEASE_ID', 'SB_ENGINE_CLAUDE']) delete env[key];
  app = await electron.launch({ cwd: root, args: ['.'], env, timeout: 30_000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => manifest.rendererErrors.push(error.message));
  await page.waitForURL(url => url.protocol === 'file:' && !url.hash.includes('overlay'));
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
  await page.getByTestId('plan-toggle-tree-plan').waitFor();
  await page.getByTestId('tile-chat-tree-plan').scrollIntoViewIfNeeded();
  await capture('plan-compact');
  await page.getByTestId('plan-toggle-tree-plan').click();
  await page.getByTestId('plan-steps-tree-plan').waitFor();
  await capture('plan-expanded');
  const result = page.getByTestId('canonical-result').last();
  await result.locator('summary').click();
  await result.scrollIntoViewIfNeeded();
  await result.getByText('Proposta disponibile', { exact: false }).waitFor();
  await capture('canonical-result');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('g');
  await page.keyboard.press('y');
  await page.getByTestId('bm-memory-page').waitFor();
  await page.getByTestId('mm-insights').waitFor();
  await capture('memory');
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
