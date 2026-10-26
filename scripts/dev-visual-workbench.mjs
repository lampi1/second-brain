// Additional hidden native-dev captures for PR review. Synthetic IPC read models, no e2e runner or paid services.
export async function captureRoutineWorkbench(app, page, capture, snapshot) {
  const fixture = {
    state: { sources: [{ repository: 'example/knowledge', ref: 'main', directory: 'components', enabled: false }], catalogs: [], bundles: [{ schema: 1, digest: 'a'.repeat(64), origin: { path: 'review-knowledge.json' }, createdAt: 1, license: 'included', findings: [], files: [{ path: 'review.md', content: 'Spiega la modifica con riferimenti al codice e alle prove. Distingui risultati verificati e ipotesi.\nChiedi se approfondire; non dedurre comprensione da un’approvazione.', sha256: 'b'.repeat(64) }, { path: 'LICENSE', content: 'Synthetic review fixture only.', sha256: 'c'.repeat(64) }] }] },
    readiness: { flowId: snapshot.versions[0].definition.id, version: 1, digest: 'visual-only', at: 1, ready: false, coverage: [], checks: [
      { id: 'integrity', state: 'pass', detail: 'Synthetic package identity matches' }, { id: 'automation', state: 'fail', detail: 'Automation is paused; approved grants are unavailable' },
      { id: 'model', stepId: 'step-0', state: 'pass', detail: 'Synthetic engine/model available' }, { id: 'test-db-connection', stepId: 'step-0', state: 'unknown', detail: 'Credentials and remote availability remain effect-time checks' },
      { id: 'user-gate', stepId: 'step-4', state: 'user', detail: 'The exact user decision is still required' },
    ] },
    comparison: { flowId: snapshot.versions[0].definition.id, comparableSubjects: 0, caveats: ['Synthetic observations, not real runs'], versions: [
      { version: 1, digest: 'visual-only', runs: 3, completed: 1, blocked: 1, cancelled: 0, skipped: 1, needsHuman: 0, retries: 2, observedDecisions: 1, terminalElapsedMs: null, completeEvidence: 1 },
    ] },
    suites: [{ id: 'document-check-v1', flowId: snapshot.versions[0].definition.id, createdAt: 1, digest: 'd'.repeat(64), cases: [{ id: 'document-one' }, { id: 'document-two' }] }],
    evaluation: { suiteId: 'document-check-v1', suiteDigest: 'd'.repeat(64), flowVersion: 1, definitionDigest: 'visual-only', at: 1, coverage: [], cases: [
      { id: 'document-one', split: 'tuning', state: 'pass', reasons: [] }, { id: 'document-two', split: 'holdout', state: 'unknown', reasons: ['No matching host run for this exact version'] },
    ] },
  };
  await app.evaluate(({ BrowserWindow, ipcMain }, { fixture, snapshot }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay'));
    win.setContentSize(1600, 1100);
    for (const channel of ['components:operate', 'routine:workbench', 'flows:list']) ipcMain.removeHandler(channel);
    ipcMain.handle('components:operate', (_event, { request }) => request.op === 'inspect' ? { bundle: fixture.state.bundles[0] } : { state: fixture.state });
    ipcMain.handle('routine:workbench', (_event, { request }) => request.op === 'readiness' ? { readiness: fixture.readiness } : request.op === 'compare' ? { comparison: fixture.comparison } : request.op === 'suites' ? { suites: fixture.suites } : { evaluation: fixture.evaluation });
    ipcMain.handle('flows:list', () => snapshot);
    win.webContents.send('flows:changed', snapshot);
  }, { fixture, snapshot });
  await page.getByTestId('components-open').click();
  const components = page.getByTestId('component-catalog');
  await components.locator('summary').filter({ hasText: 'Copie già ispezionate' }).click();
  const staged = components.getByRole('button', { name: /review-knowledge.json/ }); await staged.click();
  await page.getByTestId('component-inspection').locator('summary').filter({ hasText: 'review.md' }).click();
  await staged.focus(); await capture('components-inspection-focus');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay')); w.setContentSize(680, 900); });
  await capture('components-narrow'); await page.keyboard.press('Escape');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay')); w.setContentSize(1600, 1100); });
  await page.getByTestId('routine-workbench-open').first().click();
  const workbench = page.getByTestId('routine-workbench');
  await workbench.getByRole('button', { name: 'document-check-v1 · 2' }).click();
  await page.getByTestId('routine-evaluation').waitFor(); await capture('routine-workbench-observations');
  await page.keyboard.press('Escape');
  await page.getByTestId('nav-home').click();
  const chat = await page.evaluate(async () => (await window.sb.invoke('chat:list', undefined)).find(c => !c.isOrchestrator && !c.closedAt && !c.parentId));
  if (!chat) throw new Error('Synthetic work chat missing for context capture');
  chat.launchContext = { schema: 1, at: 1, mode: 'scoped', memory: { available: true, records: [{ id: 'fact-sample', status: 'confirmed', sourceRunId: 'run-sample', estimatedTokens: 30, score: 1 }], estimatedTokens: 30, budgetTokens: 1200, omitted: { ineligible: 2, unmatched: 14, budget: 1 } }, skills: [{ name: 'review', sha256: 'b'.repeat(64) }], instructions: { sha256: 'c'.repeat(64), characters: 3000, estimatedTokens: 1000 } };
  await app.evaluate(({ BrowserWindow }, chat) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay')); w.webContents.send('chat:updated', chat); }, chat);
  await page.getByTestId(`chat-menu-${chat.id}`).click(); await page.getByTestId(`chat-context-${chat.id}`).click();
  await page.getByTestId('agent-context-inspector').waitFor(); await capture('agent-context-manifest'); await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('g'); await page.keyboard.press('p');
  const voice = page.getByTestId('voice-diagnostics'); await voice.scrollIntoViewIfNeeded(); await voice.locator('summary').first().click(); await capture('voice-diagnostics');
}
