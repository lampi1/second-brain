// End-to-end: "Comando da eseguire" (main/run/asks.ts, shared/command-ask.ts) on the demo. A chat ends its turn with a
// shell block for the user: the block becomes a request in the questions window (always on since 2026-10-22: no card
// in the chat's tile, no Orchestrator column, no request cards in the global layer): the command whole, the chat's
// explanation before the block as its title, its two-word summary, Esegui / Copia / Non serve, the chat's name in its
// label, and the open requests go up by one; Esegui there runs it in the chat that proposed it (output under the block)
// and the request leaves. An example in the middle of an explanation asks for nothing. A work chat's command never
// shows in the Orchestrator; "Non serve" takes it away. On a page (Task) the same window shows it, with "Apri chat".
// A production block asks a second click too. When the run ends the chat gets its result by itself (run/results.ts).
// Screenshots: test-results/shots/command-ask-window.png, command-ask-not-orchestrator.png, command-ask-page.png,
// command-run-result.png.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expandChats, goPage, launchDemo, shot } from './helpers';

type Demo = { turn(c: string, t: string): void; asks(): { reads: number; pending: string[] } };
const turn = (app: ElectronApplication, chatId: string, text: string) =>
  app.evaluate((_e, [c, t]) => { (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.turn(c, t); }, [chatId, text] as const);
const asksState = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.asks());
const openRequests = async (page: Page) => (await page.evaluate(() => window.sb.invoke('chat:pending', undefined))).length;

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
const LEAD = 'Fatto: il fix è in main. Ora lancia il controllo:';
const ASK = `${LEAD}\n\n\`\`\`powershell\n${CMD}\n\`\`\``;

test('a command left by a chat waits in the questions window and runs from there; an example asks for nothing', async () => {
  const { app, page } = await launchDemo();
  await expandChats(page, 'mappa'); // the transcript: the strips start collapsed
  await expect(page.getByTestId('needs-lane')).toHaveCount(0); // the agents workspace has no "Ti aspettano" strip (ADR 0019)
  // the demo's three requests (Orchestrator, QA, Feedback) are set aside; no request card in any tile
  expect(await openRequests(page)).toBe(3);
  await expect(page.getByTestId('view-agents').locator('[data-request-key]')).toHaveCount(0);

  // an example in the middle of an explanation: no request (the turn's end was read, nothing asked)
  const reads = (await asksState(app)).reads;
  await turn(app, 'mappa', EXAMPLE);
  await expect(page.getByTestId('tile-chat-mappa').getByTestId('codeblock')).toHaveCount(1);
  await expect.poll(async () => (await asksState(app)).reads).toBeGreaterThan(reads);
  expect((await asksState(app)).pending).not.toContain('mappa');
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  expect(await openRequests(page)).toBe(3);

  // a command left for the user at the end of the turn: the questions window, one more open request
  await turn(app, 'mappa', ASK);
  const card = page.getByTestId('qwin-card');
  await expect(card).toHaveAttribute('data-kind', 'command');
  await expect(page.getByTestId('qwin-chat')).toHaveText('App · Mappa 3D');
  // the chat's explanation right before the block is the card's title; the command whole under it
  await expect(page.getByTestId('qwin-card-lead')).toHaveText(LEAD);
  await expect(page.getByTestId('qwin-card-code')).toHaveText(CMD);
  await expect(page.getByTestId('qwin-card-gist')).toHaveText('Stampa testo');
  await expect(page.locator('[data-kind="command"]')).toHaveCount(1); // only there
  expect(await openRequests(page)).toBe(4);
  await expect(card).toContainText('Comando da eseguire');
  await expect(card).toHaveAttribute('aria-label', /App · Mappa 3D/);
  await expect(page.getByTestId('qwin-card-copy')).toBeVisible();
  await expect(page.getByTestId('qwin-card-dismiss')).toHaveText('Non serve');
  await page.mouse.move(2, 2);
  await shot(page, 'command-ask-window');

  // Esegui from the window: it runs in the chat that proposed it, the request leaves
  await page.getByTestId('qwin-card-run').click();
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  await expect.poll(() => openRequests(page)).toBe(3);
  const block = page.getByTestId('tile-chat-mappa').getByTestId('codeblock').last();
  await expect(block.getByTestId('cb-run')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
  await expect(block.getByTestId('cb-out')).toContainText('comando ok');
  const runs = await page.evaluate(() => window.sb.invoke('run:list', { chatId: 'mappa' }));
  expect(runs.at(-1)).toMatchObject({ chatId: 'mappa', state: 'ok', exitCode: 0 });

  // a production block: the window asks a second click and says why (never clicked twice here)
  await page.evaluate(() => window.sb.invoke('chat:reopen', { chatId: 'review' })); // closed in the demo
  await turn(app, 'review', 'Questo lo lanci tu:\n```bash\naz webapp restart -n app-prod -g rg-prod\n```');
  await expect(page.getByTestId('qwin-card-code')).toHaveText('az webapp restart -n app-prod -g rg-prod');
  await expect(page.getByTestId('qwin-card-prod')).toBeVisible();
  await page.getByTestId('qwin-card-run').click();
  await expect(page.getByTestId('qwin-card-run')).toContainText('Confermi?');
  const prodRuns = await page.evaluate(() => window.sb.invoke('run:list', { chatId: 'review' }));
  expect(prodRuns).toHaveLength(0);
  // the chat goes on (a new message): the request leaves by itself
  await page.evaluate(() => window.sb.invoke('chat:send', { chatId: 'review', text: 'lo faccio dopo' }));
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  await app.close();
});

test('a work chat\'s command never shows in the Orchestrator: it waits in the questions window; "Non serve" takes it away', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  await expandChats(page, 'mappa'); // the transcript: the strips start collapsed
  const orchestrator = page.getByTestId('tile-orchestrator');
  await turn(app, 'mappa', ASK);
  await expect(page.getByTestId('qwin-card')).toHaveAttribute('data-kind', 'command');
  await expect(page.getByTestId('qwin-card-lead')).toHaveText(LEAD);
  await expect(page.getByTestId('qwin-card-code')).toHaveText(CMD);
  await expect(orchestrator.locator('[data-request-key^="mappa/"]')).toHaveCount(0); // the Orchestrator never hosts it
  await expect(page.locator('[data-kind="command"]')).toHaveCount(1);
  await page.mouse.move(2, 2);
  await shot(page, 'command-ask-not-orchestrator');
  // the open requests main serves (the app's chat:pending, the Orchestrator's app_pending) list it too
  const pending = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
  expect(pending.filter(p => p.type === 'command')).toMatchObject([{ chatId: 'mappa', tool: 'Esegui', detail: CMD }]);
  await page.getByTestId('qwin-card-dismiss').click();
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  const after = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
  expect(after.filter(p => p.type === 'command')).toHaveLength(0);
  // the block stays in the chat with its own Esegui
  await expect(page.getByTestId('tile-chat-mappa').getByTestId('codeblock').last().getByTestId('cb-exec')).toBeVisible();
  await app.close();
});

test('on a page the command shows in the questions window and Esegui there runs it in its chat', async () => {
  const { app, page } = await launchDemo();
  await goPage(page, 'task');
  await expect(page.getByTestId('brain-page-task')).toBeVisible(); // a page (Oggi is now Task)
  await turn(app, 'mappa', ASK);
  const card = page.getByTestId('qwin-card');
  await expect(card).toHaveAttribute('data-kind', 'command');
  await expect(page.getByTestId('qwin-chat')).toHaveText('App · Mappa 3D');
  await expect(page.getByTestId('qwin-card-code')).toHaveText(CMD);
  await expect(page.getByTestId('qwin-card-lead')).toHaveText(LEAD);
  await expect(page.getByTestId('qwin-open-chat')).toBeVisible(); // the chat is not on screen: one click away
  await page.mouse.move(2, 2);
  await shot(page, 'command-ask-page');
  await page.getByTestId('qwin-card-run').click();
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('run:list', { chatId: 'mappa' }))).at(-1)?.state, { timeout: 30_000 }).toBe('ok');
  await app.close();
});

test('when a run of Esegui ends, the chat that proposed it gets the exit code and the output by itself', async () => {
  const { app, page } = await launchDemo({ env: { SB_RUN_RESULTS: '1', SB_RUN_RESULTS_MS: '200' } });
  await expandChats(page, 'mappa'); // the transcript: the strips start collapsed
  await turn(app, 'mappa', ASK);
  await expect(page.getByTestId('qwin-card')).toHaveAttribute('data-kind', 'command');
  await expect(page.getByTestId('qwin-card-lead')).toHaveText(LEAD);
  await page.getByTestId('qwin-card-run').click();
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
