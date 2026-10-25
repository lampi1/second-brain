// A sealed routine remains inspectable after approval and from completed history; no model or remote write runs.
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { FlowDefinition, FlowRun, FlowSnapshot } from '../../src/shared/flows';
import { launchDemo, publishFlows, shot } from './helpers';
const content = 'Verify the synthetic outcome against the saved acceptance criteria.';
const definition: FlowDefinition = { id: 'sealed-example', title: 'Verifica guidata', description: 'Prompt e prove della versione salvata.', aliases: [], scope: {}, steps: [{ id: 'inspect', title: 'Verifica delle evidenze', kind: 'agent', role: 'scout', tier: 'mid', engine: 'claude', model: 'fixture-model', agentPrompt: 'Use the versioned checklist and report precise evidence.', instructions: 'Confronta risultato atteso e risultato osservato.', assets: ['verification.md'], inputs: ['workspace'], workspaceInput: 'workspace', evidence: ['proof'], timeoutMs: 60000, maxAttempts: 2, effect: 'read-only' }], package: { schema: 1, assets: [{ id: 'verification.md', kind: 'checklist', content, sha256: createHash('sha256').update(content).digest('hex') }], outputs: [{ id: 'outcome', kind: 'report', description: 'Observed outcome' }], requiredOps: [] } };
const run: FlowRun = { id: 'sealed-run', revision: 3, flowId: definition.id, flowVersion: 1, definitionDigest: 'fixture', ownerOrchestratorId: 'app', subjectKey: 'sample', scope: {}, inputs: { workspace: '/example' }, status: 'completed', currentStep: 1, steps: [{ stepId: 'inspect', status: 'completed', attempts: 1, receipt: { id: 'proof', stepId: 'inspect', kind: 'agent-report', at: 1, summary: 'Outcome verified', evidence: ['proof: saved result'] } }], createdAt: 1, updatedAt: 2, trace: [{ id: 'done', at: 2, kind: 'transition', message: 'active → completed' }] };
test('fullscreen preserves the approved package and completed evidence', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  try {
    const snapshot: FlowSnapshot = { contextKey: 'sealed-fixture', drafts: [], versions: [{ definition, version: 1, draftRevision: 1, activatedAt: 1, digest: 'fixture' }], active: { [definition.id]: 1 }, runs: [run] };
    await publishFlows(app, snapshot); await page.getByTestId('nav-flussi').click(); await page.getByTestId('rt-tab-routines').click();
    await page.getByTestId('rt-routine-card').filter({ hasText: definition.title }).click(); await page.getByTestId('flow-fullscreen-open').click();
    const modal = page.getByTestId('flow-fullscreen'); await expect(modal).toContainText('fixture-model');
    await modal.getByText('Prompt completo salvato', { exact: true }).click(); await expect(modal).toContainText(definition.steps[0]!.agentPrompt!);
    await modal.getByTestId('flow-package').locator(':scope > summary').click(); await modal.getByText('verification.md · checklist', { exact: true }).click(); await expect(modal).toContainText(content);
    await shot(page, 'routine-sealed-fullscreen'); await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0);
    await page.getByTestId('rt-tab-history').click(); await page.getByTestId('flow-fullscreen-open').click(); await expect(modal).toContainText('Outcome verified');
    await expect(modal.getByRole('button', { name: 'Analizza con Orchestrator' })).toBeVisible(); await shot(page, 'routine-completed-inspection');
  } finally { await app.close(); }
});

test('a routine worker stays out of Grindhouse and opens from its current step', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  try {
    const active: FlowRun = { ...run, status: 'active', currentStep: 0, steps: [{ stepId: 'inspect', status: 'running', attempts: 1, chatId: 'w2', startedAt: Date.now() }] };
    const snapshot: FlowSnapshot = { contextKey: 'sealed-fixture', drafts: [], versions: [{ definition, version: 1, draftRevision: 1, activatedAt: 1, digest: 'fixture' }], active: { [definition.id]: 1 }, runs: [active] };
    await publishFlows(app, snapshot); await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('tile-chat-w2')).toHaveCount(0);
    await page.getByTestId('nav-flussi').click(); await page.getByTestId('rt-tab-now').click();
    await page.getByTestId('rt-working-card').locator('.rt-work-head').click(); await page.getByTestId('flow-open-agent').click();
    await expect(page.getByTestId('routine-agent')).toBeVisible(); await expect(page.getByTestId('tile-chat-w2')).toBeVisible();
    await shot(page, 'routine-live-worker'); await page.getByTestId('routine-agent-back').click(); await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('tile-chat-w2')).toHaveCount(0);
  } finally { await app.close(); }
});
