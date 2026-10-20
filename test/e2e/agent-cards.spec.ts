// E2E of the agent cards' front (owner, 2026-10-19): on the frozen demo (made-up runs, main/demo-agent-runs.ts) every
// card shows the character large and centred, a level with its verified successes beside it («Lv 4 Esperto · 38
// riusciti verificati», ADR 0100) and its way to the next one, and a performance % — or "In rodaggio" below 5 judged
// runs — each with a "?" whose bubble gives the formula; a role with no runs is a Lv 1 with the empty-state line; the
// model tier chip reads «Modello: …», never «Livello». The flip to the back still works. Screenshots dark and light: test-results/shots/agent-cards-*.png.
import { expect, test, type Page } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

async function theme(page: Page, scheme: 'dark' | 'light') {
  await page.evaluate(t => window.sb.invoke('settings:set', { theme: t }), scheme);
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(250);
}

test('agent cards: big centred character, level and performance with their "?" formulas, dark and light', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchDemo({ width: 1440, height: 1000 });
  try {
    await goPage(page, 'agenti');
    const overview = page.getByTestId('agent-overview');
    await expect(overview.getByTestId('catalog-card-artisan')).toBeVisible();

    // a veteran: a level past 1 and a performance %
    const artisan = overview.getByTestId('catalog-card-artisan');
    await expect(artisan.getByTestId('catalog-level-artisan')).toContainText(/Lv \d+/);
    expect(Number(await artisan.getByTestId('catalog-level-artisan').getAttribute('data-level'))).toBeGreaterThan(1);
    await expect(artisan.getByTestId('catalog-perf-artisan')).toContainText('%');
    await expect(artisan.getByTestId('catalog-level-wins-artisan')).toContainText(/\d+ riusciti verificati/);
    await expect(artisan.locator('.catalog-chip[data-kind="model"]')).toContainText('Modello:');
    const big = await artisan.locator('.catalog-hero .agent-avatar').boundingBox();
    expect(big!.width).toBeGreaterThanOrEqual(96);
    // a new role: still warming up; a role with no runs: Lv 1 and the empty-state line
    await expect(overview.getByTestId('catalog-perf-herald')).toContainText('In rodaggio');
    await expect(overview.getByTestId('catalog-perf-herald')).toHaveAttribute('data-band', 'warmup');
    await expect(overview.getByTestId('catalog-level-pulse')).toContainText('Lv 1');
    await expect(overview.getByTestId('catalog-level-pulse')).toContainText('Nessun lavoro riuscito verificato ancora');

    // the "?" give the formulas, with the agent's own numbers
    await artisan.getByTestId('catalog-level-help-artisan').click();
    const lv = page.getByTestId('catalog-level-help-artisan-bubble');
    await expect(lv).toBeVisible();
    await expect(lv).toContainText('5 × N × (N − 1) ÷ 2');
    await expect(lv).toContainText('riusciti verificati su');
    await expect(lv).toContainText('solo con i lavori riusciti e verificati');
    await expect(artisan).toHaveAttribute('data-flipped', 'false'); // the "?" does not flip the card
    await shot(page, 'agent-cards-level-help-dark');
    await page.keyboard.press('Escape');
    await artisan.getByTestId('catalog-perf-help-artisan').click();
    const pf = page.getByTestId('catalog-perf-help-artisan-bubble');
    await expect(pf).toContainText('30 giorni');
    await expect(pf).toContainText('Voti finora');
    await shot(page, 'agent-cards-perf-help-dark');
    await page.keyboard.press('Escape');
    await expect(pf).toBeHidden();

    await overview.getByTestId('catalog-card-pulse').scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    await shot(page, 'agent-cards-new-dark');
    await overview.evaluate(el => { for (let e: Element | null = el; e; e = e.parentElement) e.scrollTop = 0; });
    await page.waitForTimeout(300);
    await shot(page, 'agent-cards-dark');
    // the flip still works from the front
    await artisan.getByTestId('catalog-flip-artisan').click();
    await expect(artisan).toHaveAttribute('data-flipped', 'true');
    await page.keyboard.press('Escape');
    await expect(artisan).toHaveAttribute('data-flipped', 'false');

    await theme(page, 'light');
    await goPage(page, 'agenti');
    await expect(page.getByTestId('catalog-card-artisan')).toBeVisible();
    await page.mouse.move(2, 2);
    await page.getByTestId('agent-overview').evaluate(el => { for (let e: Element | null = el; e; e = e.parentElement) e.scrollTop = 0; });
    await page.waitForTimeout(400);
    await shot(page, 'agent-cards-light');
    // the new roles further down: warming up, and no runs at all
    await page.getByTestId('catalog-card-pulse').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, 'agent-cards-new-light');
    await page.getByTestId('catalog-perf-help-scout').click();
    await expect(page.getByTestId('catalog-perf-help-scout-bubble')).toBeVisible();
    await shot(page, 'agent-cards-perf-help-light');
  } finally { await app.close(); }
});

test('"?" explanations across the app: Orchestrator, strips, Agenti summary, Settings, Skill', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchDemo({ width: 1440, height: 1000 });
  const open = async (id: string, text: string | RegExp, name: string) => {
    const mark = page.getByTestId(id).first();
    await mark.scrollIntoViewIfNeeded();
    await mark.click();
    const bubble = page.getByTestId(`${id}-bubble`).first();
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText(text);
    await shot(page, name);
    await page.keyboard.press('Escape');
    await expect(bubble).toBeHidden();
  };
  try {
    await open('orchestrator-help', 'coordina il lavoro', 'explain-orchestrator-dark');
    const strip = page.locator('[data-testid^="chat-help-"]').first();
    await expect(strip).toBeVisible();
    const id = (await strip.getAttribute('data-testid'))!;
    await open(id, 'senza le attese', 'explain-strip-dark');
    await expect(page.locator('section.chat-tile.is-expanded')).toHaveCount(0); // the "?" did not expand the strip
    await goPage(page, 'agenti');
    await open('catalog-summary-help', 'In prova', 'explain-agents-dark');
    await goPage(page, 'impostazioni');
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await open('st-toasts-help', 'Urgenti', 'explain-settings-toasts-dark');
    await open('st-stall-help', 'agent_children', 'explain-settings-stall-dark');
    await open('st-judge-help', 'peso pieno', 'explain-settings-judge-dark');
    await open('st-tiers-help', 'leggero', 'explain-settings-tiers-dark');
    await theme(page, 'light');
    await goPage(page, 'skill');
    await expect(page.getByTestId('skills-page')).toBeVisible();
    await open('sk-help', 'SKILL.md', 'explain-skills-light');
  } finally { await app.close(); }
});
