// UI acceptance for a role's page and its editor (AgentStudio.tsx), demo services only, no provider requests: Modifica
// opens the editor and a draft survives page navigation; an edit (a skill, the tier, a launch) is a new version that
// survives a restart; "Ripristina predefinito" brings the shipped role back. Screenshots dark and light.
import { expect, test } from '@playwright/test';
import { choose, launchDemo, openAgents, shot } from './helpers';

test('a role page opens its editor on Modifica and the draft survives page navigation', async () => {
  const { app, page } = await launchDemo();
  try {
    await openAgents(page, 'scout');
    const studio = page.getByTestId('agent-studio'); await expect(studio).toBeVisible();
    await expect(studio.getByRole('heading', { name: 'Scout', exact: true })).toBeVisible();
    await expect(page.getByTestId('agent-prompt')).toBeVisible(); // the role's instructions, in full
    await expect(page.getByTestId('agent-editor')).toBeVisible(); // openAgents chose Modifica il ruolo
    await shot(page, 'role-page-dark');
    await page.getByTestId('agent-instructions').fill('Cerca prima nel repository, poi sul web.');
    await page.getByTestId('nav-task').click();
    await openAgents(page, 'scout');
    await expect(page.getByTestId('agent-instructions')).toHaveValue('Cerca prima nel repository, poi sul web.');
    await shot(page, 'role-editor-dark');
  } finally { await app.close(); }
});

test('a role edit is a version that survives a restart; Ripristina predefinito brings the shipped role back', async () => {
  const first = await launchDemo({ scheme: 'light' });
  try {
    await openAgents(first.page, 'artisan');
    await expect(first.page.getByTestId('agent-reset')).toBeDisabled(); // nothing to reset on a shipped role
    await first.page.getByTestId('agent-skill-input').fill('brain-edit');
    await expect(first.page.getByTestId('agent-skill-input')).toHaveValue('brain-edit');
    await first.page.getByTestId('agent-skill-add').click();
    await choose(first.page.getByTestId('agent-tier'), 'top');
    await first.page.getByTestId('agent-launches').getByRole('checkbox', { name: 'Herald' }).check();
    await shot(first.page, 'role-editor-light');
    await first.page.getByTestId('agent-save').click();
    await expect(first.page.getByTestId('agent-editor')).toHaveCount(0);
    await expect(first.page.getByTestId('agent-skills')).toContainText('brain-edit');
    await expect(first.page.getByTestId('agent-versions')).toContainText('v2');
    await shot(first.page, 'role-page-light');
  } finally { await first.app.close(); }
  const second = await launchDemo({ userData: first.userData, scheme: 'light' });
  try {
    await openAgents(second.page, 'artisan');
    const studio = second.page.getByTestId('agent-studio');
    await expect(studio.getByTestId('agent-skills')).toContainText('brain-edit');
    await expect(studio).toContainText('Herald');
    await studio.getByTestId('agent-reset').click();
    await second.page.getByTestId('agent-reset-confirm').getByRole('button', { name: /^(Conferma il ripristino|Confirm the restore)$/ }).click();
    await expect(studio.getByTestId('agent-skills')).not.toContainText('brain-edit');
    await expect(studio.getByTestId('agent-reset')).toBeDisabled();
    const artisan = await second.page.evaluate(async () => (await window.sb.invoke('agents:list', undefined)).profiles.find(p => p.id === 'artisan')!);
    expect(artisan).toMatchObject({ userLocked: false, lastEditedBy: 'default', skills: [] });
  } finally { await second.app.close(); }
});
