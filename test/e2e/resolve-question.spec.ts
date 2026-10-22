// End-to-end: a work chat's question answered by the user in the Orchestrator (app_resolve_question, main/appctl/tools.ts,
// ADR 0017). The Orchestrator calls the tool over the app's MCP: blocked while the user has said nothing in the Orchestrator since
// the question opened; after he writes there, the work chat's panel closes, the chat gets the answer marked "Risposto
// nell'Orchestrator dall'utente" and the question leaves the questions window (where it waits: always on since 2026-10-22)
// and the open requests. Screenshot: test-results/shots/resolve-question.png.
import { expect, test } from '@playwright/test';
import { McpClient } from './fixture-server';
import { launchDemo, shot } from './helpers';

test('the Orchestrator closes a work chat\'s question with the user\'s answer, only after he spoke in the Orchestrator', async () => {
  const { app, page } = await launchDemo({ questions: true });
  const info = await page.evaluate(() => window.sb.invoke('app:info', undefined));
  const orchestrator = new McpClient(`${info.mcpUrl}/app`);
  await orchestrator.init();
  const pending = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
  const q = pending.find(p => p.chatId === 'qa' && p.type === 'question')!;
  const question = q.questions![0]!.question;
  await page.locator(`[data-testid="qwin-pick"][data-key="qa/${q.id}"]`).click(); // the QA's question in the window
  const card = page.locator(`[data-request-key="qa/${q.id}"]`);
  await expect(card).toBeVisible();

  // the user has not spoken in the Orchestrator since the question opened: the Orchestrator may not answer for him
  const blocked = await orchestrator.call('app_resolve_question', { chatId: 'qa', requestId: q.id, answers: { [question]: 'Apro un bug e taggo la QA' } });
  expect(blocked.isError).toBe(true);
  expect(blocked.text).toContain('L\'utente non ha scritto');
  await expect(card).toBeVisible();

  // he answers the Orchestrator's own question, then tells it what to do with the QA's
  const rq = pending.find(p => p.chatId === 'orchestrator')!;
  await page.evaluate(([rid, text]) => window.sb.invoke('chat:answer', { chatId: 'orchestrator', requestId: rid, answer: { kind: 'question', answers: { [text]: 'QA rimborsi' } } }), [rq.id, rq.questions?.[0]?.question ?? rq.title] as const);
  await page.evaluate(() => window.sb.invoke('chat:send', { chatId: 'orchestrator', text: 'Per la QA dei rimborsi: apri il bug e tagga la QA.' }));

  const done = await orchestrator.call('app_resolve_question', { chatId: 'qa', requestId: q.id, answers: { [question]: 'Apro un bug e taggo la QA' }, note: 'deciso in Orchestrator' });
  expect(done.isError).toBe(false);
  await expect(card).toHaveCount(0);
  const left = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
  expect(left.some(p => p.id === q.id)).toBe(false);
  // the work chat goes on with the marked answer
  await expect.poll(async () => JSON.stringify(await page.evaluate(() => window.sb.invoke('chat:items', { chatId: 'qa' }))), { timeout: 15_000 }).toContain('Risposto nell’Orchestrator dall\'utente');
  await page.mouse.move(2, 2);
  await shot(page, 'resolve-question');
  await app.close();
});
