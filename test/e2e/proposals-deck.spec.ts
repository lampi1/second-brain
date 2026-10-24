// Memoria → Proposte (ADR 0123) in the frozen demo: the demo's skill candidate, applied changes (never memory ones, ADR 0149), the
// Orchestrator's setting request, the Battito's rule and the improvement loop's policy are one deck, newest first, with
// who / where / when / evidence. Swipe by mouse drag (a short drag springs back, a long one decides), the round
// buttons, ← / →, Z and Ctrl+Z (undo of the held decision), a blocked side, the end state with its counts and the
// sidebar badge. Decisions reach main and its sources (settings:confirm, brainmodel:rollback …).
// Screenshots dark and light: a card mid-drag, the end state, the empty state (test-results/shots/proposals-*.png).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, setQuestionsAside, shot } from './helpers';

const SHOTS = process.env.SB_SHOTS_COPY;
async function snap(page: Page, name: string): Promise<void> {
  const file = await shot(page, name);
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.copyFileSync(file, path.join(SHOTS, `${name}.png`)); }
}
/** The deck: Memoria, its Proposte tab (the hub's tab bar, ADR 0122). */
async function openDeck(page: Page): Promise<void> {
  await page.getByTestId('nav-memoria').click();
  const tab = page.getByTestId('mh-tab-proposte');
  if (await tab.count()) await tab.click();
  await expect(page.getByTestId('proposals-deck')).toBeVisible();
}
async function theme(page: Page, scheme: 'dark' | 'light'): Promise<void> {
  await page.evaluate(t => window.sb.invoke('settings:set', { theme: t }), scheme);
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.waitForTimeout(250);
}
const top = (page: Page) => page.getByTestId('pd-card-top');
async function drag(page: Page, dx: number, release = true): Promise<void> {
  // centred: the cards are tall (ADR 0132) and the sticky tab bar may cover a title that is only "in view"
  await top(page).locator('.pd-title').evaluate(e => e.scrollIntoView({ block: 'center' }));
  const box = (await top(page).locator('.pd-title').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + i * 1.5);
  if (release) await page.mouse.up();
}
const list = (page: Page) => page.evaluate(() => window.sb.invoke('proposals:list', undefined));

test('the deck: every source in one stack, swipe / buttons / keys, undo, the end state and the badge', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo();
  try {
    await openDeck(page);
    const first = await list(page);
    const sources = new Set(first.items.map(c => c.source));
    for (const s of ['candidate', 'change', 'setting', 'pulse', 'policy'] as const) expect(sources).toContain(s);
    // memory facts and memory tidy-ups are never cards (ADR 0149): only skills, rules and the rest
    expect(sources.has('memory')).toBe(false);
    expect(first.items.some(c => c.id === 'change:demo-p2')).toBe(false);
    // newest first, provenance resolved to the demo's chats
    const at = first.items.map(c => c.provenance.at);
    expect([...at].sort().reverse()).toEqual(at);
    await expect(page.getByTestId('nav-badge-proposals')).toHaveText(String(first.items.length));
    await expect(page.getByTestId('pd-chip-all')).toContainText(String(first.items.length));

    // the top card is the newest: who, where, when, evidence
    await expect(top(page)).toHaveAttribute('data-card', first.items[0]!.id);
    await expect(page.getByTestId('pd-provenance')).toBeVisible();

    // a short drag springs back; a long one mid-way shows the stamp (screenshot), then decides
    await drag(page, 40);
    await expect(top(page)).toHaveAttribute('data-card', first.items[0]!.id);
    await drag(page, 110, false);
    await expect(page.getByTestId('pd-stamp-yes')).toHaveCSS('opacity', /^(0\.[5-9]|1)/);
    await snap(page, 'proposals-deck-drag-dark');
    await theme(page, 'light');
    await snap(page, 'proposals-deck-drag-light');
    await theme(page, 'dark');
    await page.mouse.up(); // below the threshold: it springs back
    await expect(top(page)).toHaveAttribute('data-card', first.items[0]!.id);
    await expect(page.getByTestId('pd-stamp-yes')).toHaveCSS('opacity', '0');

    // the newest is the Orchestrator's setting request: ✓ holds it (the badge already counts it off), ↺ takes it back
    const setting = first.items[0]!;
    expect(setting.source).toBe('setting');
    await page.getByTestId('pd-approve').click();
    await expect(top(page)).not.toHaveAttribute('data-card', setting.id);
    await expect(page.getByTestId('nav-badge-proposals')).toHaveText(String(first.items.length - 1));
    await page.getByTestId('pd-undo').click();
    await expect(top(page)).toHaveAttribute('data-card', setting.id);
    await expect(page.getByTestId('nav-badge-proposals')).toHaveText(String(first.items.length));
    await page.keyboard.press('ArrowRight');
    await expect(top(page)).not.toHaveAttribute('data-card', setting.id);
    // ← on the next one, then Ctrl+Z brings it back
    const second = await top(page).getAttribute('data-card');
    await page.keyboard.press('ArrowLeft');
    await expect(top(page)).not.toHaveAttribute('data-card', second!);
    await page.keyboard.press('Control+z');
    await expect(top(page)).toHaveAttribute('data-card', second!);
    // the setting went to main when the next decision was made; Ctrl+Z left it applied
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('settings:get', undefined))).pulse?.dailyUsd, { timeout: 10_000 }).toBe(0.4);

    // the rest, each by another way: drag, keys, buttons; a skill candidate without its evidence can only be rejected
    const decided: Record<string, 'approve' | 'reject'> = {}, snapped = new Set<string>();
    for (let guard = 0; guard < 20 && await top(page).count(); guard++) {
      const id = (await top(page).getAttribute('data-card'))!, card = first.items.find(c => c.id === id)!;
      // every card asks one plain question (ADR 0126); what each answer does is on the buttons' tips (ADR 0132)
      await expect(page.getByTestId('pd-question')).toHaveText(/\?$/);
      await expect(page.getByTestId('pd-approve')).toHaveAttribute('title', /.+/);
      if (!snapped.has(card.source)) { snapped.add(card.source); await snap(page, `proposals-card-${card.source}-dark`); }
      if (card.id === 'change:demo-p3') {
        await expect(page.getByTestId('pd-code')).toContainText('status === 500');
        await page.keyboard.press('ArrowRight'); decided[id] = 'approve';
      } else if (card.source === 'candidate') {
        await expect(page.getByTestId('pd-approve')).toBeDisabled();
        await drag(page, 260);
        await expect(top(page)).toHaveAttribute('data-card', id); // refused: back on top, with the reason
        await expect(page.locator('.pd-hint')).not.toBeEmpty();
        await snap(page, 'proposals-deck-blocked-dark');
        await page.getByTestId('pd-reject').click(); decided[id] = 'reject';
      }
      else if (card.source === 'policy') { await page.keyboard.press('ArrowLeft'); decided[id] = 'reject'; }
      else { await page.keyboard.press('ArrowRight'); decided[id] = 'approve'; }
      await expect(top(page).and(page.locator(`[data-card="${id}"]`))).toHaveCount(0);
    }
    const approved = Object.values(decided).filter(d => d === 'approve').length + 1;
    const rejected = Object.values(decided).filter(d => d === 'reject').length;
    await expect(page.getByTestId('pd-done')).toBeVisible();
    await expect(page.getByTestId('pd-count-approved')).toContainText(String(approved));
    await expect(page.getByTestId('pd-count-rejected')).toContainText(String(rejected));
    // «Annulla ultima» on the end state: the last card is back; decided again, the end state returns
    const last = Object.keys(decided).at(-1)!;
    await page.getByTestId('pd-done-undo').click();
    await expect(top(page)).toHaveAttribute('data-card', last);
    await page.keyboard.press(decided[last] === 'approve' ? 'ArrowRight' : 'ArrowLeft');
    await expect(page.getByTestId('pd-done')).toBeVisible();
    await page.getByTestId('pd-review-rejected').click();
    await expect(page.getByTestId('pd-rejected-list').locator('li')).toHaveCount(rejected);
    await snap(page, 'proposals-deck-done-dark');
    await theme(page, 'light');
    await snap(page, 'proposals-deck-done-light');
    await theme(page, 'dark');

    // everything reached main through its own source: nothing open any more, the badge is gone
    await expect.poll(async () => (await list(page)).items.length, { timeout: 15_000 }).toBe(0);
    await expect(page.getByTestId('nav-badge-proposals')).toHaveCount(0);
    const changes = (await page.evaluate(() => window.sb.invoke('brainmodel:state', undefined))).changes;
    expect(changes.find(c => c.id === 'demo-p1')?.rolledBackAt).toBeTruthy(); // the candidate's rejection undid its change
    expect(changes.find(c => c.id === 'demo-l6')?.rolledBackAt).toBeFalsy(); // kept

    // the end state stays until the page is left; after a reload the deck is empty
    await page.reload();
    await setQuestionsAside({ app, page }); // a reload forgets «Rispondi dopo»
    await openDeck(page);
    await expect(page.getByTestId('pd-empty')).toBeVisible();
    await snap(page, 'proposals-deck-empty-dark');
    await theme(page, 'light');
    await snap(page, 'proposals-deck-empty-light');
  } finally { await app.close(); }
});
