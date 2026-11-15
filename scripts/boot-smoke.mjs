// Starts the built app once on this machine and proves it comes up: the frozen demo (no providers, no tokens) in an
// isolated profile, the Orchestrator on screen, every sidebar page opened with no renderer error, one picture taken,
// and a clean quit. Why: the app is written on Windows; this is the proof that it also starts on macOS and Linux
// (ADR 0054 stage 5), run by CI on the three systems (a step of job `check` in .github/workflows/ci.yml) and by hand:
// `node scripts/build.mjs --dev && node scripts/boot-smoke.mjs` (Linux without a display: under `xvfb-run`).
// Not a test of features: the e2e suite does that. Exit 0 = started, rendered and quit; 1 = the reason in the output.
import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'test-results', 'boot-smoke');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-boot-'));
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });

const report = { platform: process.platform, arch: process.arch, revision: process.env.GITHUB_SHA ?? 'local', pages: [], rendererErrors: [], mainErrors: [] };
const isMain = url => url.startsWith('file:') && !url.includes('#overlay');
let app, failed = null;
// one ceiling for the whole run: a start that hangs must end the job with a reason, never wait for the runner's own
const ceiling = setTimeout(() => { console.error('boot smoke: no result after 300 s'); app?.process().kill('SIGKILL'); process.exit(1); }, 300_000);

try {
  const env = { ...process.env, SB_DEMO: '1', SB_DEMO_FREEZE: '1', SB_HIDDEN: '1', SB_TEST: '1', SB_USER_DATA: profile, SB_MCP_PORT: '0', SB_LANG: 'en' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'SB_BRAIN', 'SB_RELEASE', 'SB_RELEASE_ID', 'SB_ENGINE_CLAUDE']) delete env[key];
  const extra = (process.env.SB_E2E_ELECTRON_ARGS ?? '').split(/\s+/).filter(Boolean);
  app = await electron.launch({ cwd: root, args: ['.', ...extra], env, timeout: 60_000 });
  app.process().stderr?.on('data', d => { const t = String(d); if (/Uncaught|UnhandledPromiseRejection|Error: /.test(t)) report.mainErrors.push(t.trim().slice(0, 500)); });

  // Electron may open its overlay window first, and a window can show before it has its URL: look again until the
  // app's own renderer is there (as test/e2e/helpers.ts does), never wait for one more window event
  let page;
  for (const until = Date.now() + 60_000; !(page = app.windows().find(w => isMain(w.url()))); ) {
    if (Date.now() > until) throw new Error('the main window did not open in 60 s');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  page.setDefaultTimeout(30_000);
  page.on('pageerror', error => report.rendererErrors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('tile-orchestrator').waitFor();

  // every page the sidebar offers, through its own items: a page that throws on this OS shows here
  const ids = (await page.locator('[data-testid^="nav-"]').evaluateAll(list => list.map(el => el.getAttribute('data-testid'))))
    .filter(id => id && !/^nav-(tree|badge|group|back$|forward$)/.test(id));
  for (const id of [...new Set(ids)]) {
    await page.getByTestId(id).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    report.pages.push(id);
  }
  await page.getByTestId('nav-home').click();
  await page.getByTestId('tile-orchestrator').waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay'));
    if (!win) throw new Error('main window missing');
    const image = await win.webContents.capturePage(undefined, { stayHidden: true });
    if (image.isEmpty()) throw new Error('empty picture of the main window');
    return image.toPNG().toString('base64');
  });
  await fs.writeFile(path.join(output, `home-${process.platform}.png`), Buffer.from(png, 'base64'));

  report.versions = await app.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome }));
  const exited = new Promise(resolve => app.process().once('exit', code => resolve(code)));
  await app.evaluate(({ app: a }) => { a.quit(); });
  report.exitCode = await exited;
  app = null;
  if (report.rendererErrors.length) failed = `renderer errors: ${report.rendererErrors.join(' | ')}`;
  else if (report.exitCode !== 0) failed = `the app quit with code ${report.exitCode}`;
  else if (!report.pages.length) failed = 'no sidebar page found to open';
} catch (error) {
  failed = error instanceof Error ? error.stack ?? error.message : String(error);
  app?.process().kill('SIGKILL');
} finally {
  clearTimeout(ceiling);
  report.ok = !failed;
  if (failed) report.failure = failed;
  await fs.writeFile(path.join(output, `report-${process.platform}.json`), JSON.stringify(report, null, 1));
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}
console.log(failed ? `boot smoke: FAILED on ${process.platform}-${process.arch}\n${failed}` : `boot smoke: ok on ${process.platform}-${process.arch} (${report.pages.length} pages, Electron ${report.versions?.electron})`);
if (report.mainErrors.length) console.log(`main process output worth reading:\n${report.mainErrors.join('\n')}`);
process.exit(failed ? 1 : 0);
