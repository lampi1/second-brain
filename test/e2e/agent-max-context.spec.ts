// "Contesto massimo" in the agent editor (issue #80, ADR 0078): the field saves with the agent as a new version, shows
// in the agent's configuration, says whether the engine applies it, and survives a restart. Demo data, no tokens.
import { expect, test } from '@playwright/test';
import { launchDemo, openAgents, shot } from './helpers';

test('an agent keeps its maximum context and the editor says which engines apply it', async () => {
  const first = await launchDemo();
  try {
    await openAgents(first.page);
    const studio = first.page.getByTestId('agent-studio');
    await studio.getByTestId('agent-edit').click();
    const field = first.page.getByTestId('agent-max-context');
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('placeholder', 'Impostazione dell’app');
    await expect(first.page.getByTestId('agent-max-context-note')).toContainText(/compatta|Claude/);
    await field.fill('400');
    await field.evaluate(e => e.scrollIntoView({ block: 'center' }));
    await shot(first.page, 'agent-max-context-editor');
    await first.page.getByTestId('agent-save').click();
    await expect(studio).toContainText('400k token');
  } finally { await first.app.close(); }
  const second = await launchDemo({ userData: first.userData });
  try {
    await openAgents(second.page);
    const studio = second.page.getByTestId('agent-studio');
    await expect(studio).toContainText('400k token');
    await studio.getByTestId('agent-edit').click();
    await expect(second.page.getByTestId('agent-max-context')).toHaveValue('400');
    await second.page.getByTestId('agent-max-context').fill('');
    await second.page.getByTestId('agent-save').click();
    await expect(studio).not.toContainText('400k token');
  } finally { await second.app.close(); }
});
