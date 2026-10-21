// End-to-end: "Comando da eseguire" (main/run/asks.ts, shared/command-ask.ts) on the demo. A chat ends its turn with a
// shell block for the user: the block becomes a request card in the asking chat's own tile (the agents workspace has no
// "Ti aspettano" strip, ADR 0019): the command, Esegui / Copia / Non serve, the chat's name in its label, and the
// open requests on screen go up by one; Esegui there runs it in the chat that proposed it (output under the block) and
// the card leaves; the chat's explanation before the block is on the card, in sight. An example in the middle of an explanation asks for nothing. A work chat's command never shows in
// the Orchestrator, its open overlay included (the user, 2026-10-13); "Non serve" on the tile card takes it away. On a page (Task) it
// floats in the request layer. A production block asks a second click on the card too. When the run ends the chat gets
// its result by itself (run/results.ts). Screenshots: test-results/shots/command-ask-lane.png (the tile card),
// command-ask-not-orchestrator.png, command-ask-layer.png, command-run-result.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { expandChats, launchDemo, layerPage, layerState, shot, windowShot } from './helpers';

type Demo = { turn(c: string, t: string): void; asks(): { reads: number; pending: string[] } };
const turn = (app: ElectronApplication, chatId: string, text: string) =>
  app.evaluate((_e, [c, t]) => { (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.turn(c, t); }, [chatId, text] as const);
const asksState = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.asks());

const EXAMPLE = [
  'Il comando si scrive così:',
  '```bash',
  'git log --oneline',
  '```',
  'e mostra un commit per riga. Il resto della spiegazione continua qui, con altri dettagli sul formato e sulle opzioni.',
].join('\n');
/** Esegui runs a block in PowerShell 5.1 on Windows and in the user's login shell ($SHELL -lc) on macOS and Linux
 *  (ADR 0054, main/platform.ts userShell): the command is written for the shell that runs it on this machine. */
const CMD = process.platform === 'win32' ? "Write-Output 'comando ok'" : "echo 'comando ok'";
const ASK = `Fatto: il fix è in main. Ora lancia il controllo:\n\n\`\`\`powershell\n${CMD}\n\`\`\``;

test('a command left by a chat waits in its tile and runs from there; an example asks for nothing', async () => {
  const { app, page } = await launchDemo();
  await expandChats(page, 'mappa', 'qa', 'feedback'); // transcripts and requests: the strips start collapsed
  await expect(page.getByTestId('needs-lane')).toHaveCount(0); // the agents workspace has no "Ti aspettano" strip (ADR 0019)
  // the open requests: the demo's three (Orchestrator, QA, Feedback); the Orchestrator column (ADR 0068) shows its own, the
  // strips the other two in their tiles
  await expect(page.getByTestId('tile-orchestrator').locator('[data-request-key]')).toHaveCount(1);
  const asks = page.getByTestId('view-agents').locator('[data-request-key]');
  await expect(asks).toHaveCount(2);

  // an example in the middle of an explanation: no request (the turn's end was read, nothing asked)
  const reads = (await asksState(app)).reads;
  await turn(app, 'mappa', EXAMPLE);
  await expect(page.getByTestId('tile-chat-mappa').getByTestId('codeblock')).toHaveCount(1);
  await expect.poll(async () => (await asksState(app)).reads).toBeGreaterThan(reads);
  expect((await asksState(app)).pending).not.toContain('mappa');
  await expect(page.locator('[data-kind="command"]')).toHaveCount(0);
  await expect(asks).toHaveCount(2);

  // a command left for the user at the end of the turn: a card in the chat's own tile, one more open request on screen
  await turn(app, 'mappa', ASK);
  const card = page.getByTestId('tile-chat-mappa').locator('[data-kind="command"]');
  await expect(card).toHaveCount(1);
  // the chat's explanation right before the block, in sight without a click (2026-10-13)
  await expect(card.locator('.cmd-lead')).toHaveText('Fatto: il fix è in main. Ora lancia il controllo:');
  await expect(page.locator('[data-kind="command"]')).toHaveCount(1); // only there
  await expect(asks).toHaveCount(3);
  await expect(card).toContainText('Comando da eseguire');
  await expect(card).toHaveAttribute('aria-label', /App · Mappa 3D/);
  await expect(card.locator('.cmd-code')).toHaveText(CMD);
  await expect(card.getByRole('button', { name: 'Copia' })).toBeVisible();
  // "Vai alla chat" only where the chat is not already around the card (Orchestrator card and layer: the tests below)
  await expect(card.getByRole('button', { name: /Vai alla chat/ })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Non serve' })).toBeVisible();
  await page.mouse.move(2, 2);
  await shot(page, 'command-ask-lane');

  // Esegui from the card: it runs in the chat that proposed it, the card leaves
  await card.getByRole('button', { name: /Esegui/ }).click();
  await expect(card).toHaveCount(0);
  await expect(asks).toHaveCount(2);
  const block = page.getByTestId('tile-chat-mappa').getByTestId('codeblock').last();
  await expect(block.getByTestId('cb-run')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
  await expect(block.getByTestId('cb-out')).toContainText('comando ok');
  const runs = await page.evaluate(() => window.sb.invoke('run:list', { chatId: 'mappa' }));
  expect(runs.at(-1)).toMatchObject({ chatId: 'mappa', state: 'ok', exitCode: 0 });

  // a production block: the card asks a second click and says why (never clicked twice here)
  await page.evaluate(() => window.sb.invoke('chat:reopen', { chatId: 'review' })); // closed in the demo
  await expandChats(page, 'review');
  await turn(app, 'review', 'Questo lo lanci tu:\n```bash\naz webapp restart -n app-prod -g rg-prod\n```');
  const prod = page.getByTestId('tile-chat-review').locator('[data-kind="command"]');
  await expect(prod).toHaveCount(1);
  await expect(prod.locator('.cb-prod')).toBeVisible();
  await prod.getByRole('button', { name: /Esegui/ }).click();
  await expect(prod.getByRole('button', { name: /Confermi\?/ })).toBeVisible();
  const prodRuns = await page.evaluate(() => window.sb.invoke('run:list', { chatId: 'review' }));
  expect(prodRuns).toHaveLength(0);
  // the chat goes on (a new message): the request leaves by itself
  await page.evaluate(() => window.sb.invoke('chat:send', { chatId: 'review', text: 'lo faccio dopo' }));
  await expect(prod).toHaveCount(0);
  await app.close();
});

test('a work chat\'s command never shows in the Orchestrator: it is a card in its own tile; "Non serve" takes it away', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  await expandChats(page, 'mappa'); // their transcripts: the strips start collapsed
  const orchestrator = page.getByTestId('tile-orchestrator');
  await turn(app, 'mappa', ASK);
  const card = page.getByTestId('tile-chat-mappa').locator('[data-kind="command"]');
  await expect(card).toHaveCount(1);
  // the chat's explanation right before the block, in sight without a click (2026-10-13)
  await expect(card.locator('.cmd-lead')).toHaveText('Fatto: il fix è in main. Ora lancia il controllo:');
  await expect(card.locator('.cmd-code')).toHaveText(CMD);
  await expect(orchestrator.locator('[data-request-key^="mappa/"]')).toHaveCount(0); // the open Orchestrator never hosts it
  await expect(page.locator('[data-kind="command"]')).toHaveCount(1);
  await page.mouse.move(2, 2);
  await shot(page, 'command-ask-not-orchestrator');
  // the open requests main serves (the app's chat:pending, the Orchestrator's app_pending) list it too
  const pending = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
  expect(pending.filter(p => p.type === 'command')).toMatchObject([{ chatId: 'mappa', tool: 'Esegui', detail: CMD }]);
  await card.getByRole('button', { name: 'Non serve' }).click();
  await expect(card).toHaveCount(0);
  const after = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
  expect(after.filter(p => p.type === 'command')).toHaveLength(0);
  // the block stays in the chat with its own Esegui
  await expect(page.getByTestId('tile-chat-mappa').getByTestId('codeblock').last().getByTestId('cb-exec')).toBeVisible();
  await app.close();
});

test('on a page the command floats in the request layer and Esegui there runs it in its chat', async () => {
  const { app, page } = await launchDemo();
  await expandChats(page, 'mappa'); // their transcripts: the strips start collapsed
  // the demo's own requests answered first, so the command is the card shown in full
  for (const p of await page.evaluate(() => window.sb.invoke('chat:pending', undefined))) {
    const answer = p.type === 'permission' ? { kind: 'permission' as const, allow: false } : { kind: 'question' as const, answers: { [p.questions![0]!.question]: p.questions![0]!.options[0]!.label } };
    await page.evaluate(([c, r, a]) => window.sb.invoke('chat:answer', { chatId: c, requestId: r, answer: a }), [p.chatId, p.id, answer] as const);
  }
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('task');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('brain-page-task')).toBeVisible(); // a page (Oggi is now Task)
  await turn(app, 'mappa', ASK);
  await expect.poll(async () => (await layerState(app)).cards).toBe(1);
  const layer = await layerPage(app);
  const card = layer.getByTestId('layer-card');
  await expect(card).toContainText('ti lascia un comando');
  await expect(card).toContainText('App · Mappa 3D');
  await expect(card.locator('.cmd-code')).toHaveText(CMD);
  await expect(card.locator('.cmd-lead')).toHaveText('Fatto: il fix è in main. Ora lancia il controllo:'); // in the layer too
  await expect(card.getByRole('button', { name: /Vai alla chat/ })).toBeVisible();
  await windowShot(app, 'command-ask-layer');
  await card.getByRole('button', { name: /Esegui/ }).click();
  await expect.poll(async () => (await layerState(app)).cards).toBe(0);
  await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('run:list', { chatId: 'mappa' }))).at(-1)?.state, { timeout: 30_000 }).toBe('ok');
  await app.close();
});

test('when a run of Esegui ends, the chat that proposed it gets the exit code and the output by itself', async () => {
  const { app, page } = await launchDemo({ env: { SB_RUN_RESULTS: '1', SB_RUN_RESULTS_MS: '200' } });
  await expandChats(page, 'mappa'); // their transcripts: the strips start collapsed
  await turn(app, 'mappa', ASK);
  const card = page.getByTestId('tile-chat-mappa').locator('[data-kind="command"]');
  await expect(card).toHaveCount(1);
  // the chat's explanation right before the block, in sight without a click (2026-10-13)
  await expect(card.locator('.cmd-lead')).toHaveText('Fatto: il fix è in main. Ora lancia il controllo:');
  await card.getByRole('button', { name: /Esegui/ }).click();
  const result = async () => (await page.evaluate(() => window.sb.invoke('chat:items', { chatId: 'mappa' })))
    .filter(i => i.kind === 'user' && i.text.startsWith('[esito di Esegui'));
  await expect.poll(async () => (await result()).length, { timeout: 30_000 }).toBe(1);
  const text = (await result())[0]!;
  expect(text.kind === 'user' && text.text).toContain('Esito: riuscito (exit code 0)');
  expect(text.kind === 'user' && text.text).toContain('comando ok');
  expect(text.kind === 'user' && text.text).toContain('non vale come suo ok');
  await expect(page.getByTestId('tile-chat-mappa')).toContainText('[esito di Esegui');
  // the demo chat answers it at once: the message is scrolled back into view for the screenshot
  await page.getByTestId('tile-chat-mappa').getByText('[esito di Esegui').first().scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  await shot(page, 'command-run-result');
  await app.close();
});
