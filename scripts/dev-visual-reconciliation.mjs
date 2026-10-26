// Hidden native reconciliation fixture; local IPC stubs only, no live work item or external effect.
export async function captureReconciliation(app, page, capture) {
  const step = { id: 'publish', title: 'Pubblica il branch', kind: 'agent', effect: 'external-write', adapter: 'devops-write', instructions: 'Publish fixture', inputs: ['workspace'], workspaceInput: 'workspace', evidence: [], maxAttempts: 1, timeoutMs: 60000 };
  const definition = { id: 'recovery-fixture', title: 'Correzione verificata', description: 'Run fermata dopo una scrittura incerta.', aliases: [], scope: {}, steps: [step] };
  const run = { id: 'fixture-run', revision: 4, flowId: definition.id, flowVersion: 1, definitionDigest: 'fixture', ownerOrchestratorId: 'o', subjectKey: 'work-item:42', scope: {}, inputs: {}, status: 'cancelled', currentStep: 0, steps: [{ stepId: step.id, status: 'cancelled', attempts: 1 }], createdAt: Date.now() - 60000, updatedAt: Date.now(), cancellation: { at: Date.now(), expectedRevision: 3, reason: 'Stopped', by: 'user', interruption: 'confirmed' } };
  const snapshot = { contextKey: 'reconcile-ui', drafts: [], versions: [{ version: 1, digest: 'fixture', activatedAt: Date.now(), definition }], active: { [definition.id]: 1 }, runs: [run] };
  await app.evaluate(({ BrowserWindow, ipcMain }, data) => {
    for (const channel of ['flows:list', 'flows:writeReconciliation', 'flows:reconcileWrites']) ipcMain.removeHandler(channel);
    let view = { runId: 'fixture-run', revision: 4, digest: 'fixture', canReconcile: true, workItem: { organization: 'contoso', id: 42, url: 'https://example.com/workitems/42' }, operations: ['push-branch', 'comment', 'comment', 'comment'].map((op, i) => ({ id: String(i + 1).repeat(64), op, state: 'pending', eligible: true, at: Date.now() - (4 - i) * 60000 })) };
    ipcMain.handle('flows:list', () => data); ipcMain.handle('flows:writeReconciliation', () => view);
    ipcMain.handle('flows:reconcileWrites', (_e, input) => { view = { ...view, digest: 'saved', operations: view.operations.map(op => { const d = input.decisions.find(x => x.id === op.id); return d ? { ...op, state: 'reconciled', eligible: false, reconciliation: { ...d, at: Date.now(), by: 'user', organization: 'contoso', workItemId: 42 } } : op; }) }; return view; });
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay')); win.webContents.send('flows:changed', data);
  }, snapshot);
  await page.getByTestId('nav-flussi').click(); await page.getByTestId('rt-tab-history').click();
  await page.getByTestId('routine-reconcile-open').first().click();
  const modal = page.getByTestId('routine-reconciliation'); await modal.getByTestId('reconcile-operation').first().waitFor();
  await modal.locator('select').first().selectOption('reverted');
  await modal.locator('textarea').first().fill('Verificato in DevOps: il branch è stato eliminato manualmente.');
  const readable = await modal.locator('textarea').first().evaluate(field => field.clientWidth >= 280 && field.clientHeight >= 70 && getComputedStyle(field).textAlign === 'left');
  if (!readable) throw new Error('Reconciliation evidence field is clipped');
  await modal.locator('summary').first().click(); await capture('routine-write-reconciliation');
  await modal.getByTestId('reconcile-confirm').click(); await modal.getByText(/Riconciliata:/).waitFor();
  await capture('routine-write-reconciled'); await page.keyboard.press('Escape');
}
