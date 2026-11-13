// Settings connector identities and repository-scoped Codex consent; runs only on main, with hidden demo data.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';
test('Settings shows three connectors and the supported engines with explicit Codex repository consent', async () => {
  const { app, page } = await launchDemo();
  try {
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    await page.getByTestId('st-search').fill('Azure');
    const cards = page.getByTestId('app-connectors');
    for (const name of ['GitHub', 'Jira Cloud', 'Azure DevOps']) await expect(cards.getByRole('article', { name })).toBeVisible();
    await expect(cards.getByRole('button', { name: 'Accedi a Azure DevOps', exact: true })).toBeVisible();
    await shot(page, 'settings-tools-connectors');
    await page.getByTestId('st-search').fill('Codex');
    const accounts = page.getByTestId('st-group-accounts');
    // the built-in engines (engines/registry.ts engineInfos): Claude Code, Cursor, Codex, OpenCode
    await expect(accounts.locator('.st-tool')).toHaveCount(4);
    for (const id of ['claude', 'cursor', 'codex', 'opencode']) await expect(accounts.getByTestId(`st-tool-${id}`)).toHaveCount(1);
    await expect(accounts).not.toContainText('Kimi');
    await expect(page.getByTestId('codex-autonomy')).toContainText('Nessun repository autorizzato');
    await expect(page.getByRole('button', { name: 'Aggiungi cartella', exact: true })).toBeVisible();
    await shot(page, 'settings-tools-codex');
  } finally { await app.close(); }
});
