// End-to-end: the simple first-run setup (issues #164, #165, ADR 0119). (1) A fresh profile on an Italian system opens
// on the language step with Italiano preselected; a click on Deutsch switches every text at once, keeps the answers
// given so far and saves the setting; the next step speaks German and the profile chat language and the new brain
// follow it. (2) A full run in the demo with one catalog tool: GitHub's tile asks only for a token (with the link to
// where it is made), creates the account and the MCP server together, tests at once ("Funziona: vedo 3 progetti") and
// no technical field (command, args, env, headers) is ever shown; the folders step offers no existing brain; goals,
// areas and team are not asked; the technical form lives in Settings → Avanzate. Zero network: the account check
// (connectors:*) is replaced in main, the demo's MCP servers answer from a fake upstream (main/mcp-servers/demo.ts).
// Screenshots: test-results/shots/setup-simple-*.png, every step dark and light.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launch, launchDemo, setSize, shot } from './helpers';

const theme = async (page: Page, light: boolean) => page.evaluate(v => { document.documentElement.dataset.theme = v ? 'light' : 'dark'; }, light);
async function both(page: Page, name: string): Promise<void> {
  await page.mouse.move(2, 2);
  await shot(page, `${name}-dark`);
  await theme(page, true); await shot(page, `${name}-light`); await theme(page, false);
}

test('setup: the language comes first, switches the wizard at once and keeps the answers', async () => {
  test.setTimeout(90_000);
  const { app, page, userData } = await launch();
  try {
    await setSize(app, 1400, 900);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    const setup = page.getByTestId('first-interview');
    await expect(setup).toBeVisible({ timeout: 15000 }); // a fresh profile opens it by itself
    const title = setup.locator('#sw-title'), next = () => setup.getByTestId('setup-next').click();
    await expect(setup.getByText('Passo 1 di 6')).toBeVisible();
    await expect(title).toHaveText('Scegli la tua lingua');
    await expect(setup.getByTestId('setup-lang-it')).toHaveAttribute('aria-checked', 'true'); // the system language
    await expect(setup.getByTestId('setup-lang-de')).toContainText('Deutsch');
    await expect(setup.getByTestId('setup-lang-en')).toContainText('English');
    await both(page, 'setup-simple-1-language');

    // an answer given further on, then back to the language
    await setup.getByTestId('setup-step-you').click();
    await setup.getByTestId('setup-name').fill('Giulia');
    await setup.getByTestId('setup-step-language').click();
    await expect(title).toHaveText('Scegli la tua lingua');

    await setup.getByTestId('setup-lang-de').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(title).toHaveText('Wähle deine Sprache'); // same step, now in German
    await expect(setup.getByText('Schritt 1 von 6')).toBeVisible();
    await expect(setup.getByTestId('setup-lang-de')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).language)).toBe('de');
    await both(page, 'setup-simple-1-language-de');
    await next();
    await expect(title).toHaveText('Verbinde deine KI');
    await setup.getByTestId('setup-step-you').click();
    await expect(setup.getByTestId('setup-name')).toHaveValue('Giulia'); // the answer survived the switch
    const saved = await page.evaluate(() => window.sb.invoke('setup:get', undefined));
    expect(saved.preferences.profile).toMatchObject({ name: 'Giulia', language: 'Deutsch' });
    expect(saved.preferences.profile?.language).toBe('Deutsch');

    // the run ends: the new brain is created in German and me.md says so
    for (const s of ['folders', 'done']) await setup.getByTestId(`setup-step-${s}`).click();
    await expect(setup.getByTestId('setup-guide-choice')).toHaveCount(0); // no AI chosen: no guide chat
    await page.getByTestId('setup-complete').click();
    await expect(setup).toBeHidden({ timeout: 15000 });
    const info = await page.evaluate(() => window.sb.invoke('app:info', undefined));
    expect(info.brainRoot?.startsWith(userData)).toBe(true);
    const me = fs.readFileSync(path.join(info.brainRoot!, 'me.md'), 'utf8');
    expect(me).toContain('Language: Deutsch');
    expect(me).toMatch(/^# Giulia\n/);
  } finally { await app.close(); }
});

test('setup: a full run with one catalog tool, no technical field, token and test in the tile', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo({ width: 1400, height: 900 });
  try {
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as { tokens: unknown[] };
      g.tokens = [];
      const base = (provider: string) => ({ provider, status: 'pending', checkedAt: null, account: null, projects: [], selected: [], detail: '' });
      const states: Record<string, unknown> = { github: base('github'), azure: base('azure'), jira: base('jira') };
      for (const name of ['connectors:list', 'connectors:useToken', 'connectors:probe']) ipcMain.removeHandler(name);
      ipcMain.handle('connectors:list', () => Object.values(states));
      ipcMain.handle('connectors:probe', (_e, a: { provider: string }) => states[a.provider]);
      // the account check a real token would get from GitHub's REST API, without the network
      ipcMain.handle('connectors:useToken', (_e, a: { provider: string; token: string }) => {
        g.tokens.push(a);
        states[a.provider] = { ...base(a.provider), status: 'verified', checkedAt: new Date().toISOString(), account: 'giulia-dev', projects: [{ id: '1', name: 'giulia-dev/shop' }, { id: '2', name: 'giulia-dev/api' }, { id: '3', name: 'giulia-dev/site' }] };
        return states[a.provider];
      });
    });
    await page.keyboard.press('Control+,');
    await page.getByRole('button', { name: 'Configura il mio lavoro', exact: true }).click();
    const setup = page.getByTestId('first-interview');
    const title = setup.locator('#sw-title'), next = () => setup.getByTestId('setup-next').click();

    // 1 language (Continua keeps the preselected one and saves it)
    await expect(title).toHaveText('Scegli la tua lingua');
    await next();
    // 2 AI: one recommended, the others folded under «Altre IA»
    await expect(title).toHaveText('Collega la tua IA');
    await expect(setup.locator('[data-recommended]')).toHaveCount(1);
    await expect(setup.getByTestId('setup-engines-more')).toBeVisible();
    // in the demo every AI is signed in and in use, so «Altre IA» opens by itself; the owner folds it at will
    const more = setup.getByTestId('setup-engines-more-toggle');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(setup.getByTestId('setup-engine-codex')).toBeVisible();
    await both(page, 'setup-simple-2-ai-more');
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(setup.getByTestId('setup-engine-codex')).toHaveCount(0);
    await both(page, 'setup-simple-2-ai');
    await next();

    // 3 tools: the catalog; GitHub asks only for the token, with the link to where it is made
    await expect(title).toHaveText('Collega i tuoi strumenti');
    const tile = setup.getByTestId('tool-tile-github');
    await expect(setup.getByTestId('tool-catalog')).toBeVisible();
    await both(page, 'setup-simple-3-tools');
    await setup.getByTestId('tool-github-connect').click();
    const form = setup.getByTestId('tool-github-form');
    await expect(form.locator('input')).toHaveCount(1);
    await expect(form.getByTestId('tool-github-token')).toHaveAttribute('type', 'password');
    await expect(setup.getByTestId('tool-github-token-link')).toHaveAttribute('href', 'https://github.com/settings/personal-access-tokens/new');
    await expect(form).toContainText('Generate new token');
    for (const word of ['Comando', 'Argomenti', 'Variabili', 'Intestazioni', 'stdio', 'npx']) await expect(setup).not.toContainText(word);
    await form.getByTestId('tool-github-submit').click();
    await expect(form.getByRole('alert')).toContainText('Da compilare'); // nothing typed yet: says what is missing
    const token = ['github', 'pat', '11E2ETESTTOKEN0123456789', 'abcdefghijklmnop'].join('_'); // built at run time: not a secret shape in the source
    await form.getByTestId('tool-github-token').fill(token);
    await both(page, 'setup-simple-3-tools-token');
    await form.getByTestId('tool-github-submit').click();
    await expect(tile).toHaveAttribute('data-phase', 'ok');
    await expect(setup.getByTestId('tool-github-ok')).toContainText('Funziona: vedo 3 progetti');
    await expect(setup.getByTestId('tool-github-ok')).toContainText('giulia-dev');
    expect(await page.content()).not.toContain(token);
    // one tile made both: the account (its token in the same place) and the MCP server with its token, tested
    expect(await app.evaluate(() => (globalThis as unknown as { tokens: unknown[] }).tokens)).toEqual([{ provider: 'github', token }]);
    const servers = await page.evaluate(() => window.sb.invoke('mcpservers:state', undefined));
    const github = servers.servers.find(s => s.id === 'github')!;
    expect(github.url).toBe('https://api.githubcopilot.com/mcp/');
    expect(github.secretMasks['header:Authorization']).toMatch(/…/);
    expect(github.lastTest?.ok).toBe(true);
    expect(JSON.stringify(servers)).not.toContain(token);
    await both(page, 'setup-simple-3-tools-ok');
    await next();

    // 4 about you (optional)
    await expect(title).toHaveText('Raccontaci chi sei');
    await expect(setup.getByTestId('setup-language')).toHaveCount(0); // no free-text language field any more
    await both(page, 'setup-simple-4-you');
    await next();

    // 5 folders: never an existing brain
    await expect(title).toHaveText('Le tue cartelle');
    await expect(setup.getByTestId('setup-folders')).toBeVisible();
    await expect(setup.getByTestId('setup-pick-brain')).toHaveCount(0);
    await both(page, 'setup-simple-5-folders');
    await next();

    // 6 ready: the summary; goals, areas and team are not asked
    await expect(title).toHaveText('Tutto pronto');
    await expect(setup.getByTestId('setup-step-work')).toHaveCount(0);
    await expect(setup.getByTestId('setup-step-agents')).toHaveCount(0);
    await expect(setup.locator('textarea')).toHaveCount(0);
    await expect(setup).toContainText('GitHub');
    await both(page, 'setup-simple-6-ready');
    await page.getByTestId('setup-complete').click();
    await expect(setup).toBeHidden({ timeout: 15000 });
    const done = await page.evaluate(() => window.sb.invoke('setup:get', undefined));
    expect(done.status).toBe('completed');
    expect(done.preferences.tools).toBe('GitHub');
    expect((await page.evaluate(() => window.sb.invoke('settings:get', undefined))).language).toBe('it');

    // Settings: the catalog in Connettori, the technical form only in Avanzate
    await page.keyboard.press('Control+,');
    const connectors = page.getByTestId('st-group-connectors');
    await connectors.scrollIntoViewIfNeeded();
    await expect(connectors.getByTestId('tool-catalog')).toBeVisible();
    await expect(connectors.getByTestId('hub-add')).toHaveCount(0);
    const advanced = page.getByTestId('st-group-advanced');
    await advanced.scrollIntoViewIfNeeded();
    await advanced.getByTestId('hub-add').click();
    await expect(advanced.getByTestId('hub-editor')).toContainText('Comando');
    await advanced.getByTestId('hub-editor').scrollIntoViewIfNeeded();
    await both(page, 'setup-simple-7-settings-advanced');
  } finally { await app.close(); }
});
