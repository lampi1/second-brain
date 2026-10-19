// End-to-end: the first-run setup on a fresh profile (no brain) with a fixture home (SB_HOME, never the user's):
// (1) every text field of every step takes a whole word typed key by key and keeps the focus (the Modal used to
// re-run its focus effect on each keystroke, so only the first letter landed); (2) a connected AI and each tool end in
// a real check with a clear state: Claude turns "Collegata" by itself after its sign-in window (no Verifica click),
// GitHub "Connesso come …" after the probe, Jira "Non connesso" with the reason and what to do, Azure waiting for its
// window; (3) the folders step: no options to choose, a new memory by default, the projects folder found by itself
// in the fixture home, changed with the (stubbed) native picker, asked when nothing is found, and on confirm saved in
// projectsRoot with the new memory's REPOS pointing there; Settings → Il mio spazio shows it, re-detects and changes it. CLI status, sign-ins, probes and the folder dialog are
// replaced in main: no CLI runs, no network, no tokens. Screenshots: test-results/shots/setup-onboarding-*.png (dark
// and light).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launch, setSize, shot } from './helpers';

/** types a word key by key into each visible text field of the step: the whole word lands and the focus stays */
async function typeEverywhere(page: Page, scope: Locator): Promise<number> {
  const fields = scope.locator('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea');
  let typed = 0;
  for (let i = 0; i < await fields.count(); i++) {
    const field = fields.nth(i);
    if (!await field.isVisible() || !await field.isEditable()) continue;
    await field.click();
    await field.press('ControlOrMeta+a'); await field.press('Delete');
    await page.keyboard.type('Prova scrittura', { delay: 25 });
    await expect(field).toHaveValue('Prova scrittura');
    await expect(field).toBeFocused();
    await field.press('ControlOrMeta+a'); await field.press('Delete');
    typed++;
  }
  return typed;
}
const light = async (page: Page, on: boolean) => page.evaluate(v => { document.documentElement.dataset.theme = v ? 'light' : 'dark'; }, on);

test('setup: fields take typing, connectors end in a real check, folders without options', async () => {
  test.setTimeout(120_000);
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-home-')));
  const found = path.join(home, 'Projects'), picked = path.join(home, 'lavoro', 'clienti');
  for (const repo of ['shop', 'api']) fs.mkdirSync(path.join(found, repo, '.git'), { recursive: true });
  fs.mkdirSync(picked, { recursive: true });
  const { app, page, userData } = await launch({ SB_HOME: home });
  try {
    await setSize(app, 1600, 1000);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await app.evaluate(({ dialog, ipcMain }, dir) => {
      const g = globalThis as unknown as { signedIn: boolean; probes: Record<string, number> };
      g.signedIn = false; g.probes = {};
      // the native folder picker answers with the fixture folder (the real handler then saves projectsRoot)
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
      for (const name of ['cli:status', 'cli:login', 'engines:trust', 'connectors:list', 'connectors:login', 'connectors:probe']) ipcMain.removeHandler(name);
      ipcMain.handle('cli:status', (_e, a: { harness: string }) => a.harness === 'claude' ? { found: true, path: '/bin/claude', version: '2', loggedIn: g.signedIn, account: g.signedIn ? 'giulia@example.com' : null }
        : { found: false, path: null, version: null, loggedIn: null });
      ipcMain.handle('cli:login', () => undefined);
      ipcMain.handle('engines:trust', () => undefined);
      const base = (provider: string) => ({ provider, status: 'pending', checkedAt: null, account: null, projects: [], selected: [], detail: '' });
      const states: Record<string, unknown> = { github: base('github'), azure: base('azure'), jira: base('jira') };
      ipcMain.handle('connectors:list', () => Object.values(states));
      ipcMain.handle('connectors:login', (_e, a: { provider: string }) => { if (a.provider === 'jira') throw new Error('Portachiavi cifrato di sistema non disponibile'); });
      ipcMain.handle('connectors:probe', (_e, a: { provider: string }) => {
        const n = g.probes[a.provider] = (g.probes[a.provider] ?? 0) + 1;
        // GitHub: the first check runs while its sign-in window is still open, the next one finds the account
        const ok = a.provider === 'github' && n > 1;
        states[a.provider] = ok ? { ...base(a.provider), status: 'verified', checkedAt: new Date().toISOString(), account: 'giulia-dev', projects: [{ id: '1', name: 'giulia-dev/shop' }, { id: '2', name: 'giulia-dev/api' }, { id: '3', name: 'giulia-dev/site' }] }
          : { ...base(a.provider), status: 'failed', checkedAt: new Date().toISOString() };
        return states[a.provider];
      });
    }, picked);

    const setup = page.getByTestId('first-interview');
    await expect(setup).toBeVisible({ timeout: 15000 }); // a fresh profile opens it by itself
    const title = setup.locator('#sw-title');
    const next = () => setup.getByRole('button', { name: 'Continua', exact: true }).click();

    // 1 folders: no options, a new memory by default, the projects folder found by itself
    await expect(title).toHaveText('La tua memoria e i tuoi progetti');
    await expect(setup.getByTestId('setup-memory-card')).toHaveAttribute('data-state', 'new');
    await expect(setup.getByTestId('setup-memory-card')).toContainText(userData);
    await expect(setup.getByTestId('setup-memory').locator('input, textarea, details')).toHaveCount(0);
    const projects = setup.getByTestId('setup-projects');
    await expect(projects).toHaveAttribute('data-state', 'found');
    await expect(projects).toContainText(found);
    await expect(projects).toContainText('2 repository git');
    await shot(page, 'setup-onboarding-1-folders-found');
    await light(page, true); await shot(page, 'setup-onboarding-1-folders-found-light'); await light(page, false);
    await setup.getByTestId('setup-pick-projects').click();
    await expect(projects).toHaveAttribute('data-state', 'chosen');
    await expect(projects).toContainText(picked);
    expect((await page.evaluate(() => window.sb.invoke('settings:get', undefined))).projectsRoot).toBe(picked);

    // 2 AI: after Collega the card turns connected by itself once the sign-in is done (no Verifica click)
    await next();
    const claude = setup.getByTestId('setup-engine-claude');
    await expect(claude).toHaveAttribute('data-phase', 'signedOut');
    await setup.getByTestId('setup-connect-claude').click();
    await expect(claude).toHaveAttribute('data-phase', 'waiting');
    await app.evaluate(() => { (globalThis as unknown as { signedIn: boolean }).signedIn = true; });
    await expect(claude).toHaveAttribute('data-phase', 'connected', { timeout: 10_000 });
    await expect(setup.getByTestId('setup-engine-claude-checked')).toContainText('senza consumare token');
    await expect(claude).toContainText('giulia@example.com');
    await expect(setup.getByTestId('setup-use-claude')).toBeChecked();
    await shot(page, 'setup-onboarding-2-ai-connected');

    // 3 tools: typing in the textarea, then every connector ends in a real check with a clear state
    await next();
    await expect(title).toHaveText('Collega i tuoi strumenti');
    expect(await typeEverywhere(page, setup)).toBe(1);
    const github = setup.getByTestId('setup-tool-github'), jira = setup.getByTestId('setup-tool-jira'), azure = setup.getByTestId('setup-tool-azure');
    await expect(github).toHaveAttribute('data-phase', 'idle');
    await expect(setup.getByTestId('setup-tool-github-status')).toHaveText('Non collegato');
    await shot(page, 'setup-onboarding-3-tools-idle');
    await setup.getByTestId('setup-tool-github-connect').click();
    await expect(github).toHaveAttribute('data-phase', 'waiting');
    await expect(setup.getByTestId('setup-tool-github-waiting')).toContainText('verifichiamo da soli');
    await expect(github).toHaveAttribute('data-phase', 'connected', { timeout: 10_000 }); // the automatic re-check
    await expect(setup.getByTestId('setup-tool-github-status')).toHaveText('Connesso');
    await expect(setup.getByTestId('setup-tool-github-ok')).toContainText('Connesso come giulia-dev');
    await expect(setup.getByTestId('setup-tool-github-ok')).toContainText('3 progetti (sola lettura)');
    await setup.getByTestId('setup-tool-jira-connect').click();
    await expect(jira).toHaveAttribute('data-phase', 'error');
    await expect(setup.getByTestId('setup-tool-jira-bad')).toContainText('Portachiavi cifrato di sistema non disponibile');
    await expect(setup.getByTestId('setup-tool-jira-bad')).toContainText('Cosa fare');
    await setup.getByTestId('setup-tool-azure-connect').click();
    await expect(azure).toHaveAttribute('data-phase', 'waiting');
    await expect(setup).toBeVisible(); // nothing here closes the modal
    await setup.getByTestId('setup-tools').scrollIntoViewIfNeeded();
    await shot(page, 'setup-onboarding-3-tools-states');
    await light(page, true); await shot(page, 'setup-onboarding-3-tools-states-light'); await light(page, false);

    // 4 about you, 5 your work: every field takes typing key by key
    await next();
    await expect(title).toHaveText('Raccontaci chi sei');
    expect(await typeEverywhere(page, setup)).toBe(3);
    await setup.getByTestId('setup-name').pressSequentially('Giulia', { delay: 25 });
    await setup.getByTestId('setup-role').pressSequentially('product manager', { delay: 25 });
    await expect(setup.getByTestId('setup-name')).toHaveValue('Giulia');
    await shot(page, 'setup-onboarding-4-you');
    await light(page, true); await shot(page, 'setup-onboarding-4-you-light'); await light(page, false);
    await next();
    await expect(title).toHaveText('Il tuo lavoro');
    expect(await typeEverywhere(page, setup)).toBe(2);
    await setup.getByTestId('setup-goals').pressSequentially('Preparare le riunioni\ndel lunedì', { delay: 15 });
    await expect(setup.getByTestId('setup-goals')).toHaveValue('Preparare le riunioni\ndel lunedì');
    await shot(page, 'setup-onboarding-5-work');

    // summary: the projects folder is there; confirm creates the memory pointing at it
    await next(); await next();
    await expect(title).toHaveText('Tutto pronto');
    await expect(setup).toContainText(picked);
    await shot(page, 'setup-onboarding-7-done');
    await page.getByTestId('setup-complete').click();
    await expect(setup).toBeHidden({ timeout: 15000 });
    const info = await page.evaluate(() => window.sb.invoke('app:info', undefined));
    expect(info.brainRoot?.startsWith(userData)).toBe(true);
    const brain = JSON.parse(fs.readFileSync(path.join(info.brainRoot!, 'brain.json'), 'utf8')) as { template: { REPOS: string } };
    expect(brain.template.REPOS).toBe(picked.split(path.sep).join('/'));

    // Settings → Il mio spazio shows the same folder: Rileva di nuovo finds the other one, «Usa questa» saves it
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    const row = page.getByTestId('st-projects');
    await row.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('st-projects-value')).toHaveText(picked);
    await expect(page.getByTestId('st-help-projects')).toBeVisible();
    await page.getByTestId('st-projects-detect').click();
    await expect(page.getByTestId('st-projects-found')).toContainText(found);
    await shot(page, 'setup-onboarding-8-settings-projects');
    await light(page, true); await shot(page, 'setup-onboarding-8-settings-projects-light'); await light(page, false);
    await page.getByTestId('st-projects-found').getByRole('button', { name: 'Usa questa', exact: true }).click();
    await expect(page.getByTestId('st-projects-value')).toHaveText(found);
    expect((await page.evaluate(() => window.sb.invoke('settings:get', undefined))).projectsRoot).toBe(found);

    // nothing found and nothing saved: the step asks for the folder
    await page.evaluate(() => window.sb.invoke('settings:set', { projectsRoot: null }));
    for (const repo of ['shop', 'api']) fs.rmSync(path.join(found, repo, '.git'), { recursive: true });
    await page.getByRole('button', { name: 'Configura il mio lavoro', exact: true }).click();
    await expect(title).toHaveText('La tua memoria e i tuoi progetti');
    await expect(setup.getByTestId('setup-memory-card')).toHaveAttribute('data-state', 'connected');
    await expect(projects).toHaveAttribute('data-state', 'ask');
    await expect(projects).toContainText('Dove tieni i tuoi progetti?');
    await shot(page, 'setup-onboarding-1-folders-ask');
    await light(page, true); await shot(page, 'setup-onboarding-1-folders-ask-light');
  } finally { await app.close(); }
});
