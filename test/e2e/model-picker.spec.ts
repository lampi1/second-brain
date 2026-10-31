// E2E of the shared engine/model picker (ModelPicker.tsx, owner 2026-10-31: one selector for the Orchestrator, the Agenti
// page and the Grindhouse strip) and of the role cards' symmetry («le card degli agenti non sono simmetriche»), on the
// frozen demo, no provider requests. The strip's ⋯ «Modello ed effort…» changes only that chat (another engine is shown
// but cannot be picked there); the Orchestrator's chip has «Solo questa chat» and «Predefinito dell'Orchestrator» as two
// actions; the search says when nothing matches; the back of a role card saves the role's default. The role cards of
// one row end at the same height with their numbers on the same bottom line. Screenshots:
// test-results/shots/model-picker-*.png and agent-cards-symmetry.png.
import { expect, test, type Page } from '@playwright/test';
import { goPage, launchDemo, openOrchestrator, shot } from './helpers';

/** the demo's questions window is open at launch and would take the clicks: «Rispondi dopo» */
async function laterQuestions(page: Page) {
  const later = page.getByTestId('qwin-later'), backdrop = page.getByTestId('qwin-backdrop');
  await backdrop.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  for (let i = 0; i < 10 && await backdrop.count(); i++) {
    if (await later.isVisible()) await later.click(); else await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await expect(backdrop).toHaveCount(0);
}

test('one picker for strip, Orchestrator and role card; chat-only vs default actions; search states', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo({ width: 1600, height: 1000 });
  try {
    await laterQuestions(page);

    // the strip: ⋯ → «Modello ed effort…», this chat only
    await page.getByTestId('chat-menu-qa').click();
    await page.getByTestId('chat-model-qa').click();
    const strip = page.getByTestId('chat-picker-qa-pop');
    await expect(strip).toBeVisible();
    await expect(page.getByTestId('chat-picker-qa-scope')).toContainText('QA');
    await expect(page.getByTestId('chat-picker-qa-search')).toBeFocused();
    // the CLI default is its own row, distinct from the effort chips
    await expect(page.getByTestId('chat-picker-qa-row-claude-default')).toContainText('Predefinito della CLI');
    await expect(page.getByTestId('chat-picker-qa-group-cursor')).toBeVisible();
    await expect(page.getByTestId('chat-picker-qa-row-cursor-default')).toBeDisabled();
    await expect(page.getByTestId('chat-picker-qa-apply-default')).toHaveCount(0);
    await shot(page, 'model-picker-strip');
    // ↓ moves between the rows like a list
    await page.getByTestId('chat-picker-qa-row-claude-default').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-testid^="chat-picker-qa-row-claude-"]:focus')).toHaveCount(1);
    await page.getByTestId('chat-picker-qa-row-claude-claude-sonnet-4-6').click();
    await page.getByTestId('chat-picker-qa-effort-medium').click();
    await page.getByTestId('chat-picker-qa-apply-chat').click();
    await expect(strip).toHaveCount(0);
    await expect(page.getByTestId('tile-chat-qa')).toContainText(/sonnet/i);

    // the search: no match is said, never an empty list
    await page.getByTestId('chat-menu-qa').click();
    await page.getByTestId('chat-model-qa').click();
    await page.getByTestId('chat-picker-qa-search').fill('zzz-nessuno');
    await expect(page.getByTestId('chat-picker-qa-nomatch')).toContainText('zzz-nessuno');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('chat-picker-qa-pop')).toHaveCount(0);

    // the Orchestrator's chip: «Solo questa chat» and «Predefinito dell'Orchestrator», two actions
    await openOrchestrator(page);
    await page.getByTestId('orchestrator-model').click();
    await expect(page.getByTestId('orchestrator-model-pop')).toBeVisible();
    await expect(page.getByTestId('orchestrator-model-apply-chat')).toBeVisible();
    await expect(page.getByTestId('orchestrator-model-apply-default')).toHaveText('Predefinito dell’Orchestrator');
    for (const engine of ['claude', 'cursor', 'codex', 'opencode']) await expect(page.getByTestId(`orchestrator-model-group-${engine}`)).toHaveCount(1);
    await shot(page, 'model-picker-orchestrator');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('orchestrator-model')).toBeFocused();

    // the back of a role card: the role's default for new chats
    await goPage(page, 'agenti');
    await page.getByTestId('catalog-flip-scout').click();
    await page.getByTestId('catalog-model-pick-scout').click();
    await expect(page.getByTestId('catalog-picker-scout-scope')).toContainText('nuove chat di Scout');
    await expect(page.getByTestId('catalog-picker-scout-row-claude-default')).toContainText('Modello del livello');
    await expect(page.getByTestId('catalog-picker-scout-apply-chat')).toHaveCount(0);
    await shot(page, 'model-picker-role');
    await page.getByTestId('catalog-picker-scout-row-claude-claude-opus-5-5').click();
    await page.getByTestId('catalog-picker-scout-apply-role').click();
    await expect(page.getByTestId('catalog-picker-scout-pop')).toHaveCount(0);
    await expect(page.getByTestId('catalog-model-pick-scout')).toContainText(/opus/i);
  } finally { await app.close(); }
});

test('role cards of one row are equally tall, their numbers on one bottom line, nothing cut', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchDemo({ width: 1600, height: 1000 });
  try {
    await laterQuestions(page);
    await goPage(page, 'agenti');
    const cards = page.locator('[data-testid="catalog-roles"] > .catalog-card');
    await expect(cards.first()).toBeVisible();
    const boxes = await cards.evaluateAll(els => els.map(e => {
      const r = e.getBoundingClientRect(), stats = e.querySelector('.bm-face-front > .catalog-stats')!.getBoundingClientRect();
      const front = e.querySelector<HTMLElement>('.bm-face-front')!;
      return { top: Math.round(r.top), height: Math.round(r.height), stats: Math.round(stats.bottom), cut: front.scrollHeight > front.clientHeight + 1 };
    }));
    const rows = new Map<number, typeof boxes>();
    for (const b of boxes) rows.set(b.top, [...rows.get(b.top) ?? [], b]);
    expect([...rows.values()].some(r => r.length > 1)).toBe(true);
    for (const row of rows.values()) {
      expect(new Set(row.map(b => b.height)).size).toBe(1);
      expect(new Set(row.map(b => b.stats)).size).toBe(1);
    }
    expect(boxes.every(b => !b.cut)).toBe(true);
    await shot(page, 'agent-cards-symmetry');
  } finally { await app.close(); }
});
