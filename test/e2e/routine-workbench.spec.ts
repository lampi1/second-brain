// Native component/context/workbench dialogs and voice diagnostics. Written on the branch; execute only on main.
// Demo/IPC fixtures exercise UI contracts without network, microphones, paid agents or real routine effects.
import { expect, test } from '@playwright/test';
import type { FlowSnapshot } from '../../src/shared/flows';
import type { RoutineWorkbenchResult } from '../../src/shared/routine-workbench';
import { goPage, launchDemo, publishFlows, shot } from './helpers';

test('local component inspection is inert, survives reopening and keeps full content behind details', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  try {
    await page.getByTestId('nav-flussi').click(); await page.getByTestId('components-open').click();
    const modal = page.getByTestId('component-catalog'); await expect(modal).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Sì, abilita', exact: true })).toBeVisible();
    await modal.locator('summary').filter({ hasText: 'Bundle JSON locale' }).click();
    await modal.getByLabel('Bundle JSON locale').setInputFiles({ name: 'sample-knowledge.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([{ path: 'review.md', content: 'Explain a verified change. <script>never execute</script>' }, { path: 'LICENSE', content: 'Synthetic fixture terms.' }])) });
    const inspection = page.getByTestId('component-inspection'); await expect(inspection).toContainText('sample-knowledge.json');
    await expect(modal.locator('summary').filter({ hasText: 'Copie già ispezionate' })).toBeVisible();
    await inspection.locator('summary').filter({ hasText: 'review.md' }).click();
    await expect(inspection.locator('pre').filter({ hasText: 'never execute' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Adattiamo questo alla mia routine?' })).toBeVisible();
    await shot(page, 'components-local-inspection');
    await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0); await expect(page.getByTestId('components-open')).toBeFocused();
    await page.getByTestId('components-open').click();
    await modal.locator('summary').filter({ hasText: 'Copie già ispezionate' }).click();
    const staged = modal.getByRole('button', { name: /sample-knowledge.json/ }); await expect(staged).toBeVisible(); await staged.focus();
    await shot(page, 'components-keyboard-focus');
  } finally { await app.close(); }
});

test('routine verification exposes unknowns, localized checks, explicit case evaluation and offline export', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  try {
    const snapshot: FlowSnapshot = { contextKey: 'workbench-ui-fixture', active: { sample: 1 }, drafts: [], versions: [{ definition: { id: 'sample', title: 'Verifica documento', description: 'Controlla il documento selezionato.', aliases: [], scope: {}, steps: [{ id: 'review', title: 'Conferma', kind: 'approval', instructions: 'Controlla il documento.', inputs: [], evidence: [], effect: 'read-only', timeoutMs: 5000, maxAttempts: 1 }] }, version: 1, digest: 'a'.repeat(64), activatedAt: 1, draftRevision: 1 }], runs: [] };
    const result: RoutineWorkbenchResult = {
      readiness: { flowId: 'sample', version: 1, digest: 'a'.repeat(64), at: 1, ready: false, checks: [{ id: 'automation', state: 'fail', detail: 'Automation is paused' }, { id: 'interpreter', stepId: 'review', state: 'unknown', detail: 'Interpreter not checked' }], coverage: [] },
      comparison: { flowId: 'sample', comparableSubjects: 0, caveats: ['Recorded observations only'], versions: [{ version: 1, digest: 'a'.repeat(64), runs: 0, completed: 0, blocked: 0, cancelled: 0, skipped: 0, needsHuman: 0, retries: 0, observedDecisions: 0, terminalElapsedMs: null, completeEvidence: 0 }] },
      suites: [{ id: 'sample-v1', flowId: 'sample', createdAt: 1, digest: 'b'.repeat(64), cases: [{ id: 'one', subjectKey: 'fixture', expected: 'completed', evidence: [], split: 'holdout' }] }],
      evaluation: { suiteId: 'sample-v1', suiteDigest: 'b'.repeat(64), flowVersion: 1, definitionDigest: 'a'.repeat(64), at: 1, cases: [{ id: 'one', split: 'holdout', state: 'unknown', reasons: ['No matching host run'] }], coverage: [] },
    };
    await app.evaluate(({ ipcMain }, value) => {
      ipcMain.removeHandler('routine:workbench');
      ipcMain.handle('routine:workbench', (_event, { request }) => request.op === 'readiness' ? { readiness: value.readiness } : request.op === 'compare' ? { comparison: value.comparison } : request.op === 'suites' ? { suites: value.suites } : { evaluation: value.evaluation });
    }, result);
    await publishFlows(app, snapshot); await page.getByTestId('nav-flussi').click(); await page.getByTestId('rt-tab-routines').click();
    await page.getByTestId('rt-routine-card').filter({ hasText: 'Verifica documento' }).click();
    await page.getByTestId('rt-detail').getByTestId('routine-workbench-open').click();
    const modal = page.getByTestId('routine-workbench'); await expect(modal).toContainText('1 problema · 1 verifica ancora sconosciuta');
    await expect(modal.locator('summary').filter({ hasText: 'Automazione disponibile' })).toContainText('Da risolvere');
    await modal.getByRole('button', { name: 'sample-v1 · 1' }).click();
    await expect(page.getByTestId('routine-evaluation')).toContainText('Non verificato');
    await shot(page, 'routine-workbench-evidence');
    const download = page.waitForEvent('download'); await modal.getByRole('button', { name: 'Report offline', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('routine-observations-v1.html');
    await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0);
  } finally { await app.close(); }
});

test('chat context and voice diagnostics remain on demand and report missing samples honestly', async () => {
  const { app, page } = await launchDemo();
  try {
    const chat = await page.evaluate(async () => (await window.sb.invoke('chat:list', undefined)).find(c => c.id === 'qa')!);
    chat.launchContext = { schema: 1, mode: 'scoped', at: 1, memory: { available: true, records: [{ id: 'fact-sample', status: 'confirmed', score: 1, estimatedTokens: 20, sourceRunId: 'run-sample' }], estimatedTokens: 20, budgetTokens: 1200, omitted: { ineligible: 1, unmatched: 8, budget: 2 } }, skills: [{ name: 'review', sha256: 'a'.repeat(64) }], instructions: { sha256: 'b'.repeat(64), characters: 900, estimatedTokens: 300 } };
    await app.evaluate(({ BrowserWindow }, value) => { BrowserWindow.getAllWindows()[0]!.webContents.send('chat:updated', value); }, chat);
    await page.getByTestId('chat-menu-qa').click(); await page.getByTestId('chat-context-qa').click();
    const context = page.getByTestId('agent-context-inspector'); await expect(context).toContainText('fact-sample'); await expect(context).toContainText('≈ 300');
    await shot(page, 'agent-context-manifest'); await page.keyboard.press('Escape'); await expect(context).toHaveCount(0);
    await goPage(page, 'impostazioni'); const diagnostic = page.getByTestId('voice-diagnostics'); await diagnostic.scrollIntoViewIfNeeded();
    await diagnostic.locator('summary').first().click(); await expect(diagnostic).toContainText('n=0');
    await shot(page, 'voice-observations');
  } finally { await app.close(); }
});
