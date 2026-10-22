// End-to-end: the first-run setup on a fresh profile (no brain) with a fixture home (SB_HOME, never the user's):
// (1) every text field of every step takes a whole word typed key by key and keeps the focus (the Modal used to
// re-run its focus effect on each keystroke, so only the first letter landed); (2) a connected AI and each tool tile end
// in a real check with a clear state: Claude (the recommended AI here) turns "Collegata" by itself after its sign-in
// window (no Verifica click); the Azure DevOps tile asks only the organization, waits for its sign-in window and ends
// "Funziona: vedo N progetti"; the Jira tile asks site, email and token and, when the token cannot be kept, says why
// and what to do (ADR 0119); (3) the folders step: always a new brain in the default place, the projects folder found
// by itself in the fixture home, changed with the (stubbed) native picker, asked when nothing is found, and on confirm
// saved in projectsRoot with the new brain's REPOS pointing there; Settings → Il mio spazio shows it, re-detects and
// changes it; (4) on confirm the first guide chat starts on the chosen AI with the guide's brief (goals, areas and team
// are asked there). CLI status, sign-ins, account checks, the MCP servers' store and test, chat creation and the folder
// dialog are replaced in main: no CLI runs, no network, no tokens. Screenshots: test-results/shots/setup-onboarding-*.png
// (dark and light).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launch, setSize, shot } from './helpers';
import { guidePrompt } from '../../src/modules/ai-first/model';

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
const ADO = 'https://dev.azure.com/'; // the organization URL, joined at run time (the publish guard flags real-looking hosts)
const light = async (page: Page, on: boolean) => page.evaluate(v => { document.documentElement.dataset.theme = v ? 'light' : 'dark'; }, on);

test('setup: fields take typing, tools end in a real check, a new brain, the guide chat on confirm', async () => {
  test.setTimeout(150_000);
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-home-')));
  const found = path.join(home, 'Projects'), picked = path.join(home, 'lavoro', 'clienti');
  for (const repo of ['shop', 'api']) fs.mkdirSync(path.join(found, repo, '.git'), { recursive: true });
  fs.mkdirSync(picked, { recursive: true });
  const { app, page, userData } = await launch({ SB_HOME: home });
  try {
    await setSize(app, 1600, 1000);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await app.evaluate(({ dialog, ipcMain }, dir) => {
      const g = globalThis as unknown as { signedIn: boolean; probes: Record<string, number>; chats: unknown[] };
      g.signedIn = false; g.probes = {}; g.chats = [];
      // the native folder picker answers with the fixture folder (the real handler then saves projectsRoot)
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
      for (const name of ['cli:status', 'cli:login', 'engines:trust', 'connectors:list', 'connectors:login', 'connectors:probe', 'connectors:useToken', 'mcpservers:state', 'mcpservers:save', 'mcpservers:setSecret', 'mcpservers:test', 'chat:create']) ipcMain.removeHandler(name);
      ipcMain.handle('cli:status', (_e, a: { harness: string }) => a.harness === 'claude' ? { found: true, path: '/bin/claude', version: '2', loggedIn: g.signedIn, account: g.signedIn ? 'giulia@example.com' : null }
        : { found: false, path: null, version: null, loggedIn: null });
      ipcMain.handle('cli:login', () => undefined);
      ipcMain.handle('engines:trust', () => undefined);
      const base = (provider: string) => ({ provider, status: 'pending', checkedAt: null, account: null, projects: [], selected: [], detail: '' });
      const states: Record<string, unknown> = { github: base('github'), azure: base('azure'), jira: base('jira') };
      ipcMain.handle('connectors:list', () => Object.values(states));
      ipcMain.handle('connectors:login', () => undefined);
      ipcMain.handle('connectors:useToken', () => { throw new Error('Portachiavi cifrato di sistema non disponibile'); });
      ipcMain.handle('connectors:probe', (_e, a: { provider: string }) => {
        const n = g.probes[a.provider] = (g.probes[a.provider] ?? 0) + 1;
        // Azure: the first check runs while its sign-in window is still open, the next one finds the account
        const ok = a.provider === 'azure' && n > 1;
        states[a.provider] = ok ? { ...base(a.provider), status: 'verified', checkedAt: new Date().toISOString(), account: 'giulia@example.com', projects: [{ id: '1', name: 'Shop' }, { id: '2', name: 'Api' }] }
          : { ...base(a.provider), status: 'pending', checkedAt: new Date().toISOString() };
        return states[a.provider];
      });
      // the app's MCP servers, in memory: the test answers at once (no npx, no network)
      const servers: Record<string, Record<string, unknown>> = {};
      const view = () => ({ servers: Object.values(servers), access: {}, secretsAvailable: true });
      ipcMain.handle('mcpservers:state', () => view());
      ipcMain.handle('mcpservers:save', (_e, a: { def: Record<string, unknown> }) => { servers[a.def.id as string] = { ...a.def, secretMasks: {}, lastTest: null }; return view(); });
      ipcMain.handle('mcpservers:setSecret', () => view());
      ipcMain.handle('mcpservers:test', (_e, a: { id: string }) => { servers[a.id]!.lastTest = { ok: true, at: Date.now(), ms: 30, tools: [{ name: 'wit_my_work_items', description: '', readOnly: true }, { name: 'wit_add_comment', description: '', readOnly: false }] }; return view(); });
      ipcMain.handle('chat:create', (_e, req: unknown) => { g.chats.push(req); throw new Error('chat not started in this test'); });
    }, picked);

    const setup = page.getByTestId('first-interview');
    await expect(setup).toBeVisible({ timeout: 15000 }); // a fresh profile opens it by itself
    const title = setup.locator('#sw-title');
    const next = () => setup.getByTestId('setup-next').click();

    // 1 language
    await expect(title).toHaveText('Scegli la tua lingua');
    await next();

    // 2 AI: Claude is the recommended one; after Collega the card turns connected by itself (no Verifica click)
    const claude = setup.getByTestId('setup-engine-claude');
    await expect(claude).toHaveAttribute('data-phase', 'signedOut');
    await expect(claude).toHaveAttribute('data-recommended', 'true');
    await setup.getByTestId('setup-connect-claude').click();
    await expect(claude).toHaveAttribute('data-phase', 'waiting');
    await app.evaluate(() => { (globalThis as unknown as { signedIn: boolean }).signedIn = true; });
    await expect(claude).toHaveAttribute('data-phase', 'connected', { timeout: 10_000 });
    await expect(setup.getByTestId('setup-engine-claude-checked')).toContainText('senza consumare token');
    await expect(claude).toContainText('giulia@example.com');
    await expect(setup.getByTestId('setup-use-claude')).toBeChecked();
    await shot(page, 'setup-onboarding-2-ai-connected');

    // 3 tools: every tile ends in a real check with a clear state
    await next();
    await expect(title).toHaveText('Collega i tuoi strumenti');
    expect(await typeEverywhere(page, setup)).toBe(0); // nothing to type until a tile is opened
    const azure = setup.getByTestId('tool-tile-azure'), jira = setup.getByTestId('tool-tile-jira');
    await expect(azure).toHaveAttribute('data-phase', 'idle');
    await expect(setup.getByTestId('tool-azure-status')).toHaveText('Da collegare');
    await shot(page, 'setup-onboarding-3-tools-idle');
    await setup.getByTestId('tool-azure-connect').click();
    await expect(setup.getByTestId('tool-azure-form').locator('input')).toHaveCount(1); // only the organization
    await setup.getByTestId('tool-azure-organization').fill(`${ADO}contoso/Shop`);
    await setup.getByTestId('tool-azure-submit').click();
    await expect(azure).toHaveAttribute('data-phase', 'waiting');
    await expect(setup.getByTestId('tool-azure-waiting')).toContainText('verifichiamo da soli');
    await expect(azure).toHaveAttribute('data-phase', 'ok', { timeout: 10_000 }); // the automatic re-check
    await expect(setup.getByTestId('tool-azure-ok')).toContainText('Funziona: vedo 2 progetti');
    await expect(setup.getByTestId('tool-azure-ok')).toContainText('2 strumenti pronti');
    const server = (await page.evaluate(() => window.sb.invoke('mcpservers:state', undefined))).servers.find(s => s.id === 'azure-devops');
    expect(server).toMatchObject({ transport: 'stdio', command: 'npx', args: ['-y', '@azure-devops/mcp', 'contoso'] });
    await setup.getByTestId('tool-jira-connect').click();
    expect(await typeEverywhere(page, jira)).toBe(3); // site, email, token
    await setup.getByTestId('tool-jira-site').pressSequentially('acme', { delay: 15 });
    await setup.getByTestId('tool-jira-email').fill('giulia@example.com');
    await setup.getByTestId('tool-jira-token').fill('ATATT3xFfGF0-e2e-only');
    await expect(setup.getByTestId('tool-jira-token-link')).toHaveAttribute('href', 'https://id.atlassian.com/manage-profile/security/api-tokens');
    await setup.getByTestId('tool-jira-submit').click();
    await expect(jira).toHaveAttribute('data-phase', 'failed');
    await expect(setup.getByTestId('tool-jira-bad')).toContainText('Portachiavi cifrato di sistema non disponibile');
    await expect(setup.getByTestId('tool-jira-bad')).toContainText('Cosa fare');
    await expect(setup).toBeVisible(); // nothing here closes the modal
    await shot(page, 'setup-onboarding-3-tools-states');
    await light(page, true); await shot(page, 'setup-onboarding-3-tools-states-light'); await light(page, false);

    // 4 about you: every field takes typing key by key
    await next();
    await expect(title).toHaveText('Raccontaci chi sei');
    expect(await typeEverywhere(page, setup)).toBe(2);
    await setup.getByTestId('setup-name').pressSequentially('Giulia', { delay: 25 });
    await setup.getByTestId('setup-role').pressSequentially('product manager', { delay: 25 });
    await expect(setup.getByTestId('setup-name')).toHaveValue('Giulia');
    await shot(page, 'setup-onboarding-4-you');
    await light(page, true); await shot(page, 'setup-onboarding-4-you-light'); await light(page, false);

    // 5 folders: always a new brain, the projects folder found by itself
    await next();
    await expect(title).toHaveText('Le tue cartelle');
    await expect(setup.getByTestId('setup-memory-card')).toHaveAttribute('data-state', 'new');
    await expect(setup.getByTestId('setup-memory-card')).toContainText(userData);
    await expect(setup.getByTestId('setup-pick-brain')).toHaveCount(0);
    await expect(setup.getByTestId('setup-folders').locator('input, textarea, details')).toHaveCount(0);
    const projects = setup.getByTestId('setup-projects');
    await expect(projects).toHaveAttribute('data-state', 'found');
    await expect(projects).toContainText(found);
    await expect(projects).toContainText('2 repository git');
    await shot(page, 'setup-onboarding-5-folders-found');
    await light(page, true); await shot(page, 'setup-onboarding-5-folders-found-light'); await light(page, false);
    await setup.getByTestId('setup-pick-projects').click();
    await expect(projects).toHaveAttribute('data-state', 'chosen');
    await expect(projects).toContainText(picked);
    expect((await page.evaluate(() => window.sb.invoke('settings:get', undefined))).projectsRoot).toBe(picked);

    // 6 ready: the projects folder is there; confirm creates the brain pointing at it and starts the guide chat
    await next();
    await expect(title).toHaveText('Tutto pronto');
    await expect(setup).toContainText(picked);
    await expect(setup).toContainText('Azure DevOps');
    await expect(setup.getByTestId('setup-guide')).toBeChecked();
    await shot(page, 'setup-onboarding-6-done');
    await page.getByTestId('setup-complete').click();
    await expect(setup).toBeHidden({ timeout: 15000 });
    const info = await page.evaluate(() => window.sb.invoke('app:info', undefined));
    expect(info.brainRoot?.startsWith(userData)).toBe(true);
    const brain = JSON.parse(fs.readFileSync(path.join(info.brainRoot!, 'brain.json'), 'utf8')) as { template: { REPOS: string } };
    expect(brain.template.REPOS).toBe(picked.split(path.sep).join('/'));
    const settings = await page.evaluate(() => window.sb.invoke('settings:get', undefined));
    expect(settings.orchestratorChats.harness).toBe('claude'); // the AI chosen in step 2 is the roles' engine (#96)
    expect(settings.language).toBe('it');
    const chats = await app.evaluate(() => (globalThis as unknown as { chats: { harness: string; cwd: string; prompt: string }[] }).chats);
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ harness: 'claude', cwd: info.brainRoot, prompt: guidePrompt('it') });

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

    // nothing found and nothing saved: the folders step asks for the folder
    await page.evaluate(() => window.sb.invoke('settings:set', { projectsRoot: null }));
    for (const repo of ['shop', 'api']) fs.rmSync(path.join(found, repo, '.git'), { recursive: true });
    await page.getByRole('button', { name: 'Configura il mio lavoro', exact: true }).click();
    await setup.getByTestId('setup-step-folders').click();
    await expect(title).toHaveText('Le tue cartelle');
    await expect(setup.getByTestId('setup-memory-card')).toHaveAttribute('data-state', 'connected');
    await expect(projects).toHaveAttribute('data-state', 'ask');
    await expect(projects).toContainText('Dove tieni i tuoi progetti?');
    await shot(page, 'setup-onboarding-5-folders-ask');
    await light(page, true); await shot(page, 'setup-onboarding-5-folders-ask-light');
  } finally { await app.close(); }
});
