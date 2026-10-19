// The app's menus, clear and in one place each (2026-10-15): the gear holds only the look and the way to Settings, "…"
// in the top bar is always there with the actions used now and then, a chat's ⋯ menu puts the everyday actions first
// and the hand-off in one labelled group, the sidebar is three groups (Lavoro, Brain, App). Frozen demo; screenshots
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
    await expect(page.getByTestId('topbar-connectors')).toHaveCount(0);
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
    await page.getByTestId('topbar-more').click();
    await expect(page.getByTestId('more-credentials')).toBeVisible();
    for (const id of ['more-browsers', 'more-improve']) await expect(page.getByTestId(id)).toHaveCount(0);
    await expect(page.getByTestId('topbar-more-pop')).not.toContainText('Migliora');
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

    // the sidebar: three groups, Regole in Brain (its learned rules inside, ADR 0082), Task (once DevOps, ADR 0079) in Lavoro
    const nav = page.getByTestId('sidebar');
    await expect(page.getByTestId('nav-collapse')).toHaveCount(0); // always expanded: no toggle
    await expect(nav.locator('.nav-title')).toHaveCount(3);
    await expect(page.getByTestId('nav-miglioramento')).toHaveCount(0);
    const navOrder = await nav.locator('.nav-title, .nav-item').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
    const ix = (id: string) => navOrder.indexOf(id);
    expect(ix('nav-home')).toBeLessThan(ix('nav-group-work'));
    expect(ix('nav-workspace')).toBe(-1); // SPEC 19: the agents live in the Grindhouse, no separate entry
    expect(ix('nav-group-brain')).toBeLessThan(ix('nav-regole'));
    expect(ix('nav-regole')).toBeLessThan(ix('nav-group-app'));
    expect(ix('nav-dashboard')).toBeGreaterThan(ix('nav-group-app'));
    expect(ix('nav-skill')).toBeGreaterThan(ix('nav-group-brain')); // Skill is in the Brain section (ADR 0077)
    expect(ix('nav-skill')).toBeLessThan(ix('nav-group-app'));
    expect(ix('nav-dashboard')).toBeLessThan(ix('nav-guida'));
    await expect(page.getByTestId('nav-migliora')).toHaveCount(0);
    await expect(page.getByTestId('nav-devops')).toHaveCount(0);
    await expect(nav).not.toContainText('DevOps');
    await shot(page, 'menus-sidebar');
  } finally {
    await app.close();
  }
});
