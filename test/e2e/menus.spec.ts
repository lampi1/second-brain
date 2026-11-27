// The app's menus, clear and in one place each (2026-10-15): the gear holds only the look and the way to Settings, "…"
// in the top bar is always there with the actions used now and then, a chat's ⋯ menu puts the everyday actions first
// and the hand-off in one labelled group, the sidebar's ☰ is three groups (Lavoro, Svago, Sistema; ADR 0366). Frozen demo; screenshots
// of each menu in test-results/shots/menus-*.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('menus: gear, "…", a chat\'s ⋯ and the sidebar groups', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    // The gear links to shortcuts and Settings; appearance and connectors have one home in Settings.
    await page.getByTestId('settings').click();
    const gear = page.getByTestId('settings-pop');
    await expect(gear).toBeVisible();
    await expect(page.getByTestId('theme-system')).toHaveCount(0);
    await expect(page.getByTestId('settings-all')).toBeVisible();
    await expect(gear.getByTestId('topbar-connectors')).toHaveCount(0); // the connectors are a chip on the bar (ADR 0349), not in the gear
    await expect(page.getByTestId('nav-map')).toHaveCount(0);
    await expect(gear).not.toContainText('Windows');
    await expect(gear).not.toContainText('DevOps');
    await expect(gear).not.toContainText('motori');
    await expect(gear.locator('.menu-sep + .menu-sep')).toHaveCount(0);
    await shot(page, 'menus-gear');
    await page.keyboard.press('Escape');

    // "…" is on the bar at any width with Credenziali; it left the bar (the popups switch is on it).
    // The hide-browsers switch is gone (#82); "Migliora l'app" is gone (ADR 0079): no entry anywhere.
    for (const off of ['topbar-browsers', 'topbar-credentials', 'topbar-improve']) await expect(page.getByTestId(off)).toHaveCount(0);
    await page.getByTestId('settings').click();
    await expect(page.getByTestId('more-credentials')).toBeVisible();
    for (const id of ['more-browsers', 'more-improve']) await expect(page.getByTestId(id)).toHaveCount(0);
    await expect(page.getByTestId('settings-pop')).not.toContainText('Migliora');
    await shot(page, 'menus-more');
    await page.keyboard.press('Escape');

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

    // the sidebar (ADR 0366, issue #491): ☰ holds the eight pages in three groups (Lavoro, Svago, Sistema); Task,
    // Registrazioni, Collegamenti and Log left it (palette, G keys, Orchestrator), Task comes back only with unread items
    const nav = page.getByTestId('sidebar');
    await expect(page.getByTestId('nav-collapse')).toHaveCount(0); // always expanded: no toggle
    await expect(page.getByTestId('nav-home')).toBeVisible();
    await page.getByTestId('nav-menu-btn').click();
    const menu = page.getByTestId('nav-menu');
    await expect(menu.locator('.nav-title')).toHaveCount(3);
    const navOrder = await menu.locator('.nav-title, .nav-item').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
    expect(navOrder.filter(id => id !== 'nav-task')).toEqual(['nav-group-work', 'nav-menu-home', 'nav-piani', 'nav-group-leisure', 'nav-impara', 'nav-scacchi',
      'nav-group-system', 'nav-agenti', 'nav-memoria', 'nav-andamento', 'nav-impostazioni']);
    if (navOrder.includes('nav-task')) expect(navOrder.indexOf('nav-task')).toBe(navOrder.indexOf('nav-piani') + 1);
    for (const gone of ['nav-registrazioni', 'nav-collegamenti', 'nav-log', 'nav-workspace', 'nav-dashboard', 'nav-skill', 'nav-regole', 'nav-script', 'nav-idee',
      'nav-apprendimento', 'nav-costi', 'nav-qualita', 'nav-classificatori', 'nav-miglioramento', 'nav-migliora', 'nav-devops']) expect(navOrder).not.toContain(gone);
    await expect(nav).not.toContainText('DevOps');
    await shot(page, 'menus-sidebar');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  } finally {
    await app.close();
  }
});
