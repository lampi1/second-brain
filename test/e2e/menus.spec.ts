// The app's menus, clear and in one place each (2026-10-15): the gear holds only the look and the way to Settings, "…"
// in the top bar is always there with the actions used now and then, a chat's ⋯ menu puts the everyday actions first
// and the hand-off in one labelled group, the sidebar is three groups (Lavoro, Brain, App). Frozen demo; screenshots
// of each menu in test-results/shots/menus-*.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('menus: gear, "…", a chat\'s ⋯ and the sidebar groups', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    // the gear: theme (no "Windows" in it), density, shortcuts, every setting; nothing about DevOps or the engines
    await page.getByTestId('settings').click();
    const gear = page.getByTestId('settings-pop');
    await expect(gear).toBeVisible();
    await expect(page.getByTestId('theme-system')).toHaveText(/Come il sistema/);
    await expect(gear).not.toContainText('Windows');
    await expect(gear).not.toContainText('DevOps');
    await expect(gear).not.toContainText('motori');
    await expect(gear.locator('.menu-sep + .menu-sep')).toHaveCount(0);
    await shot(page, 'menus-gear');
    await page.keyboard.press('Escape');

    // "…" is on the bar at any width with browsers, questions window, Credenziali and Migliora; those left the bar
    for (const off of ['topbar-browsers', 'topbar-credentials', 'topbar-qwin', 'topbar-improve']) await expect(page.getByTestId(off)).toHaveCount(0);
    await page.getByTestId('topbar-more').click();
    for (const id of ['more-browsers', 'more-qwin', 'more-credentials', 'more-improve']) await expect(page.getByTestId(id)).toBeVisible();
    await shot(page, 'menus-more');
    // hiding the browsers leaves a count on "…"
    await page.getByTestId('more-browsers').click();
    await expect(page.getByTestId('topbar-browsers-count')).toBeVisible();
    await page.keyboard.press('Control+Shift+B');
    await expect(page.getByTestId('topbar-browsers-count')).toHaveCount(0);

    // a chat's ⋯: the everyday actions first, then the engine's choices, the continuation group, close last
    await page.getByTestId('chat-menu-qa').click();
    const pop = page.getByTestId('chat-menu-pop-qa');
    await expect(pop).toBeVisible();
    const order = await pop.locator('[data-testid]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')!));
    const at = (id: string) => order.findIndex(t => t.startsWith(id));
    expect(at('chat-rename-qa')).toBe(0);
    expect(at('chat-rename-qa')).toBeLessThan(at('chat-model-qa'));
    expect(at('chat-model-qa')).toBeLessThan(at('chat-handoff-qa'));
    expect(at('chat-handoff-qa')).toBeLessThan(at('chat-resume-qa'));
    expect(order.at(-1)).toBe('chat-close-qa');
    await expect(pop).toContainText('Passaggio di consegne');
    await expect(page.getByTestId('chat-handoff-qa')).toHaveText(/nota per chi continua/);
    await shot(page, 'menus-chat');
    await page.keyboard.press('Escape');

    // the sidebar: three groups, "Regole imparate" in Brain (no more "Miglioramento" next to "Migliora l'app")
    await page.getByTestId('nav-collapse').click();
    const nav = page.getByTestId('sidebar');
    if (!(await nav.locator('.nav-title').count())) await page.getByTestId('nav-collapse').click();
    await expect(nav.locator('.nav-title')).toHaveCount(3);
    await expect(page.getByTestId('nav-miglioramento')).toHaveAttribute('aria-label', 'Regole imparate');
    const navOrder = await nav.locator('.nav-title, .nav-item').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
    const ix = (id: string) => navOrder.indexOf(id);
    expect(ix('nav-group-work')).toBeLessThan(ix('nav-workspace'));
    expect(ix('nav-group-brain')).toBeLessThan(ix('nav-miglioramento'));
    expect(ix('nav-miglioramento')).toBeLessThan(ix('nav-group-app'));
    expect(ix('nav-group-app')).toBeLessThan(ix('nav-migliora'));
    await shot(page, 'menus-sidebar');
  } finally {
    await app.close();
  }
});
