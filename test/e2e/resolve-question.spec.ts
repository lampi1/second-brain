// End-to-end: a work chat's question answered by the user in the Regia (app_resolve_question, main/appctl/tools.ts,
// ADR 0017). The Regia calls the tool over the app's MCP: blocked while the user has said nothing in the Regia since
// the question opened; after he writes there, the work chat's panel closes, the chat gets the answer marked "Risposto
// in Regia dall'utente" and the question leaves the work chat's tile (where it waits: the Mosaico has no "Ti aspettano"
// strip, ADR 0019) and the open requests. Screenshot: test-results/shots/resolve-question.png.
import { expect, test } from '@playwright/test';
import { McpClient } from './fixture-server';
import { launchDemo, shot } from './helpers';

test('the Regia closes a work chat\'s question with the user\'s answer, only after he spoke in the Regia', async () => {
  const { app, page } = await launchDemo();
  const info = await page.evaluate(() => window.sb.invoke('app:info', undefined));
  const regia = new McpClient(`${info.mcpUrl}/app`);
  await regia.init();
  const pending = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
  const q = pending.find(p => p.chatId === 'qa' && p.type === 'question')!;
  const question = q.questions![0]!.question;
  const card = page.getByTestId('tile-chat-qa').locator(`[data-request-key="qa/${q.id}"]`);
  await expect(card).toBeVisible();

  // the user has not spoken in the Regia since the question opened: the Regia may not answer for him
  const blocked = await regia.call('app_resolve_question', { chatId: 'qa', requestId: q.id, answers: { [question]: 'Apro un bug e taggo la QA' } });
  expect(blocked.isError).toBe(true);
  expect(blocked.text).toContain('L\'utente non ha scritto');
  await expect(card).toBeVisible();

  // he answers the Regia's own question, then tells it what to do with the QA's
  const rq = pending.find(p => p.chatId === 'regia')!;
  await page.evaluate(([rid, text]) => window.sb.invoke('chat:answer', { chatId: 'regia', requestId: rid, answer: { kind: 'question', answers: { [text]: 'QA rimborsi' } } }), [rq.id, rq.questions?.[0]?.question ?? rq.title] as const);
  await page.evaluate(() => window.sb.invoke('chat:send', { chatId: 'regia', text: 'Per la QA dei rimborsi: apri il bug e tagga la QA.' }));

  const done = await regia.call('app_resolve_question', { chatId: 'qa', requestId: q.id, answers: { [question]: 'Apro un bug e taggo la QA' }, note: 'deciso in Regia' });
  expect(done.isError).toBe(false);
  await expect(card).toHaveCount(0);
  const left = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
  expect(left.some(p => p.id === q.id)).toBe(false);
  // the work chat goes on with the marked answer
  await expect(page.getByTestId('tile-chat-qa')).toContainText('Risposto nell’Orchestrator dall\'utente', { timeout: 15_000 });
  await page.mouse.move(2, 2);
  await shot(page, 'resolve-question');
  await app.close();
});
