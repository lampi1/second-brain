// End-to-end: Settings no longer exposes the model/task routing matrix. Opening the page, searching and saving an
// unrelated preference must preserve the legacy routing table, locks, exploration, cost weight and history. The
// retained backend's validation/versioning has unit coverage in brain/routing.test.ts; no replacement editor is assumed.
// Screenshot: test-results/shots/settings-routing-retired.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('Settings retires the routing matrix without resetting legacy routing choices or history', async () => {
  const { app, page } = await launchDemo({ freeze: true });
  try {
    const before = await page.evaluate(() => window.sb.invoke('routing:get', undefined));
    expect(before.table).toMatchObject({ version: 3, exploration: 0, costWeight: 7 });
    expect(before.table?.routes).toHaveLength(4);
    expect(before.table?.routes[1]).toMatchObject({ kind: 'triage', model: 'claude-sonnet-5-5' });
    expect(before.table?.routes[3]).toMatchObject({ kind: 'bug-fix', locked: true });
    expect(before.history).toEqual(expect.arrayContaining([expect.objectContaining({ to: 2, by: 'agente: Regia dell’app', evidence: expect.stringContaining('31 chat') })]));

    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    const settings = page.getByTestId('settings-page');
    await expect(settings).toBeVisible();
    await expect(settings.getByTestId('st-group-routing')).toHaveCount(0);
    await expect(settings.getByTestId('st-routing-table')).toHaveCount(0);
    await expect(settings.getByTestId('st-routing-add')).toHaveCount(0);
    const search = settings.getByRole('searchbox', { name: 'Cerca nelle impostazioni' });
    await search.fill('Instradamento modelli');
    await expect(settings.getByTestId('st-search-empty')).toBeVisible();
    await shot(page, 'settings-routing-retired');
    await search.press('Escape');
    await settings.getByTestId('st-theme-choice-light').click();
    await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).theme)).toBe('light');

    const after = await page.evaluate(() => window.sb.invoke('routing:get', undefined));
    expect(after.table).toEqual(before.table);
    expect(after.history).toEqual(before.history);
    expect(after.registry).toEqual(before.registry);
  } finally {
    await app.close();
  }
});
