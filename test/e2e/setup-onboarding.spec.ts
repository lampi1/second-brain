// End-to-end: the first-run setup on a fresh profile (no brain) with a fixture home (SB_HOME, never the user's), in its
// three moments inside ONE modal (components/FirstInterview.tsx, ADR 0279): (1) welcome: the name takes a whole word
// typed key by key and keeps the focus, the title and the preview greet by that name, a language switch keeps it, a
// click on the backdrop does nothing; (2) your AI: the engines found on this computer as rows, the missing ones in one
// line; «Accedi» opens the sign-in (stubbed) and the row turns «già connesso» by itself, in place, and becomes the
// Orchestrator's; Esc saves, and reopening resumes there with the name; (3) the first request: the workspace is
// prepared with no questions (a new brain in the profile, the projects folder found in the fixture home, the chosen AI
// as the roles' engine, the name in me.md) and the REAL Orchestrator chat (the fake Claude CLI, no model, no network)
// answers inside the setup; «Entra nell'app» closes it and the Orchestrator keeps the conversation. CLI status,
// sign-in and trust are replaced in main: no tokens. Screenshots: test-results/shots/setup-onboarding-*.png (dark, light).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launch, setSize, shot } from './helpers';

const FAKE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-claude.mjs');
const light = async (page: Page, on: boolean) => page.evaluate(v => { document.documentElement.dataset.theme = v ? 'light' : 'dark'; }, on);
const both = async (page: Page, name: string) => { await shot(page, name); await light(page, true); await shot(page, `${name}-light`); await light(page, false); };

test('setup: three moments in one modal, the first request answered inside it', async () => {
  test.setTimeout(150_000);
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-home-')));
  const found = path.join(home, 'Projects');
  for (const repo of ['shop', 'api']) fs.mkdirSync(path.join(found, repo, '.git'), { recursive: true });
  const { app, page, userData } = await launch({ SB_HOME: home, SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: path.join(home, '.claude-fixture') });
  try {
    await setSize(app, 1600, 1000);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as { signedIn: boolean; logins: string[] };
      g.signedIn = false; g.logins = [];
      for (const name of ['cli:status', 'cli:login', 'engines:trust']) ipcMain.removeHandler(name);
      ipcMain.handle('cli:status', (_e, a: { harness: string }) => a.harness === 'claude' ? { found: true, path: '/bin/claude', version: '2', loggedIn: g.signedIn, account: g.signedIn ? 'giulia@example.com' : null }
        : { found: false, path: null, version: null, loggedIn: null });
      ipcMain.handle('cli:login', (_e, a: { harness: string }) => { g.logins.push(a.harness); });
      ipcMain.handle('engines:trust', () => undefined);
    });

    const setup = page.getByTestId('first-interview');
    await expect(setup).toBeVisible({ timeout: 15000 }); // a fresh profile opens it by itself
    const title = setup.locator('#sw-title'), next = setup.getByTestId('setup-next');

    // 1 welcome: language and name on one screen, the preview beside them
    await expect(title).toHaveText('Cominciamo da te');
    await expect(setup.getByText('1 di 3')).toBeVisible();
    await expect(setup.getByTestId('setup-lang-it')).toHaveAttribute('aria-checked', 'true');
    await expect(setup.getByTestId('setup-preview')).toContainText('Anteprima');
    await shot(page, 'setup-onboarding-1-welcome');
    const name = setup.getByTestId('setup-name');
    await name.click();
    await page.keyboard.type('Giulia', { delay: 25 });
    await expect(name).toHaveValue('Giulia');
    await expect(name).toBeFocused();
    await expect(title).toHaveText('Piacere, Giulia');
    await expect(setup.getByTestId('setup-preview-reply')).toContainText('Va bene, Giulia.');
    await page.mouse.click(8, 500); // the backdrop: nothing closes
    await expect(setup).toBeVisible();
    await setup.getByTestId('setup-lang-en').click();
    await expect(title).toHaveText('Nice to meet you, Giulia');
    await expect(setup.getByTestId('setup-name')).toHaveValue('Giulia');
    await setup.getByTestId('setup-lang-it').click();
    await expect(title).toHaveText('Piacere, Giulia');
    await both(page, 'setup-onboarding-1-welcome-named');
    // the app's smallest window: both halves and the actions still fit
    await setSize(app, 1000, 640);
    await expect(setup.getByTestId('setup-preview-reply')).toBeInViewport({ ratio: 1 });
    await expect(setup.getByTestId('setup-name')).toBeInViewport({ ratio: 1 });
    await expect(next).toBeInViewport({ ratio: 1 });
    await shot(page, 'setup-onboarding-1-welcome-small');
    await setSize(app, 1600, 1000);

    // 2 your AI: found by itself; «Accedi» waits in place and turns connected without a click
    await next.click();
    await expect(title).toHaveText('Collega la tua AI');
    const claude = setup.getByTestId('setup-engine-claude');
    await expect(claude).toHaveAttribute('data-phase', 'signedOut');
    await expect(claude).toContainText('installato · serve l’accesso');
    await expect(setup.getByTestId('setup-engines-absent')).toHaveText('Non trovati: Codex, Cursor, OpenCode.');
    await expect(next).toBeDisabled();
    await expect(setup.getByTestId('setup-no-ai')).toBeVisible();
    await shot(page, 'setup-onboarding-2-ai-found');
    await setup.getByTestId('setup-connect-claude').click();
    await expect(claude).toHaveAttribute('data-phase', 'waiting');
    await expect(setup.getByTestId('setup-engine-claude-waiting')).toContainText('controllo da solo');
    expect(await app.evaluate(() => (globalThis as unknown as { logins: string[] }).logins)).toEqual(['claude']);
    await expect(setup).toBeVisible(); // the click did not close the setup
    await shot(page, 'setup-onboarding-2-ai-waiting');
    await app.evaluate(() => { (globalThis as unknown as { signedIn: boolean }).signedIn = true; });
    await expect(claude).toHaveAttribute('data-phase', 'connected', { timeout: 10_000 });
    await expect(claude).toHaveAttribute('data-primary', 'true');
    await expect(claude).toContainText('installato · già connesso · giulia@example.com');
    await expect(setup.getByTestId('setup-use-claude')).toBeChecked();
    await expect(next).toHaveText('Continua con Claude Code');
    await both(page, 'setup-onboarding-2-ai-connected');

    // Esc saves the draft; reopening resumes on the same moment with the name
    await expect(setup.locator('.sw-saved')).toHaveText('Bozza salvata su questo computer');
    await page.keyboard.press('Escape');
    await expect(setup).toBeHidden();
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    await page.getByRole('button', { name: 'Configura il mio lavoro', exact: true }).click();
    await expect(title).toHaveText('Collega la tua AI');
    await expect(next).toHaveText('Continua con Claude Code', { timeout: 10_000 });

    // 3 the first request: no more questions, the real Orchestrator inside the setup
    await next.click();
    const live = setup.getByTestId('setup-live');
    await expect(live).toBeVisible({ timeout: 20_000 });
    await expect(title).toHaveText('Chiedi la prima cosa');
    await expect(setup.getByTestId('setup-preview')).toHaveCount(0);
    await expect(setup.getByTestId('setup-team').locator('li')).toHaveCount(5);
    const info = await page.evaluate(() => window.sb.invoke('app:info', undefined));
    expect(info.brainRoot?.startsWith(userData)).toBe(true);
    await expect(setup).toContainText(info.brainRoot!);
    const input = setup.getByTestId('setup-first-input');
    await setup.getByTestId('setup-idea-team').click();
    await expect(input).toHaveValue('Presentami la squadra: chi fa cosa?');
    await expect(input).toBeFocused();
    await shot(page, 'setup-onboarding-3-first-idea');
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('');
    await expect(live).toContainText('Presentami la squadra: chi fa cosa?');
    await expect(live).toContainText('Ciao dal motore', { timeout: 20_000 });
    await both(page, 'setup-onboarding-3-first-answer');
    await setSize(app, 1000, 640);
    await expect(setup.getByTestId('setup-first-input')).toBeInViewport({ ratio: 1 });
    await expect(setup.getByTestId('setup-enter')).toBeInViewport({ ratio: 1 });
    await shot(page, 'setup-onboarding-3-first-small');
    await setSize(app, 1600, 1000);

    // what was prepared, with no questions
    const settings = await page.evaluate(() => window.sb.invoke('settings:get', undefined));
    expect(settings.orchestratorChats.harness).toBe('claude'); // the chosen AI is the roles' engine (#96)
    expect(settings.engineOn).toMatchObject({ claude: true, codex: false, cursor: false, opencode: false });
    expect(settings.projectsRoot).toBe(found);
    expect(settings.language).toBe('it');
    expect(fs.readFileSync(path.join(info.brainRoot!, 'me.md'), 'utf8')).toMatch(/^# Giulia\n/);
    const brain = JSON.parse(fs.readFileSync(path.join(info.brainRoot!, 'brain.json'), 'utf8')) as { template: { REPOS: string } };
    expect(brain.template.REPOS).toBe(found.split(path.sep).join('/'));
    expect((await page.evaluate(() => window.sb.invoke('setup:get', undefined))).status).toBe('completed');

    // «Entra nell'app»: the setup closes, the Orchestrator keeps the conversation
    const chatId = await live.getAttribute('data-chat-id');
    await setup.getByTestId('setup-enter').click();
    await expect(setup).toBeHidden();
    const tile = page.getByTestId('tile-orchestrator');
    await expect(tile).toHaveAttribute('data-chat-id', chatId!);
    await expect(tile).toContainText('Ciao dal motore');
    await shot(page, 'setup-onboarding-4-in-the-app');
  } finally { await app.close(); }
});
