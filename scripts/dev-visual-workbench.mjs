// Additional hidden native-dev captures for PR review: a work chat's launch context and the voice diagnostics.
// Synthetic read models only, no e2e runner or paid services. Used by dev-visual-smoke.mjs.
export async function captureWorkbench(app, page, capture) {
  await page.getByTestId('nav-home').click();
  await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('g'); await page.keyboard.press('a');
  await page.getByTestId('catalog-flip-artisan').click(); await page.getByTestId('catalog-open-artisan').click();
  // the role's page (ADR 0347): «+ Skill» opens a field; the page's own focus (the instructions) must not take it back
  await page.getByTestId('agent-skill-add').click();
  const skill = page.getByTestId('agent-skill-name');
  await skill.fill('brain-edit');
  // Observe beyond the former delayed focus: the user's selected field and text must remain intact.
  await page.waitForTimeout(100);
  if (await skill.inputValue() !== 'brain-edit' || !await skill.evaluate(el => el === document.activeElement)) throw new Error('Role editor stole skill input focus');
  await capture('role-editor-skill-focus');
  await skill.press('Enter');
  await page.getByTestId('agent-skills').getByRole('button', { name: 'brain-edit', exact: true }).waitFor();
  await page.getByTestId('nav-home').click();
  const child = await page.evaluate(async () => (await window.sb.invoke('chat:list', undefined)).find(c => c.parentId && c.delegation && !c.closedAt));
  if (!child) throw new Error('Synthetic delegated chat missing');
  const idle = { ...child, state: 'idle', pending: 0, queued: undefined, background: 0, agentChildren: undefined, delegation: { ...child.delegation, result: undefined } };
  const publish = chat => app.evaluate(({ BrowserWindow }, chat) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay')); w.webContents.send('chat:updated', chat); }, chat);
  await publish(idle);
  // its strip under the lead (AgentStrips.tsx, ADR 0366) says how the page counts it (data-status): a stalled helper is
  // no longer at work, one with background work is, and its team is then «Al lavoro» (its helpers unfolded)
  const status = want => page.waitForFunction(({ id, want }) => document.querySelector(`[data-testid="grind-kid-${id}"]`)?.getAttribute('data-status') === want,
    { id: child.id, want }, { timeout: 30_000 });
  await status('done');
  await publish({ ...idle, background: 1 });
  await status('work');
  await page.waitForFunction(id => document.querySelector(`[data-testid="grind-kid-${id}"]`)?.closest('[data-sec]')?.getAttribute('data-sec') === 'work', child.id);
  await page.getByTestId(`grind-kid-${child.id}`).scrollIntoViewIfNeeded();
  await capture('delegation-background-work');
  await publish(idle);
  await status('done');
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
