// Portable routines: import opens an inert draft form; an open routine shows every step and exports its version; a
// finished run keeps its evidence in Storico.
import { test, expect } from '@playwright/test';
import type { FlowDefinition, FlowSnapshot } from '../../src/shared/flows';
import { launchDemo, shot, publishFlows } from './helpers';

test('import opens an inert draft form; a long routine shows every step, exports, and keeps run evidence', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  try {
    await page.getByTestId('nav-flussi').click();
    await page.getByTestId('flow-import-open').click();
    const importer = page.getByTestId('flow-import');
    await expect(importer).toBeVisible();
    await expect(importer.getByTestId('flow-import-submit')).toBeDisabled();
    await expect(importer).toContainText('nuova bozza');
    await page.keyboard.press('Escape');
    await expect(importer).toHaveCount(0);
    await expect(page.getByTestId('flow-import-open')).toBeFocused();
    const definition: FlowDefinition = { id: 'document-review', title: 'Revisione documento', description: 'Controlla il documento selezionato con tutte le verifiche e le evidenze. '.repeat(40), aliases: [], scope: {}, steps: [{ id: 'review', title: 'Revisione indipendente', kind: 'agent', role: 'sentinel', tier: 'mid', instructions: 'Verifica il risultato e raccogli le evidenze. [Report](file:///tmp/flow-review.md)', inputs: ['workspace'], workspaceInput: 'workspace', evidence: ['report'], timeoutMs: 5000, maxAttempts: 1, effect: 'read-only' }] };
    definition.steps.push(...Array.from({ length: 19 }, (_, index) => ({ ...definition.steps[0]!, id: `followup-${index}`, title: `Verifica completa ${index + 2}`, instructions: `Controlla il passaggio ${index + 2}. ${'Confronta requisiti, documento selezionato e report con evidenze verificabili. '.repeat(6)}` })));
    const snapshot: FlowSnapshot = { contextKey: 'portable-ui-fixture', drafts: [], active: { [definition.id]: 2 }, versions: [1, 2].map(version => ({ definition, version, draftRevision: version, digest: `digest-${version}`, activatedAt: version })), runs: [{ id: 'recorded', revision: 1, flowId: definition.id, flowVersion: 1, definitionDigest: 'digest-1', ownerOrchestratorId: 'o', subjectKey: 'Documento selezionato', scope: {}, inputs: {}, status: 'completed', currentStep: 0, createdAt: 1, updatedAt: 2, steps: [{ stepId: 'review', status: 'completed', attempts: 1, receipt: { id: 'receipt', stepId: 'review', kind: 'agent-report', at: 2, summary: 'Documento verificato.', evidence: ['report: revisione selezionata'] } }] }] };
    snapshot.roles = { sentinel: { name: 'Sentinel', avatar: { kind: 'character', value: 'sentinel' }, tier: 'mid', tierMax: 'top', model: null, models: { mid: 'review-model' } } };
    await publishFlows(app, snapshot);
    // the open routine exports its active version (with models and pinned scripts) for a cloud agent
    await page.getByTestId('rt-tab-routines').click();
    await page.getByTestId('rt-routine-card').filter({ hasText: 'Revisione documento' }).click();
    const detail = page.getByTestId('rt-detail');
    await expect(detail).toContainText('v2');
    await expect(detail.locator('.rt-pipe > li')).toHaveCount(20);
    await expect(detail.getByTestId('rt-export')).toBeVisible();
    await shot(page, 'flow-routine-all-steps');
    // the finished run keeps its evidence in Storico
    await page.getByTestId('rt-tab-history').click();
    await page.getByTestId('rt-history').locator('tbody tr').first().click();
    await expect(page.getByTestId('rt-history')).toContainText('Documento verificato.');
  } finally { await app.close(); }
});
