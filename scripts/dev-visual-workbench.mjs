// Additional hidden native-dev captures for PR review: a work chat's launch context and the voice diagnostics.
// Synthetic read models only, no e2e runner or paid services. The legacy Routine workbench and component catalog
// captures are gone with that UI (ADR 0175, 0176). Used by dev-visual-smoke.mjs.
export async function captureRoutineWorkbench(app, page, capture) {
  await page.getByTestId('nav-home').click();
  await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('g'); await page.keyboard.press('a');
  await page.getByTestId('catalog-flip-artisan').click(); await page.getByTestId('catalog-open-artisan').click();
  const skill = page.getByTestId('agent-skill-input');
  await skill.fill('brain-edit');
  // Observe beyond the former delayed focus: the user's selected field and text must remain intact.
  await page.waitForTimeout(100);
  if (await skill.inputValue() !== 'brain-edit' || !await skill.evaluate(el => el === document.activeElement)) throw new Error('Role editor stole skill input focus');
  await capture('role-editor-skill-focus');
  await page.getByTestId('agent-skill-add').click();
  await page.getByTestId('agent-skills-edit').getByRole('button', { name: /brain-edit/ }).waitFor();
  await page.getByTestId('nav-home').click();
  const child = await page.evaluate(async () => (await window.sb.invoke('chat:list', undefined)).find(c => c.parentId && c.delegation && !c.closedAt));
  if (!child) throw new Error('Synthetic delegated chat missing');
  const idle = { ...child, state: 'idle', pending: 0, queued: undefined, background: 0, agentChildren: undefined, delegation: { ...child.delegation, result: undefined } };
  const publish = chat => app.evaluate(({ BrowserWindow }, chat) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay')); w.webContents.send('chat:updated', chat); }, chat);
  await publish(idle);
  await page.waitForFunction(id => document.querySelector(`[data-testid="delegation-card-${id}"]`)?.getAttribute('data-child-state') === 'stall', child.id);
  const segments = page.getByTestId(`tree-kids-${child.parentId}`).locator('.kids-segs .seg-run');
  const before = await segments.count();
  await publish({ ...idle, background: 1 });
  await page.waitForFunction(({ id, parent, count }) => document.querySelector(`[data-testid="delegation-card-${id}"]`)?.getAttribute('data-child-state') === 'run'
    && document.querySelectorAll(`[data-testid="tree-kids-${parent}"] .kids-segs .seg-run`).length === count, { id: child.id, parent: child.parentId, count: before + 1 });
  await page.getByTestId(`delegation-card-${child.id}`).scrollIntoViewIfNeeded();
  await capture('delegation-background-work');
  await publish(idle);
  await page.waitForFunction(({ id, parent, count }) => document.querySelector(`[data-testid="delegation-card-${id}"]`)?.getAttribute('data-child-state') === 'stall'
    && document.querySelectorAll(`[data-testid="tree-kids-${parent}"] .kids-segs .seg-run`).length === count, { id: child.id, parent: child.parentId, count: before });
  await publish(child);
  const chat = await page.evaluate(async () => (await window.sb.invoke('chat:list', undefined)).find(c => !c.isOrchestrator && !c.closedAt && !c.parentId));
  if (!chat) throw new Error('Synthetic work chat missing for context capture');
  chat.launchContext = { schema: 1, at: 1, mode: 'scoped', memory: { available: true, records: [{ id: 'fact-sample', status: 'confirmed', sourceRunId: 'run-sample', estimatedTokens: 30, score: 1 }], estimatedTokens: 30, budgetTokens: 1200, omitted: { ineligible: 2, unmatched: 14, budget: 1 } }, skills: [{ name: 'review', sha256: 'b'.repeat(64) }], instructions: { sha256: 'c'.repeat(64), characters: 3000, estimatedTokens: 1000 } };
  await app.evaluate(({ BrowserWindow }, chat) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay')); w.webContents.send('chat:updated', chat); }, chat);
  await page.getByTestId(`chat-menu-${chat.id}`).click(); await page.getByTestId(`chat-context-${chat.id}`).click();
  await page.getByTestId('agent-context-inspector').waitFor(); await capture('agent-context-manifest'); await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('g'); await page.keyboard.press('p');
  const voice = page.getByTestId('voice-diagnostics'); await voice.scrollIntoViewIfNeeded(); await voice.locator('summary').first().click(); await capture('voice-diagnostics');
}
