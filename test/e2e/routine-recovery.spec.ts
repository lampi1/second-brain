// Native recovery controls and queue focus coverage. Authored only; execute on main in the authorized E2E suite.
// Synthetic renderer state never starts providers or touches external systems; only No, Other and postponement are used.
import { test, expect } from '@playwright/test';
import type { FlowDefinition, FlowSnapshot } from '../../src/shared/flows';
import { launchDemo, shot, publishFlows } from './helpers';
test('Routine recovery explains pinned versions, repeated writes, missing prerequisites and preserved drafts', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  try {
    await expect(page.getByTestId('nav-flussi')).toContainText('Routine');
    await page.getByTestId('nav-flussi').click();
    const definition: FlowDefinition = { id: 'selected-documents', title: 'Verifica documentale sintetica', description: 'Solo il documento selezionato.', aliases: [], scope: { project: 'Demo' }, steps: ['Leggi', 'Pubblica il riepilogo', 'Verifica'].map((title, index) => ({ id: `step-${index}`, title, kind: 'manual', instructions: `Istruzione completa ${index}: usa solo il documento scelto.`, inputs: ['document'], evidence: ['Report selezionato'], timeoutMs: 5000, maxAttempts: 1, effect: index === 1 ? 'external-write' : 'read-only' })) };
    const state: FlowSnapshot = { contextKey: 'routine-recovery-ui-fixture', drafts: [], active: { [definition.id]: 2 }, versions: [1, 2].map(version => ({ definition: { ...definition, description: `Descrizione esatta versione ${version}` }, version, draftRevision: version, digest: `digest-${version}`, activatedAt: version })), runs: [{ id: 'source', revision: 4, flowId: definition.id, flowVersion: 1, definitionDigest: 'digest-1', ownerOrchestratorId: 'orchestrator', subjectKey: 'Documento scelto', scope: { project: 'Demo' }, inputs: { document: 'revisione selezionata' }, status: 'blocked', currentStep: 1, createdAt: 1, updatedAt: 2, steps: [{ stepId: 'step-0', status: 'completed', attempts: 1, receipt: { id: 'receipt', stepId: 'step-0', kind: 'user', at: 2, summary: 'Documento letto', evidence: ['Report selezionato'] } }, { stepId: 'step-1', status: 'blocked', attempts: 0, reason: 'Attende la decisione sulla scrittura.', decisionPending: false }, { stepId: 'step-2', status: 'pending', attempts: 0 }] }] };
    const publish = () => publishFlows(app, state);
    await publish();
    const stopped = page.getByTestId('rt-stopped-card');
    await expect(stopped).toContainText('Attende la decisione sulla scrittura.');
    await stopped.getByTestId('rt-from-step').click();
    const recovery = page.getByTestId('flow-recovery-modal');
    // the steps before are the same in v2: the run moves to the active version
    await expect(recovery).toContainText('v2');
    await expect(recovery).toContainText('con la versione attiva');
    await expect(recovery).toContainText('scritture esterne');
    await expect(recovery.getByTestId('flow-recovery-step')).toHaveValue('step-1');
    await expect(recovery.getByTestId('flow-recovery-yes')).toBeEnabled();
    await recovery.locator('.flow-recovery-definition > summary').click();
    await expect(recovery).toContainText('Istruzione completa 1');
    await recovery.locator('.flow-recovery-context > summary').click();
    await expect(recovery).toContainText('revisione selezionata');
    await shot(page, 'routine-resume-pinned');
    await recovery.getByTestId('flow-recovery-step').selectOption('step-2');
    await expect(recovery.getByTestId('flow-recovery-yes')).toBeDisabled();
    await expect(recovery.getByTestId('flow-recovery-blocker')).toContainText('Pubblica il riepilogo');
    await shot(page, 'routine-resume-prefix-blocked');
    await recovery.getByTestId('flow-recovery-no').click();
    await stopped.getByTestId('rt-from-start').click();
    await expect(recovery).toContainText('v2');
    await expect(recovery).toContainText('versione attiva');
    // A newly active version cannot silently change the confirmation the user already opened.
    state.active[definition.id] = 1; await publish();
    await expect(recovery.getByTestId('flow-recovery-yes')).toBeDisabled();
    await expect(recovery.getByTestId('flow-recovery-blocker')).toContainText('è cambiata');
    await recovery.getByTestId('flow-recovery-no').click();
    await stopped.getByTestId('rt-cancel').click();
    await expect(recovery).toContainText('non annulla gli effetti');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await shot(page, 'routine-cancel-single-confirmation');
    await recovery.getByTestId('flow-recovery-no').click();
    state.runs[0]!.pendingRecovery = { mode: 'from-step', stepId: 'step-1', revision: 1, requestedAt: Date.now(), targetVersion: 1, targetDigest: 'digest-1' }; await publish();
    const question = page.getByTestId('qwin-flow-restart');
    await expect(question).toBeFocused();
    await question.getByTestId('flow-recovery-other').click();
    await question.getByTestId('flow-recovery-feedback').fill('Chiarisci la scrittura prima di ripartire.');
    await page.keyboard.press('Escape');
    await expect(question).toHaveCount(0);
    await page.getByTestId('rt-stopped-card').getByTestId('rt-decide').click();
    await expect(question.getByTestId('flow-recovery-feedback')).toHaveValue('Chiarisci la scrittura prima di ripartire.');
    await shot(page, 'routine-recovery-postponed-draft');
  } finally { await app.close(); }
});
