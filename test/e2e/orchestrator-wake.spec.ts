// End-to-end: "Eventi all'Orchestrator" (main/chats/orchestrator-wake.ts) on the demo. A work chat ends its turn leaving a
// command for the user (through the real wiring): a plain turn end is quiet news (2026-11-07, ADR 0221), so even once the
// Orchestrator is free (here after the user answered its open question) it opens no turn of its own; it rides along with
// the Orchestrator's next turn (here a user message) as one message labelled as the app's, with the chat's title and what
// it left. While the Orchestrator waits for the user nothing is sent. The demo turns the news on only with SB_ORCHESTRATOR_EVENTS=1; SB_ORCHESTRATOR_EVENTS_MS shortens the grouping window.
// Screenshot: test-results/shots/orchestrator-wake.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type Demo = { turn(c: string, t: string): void; wake(): { queued: string[]; held: number } };

test('a work chat that finishes reaches the Orchestrator with its next turn as an app message, never as a turn of its own', async () => {
  const { app, page } = await launchDemo({ orchestrator: true, env: { SB_ORCHESTRATOR_EVENTS: '1', SB_ORCHESTRATOR_EVENTS_MS: '500' } });
  const orchestratorItems = () => page.evaluate(() => window.sb.invoke('chat:items', { chatId: 'orchestrator' }));
  const appNews = async () => (await orchestratorItems()).filter(i => i.kind === 'user' && i.text.startsWith('[evento app'));

  const text = ['Fatto: la mappa carica in 2 secondi. Ora lancia:', '', '```powershell', "Write-Output 'ok'", '```'].join('\n');
  await app.evaluate((_e, t) => { (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.turn('mappa', t); }, text);
  // the Orchestrator waits for the user (its open question): the news waits too (held by its gate),
  // once the command (asks.ts settles it after the turn end) has replaced the bare 'done'
  const wake = () => app.evaluate(() => (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.wake());
  await expect.poll(async () => { const w = await wake(); return w.held > 0 && w.queued.includes('mappa:command'); }).toBe(true);
  expect(await appNews()).toHaveLength(0);

  const pending = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
  const q = pending.find(p => p.chatId === 'orchestrator')!;
  await page.evaluate(([rid, question]) => window.sb.invoke('chat:answer', { chatId: 'orchestrator', requestId: rid, answer: { kind: 'question', answers: { [question]: 'QA rimborsi' } } }), [q.id, q.questions?.[0]?.question ?? q.title] as const);

  // free now, but a command left after a plain turn end is quiet news (2026-11-07): it opens no turn of its own...
  await page.waitForTimeout(2000);
  expect(await appNews()).toHaveLength(0);
  expect((await wake()).queued).toContain('mappa:command');
  // ...it rides along with the Orchestrator's next turn
  await page.evaluate(() => window.sb.invoke('chat:send', { chatId: 'orchestrator', text: 'novità?' }));
  await expect.poll(async () => (await appNews()).length, { timeout: 20_000 }).toBe(1);
  const news = (await appNews())[0]!;
  expect(news.kind === 'user' && news.text).toContain('non scritto dall\'utente');
  expect(news.kind === 'user' && news.text).toContain("«App · Mappa 3D» (Claude): ha lasciato all'utente un comando da eseguire: Write-Output 'ok'");
  // shown folded as the app's (lib/foreign.ts, collapsed agent messages): one muted line, never the raw label
  const line = page.getByTestId('tile-orchestrator').getByTestId(`item-${news.id}`);
  await expect(line).toHaveAttribute('data-foreign', 'event');
  await expect(line.locator('.foreign-who')).toHaveText('Evento app');
  await expect(line).toContainText("«App · Mappa 3D» (Claude): ha lasciato all'utente un comando da eseguire");
  await expect(page.getByTestId('tile-orchestrator')).not.toContainText('[evento app');
  await page.mouse.move(2, 2);
  await shot(page, 'orchestrator-wake');
  await app.close();
});
