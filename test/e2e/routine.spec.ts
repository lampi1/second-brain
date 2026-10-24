// The Routine page (ADR 0153) in the real app with an injected snapshot (routine.fixture.ts): «Adesso» shows only what
// needs the user (a prod command with «Esegui», a self-healing run as working), «Routine» lists them with trigger and
// queue, a routine opens with its steps and per-step engine/model, «Storico» shows receipts, and «Avvia» previews a
// work item and runs dry. Main's flow handlers are swapped for stand-ins: nothing runs, the test reads what was sent.
import { test, expect } from '@playwright/test';
import { routineSnapshot } from './routine.fixture';
import { launchDemo, shot, publishFlows } from './helpers';

test('Routine page: now, routines, detail, history, start and dry run', async () => {
  const { app, page } = await launchDemo({ orchestrator: true, width: 1440, height: 900 });
  try {
    const snapshot = routineSnapshot(Date.now());
    await app.evaluate(({ ipcMain }, value) => {
      const g = globalThis as unknown as { __rtSent: { channel: string; input: unknown }[] };
      g.__rtSent = [];
      const stand = (channel: string, answer: (input: Record<string, unknown>) => unknown) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, (_e, input: Record<string, unknown>) => { g.__rtSent.push({ channel, input }); return answer(input); });
      };
      stand('flows:runCommand', () => value);
      stand('flows:editStepModel', () => value);
      stand('flows:previewItem', () => ({ id: 4812, title: 'Login fallisce con SSO su Edge', type: 'Bug', state: 'Active', areaPath: 'Air\\Web', tags: ['ai-ready', 'bug'], url: 'https://dev.azure.com/ex/Air/_workitems/edit/4812', revision: 3, matches: true, why: [], blocking: [] }));
      stand('flows:startItem', input => ({ flowId: input.flowId, version: 7, problems: [], steps: [
        { stepId: 'analyze', title: 'Analisi', kind: 'agent', who: 'Scout · claude-sonnet-5-5', prod: false, auto: true, problems: [] },
        { stepId: 'fix', title: 'Correzione', kind: 'agent', who: 'Artisan · claude-opus-5-5', prod: false, auto: true, problems: [] },
        { stepId: 'verify', title: 'Verifica', kind: 'check', who: 'Script', command: 'pwsh -NoProfile -File run-tests.ps1 -Filter 4812 -Env test', prod: false, auto: true, problems: [] },
        { stepId: 'review', title: 'Revisione PR', kind: 'agent', who: 'Sentinel', prod: false, auto: true, problems: [] },
        { stepId: 'update', title: 'Aggiorna work item', kind: 'agent', who: 'Herald · claude-haiku-5-5', prod: false, auto: true, problems: [] },
      ] }));
    }, snapshot);
    await page.getByTestId('nav-flussi').click();
    await publishFlows(app, snapshot);

    // Adesso: the prod command waits for the user, the self-healing run is working, not «needs you»
    await page.getByTestId('rt-tab-now').click();
    const prod = page.getByTestId('rt-prod-card');
    await expect(prod).toBeVisible();
    await expect(prod.getByTestId('rt-prod-command')).toContainText('move-licenses.ps1');
    await expect(page.getByTestId('rt-heal').first()).toBeVisible();
    await shot(page, 'routine-now');
    await prod.getByTestId('rt-prod-run').click();
    const sent = await app.evaluate(() => (globalThis as unknown as { __rtSent: { channel: string; input: Record<string, unknown> }[] }).__rtSent);
    const run = snapshot.runs.find(r => r.id === 'run-prod')!;
    expect(sent.find(s => s.channel === 'flows:runCommand')?.input.command).toEqual(run.awaitingUser!.command);

    // Routine: cards with trigger switch and queue; a routine opens with its steps and per-step engine/model
    await page.getByTestId('rt-tab-routines').click();
    await expect(page.getByTestId('rt-routine-card')).toHaveCount(4);
    await shot(page, 'routine-list');
    await page.getByTestId('rt-routine-card').filter({ hasText: 'Bugfix automatico' }).click();
    await expect(page.getByTestId('rt-detail')).toBeVisible();
    await expect(page.getByTestId('rt-step-model').first()).toBeVisible();
    await expect(page.getByTestId('rt-queue')).toBeVisible();
    await shot(page, 'routine-detail');

    // Storico
    await page.getByTestId('rt-tab-history').click();
    await expect(page.getByTestId('rt-history')).toBeVisible();
    await shot(page, 'routine-history');

    // Avvia: preview of one work item, then a dry run that executes nothing
    await page.getByTestId('rt-start-open').click();
    const start = page.getByTestId('rt-start');
    await expect(start).toBeVisible();
    await start.getByTestId('rt-start-item').fill('https://dev.azure.com/ex/Air/_workitems/edit/4812');
    await start.getByTestId('rt-start-item').press('Enter');
    await expect(start.getByTestId('rt-preview')).toContainText('Login fallisce con SSO su Edge');
    await shot(page, 'routine-start');
    await start.getByTestId('rt-start-dry').click();
    await expect(page.getByTestId('rt-dry-modal')).toBeVisible();
    await shot(page, 'routine-dry-run');
    const dry = await app.evaluate(() => (globalThis as unknown as { __rtSent: { channel: string; input: Record<string, unknown> }[] }).__rtSent.filter(s => s.channel === 'flows:startItem'));
    expect(dry.every(s => s.input.dryRun === true)).toBe(true);
  } finally { await app.close(); }
});
