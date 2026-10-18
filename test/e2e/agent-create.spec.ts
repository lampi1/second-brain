// Main-only acceptance for "Crea agente": the questionnaire needs only the goal, shows the message it will send and
// hands it to the Orchestrator through the normal send path (the demo's Orchestrator is waiting, so it is queued).
// No provider is called; the AI-guided creation and "Apri Studio agenti" are gone.
import { expect, test } from '@playwright/test';
import { launchDemo, openAgentOverview, shot } from './helpers';

test('the questionnaire sends the user request to the Orchestrator', async () => {
  const { app, page } = await launchDemo();
  try {
    await openAgentOverview(page);
    const overview = page.getByTestId('agent-overview');
    await expect(overview.getByRole('button', { name: 'Apri Studio agenti', exact: true })).toHaveCount(0);
    await shot(page, 'agent-create-overview');
    await overview.getByTestId('agent-create-open').click();
    const dialog = page.getByTestId('agent-create');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('agent-create-send')).toBeDisabled();
    await dialog.getByTestId('agent-create-next').click();
    await expect(dialog.getByRole('alert')).toContainText('Scrivi l’obiettivo');
    await dialog.getByText('Revisione e QA', { exact: true }).click();
    await dialog.getByTestId('agent-create-goal').fill('Rileggere le PR del checkout e segnalare i rischi');
    await shot(page, 'agent-create-step-goal');
    await dialog.getByTestId('agent-create-next').click();
    await dialog.getByText('Repository e codice', { exact: true }).click();
    await dialog.getByTestId('agent-create-next').click();
    await dialog.getByText('Legge e propone', { exact: true }).click();
    await dialog.getByTestId('agent-create-next').click();
    const preview = dialog.getByTestId('agent-create-preview');
    await expect(preview).toContainText('- Tipo: Revisione e QA');
    await expect(preview).toContainText('- Cosa deve fare: Rileggere le PR del checkout e segnalare i rischi');
    await expect(preview).toContainText('- Strumenti e dati: Repository e codice');
    await expect(preview).toContainText('- Autonomia: Legge e propone');
    await expect(preview).toContainText('agent_create');
    await shot(page, 'agent-create-review');
    await dialog.getByTestId('agent-create-send').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(/^Richiesta (inviata all’Orchestrator|in coda)/).first()).toBeVisible();
    await shot(page, 'agent-create-sent');
  } finally { await app.close(); }
});
