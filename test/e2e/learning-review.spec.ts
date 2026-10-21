// Real typed IPC and review controls against a temporary brain. No provider calls; synthetic cases never qualify.
// Screenshots run only on main with the full e2e gate (AGENTS.md).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { closeSetup, goPage, launch, shot } from './helpers';
import type { MemoryReviewRecord } from '../../src/shared/learning-review';

test('memory provenance, explicit confirmation/retraction and synthetic evaluation import', async () => {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-learning-'));
  fs.mkdirSync(path.join(brain, 'memory', 'skill-candidates'), { recursive: true });
  const observed = '2026-01-01T10:00:00.000Z';
  const record: MemoryReviewRecord = { memoryId: 'review-demo', scope: { roleId: 'scout', project: 'fixture' }, subject: 'Fixture', predicate: 'uses', value: 'an isolated test environment', sourceEventId: 'fixture-event', sourceRunId: 'fixture-run', observedAt: observed, validFrom: observed, validTo: null, status: 'proposed', supersedes: null };
  fs.writeFileSync(path.join(brain, 'memory', 'records.json'), JSON.stringify([record]));
  fs.writeFileSync(path.join(brain, 'memory', 'skill-candidates', 'fixture-review.md'), '# Fixture review\n\n## Steps\n1. Read the isolated fixture sources.\n2. Summarize the verified evidence.\n');
  const { app, page } = await launch({ SB_BRAIN: brain });
  try {
    await closeSetup(page); await goPage(page, 'memoria');
    const card = page.getByTestId('memory-review-review-demo');
    await expect(card).toContainText('fixture-event'); await expect(card).toContainText('fixture-run');
    await expect(card.getByRole('button', { name: 'Conferma il fatto' })).toBeDisabled();
    await card.getByLabel('Prova della verifica / motivo del rifiuto').fill('Verified against the isolated fixture source.');
    await card.getByRole('button', { name: 'Conferma il fatto' }).click();
    await expect(card).toContainText('Confermato');
    await card.getByLabel('Motivo della revoca').fill('Fixture no longer applies.');
    await card.getByRole('button', { name: 'Revoca', exact: true }).click();
    await expect(card).toContainText('Revocato');
    const learning = page.getByTestId('learning-review');
    await learning.getByText('Importa casi di valutazione', { exact: true }).click();
    await learning.getByTestId('learning-import').setInputFiles({ name: 'anonymized.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ id: 'imported-fixture', name: 'Initial fixture', anonymized: true, cases: [{ id: 'case-1', family: 'fixture', input: 'Inspect the isolated fixture.', criteria: ['State its source.'], split: 'holdout' }, { id: 'case-2', family: 'fixture-tuning', input: 'Summarize the isolated fixture.', criteria: ['Name the source.'], split: 'tuning' }] })) });
    await expect(learning.getByLabel('Raccolta di casi').locator('option').filter({ hasText: 'Initial fixture' })).toHaveCount(1);
    await learning.getByLabel('Raccolta di casi').selectOption('synthetic-workflow-v1');
    await expect(learning).toContainText('non qualificano una promozione');
    const candidate = page.getByTestId('candidate-fixture-review');
    await candidate.locator('summary').click();
    await expect(candidate).toContainText('Origine della candidata assente');
    await expect(candidate.locator('textarea')).toHaveAttribute('maxlength', '24000');
    await expect(learning.getByTestId('learning-replay-cost')).toContainText('Entrambi consumano token');
    await expect(candidate.getByRole('button', { name: 'Promuovi questa versione' })).toBeDisabled();
    await learning.scrollIntoViewIfNeeded(); await shot(page, 'learning-review-synthetic-gate');
    await candidate.scrollIntoViewIfNeeded(); await shot(page, 'learning-review-localized-proof-gates');
    await page.getByTestId('memory-review').scrollIntoViewIfNeeded(); await shot(page, 'memory-review-provenance');
  } finally { await app.close(); }
});

// Renderer fixture only: host evidence authorization and eligibility are tested in the evaluation unit suite.
// No promotion or provider call is performed; the user must inspect both retained results before acknowledging.
test('candidate proof inspection shows full deliverables and review criteria before enabling promotion', async () => {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-proof-ui-'));
  const { app, page } = await launch({ SB_BRAIN: brain });
  try {
    await app.evaluate(({ ipcMain }, root) => {
      const canonical = (runId: string, output: string) => ({ at: 1, taskId: runId, runId, taskVersion: 1, outcome: 'done', summary: 'Fixture summary', output, doneWhen: [{ criterion: 'Fixture criterion checked', met: true }] });
      ipcMain.removeHandler('learning:state');
      ipcMain.handle('learning:state', () => ({ datasets: [], replayAvailable: false, candidates: [{ name: 'proof-fixture', text: '## Steps\n1. Inspect the source.\n2. Record the evidence.', digest: 'fixture-digest', stepsReady: true, sourceRunIds: ['example-run'], verifiedExampleRunIds: ['example-run'], eligibleReplayIds: ['replay-fixture'], promotionProblems: [], promoted: false }], replays: [{ id: 'replay-fixture', datasetId: 'fixture', datasetDigest: 'fixture', split: 'holdout', candidate: { name: 'proof-fixture', digest: 'fixture-digest' }, startedAt: 1, finishedAt: 2, status: 'passed', cases: [{ caseId: 'case', runId: 'case-run', passed: true }] }] }));
      ipcMain.removeHandler('learning:evidence');
      ipcMain.handle('learning:evidence', (_event, args) => {
        if (args.expectedRoot !== root || !['example-run', 'case-run'].includes(args.runId)) throw new Error('Fixture evidence scope mismatch');
        return { run: { runId: args.runId, agentId: 'scout', goal: 'Fixture task', startedAt: 1, report: { at: 1, outcome: 'done', verified: 'yes', summary: 'Fixture summary', canonical: canonical(args.runId, 'Actual retained deliverable for ' + args.runId) } }, reviews: [{ runId: 'review-' + args.runId, agentId: 'sentinel', goal: 'Independent fixture review', reviewOf: args.runId, startedAt: 2, report: { at: 2, outcome: 'done', verified: 'yes', summary: 'Source checked', canonical: canonical('review-' + args.runId, 'Independent review evidence and limitations') } }] };
      });
    }, brain);
    await closeSetup(page); await goPage(page, 'memoria');
    const candidate = page.getByTestId('candidate-proof-fixture');
    await candidate.locator('summary').first().click();
    await candidate.getByLabel('Esempio verificato', { exact: true }).selectOption('example-run');
    await candidate.getByLabel('Replay idoneo superato').selectOption('replay-fixture');
    const inspected = candidate.getByLabel('Ho letto la bozza e le prove elencate.');
    await expect(inspected).toBeDisabled();
    await candidate.getByTestId('learning-evidence-example-run').first().getByRole('button').click();
    await expect(candidate).toContainText('Actual retained deliverable for example-run');
    await expect(inspected).toBeDisabled();
    await candidate.getByTestId('learning-evidence-case-run').getByRole('button').click();
    await expect(candidate).toContainText('Independent review evidence and limitations');
    await expect(candidate).toContainText('Fixture criterion checked');
    await expect(inspected).toBeEnabled(); await inspected.check();
    await expect(candidate.getByRole('button', { name: 'Promuovi questa versione' })).toBeEnabled();
    await candidate.scrollIntoViewIfNeeded(); await shot(page, 'learning-review-retained-proof');
  } finally { await app.close(); }
});
