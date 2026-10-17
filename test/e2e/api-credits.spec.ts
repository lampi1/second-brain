// End-to-end: the Max plan's API credits (ADR 0052) on the demo. Impostazioni → «Motori» lists Anthropic API (off until
// the user turns it on), takes its key like the other API engines, and under it shows this month's spend as the app
// computed it (seeded <userData>/api-spend.json) with where the credits come from. The retired routing matrix has no
// API-row controls in Settings; a legacy writing row's onApi choice survives engine settings changes.
// Screenshots: test-results/shots/api-credits-engines.png, api-credits-routing-retired.png.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

const month = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

test('Motori: Anthropic API turns on by the user\'s click, takes a key and shows this month\'s spend and the Max credits', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-'));
  fs.writeFileSync(path.join(userData, 'api-spend.json'), JSON.stringify({ version: 1, months: { [month()]: { anthropic: { usd: 4.3214, calls: 12, unpriced: 1 } }, '2020-01': { anthropic: { usd: 99, calls: 1, unpriced: 0 } } } }));
  const { app, page } = await launchDemo({ userData });
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  const eng = page.getByTestId('settings-page').getByTestId('st-group-engines');
  await eng.scrollIntoViewIfNeeded();

  const on = eng.getByTestId('st-engine-on-anthropic-switch');
  await expect(on).toHaveAttribute('aria-checked', 'false');
  await expect(eng.getByTestId('st-engine-on-anthropic-runs')).toHaveText('Avvio: https://api.anthropic.com/v1 (Anthropic)');
  await on.click();
  await expect(on).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await page.evaluate(async () => window.sb.invoke('settings:get', undefined))).engineOn.anthropic).toBe(true);

  const KEY = 'sk-test-e2eKeyNotReal0123456789-abcd';
  const key = eng.getByTestId('st-key-anthropic');
  await key.getByTestId('st-key-anthropic-input').fill(KEY);
  await key.getByTestId('st-key-anthropic-save').click();
  await expect(key.getByTestId('st-key-anthropic-mask')).toHaveText('Salvata: sk-…abcd');
  expect(fs.readFileSync(path.join(userData, 'secrets.json'), 'utf8')).not.toContain(KEY);

  // only this month, as the app computed it; where the credits come from
  const spend = eng.getByTestId('st-spend-anthropic');
  await expect(spend.getByTestId('st-spend-anthropic-usd')).toHaveText(/^4[,.]32 \$$/);
  await expect(spend).toContainText('in 12 richieste (1 senza prezzo nel cervello, non contata)');
  await expect(spend).toContainText('Calcolata dall\'app ai prezzi di listino');
  await expect(spend.getByTestId('st-spend-anthropic-credits')).toContainText('Si riscattano nella Console Anthropic');
  await expect(spend.getByTestId('st-spend-anthropic-credits')).toContainText('100 $ al mese con Max 5x, 200 $ con Max 20x');
  // an engine with no API kind has no spend row
  await expect(eng.getByTestId('st-spend-kimi')).toHaveCount(0);
  await key.evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.mouse.move(2, 2);
  await shot(page, 'api-credits-engines');

  await app.close();
  const logs = path.join(userData, 'logs');
  for (const f of fs.readdirSync(logs)) expect(fs.readFileSync(path.join(logs, f), 'utf8')).not.toContain(KEY);
});

test('Settings retires routing API controls while preserving a legacy writing row on API credits', async () => {
  const { app, page } = await launchDemo();
  try {
    // Seed an existing user's choice through the retained backend, without assuming a replacement editor.
    const legacy = await page.evaluate(async () => {
      const table = (await window.sb.invoke('routing:get', undefined)).table;
      if (!table) throw new Error('demo routing table missing');
      return window.sb.invoke('routing:save', {
        routes: [...table.routes, { kind: 'writing', harness: 'claude', model: 'claude-opus-5-5', effort: 'medium', why: 'legacy API choice', since: '2026-10-16', evidence: 'fixture', onApi: true }],
        baseVersion: table.version, reason: 'legacy API fixture',
      });
    });
    expect(legacy.table?.routes.at(-1)).toMatchObject({ kind: 'writing', model: 'claude-opus-5-5', onApi: true });
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    const settings = page.getByTestId('settings-page');
    await expect(settings.getByTestId('st-group-routing')).toHaveCount(0);
    await expect(settings.locator('[data-testid^="st-routing-api-"]')).toHaveCount(0);
    const engines = settings.getByTestId('st-group-engines');
    await engines.getByTestId('st-engine-on-anthropic-switch').click();
    await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).engineOn.anthropic)).toBe(true);
    const after = await page.evaluate(() => window.sb.invoke('routing:get', undefined));
    expect(after.table).toEqual(legacy.table);
    expect(after.history).toEqual(legacy.history);
    await engines.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await shot(page, 'api-credits-routing-retired');
  } finally {
    await app.close();
  }
});
