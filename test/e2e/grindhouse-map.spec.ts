// The Grindhouse and the map told simply (OS · App semplice, branch C): the menu, Ctrl+1 and Esc always show the
// overview of all the agents (every open chat folds); a strip's ⓘ says the skills its run used; a plan step on the
// map says role · model · preset, with «previsto» before it starts; a group of steps of one turn counts live («5 in
// parallelo · 1 al lavoro, 4 da far partire»). Frozen demo; screenshots in test-results/shots/grindhouse-*.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import type { StrategyPlan } from '../../src/shared/strategy';
import { launchDemo, shot } from './helpers';

const demo = <T,>(app: ElectronApplication, fn: string, ...args: unknown[]): Promise<T> =>
  app.evaluate((_e, [f, a]) => ((globalThis as unknown as { __sbDemo: Record<string, (...x: unknown[]) => unknown> }).__sbDemo[f as string]!)(...(a as unknown[])), [fn, args] as const) as Promise<T>;

test('the menu, Ctrl+1 and Esc fold every open chat into the overview of all agents', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    const open = async () => { if ((await page.getByTestId('chat-expand-fix').getAttribute('aria-expanded')) !== 'true') await page.getByTestId('chat-expand-fix').click(); await expect(page.getByTestId('chat-expand-fix')).toHaveAttribute('aria-expanded', 'true'); };
    await open();
    await shot(page, 'grindhouse-overview-before');
    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('chat-expand-fix')).toHaveAttribute('aria-expanded', 'false');
    await shot(page, 'grindhouse-overview-after');
    await open();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+1');
    await expect(page.getByTestId('chat-expand-fix')).toHaveAttribute('aria-expanded', 'false');
    await open();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('chat-expand-fix')).toHaveAttribute('aria-expanded', 'false');
  } finally { await app.close(); }
});

test('the menu leaves a chat in focus mode and shows every agent', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+2');
    await expect(page.getByTestId('chat-expand-fix')).toHaveCount(0);
    await shot(page, 'grindhouse-overview-focus-before');
    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('chat-expand-fix')).toBeVisible();
    await shot(page, 'grindhouse-overview-focus-after');
  } finally { await app.close(); }
});

test('a strip\'s ⓘ says the skills its run used (no chips on the row, ADR 0366)', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 1200 });
  try {
    await demo(app, 'tree'); // the delegation tree's chats carry a run, the plain demo ones do not
    await demo(app, 'skills', 'tree-plan', ['code-work', 'air-qa', 'ops-core', 'wiz-pr']);
    const info = page.getByTestId('strip-info-tree-plan');
    await expect(info).toHaveAttribute('aria-label', /skill: code-work · air-qa · ops-core · wiz-pr/);
    await expect(page.getByTestId('skill-chips-tree-plan')).toHaveCount(0);
    // a Cursor chat reports no skill use: its role's loaded skills, marked «uso non tracciato»
    await demo(app, 'skills', 'sms', [], ['ops-core', 'air-qa', 'wiz-pr']);
    const loaded = page.getByTestId('strip-info-sms');
    await expect(loaded).toHaveAttribute('aria-label', /uso non tracciato\): ops-core · air-qa · wiz-pr/);
    await loaded.scrollIntoViewIfNeeded();
    await loaded.hover();
    await expect(loaded.locator('.gs-tip')).toBeVisible();
    await expect(loaded.locator('.gs-tip')).toContainText('uso non tracciato');
    await shot(page, 'grindhouse-skills-untracked');
    await page.mouse.move(2, 2); // its card closes when the pointer leaves
    await expect(loaded.locator('.gs-tip')).toBeHidden();
    await info.scrollIntoViewIfNeeded();
    await info.hover();
    await expect(info.locator('.gs-tip')).toContainText('code-work');
    await shot(page, 'grindhouse-skills');
  } finally { await app.close(); }
});

test('a plan step says role · model · preset, and a parallel group counts live', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    await demo(app, 'tree');
    const steps = [
      { title: 'Leggo dove si calcola lo sconto', role: 'scout', preset: 'min', state: 'done', startedAt: Date.now() - 600_000, endedAt: Date.now() - 300_000 },
      { title: 'Sconto sul carrello', role: 'artisan', preset: 'base', state: 'now', startedAt: Date.now() - 120_000 },
      { title: 'Sconto sull’ordine', role: 'artisan', preset: 'max', state: 'todo', par: true },
      { title: 'Sconto sul reso', role: 'artisan', state: 'todo', par: true },
      { title: 'Note di rilascio', role: 'herald', state: 'todo', par: true },
      { title: 'Provo tutto', role: 'sentinel', state: 'todo', par: true },
    ] as unknown as StrategyPlan['steps'];
    await demo(app, 'plan', 'tree-plan', { phase: 'running', at: Date.now(), clarified: [], map: 'alfa-shop', steps } as StrategyPlan);
    await page.getByTestId('maps-btn').click();
    const view = page.getByTestId('pm-view');
    await expect(view).toBeVisible();
    await expect(view.getByTestId('pm-group-2')).toContainText('5 in parallelo · 1 al lavoro, 4 da far partire');
    await expect(view.getByTestId('pm-step-who-3')).toContainText('· previsto');
    await expect(view.getByTestId('pm-step-who-2')).not.toContainText('previsto');
    await expect(view.getByTestId('pm-step-who-3')).toContainText('Artisan ·');
    // the demo wires the role cards' models too: «previsto» comes with a real model, not an empty one
    await expect(view.getByTestId('pm-step-who-3')).toContainText(/Artisan · [A-Za-z].*· previsto/);
    await shot(page, 'grindhouse-map-plan-group');
  } finally { await app.close(); }
});
