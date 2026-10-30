// End-to-end: the Max plan's API credits (ADR 0052) on the demo. Settings shows only the essential engines
// (docs/settings-surface.md: «Account e strumenti» lists Claude Code, Cursor and Codex; no paid API credit panel is
// loaded by opening Settings), so Anthropic API has no row and no spend panel there; it stays off unless turned on, and
// this month's spend the app computed (seeded <userData>/api-spend.json) is still kept and served by engines:spend.
// Screenshot: test-results/shots/api-credits-engines.png.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

const month = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

test('Settings: Anthropic API has no row and no spend panel; its switch stays off and this month\'s spend is kept', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-'));
  fs.writeFileSync(path.join(userData, 'api-spend.json'), JSON.stringify({ version: 1, months: { [month()]: { anthropic: { usd: 4.3214, calls: 12, unpriced: 1 } }, '2020-01': { anthropic: { usd: 99, calls: 1, unpriced: 0 } } } }));
  const { app, page } = await launchDemo({ userData });
  try {
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    const accounts = page.getByTestId('settings-page').getByTestId('st-group-accounts');
    await accounts.scrollIntoViewIfNeeded();
    await expect(accounts.locator('.st-tool')).toHaveCount(3);
    for (const id of ['claude', 'cursor', 'codex']) await expect(accounts.getByTestId(`st-tool-${id}`)).toHaveCount(1);
    await expect(accounts.getByTestId('st-tool-anthropic')).toHaveCount(0);
    await expect(accounts).not.toContainText('Anthropic API');
    await expect(page.locator('[data-testid^="st-spend-"]')).toHaveCount(0);
    await expect(page.getByTestId('settings-page')).not.toContainText('Console Anthropic');
    // opening Settings turns nothing on
    expect((await page.evaluate(async () => window.sb.invoke('settings:get', undefined))).engineOn.anthropic).toBe(false);
    // only this month, as the app computed it, still kept for the engine
    const spend = await page.evaluate(async () => window.sb.invoke('engines:spend', undefined));
    expect(spend.month).toBe(month());
    expect(spend.engines.anthropic).toMatchObject({ calls: 12, unpriced: 1 });
    expect(spend.engines.anthropic?.usd).toBeCloseTo(4.32, 2);
    await page.mouse.move(2, 2);
    await shot(page, 'api-credits-engines');
  } finally {
    await app.close();
  }
});
