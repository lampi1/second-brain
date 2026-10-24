// Automatic configuration shares the real decision window; a postponed trigger proposal is reopened from the routine.
// Authored only: run first on main in the authorized check suite, never to bypass Electron restrictions.
import { test, expect } from '@playwright/test';
import type { FlowSnapshot } from '../../src/shared/flows';
import { launchDemo, shot, publishFlows, closeQuestions } from './helpers';
test('automatic flow proposals retain context and free answers, and reopen from the routine', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  try {
    await page.getByTestId('nav-flussi').click();
    const definition = { id: 'selected-document', title: 'Documento scelto', description: 'Verifica soltanto il documento selezionato.', aliases: [], scope: { project: 'Selected project' }, steps: [
      { id: 'read', title: 'Leggi il documento', kind: 'check' as const, instructions: 'Leggi soltanto la revisione scelta.', inputs: ['document'], evidence: [], timeoutMs: 5000, maxAttempts: 1, effect: 'read-only' as const },
      { id: 'review', title: 'Verifica indipendente', kind: 'agent' as const, instructions: 'Confronta il report con il documento.', reviewOf: 'read', inputs: ['document'], evidence: ['Report verificato'], timeoutMs: 5000, maxAttempts: 2, effect: 'read-only' as const },
    ] };
    const state: FlowSnapshot = { contextKey: 'automatic-ui-fixture', drafts: [], versions: [{ definition, version: 1, draftRevision: 1, digest: 'fixture', activatedAt: 1 }], active: { [definition.id]: 1 }, runs: [{ id: 'selected-run', revision: 1, flowId: definition.id, flowVersion: 1, definitionDigest: 'fixture', ownerOrchestratorId: 'fixture', subjectKey: 'Documento 7', scope: definition.scope, inputs: { document: 'revision 7' }, status: 'active', currentStep: 1, steps: [{ stepId: 'read', status: 'completed', attempts: 1, receipt: { id: 'receipt', stepId: 'read', kind: 'check', at: 1, summary: 'Letta revisione 7.', evidence: ['Documento 7'] } }, { stepId: 'review', status: 'running', attempts: 1 }], createdAt: 1, updatedAt: 2 }], automation: { revision: 1, paused: false, background: false, events: [], rules: [{ id: 'automatic-document', revision: 1, ownerOrchestratorId: 'fixture', status: 'proposed', failures: 0, createdAt: 1, updatedAt: 1, config: { flowId: definition.id, flowVersion: 1, scope: definition.scope, inputs: { document: 'revision 7' }, trigger: { kind: 'interval', everyMinutes: 30 }, priority: 'normal' } }] } };
    await publishFlows(app, state);
    const modal = page.getByTestId('qwin-flow-automation');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Selected project');
    await expect(modal).toContainText('30 minuti');
    await expect(modal).toContainText('revision 7');
    await expect(modal).toContainText('consumare il tuo piano AI');
    await modal.getByTestId('flow-other').click();
    await modal.getByTestId('flow-feedback').fill('Controlla solo durante il lavoro.');
    await shot(page, 'flow-automatic-consent');
    await page.getByTestId('qwin-later').click();
    // the run works by itself in «Adesso»; the postponed trigger proposal waits on the routine
    await expect(page.getByTestId('rt-working-card')).toContainText('Documento scelto');
    await expect(page.getByTestId('rt-working-card')).toContainText('Verifica indipendente');
    await page.getByTestId('rt-tab-routines').click();
    await shot(page, 'flow-routine-proposal');
    await page.getByTestId('rt-routine-card').filter({ hasText: 'Documento scelto' }).getByTestId('rt-proposal').click();
    await expect(modal.getByTestId('flow-feedback')).toHaveValue('Controlla solo durante il lavoro.');
    await closeQuestions(page);
    await page.getByTestId('flow-auto-controls').locator('summary').click();
    await expect(page.getByTestId('flow-auto-controls').getByRole('checkbox')).not.toBeChecked();
    await expect(page.getByTestId('flow-auto-controls')).toContainText('Il PC deve restare acceso e non sospeso.');
    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('flows-page')).toHaveCount(0);
  } finally { await app.close(); }
});
