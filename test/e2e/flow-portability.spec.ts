// Portable-flow and fullscreen inspection UI coverage; authored here, executed only on main by the normal check.
import { test, expect } from '@playwright/test';
import type { FlowDefinition, FlowSnapshot } from '../../src/shared/flows';
import { launchDemo, shot } from './helpers';

test('flow versions and fullscreen retain recorded evidence; import opens an inert draft form', async () => {
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
    const definition: FlowDefinition = { id: 'document-review', title: 'Revisione documento', description: 'Controlla il documento selezionato.', aliases: [], scope: {}, steps: [{ id: 'review', title: 'Revisione indipendente', kind: 'agent', role: 'sentinel', tier: 'mid', instructions: 'Verifica il risultato e raccogli le evidenze. [Report](file:///tmp/flow-review.md)', inputs: ['workspace'], workspaceInput: 'workspace', evidence: ['report'], timeoutMs: 5000, maxAttempts: 1, effect: 'read-only' }] };
    definition.steps.push({ ...definition.steps[0]!, id: 'followup', title: 'Verifica finale', instructions: 'Controlla anche il secondo passaggio completo.' });
    const snapshot: FlowSnapshot = { contextKey: 'portable-ui-fixture', drafts: [], active: { [definition.id]: 2 }, versions: [1, 2].map(version => ({ definition, version, draftRevision: version, digest: `digest-${version}`, activatedAt: version })), runs: [{ id: 'recorded', revision: 1, flowId: definition.id, flowVersion: 1, definitionDigest: 'digest-1', ownerOrchestratorId: 'o', subjectKey: 'Documento selezionato', scope: {}, inputs: {}, status: 'completed', currentStep: 0, createdAt: 1, updatedAt: 2, steps: [{ stepId: 'review', status: 'completed', attempts: 1, receipt: { id: 'receipt', stepId: 'review', kind: 'agent-report', at: 2, summary: 'Documento verificato.', evidence: ['report: revisione selezionata'] } }] }] };
    snapshot.roles = { sentinel: { name: 'Sentinel', avatar: { kind: 'character', value: 'sentinel' }, tier: 'mid', tierMax: 'top', model: null, models: { mid: 'review-model' } } };
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0]!.webContents.send('flows:changed', value), snapshot);
    await expect(page.locator('.flow-export-group')).toContainText('v1');
    await page.getByTestId('flow-fullscreen-open').click();
    const full = page.getByTestId('flow-fullscreen');
    await expect(full).toBeVisible();
    await expect(full).toHaveAttribute('aria-modal', 'true');
    await page.keyboard.press('Control+w');
    await page.keyboard.press('Control+1');
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await expect(full).toBeVisible();
    await expect(full.getByTestId('flow-fullscreen-run')).toContainText('Documento selezionato');
    const steps = full.getByTestId('flow-fullscreen-steps');
    await expect(steps.locator('.flow-step')).toHaveCount(2);
    await expect(steps.getByText('Controlla anche il secondo passaggio completo.')).toBeVisible();
    await expect(steps.getByTestId('flow-step-agent').first()).toContainText('Sentinel · mid · review-model');
    await expect(steps.getByTestId('flow-step-agent').last()).toBeVisible();
    await shot(page, 'flow-fullscreen-all-steps');
    await full.locator('.flow-fullscreen-diagram > summary').click();
    await expect(full.getByTestId('flow-node').first()).toHaveAttribute('data-status', 'completed');
    await full.locator('.flow-inspector .flow-report > summary').click();
    await expect(full.locator('.flow-inspector')).toContainText('report: revisione selezionata');
    await shot(page, 'flow-fullscreen-evidence');
    await page.keyboard.press('Escape');
    await expect(full).toHaveCount(0);
    await expect(page.getByTestId('flow-fullscreen-open')).toBeFocused();
    await page.locator('#flow-version-picker').selectOption('2');
    await expect(page.locator('.flow-export-group')).toContainText('v2');
    await expect(page.getByTestId('flow-run')).toHaveCount(0);
    await page.getByTestId('flow-fullscreen-open').click();
    await full.getByTestId('flow-fullscreen-exit').click();
    await expect(full).toHaveCount(0);
    await page.getByTestId('flow-fullscreen-open').click();
    await full.locator('.flow-fullscreen-steps .ctx-link.file').first().click();
    await expect(full).toHaveCount(0);
    await expect(page.getByTestId('viewer-overlay')).toBeVisible();
  } finally { await app.close(); }
});
