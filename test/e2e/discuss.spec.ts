// End-to-end: "Discuti" on the ideas, yours and the AI's (Idee, filter "Dall'IA"), in the frozen demo (chats, the
// Orchestrator) pointed at the synthetic brain of test/fixtures/brain-ui (SB_BRAIN: the demo then answers the brain pages
// from it). Discuti docks the Orchestrator next to the page with a ready draft (file and line of ideas.md; in English,
// ADR 0057) that is NOT sent until Enter; sent, the idea says "Discussa" and the mark leads back to the Orchestrator;
// there is no "Apri una chat" (owner, 2026-10-19: the Orchestrator delegates); the Idee table marks the discussed idea;
// the peek has the same bar. Screenshots: test-results/shots/discuss-*.png (dark, plus one light).
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, setSize, shot, goPage } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');
function fixtureBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-discuss-'));
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
  await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
});
test.afterAll(async () => { await app?.close(); });

const settled = async () => { await expect(page.getByTestId('bx-loading')).toHaveCount(0, { timeout: 30000 }); await page.waitForTimeout(250); };

test("Idee · Dall'IA: Discuti docks the Orchestrator with an editable draft that quotes the idea; sent, the idea says Discussa", async () => {
  await goPage(page, 'idee');
  await settled();
  await page.getByTestId('bx-tab-ia').click();
  await expect(page.getByTestId('bx-tab-ia')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('nav-spunti')).toHaveCount(0); // one entry, Idee
  // a reflection of the AI has the same buttons
  await expect(page.getByTestId('bx-riflessione').first().getByTestId('bx-discuss-orchestrator')).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'Una chat finita si chiude da sola' }).click();
  const peek = page.getByTestId('bx-peek');
  await expect(peek.getByTestId('bx-reason')).toBeVisible();
  await expect(peek.getByTestId('bx-discuss-orchestrator')).toHaveText('Discuti');
  await expect(peek.getByTestId('bx-discuss-chat')).toHaveCount(0); // one button: no work chat from a page
  await page.waitForTimeout(300); // the peek slides in
  await shot(page, 'discuss-idee-ia-peek');

  await peek.getByTestId('bx-discuss-orchestrator').click();
  await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
  const input = page.getByTestId('orchestrator-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(/^Let's discuss the AI's suggestion «Una chat finita si chiude da sola» \(ideas\.md, line \d+, from /);
  await expect(input).toHaveValue(/Do not change the state in ideas\.md/);
  await expect(page.getByTestId('page-idee')).toBeVisible(); // the page stays
  const row = page.getByRole('row').filter({ hasText: 'Una chat finita si chiude da sola' });
  await expect(row.getByTestId('bx-idea-discussed')).toHaveCount(0); // not sent yet: not discussed
  await shot(page, 'discuss-orchestrator-draft');

  await page.keyboard.type(' Rispondi breve.');
  await expect(input).toHaveValue(/Rispondi breve\.$/);
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('');
  await expect(row.getByTestId('bx-idea-discussed')).toBeVisible();
  await row.click();
  await expect(peek.getByTestId('bx-discuss-mark')).toContainText('Discussa');
  await expect(peek.getByTestId('bx-discuss-mark')).toContainText('con l’Orchestrator');
  await expect(page.locator('[data-testid="orchestrator-overlay"]')).toContainText('Rispondi breve.');
  await shot(page, 'discuss-orchestrator-sent');
  await page.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);
});

test('Idee: the "Discussa" mark leads back to the Orchestrator; no work chat was created', async () => {
  const before = await page.evaluate(() => window.sb.invoke('chat:list', undefined));
  expect(before.some(c => c.title.startsWith('Idea · '))).toBe(false);
  await page.getByRole('row').filter({ hasText: 'Una chat finita si chiude da sola' }).click();
  const card = page.getByTestId('bx-peek');
  await card.getByTestId('bx-discuss-open').click();
  await expect(page.getByTestId('orchestrator-input')).toBeFocused();
  await expect(page.getByTestId('page-idee')).toBeVisible();
});

test('Idee: the table marks the discussed idea; the side peek has Discuti (light theme too)', async () => {
  await goPage(page, 'idee');
  await settled();
  const row = page.getByRole('row').filter({ hasText: 'Una chat finita si chiude da sola' });
  await expect(row.getByTestId('bx-idea-discussed')).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'Diario vocale a fine giornata' }).click();
  const peek = page.getByTestId('bx-peek');
  await expect(peek.getByTestId('bx-discuss-orchestrator')).toBeVisible();
  await peek.getByTestId('bx-discuss-orchestrator').focus();
  await shot(page, 'discuss-idee-peek');
  await page.keyboard.press('Enter');
  await expect(peek).toHaveCount(0); // the peek steps aside so the Orchestrator overlay shows
  await expect(page.getByTestId('orchestrator-input')).toBeFocused();
  await expect(page.getByTestId('orchestrator-input')).toHaveValue(/^Let's discuss my idea «Diario vocale a fine giornata» .*state in progress/);
  await expect(page.getByTestId('orchestrator-input')).toHaveValue(/Where are we\?/);
  await shot(page, 'discuss-idee-orchestrator');
  // light theme: the peek again, with its bar
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.getByRole('row').filter({ hasText: 'Una chat finita si chiude da sola' }).click();
  await expect(peek.getByTestId('bx-discuss-mark')).toContainText('Discussa');
  await page.waitForTimeout(200);
  await shot(page, 'discuss-idee-light');
  await page.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
});

test('a draft already in the Orchestrator stays; a different message does not mark the idea', async () => {
  const input = page.getByTestId('orchestrator-input');
  await input.fill('Nota mia: prima questo.');
  await page.getByRole('row').filter({ hasText: 'Pausa automatica dei test lenti' }).click();
  const peek = page.getByTestId('bx-peek');
  await peek.getByRole('button', { name: 'Riga successiva' }).click();
  await expect(peek).toContainText('Spesa per tipo di lavoro nel brief');
  await peek.getByTestId('bx-discuss-orchestrator').click();
  await expect(input).toHaveValue(/^Nota mia: prima questo\.\n\nLet's discuss the AI's suggestion «Spesa per tipo di lavoro nel brief»/);
  await input.fill('Un altro messaggio, non la bozza.');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await page.waitForTimeout(300);
  await expect(page.getByRole('row').filter({ hasText: 'Spesa per tipo di lavoro nel brief' }).getByTestId('bx-idea-discussed')).toHaveCount(0);
});
