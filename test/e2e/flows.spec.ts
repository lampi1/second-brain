// Routine stays outside Home and begins empty; a new routine's review uses the existing shared window and a postponed
// review is reopened from the routine's card (ADR 0153).
// Authored only: this suite is intentionally not run on a feature branch or to bypass Electron environment restrictions.
import { test, expect } from '@playwright/test';
import type { FlowSnapshot } from '../../src/shared/flows';
import { launchDemo, shot, publishFlows, closeQuestions } from './helpers';
test('Flussi starts empty, is reachable from the rail, and reviews definitions in the common modal', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  try {
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('flows-page')).toHaveCount(0);
    await page.getByTestId('nav-flussi').click();
    await expect(page.getByTestId('flows-empty')).toBeVisible();
    await expect(page.getByTestId('flows-empty').getByRole('button', { name: 'Chiedi all’Orchestrator', exact: true })).toBeVisible();
    await expect(page.getByTestId('rt-routine-card')).toHaveCount(0);
    await shot(page, 'flows-empty');
    const snapshot: FlowSnapshot = { contextKey: 'flow-ui-fixture', drafts: [{ definition: { id: 'document-review', title: 'Revisione documento', description: 'Una definizione di prova isolata: rivedere il documento scelto.', category: 'Documenti', aliases: ['rivedi documento'], scope: { project: 'Demo' }, steps: [{ id: 'review', title: 'Controlla il documento', kind: 'approval', instructions: 'Approva solo il documento selezionato.', inputs: ['document'], evidence: ['Report del documento selezionato'], timeoutMs: 5000, maxAttempts: 1, effect: 'read-only' }] }, revision: 1, updatedAt: Date.now(), status: 'proposed' }], versions: [], active: {}, runs: [] };
    // A renderer fixture tests the actual modal/rail without starting any workflow or invoking an agent.
    await publishFlows(app, snapshot);
    const card = page.getByTestId('qwin-flow-definition');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('flow-approve')).toHaveText('Sì');
    await expect(card.getByTestId('flow-reject')).toHaveText('No');
    await expect(card.getByTestId('flow-other')).toHaveText('Altro…');
    await expect(card.locator('details').first()).not.toHaveAttribute('open', '');
    await shot(page, 'flows-definition-review');
    await card.getByTestId('flow-other').click();
    await card.getByTestId('flow-feedback').fill('Solo i documenti del progetto Demo.');
    await page.getByTestId('qwin-later').click();
    await expect(card).toHaveCount(0);
    // with no run open the page shows the routines: the postponed proposal waits on its card
    const routine = page.getByTestId('rt-routine-card').filter({ hasText: 'Revisione documento' });
    await expect(routine).toBeVisible();
    await routine.getByTestId('rt-proposal').click();
    await expect(page.getByTestId('qwin-flow-definition').getByTestId('flow-feedback')).toHaveValue('Solo i documenti del progetto Demo.');
    await closeQuestions(page);
    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('flows-page')).toHaveCount(0);
  } finally { await app.close(); }
});
