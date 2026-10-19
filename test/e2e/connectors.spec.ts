// Main-only connector UI coverage with synthetic IPC adapters; no real CLI, credential, provider or visible window.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';
import type { ConnectorState } from '../../src/shared/connectors';
test('Settings connects, verifies, selects and disconnects projects with honest failure evidence', async () => {
  const { app, page } = await launchDemo();
  try {
    await app.evaluate(({ ipcMain }) => {
      const make = (provider: 'github' | 'jira'): ConnectorState => ({ provider, status: 'pending', account: null, checkedAt: null, projects: [], selected: [], detail: 'Accesso da completare' });
      const states = { github: make('github'), jira: make('jira') }; let signedIn = false;
      for (const name of ['list', 'login', 'probe', 'select', 'disconnect']) ipcMain.removeHandler(`connectors:${name}`);
      ipcMain.handle('connectors:list', () => Object.values(states));
      ipcMain.handle('connectors:login', () => { signedIn = true; });
      ipcMain.handle('connectors:probe', (_event, { provider }: { provider: 'github' | 'jira' }) => {
        states[provider] = { ...make(provider), status: signedIn ? 'verified' : 'failed', account: signedIn ? 'demo-user' : null, checkedAt: '2026-10-17T12:00:00Z', projects: signedIn ? [{ id: 'repo-1', name: 'Demo / Project' }] : [], detail: signedIn ? 'Accesso verificato in sola lettura' : 'Accesso da completare' }; return states[provider];
      });
      ipcMain.handle('connectors:select', (_event, { provider, projects }: { provider: 'github' | 'jira'; projects: string[] }) => { states[provider].selected = projects; return states[provider]; });
      ipcMain.handle('connectors:disconnect', (_event, { provider }: { provider: 'github' | 'jira' }) => { states[provider] = make(provider); });
    });
    await page.keyboard.press('Control+,');
    const panel = page.getByTestId('app-connectors'), github = panel.getByRole('article', { name: 'GitHub', exact: true });
    await expect(panel).toBeVisible(); await github.getByRole('button', { name: 'Prova GitHub', exact: true }).click();
    await expect(github.getByRole('status')).toContainText('Verifica non riuscita'); await shot(page, 'connectors-failed');
    await github.getByRole('button', { name: 'Accedi a GitHub', exact: true }).click();
    await github.getByRole('button', { name: 'Prova GitHub', exact: true }).click();
    await expect(github.getByRole('status')).toContainText('Collegato e verificato');
    const project = github.getByRole('checkbox', { name: 'Demo / Project' }); await project.focus(); await page.keyboard.press('Space'); await expect(project).toBeChecked();
    await shot(page, 'connectors-verified-projects');
    await github.getByText('Dettagli del collegamento', { exact: true }).click();
    await github.getByRole('button', { name: 'Scollega GitHub dall’app', exact: true }).click();
    await expect(github.getByRole('status')).toContainText('Accesso da completare'); await expect(project).toHaveCount(0);
  } finally { await app.close(); }
});
test('the interview offers the connectors in place and a sign-in survives closing it', async () => {
  const { app, page } = await launchDemo();
  try {
    // a GitHub sign-in that stays open until the test ends it; a cancel would be recorded
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as { finishLogin?: () => void; cancelled?: boolean; loggedIn?: boolean };
      const state = (): ConnectorState => ({ provider: 'github', status: g.loggedIn ? 'verified' : 'pending', account: g.loggedIn ? 'demo-user' : null, checkedAt: null, projects: [], selected: [], detail: '' });
      for (const name of ['list', 'login', 'cancelLogin', 'probe']) ipcMain.removeHandler(`connectors:${name}`);
      ipcMain.handle('connectors:probe', () => state());
      ipcMain.handle('connectors:list', () => [state()]);
      ipcMain.handle('connectors:login', () => new Promise<void>(resolve => { g.finishLogin = () => { g.loggedIn = true; resolve(); }; }));
      ipcMain.handle('connectors:cancelLogin', () => { g.cancelled = true; });
    });
    await page.keyboard.press('Control+,');
    await page.getByRole('button', { name: 'Configura il mio lavoro', exact: true }).click();
    const setup = page.getByTestId('first-interview');
    for (let step = 0; step < 2; step++) await setup.getByRole('button', { name: 'Continua', exact: true }).click();
    const connectors = setup.getByTestId('app-connectors'); await expect(connectors).toBeVisible();
    await shot(page, 'connectors-in-setup');
    await connectors.getByRole('button', { name: 'Accedi a GitHub', exact: true }).click();
    await setup.getByRole('button', { name: 'Più tardi', exact: true }).click();
    await expect(setup).not.toBeVisible();
    expect(await app.evaluate(() => (globalThis as unknown as { cancelled?: boolean }).cancelled ?? false)).toBe(false);
    await app.evaluate(() => (globalThis as unknown as { finishLogin?: () => void }).finishLogin?.());
    // the sign-in ended in main on its own; Settings shows it at the next check
    const github = page.getByTestId('app-connectors').getByRole('article', { name: 'GitHub', exact: true });
    await github.getByRole('button', { name: 'Prova GitHub', exact: true }).click();
    await expect(github.getByRole('status')).toContainText('Collegato e verificato');
  } finally { await app.close(); }
});
