// The open routine shows, for each agent step, the role's avatar and name (a step without a role shows the role the
// runner picks), and a picker for engine, model and effort (ADR 0154): a pick is applied at once as a new version.
// A renderer fixture and a stand-in host: no workflow starts, no agent is invoked.
import { test, expect } from '@playwright/test';
import { stepAgentSnapshot } from './flow-step-agent.fixture';
import { launchDemo, shot, publishFlows } from './helpers';

test('each agent step shows its role and takes an engine/model pick', async () => {
  const { app, page } = await launchDemo({ orchestrator: true, width: 1400, height: 900 });
  try {
    await app.evaluate(({ ipcMain }, base) => {
      const g = globalThis as unknown as { modelEdits: unknown[] };
      g.modelEdits = [];
      ipcMain.removeHandler('flows:editStepModel');
      ipcMain.handle('flows:editStepModel', (_event, edit: { stepId: string; engine: string | null; model: string | null }) => {
        g.modelEdits.push(edit);
        const definition = structuredClone(base.versions[0]!.definition), step = definition.steps.find(s => s.id === edit.stepId)!;
        if (edit.engine) step.engine = edit.engine; if (edit.model) step.model = edit.model;
        return { ...base, active: { 'demo-fix': 2 }, versions: [...base.versions, { definition, version: 2, draftRevision: 2, digest: 'fixture-2', activatedAt: Date.now() }] };
      });
    }, stepAgentSnapshot());
    await page.getByTestId('nav-flussi').click();
    await publishFlows(app, stepAgentSnapshot());
    await page.getByTestId('rt-tab-routines').click();
    await page.getByTestId('rt-routine-card').filter({ hasText: 'Correzione di prova' }).click();
    const detail = page.getByTestId('rt-detail');
    await expect(detail.locator('.rt-who')).toHaveText(['Scout', 'Artisan', 'Scout']);
    await expect(detail.locator('[data-character=scout]').first()).toBeVisible();
    const pickers = detail.getByTestId('rt-step-model');
    await expect(pickers).toHaveCount(3); // every agent step, the role-less one too
    await shot(page, 'flow-step-agent');
    await pickers.first().locator('select').first().selectOption('codex');
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { modelEdits: unknown[] }).modelEdits)).toEqual([
      { contextKey: 'flow-step-agent-fixture', flowId: 'demo-fix', version: 1, stepId: 'investigate', engine: 'codex', model: null, effort: null },
    ]);
    await expect(detail).toContainText('v2');
  } finally { await app.close(); }
});
