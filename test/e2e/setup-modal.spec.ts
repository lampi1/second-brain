// End-to-end: the first-run setup is ONE modal from start to finish (components/FirstInterview.tsx, SetupEngines.tsx;
// owner, 2026-10-18; six steps, ADR 0119). Every step happens in the same dialog; the AI step recommends one engine
// (here Codex, the one signed in) and folds the others under «Altre IA»; "Collega" on an AI opens its sign-in (stubbed
// here: no CLI runs, no tokens) and the wizard waits on the same step with "Verifica"; a stray click on the backdrop does not close
// it; "Più tardi" saves and a reopening resumes on the same step; Esc saves too. Demo app, the engine status, sign-in
// and trust handlers replaced in main. Screenshots: test-results/shots/setup-modal-*.png (each step, dark, one light).
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('setup wizard: one modal, sign-in waits in place, resumable', async () => {
  const { app, page } = await launchDemo();
  try {
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as { signedIn: boolean; logins: string[] };
      g.signedIn = false; g.logins = [];
      for (const name of ['cli:status', 'cli:login', 'engines:trust']) ipcMain.removeHandler(name);
      ipcMain.handle('cli:status', (_e, a: { harness: string }) => a.harness === 'claude' ? { found: true, path: '/bin/claude', version: '2', loggedIn: g.signedIn, account: g.signedIn ? 'demo-account' : null }
        : a.harness === 'codex' ? { found: true, path: '/bin/codex', version: '1', loggedIn: true, account: 'giulia' } : { found: false, path: null, version: null, loggedIn: null });
      ipcMain.handle('cli:login', (_e, a: { harness: string }) => { g.logins.push(a.harness); });
      ipcMain.handle('engines:trust', () => undefined);
    });
    const openSetup = async () => {
      await page.getByTestId('settings').click();
      await page.getByTestId('settings-all').click();
      await page.getByRole('button', { name: 'Configura il mio lavoro', exact: true }).click();
    };
    await openSetup();
    const setup = page.getByTestId('first-interview');
    const next = () => setup.getByRole('button', { name: 'Continua', exact: true }).click();
    const title = setup.locator('#sw-title');

    // 1 language
    await expect(setup.getByText('Passo 1 di 6')).toBeVisible();
    await expect(title).toHaveText('Scegli la tua lingua');
    await expect(setup.getByTestId('setup-language')).toBeVisible();
    await shot(page, 'setup-modal-1-language');

    // 2 AI: Collega opens the sign-in and the same modal waits on the same step
    await next();
    await expect(title).toHaveText('Collega la tua IA');
    await expect(title).toBeFocused();
    const claude = setup.getByTestId('setup-engine-claude');
    await expect(setup.getByTestId('setup-engine-codex')).toHaveAttribute('data-phase', 'connected');
    // the one signed in is the recommended one; the others sit under «Altre IA», open here because Claude Code is
    // already turned on in the demo (the engines turned on are preselected)
    await expect(setup.getByTestId('setup-engine-codex')).toHaveAttribute('data-recommended', 'true');
    await expect(setup.getByTestId('setup-engines-more-toggle')).toHaveAttribute('aria-expanded', 'true');
    await shot(page, 'setup-modal-2-ai');
    await expect(claude).toHaveAttribute('data-phase', 'signedOut');
    await expect(setup.getByTestId('setup-engine-cursor')).toHaveAttribute('data-phase', 'missing');
    await setup.getByTestId('setup-connect-claude').click();
    await expect(claude).toHaveAttribute('data-phase', 'waiting');
    await expect(setup.getByTestId('setup-engine-claude-waiting')).toContainText('Completalo lì');
    expect(await app.evaluate(() => (globalThis as unknown as { logins: string[] }).logins)).toEqual(['claude']);
    await expect(setup).toBeVisible();
    await expect(title).toHaveText('Collega la tua IA');
    // back from the sign-in window, a click lands on the backdrop: the wizard stays
    await page.mouse.click(40, 500);
    await expect(setup).toBeVisible();
    await setup.getByTestId('setup-verify-claude').click();
    await expect(claude).toHaveAttribute('data-phase', 'waiting');
    await expect(setup.getByTestId('setup-engine-claude-waiting')).toContainText('non risulta ancora completato');
    await shot(page, 'setup-modal-2-ai-waiting');
    await app.evaluate(() => { (globalThis as unknown as { signedIn: boolean }).signedIn = true; });
    await setup.getByTestId('setup-verify-claude').click();
    await expect(claude).toHaveAttribute('data-phase', 'connected');
    await expect(setup.getByTestId('setup-use-claude')).toBeChecked();
    await expect(setup).toBeVisible();
    await shot(page, 'setup-modal-2-ai-connected');

    // "Più tardi" saves; reopening resumes on the same step with the same choices
    await setup.getByRole('button', { name: 'Più tardi', exact: true }).click();
    await expect(setup).toBeHidden();
    await page.getByRole('button', { name: 'Configura il mio lavoro', exact: true }).click();
    await expect(title).toHaveText('Collega la tua IA');
    await expect(setup.getByTestId('setup-use-claude')).toBeChecked();

    // 3 tools
    await next();
    await expect(title).toHaveText('Collega i tuoi strumenti');
    await expect(setup.getByTestId('tool-catalog')).toBeVisible();
    await shot(page, 'setup-modal-3-tools');

    // 4 about you (Enter in a one-line answer moves on like Continua)
    await next();
    await expect(title).toHaveText('Raccontaci chi sei');
    await shot(page, 'setup-modal-4-you');
    await setup.getByTestId('setup-role').fill('product manager');
    await setup.getByTestId('setup-role').press('Enter');

    // 5 folders
    await expect(title).toHaveText('Le tue cartelle');
    await shot(page, 'setup-modal-5-folders');

    // 6 ready, also in light; Esc saves and closes, the step indicator goes back
    await next();
    await expect(title).toHaveText('Tutto pronto');
    await expect(setup).toContainText('Claude Code');
    await expect(setup).toContainText('product manager');
    await expect(page.getByTestId('setup-complete')).toBeEnabled();
    await shot(page, 'setup-modal-6-done');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; }); // the demo pins dark: a visual check only
    await shot(page, 'setup-modal-6-done-light');
    await setup.getByTestId('setup-step-you').click();
    await expect(title).toHaveText('Raccontaci chi sei');
    await expect(setup.getByTestId('setup-role')).toHaveValue('product manager');
    await shot(page, 'setup-modal-4-you-light');
    await page.keyboard.press('Escape');
    await expect(setup).toBeHidden();
    const saved = await page.evaluate(() => window.sb.invoke('setup:get', undefined));
    expect(saved.status).toBe('draft');
    expect(saved.preferences.step).toBe(3);
    expect(saved.preferences.engines).toContain('claude');
  } finally { await app.close(); }
});
