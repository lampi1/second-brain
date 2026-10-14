// End-to-end: errors and numbers that are useful (ADR 0037), in the frozen demo (SB_DEMO=1 SB_DEMO_FREEZE=1) pointed
// at the synthetic brain of test/fixtures/brain-ui (SB_BRAIN). Qualità: the AI errors grouped by pattern (count, last
// seen, this week against the one before, areas, chats with "Apri", the rule), the patterns seen once in one line, a
// reading on the caught-per-100 metric; "Discutine" on a pattern docks the Regia with a draft that quotes ai-errors.md
// and its numbers and ends with the question, not sent. Costi: the period against the one before, Discutine on the
// total and on every chart. Screenshots: test-results/shots/stats-*.png.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, setSize, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');
function fixtureBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-stats-'));
  fs.mkdirSync(path.join(d, 'ops', 'tools'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'brain-site.mjs'), path.join(d, 'ops', 'tools', 'brain-site.mjs'));
  fs.copyFileSync(path.join(FIX, 'data.mjs'), path.join(d, 'ops', 'tools', 'brain-ui-data.mjs'));
  return d;
}

let app: ElectronApplication, page: Page;
test.beforeAll(async () => {
  ({ app, page } = await launch({ SB_DEMO: '1', SB_DEMO_FREEZE: '1', SB_BRAIN: fixtureBrain() }));
  await setSize(app, 1600, 1000);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(page.getByTestId('regia-pill')).toBeVisible();
});
test.afterAll(async () => { await app?.close(); });

const settled = async () => { await expect(page.getByTestId('bx-loading')).toHaveCount(0, { timeout: 30000 }); await page.waitForTimeout(250); };

test('Qualità: errors grouped by pattern with count, week comparison, chats and rule; Discutine drafts into the Regia', async () => {
  await page.getByTestId('nav-qualita').click();
  const p = page.getByTestId('page-qualita');
  await expect(p.getByTestId('bx-q-trovati')).toBeVisible({ timeout: 30000 });
  await settled();

  // every metric with numbers has its reading and its bar
  await expect(p.getByTestId('bx-q-trovati-reading')).toContainText(/(in calo|in aumento|stabile): .* ogni 100 turni negli ultimi 7 giorni contro .* nei 7 prima/);
  await expect(p.getByTestId('bx-q-trovati-discuss-regia')).toBeVisible();
  await expect(p.getByTestId('bx-q-tornati-discuss-regia')).toBeVisible();

  const sec = p.getByTestId('bx-q-errori');
  await expect(sec.getByTestId('bx-q-errori-reading')).toContainText(/errori registrati negli ultimi 7 giorni/);
  const patterns = sec.getByTestId('bx-q-pattern');
  expect(await patterns.count()).toBeGreaterThan(1);
  const first = patterns.first();
  await expect(first.locator('.bx-pattern-n')).toHaveText(/^\d+×$/);
  await expect(first).toContainText('ultimo ');
  await expect(first).toContainText(/negli ultimi 7 giorni/);
  await expect(first).toContainText('Aree');
  await expect(first).toContainText('Chat');
  await expect(first).toContainText('Regola');
  // fatto-non-verificato carries the rule that came back (recurrence.mjs: tornato)
  const fnv = sec.locator('[data-testid="bx-q-pattern"][data-type="fatto-non-verificato"]');
  await expect(fnv).toContainText('la regola non è bastata');
  await expect(fnv).toContainText('rules/qa.md "verifica sempre lo screenshot"');
  // the chats in the app are openable
  await expect(sec.getByTestId('bx-q-pattern-open').first()).toBeVisible();
  await expect(sec.getByTestId('bx-q-patterns-rest')).toContainText('Apri ai-errors.md');
  await sec.scrollIntoViewIfNeeded();
  await shot(page, 'stats-qualita-errori');
  // the "?" explains where errors come from and every term of the card
  // (the app's HelpTip, ADR 0040: the explanation is a bubble on <body>, a click pins it, another closes it)
  const mark = sec.getByTestId('bx-q-errori-help');
  const help = page.getByTestId('bx-q-errori-help-bubble');
  await expect(mark).toHaveAccessibleName('Spiegazione: errori che si ripetono');
  await mark.click();
  for (const term of ['Da dove vengono', 'mem.mjs error', 'Tipo.', 'Trovati da te', 'Confronto', 'Cosa farne']) await expect(help).toContainText(term);
  await shot(page, 'stats-qualita-help');
  await mark.click();
  await expect(help).toBeHidden();

  await fnv.getByTestId('bx-q-pattern-discuss-regia').click();
  await expect(page.getByTestId('regia-overlay')).toBeVisible();
  const input = page.getByTestId('regia-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(/^Discutiamo l'errore che si ripete «fatto non verificato» \(fonte: ai-errors\.md\)\./);
  await expect(input).toHaveValue(/- \d+ volte dal .* al .*; ultimi 7 giorni \d+, i 7 prima \d+/);
  await expect(input).toHaveValue(/regola nata: rules\/qa\.md "verifica sempre lo screenshot" \(la regola non è bastata\)/);
  await expect(input).toHaveValue(/Perché succede e come lo evitiamo\?/);
  await expect(page.getByTestId('page-qualita')).toBeVisible(); // the page stays
  await shot(page, 'stats-qualita-discutine');
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('');
  await expect(fnv.getByTestId('bx-q-pattern-discuss-mark')).toContainText('Discusso');
  await expect(fnv.getByTestId('bx-q-pattern-discuss-mark')).toContainText('con la Regia');
});

test('Costi: the period against the one before, Discutine on the total and on every chart', async () => {
  await page.getByTestId('nav-costi').click();
  const p = page.getByTestId('page-costi');
  await expect(p.getByTestId('bx-cost-kpis')).toBeVisible({ timeout: 30000 });
  await settled();
  await expect(p.getByTestId('bx-cost-reading')).toContainText(/(in calo|in aumento|stabile): .* negli ultimi 7 giorni \(oggi compreso, non finito\) contro .* nei 7 prima/, { timeout: 30000 });
  await expect(p.getByTestId('bx-cost-discuss-regia')).toBeVisible();
  for (const c of ['spesa-giorni-7', 'spesa-tipo-7', 'spesa-modello-7', 'spesa-area-7']) await expect(p.getByTestId(`bx-chart-${c}-discuss-regia`)).toBeVisible();
  await expect(p.getByTestId('bx-advice-discuss-regia')).toBeVisible();
  await shot(page, 'stats-costi');
  await p.getByRole('button', { name: '90 giorni' }).click();
  await expect(p.getByTestId('bx-cost-reading')).toContainText('nessun confronto', { timeout: 30000 });
});
