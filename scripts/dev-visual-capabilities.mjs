// Hidden native captures of routine capability approval; only synthetic in-memory fixtures, no connector calls.
export async function captureRoutineCapabilities(app, page, capture) {
  await page.getByTestId('nav-flussi').click();
  const definition = { id: 'connector-fixture', title: 'Aggiorna il sistema di test', description: 'Un commento di analisi e una nota sul connettore approvato.', aliases: [], scope: {}, steps: [
    { id: 'analysis', title: 'Condividi l’analisi', kind: 'agent', role: 'scout', instructions: 'Commenta con le persone autorizzate.', inputs: ['workspace'], workspaceInput: 'workspace', evidence: ['report'], timeoutMs: 60000, maxAttempts: 1, effect: 'external-write', adapter: 'devops-write', mentionReason: 'analysis' },
    { id: 'publish', title: 'Pubblica la nota di test', kind: 'check', instructions: 'Pubblica la nota approvata.', inputs: ['message'], evidence: ['connector'], timeoutMs: 60000, maxAttempts: 2, effect: 'external-write', connector: { serverId: 'qa-notes', tool: 'add_note', role: 'artisan', serverHash: 'a'.repeat(64), toolHash: 'b'.repeat(64), arguments: { message: '{{message}}', priority: 2 } } }
  ] };
  const snapshot = { contextKey: 'capability-ui', versions: [], active: {}, runs: [], drafts: [{ revision: 1, status: 'proposed', updatedAt: 1, definition }] };
  const publish = value => app.evaluate(({ BrowserWindow, ipcMain }, data) => {
    ipcMain.removeHandler('flows:list'); ipcMain.handle('flows:list', () => data);
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay'));
    win.webContents.send('flows:changed', data);
  }, value);
  await publish(snapshot);
  const approval = page.getByTestId('qwin-flow-definition');
  await approval.getByTestId('flow-connector-target').waitFor();
  await approval.getByText('Parametri esatti e identità approvate', { exact: true }).click();
  await capture('routine-connector-approval');
  await page.getByTestId('qwin-later').click();
  snapshot.drafts = [];
  snapshot.versions = [{ version: 1, digest: 'a'.repeat(64), activatedAt: 1, definition }]; snapshot.active = { 'connector-fixture': 1 };
  snapshot.automation = { schema: 1, revision: 1, paused: false, background: false, events: [], rules: [{ id: 'manual-config', ownerOrchestratorId: 'o', revision: 1, status: 'proposed', updatedAt: 1, config: { flowId: definition.id, flowVersion: 1, scope: { project: 'Example' }, inputs: { workspace: '/fixture', message: 'Nota di test' }, priority: 'normal', trigger: { kind: 'manual' }, devopsWrite: { organization: 'contoso', projects: ['Example'], ops: ['comment'], fields: [] } } }] };
  await publish(snapshot); await page.getByTestId('qwin-flow-automation').waitFor();
  await capture('routine-manual-grants'); await page.getByTestId('qwin-later').click();
}
