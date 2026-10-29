// UI acceptance for a role's permissions (ADR 0085, RolePermissions.tsx), demo services only, no provider requests:
// every role starts with every permission («Tutto consentito»), the demo's Herald is narrowed; the card back shows it and
// "Modifica permessi" lands on the card; turning a tool class off and choosing a ceiling updates the version in use in place (ADR 0182) and
// survives a restart; each toggle and ceiling has its "?"; "Ripristina predefiniti" brings everything back. Screenshots
// of the permissions editor dark and light.
import { expect, test, type Locator } from '@playwright/test';
import { launchDemo, openAgentOverview, openAgents, shot } from './helpers';

const card = (page: { getByTestId: (id: string) => Locator }) => page.getByTestId('role-permissions');

test('every role may do everything by default; the card back shows a narrowed Herald and opens its permissions', async () => {
  const { app, page } = await launchDemo();
  try {
    await openAgentOverview(page);
    await page.getByTestId('catalog-flip-scout').click();
    await expect(page.getByTestId('catalog-perms-scout')).toContainText(/Tutto consentito|Everything allowed/);
    await page.getByTestId('catalog-unflip-scout').click();
    await page.getByTestId('catalog-flip-herald').click();
    await expect(page.getByTestId('catalog-perms-herald')).toContainText(/Ristretto|Narrowed/);
    await shot(page, 'role-permissions-back-dark');
    await page.getByTestId('catalog-perms-edit-herald').click();
    await expect(page.getByTestId('agent-studio')).toBeVisible();
    await expect(card(page)).toBeVisible();
    await expect(card(page).getByTestId('perm-status')).toContainText(/Ristretto · 2 di 11|Narrowed · 2 of 11/);
    await expect(card(page).getByTestId('perm-toggle-shell')).toHaveAttribute('aria-checked', 'false');
    await expect(card(page).getByTestId('perm-ceiling-plan').getByRole('radio')).toBeChecked();
    await card(page).scrollIntoViewIfNeeded();
    await shot(page, 'role-permissions-narrowed-dark');
    // the Scout: everything on, no limit; the narrower classes are included in their wider ones
    await openAgents(page, 'scout');
    await expect(card(page).getByTestId('perm-status')).toContainText(/Tutto consentito|Everything allowed/);
    for (const c of ['read', 'edit', 'shell', 'web', 'browser', 'mail-draft', 'calendar-read', 'mcp']) await expect(card(page).getByTestId(`perm-toggle-${c}`)).toHaveAttribute('aria-checked', 'true');
    await expect(card(page).getByTestId('perm-toggle-shell-read')).toBeDisabled();
    await expect(card(page).getByTestId('perm-tool-shell-read')).toContainText(/inclusa in|included in/);
    await expect(card(page).getByTestId('perm-ceiling-none').getByRole('radio')).toBeChecked();
    await expect(card(page).getByTestId('perm-reset')).toBeDisabled();
    // each toggle explains what it allows
    await card(page).getByTestId('perm-help-shell-read').click();
    await expect(page.getByRole('tooltip')).toContainText('read-only-tools.md');
    await card(page).scrollIntoViewIfNeeded();
    await shot(page, 'role-permissions-dark');
  } finally { await app.close(); }
});

test('narrowing a role updates its version in place (ADR 0182) and survives a restart; Ripristina predefiniti brings every permission back', async () => {
  const first = await launchDemo({ scheme: 'light', config: { theme: 'light' } });
  try {
    await openAgents(first.page, 'scout');
    const perms = card(first.page);
    await perms.getByTestId('perm-toggle-shell').click();
    await perms.getByTestId('perm-toggle-edit').click();
    await expect(perms.getByTestId('perm-toggle-shell-read')).toBeEnabled();
    await expect(perms.getByTestId('perm-toggle-shell-read')).toHaveAttribute('aria-checked', 'true');
    await perms.getByTestId('perm-ceiling-default').click();
    await expect(perms.getByTestId('perm-status')).toContainText(/Ristretto · 9 di 11|Narrowed · 9 of 11/);
    await perms.scrollIntoViewIfNeeded();
    await shot(first.page, 'role-permissions-light');
    await perms.getByTestId('perm-save').click();
    await expect(perms.getByTestId('perm-save')).toHaveCount(0);
    // permissions are not a new version (ADR 0182): v1 says it was updated in place
    await expect(first.page.getByTestId('agent-versions')).not.toContainText('v2');
    await expect(first.page.getByTestId('agent-versions')).toContainText(/Aggiornata 1 volta senza nuova versione|Updated once without a new version/);
  } finally { await first.app.close(); }
  const second = await launchDemo({ userData: first.userData, scheme: 'light' });
  try {
    await openAgents(second.page, 'scout');
    const perms = card(second.page);
    await expect(perms.getByTestId('perm-toggle-shell')).toHaveAttribute('aria-checked', 'false');
    await expect(perms.getByTestId('perm-ceiling-default').getByRole('radio')).toBeChecked();
    const scout = await second.page.evaluate(async () => (await window.sb.invoke('agents:list', undefined)).profiles.find(p => p.id === 'scout')!);
    expect(scout.tools?.allow).not.toContain('shell');
    expect(scout.tools?.allow).toContain('shell-read');
    expect(scout.permissionCeiling).toBe('default');
    await perms.getByTestId('perm-reset').click();
    await expect(perms.getByTestId('perm-status')).toContainText(/Tutto consentito|Everything allowed/);
    await expect(perms.getByTestId('perm-reset')).toBeDisabled();
    const back = await second.page.evaluate(async () => (await window.sb.invoke('agents:list', undefined)).profiles.find(p => p.id === 'scout')!);
    expect(back.permissionCeiling).toBeNull();
    expect(back.tools?.allow).toHaveLength(11);
  } finally { await second.app.close(); }
});
