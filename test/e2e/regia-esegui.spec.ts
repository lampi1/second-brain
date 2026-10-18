// E2E of "Esegui" on commands (the user, 2026-10-12: "eseguire i comandi della Regia con un click"): a shell block in
// the Regia's own message runs and its outcome goes to the Regia; a work chat's question in the questions window
// brings the commands that chat gave in the same turn, each run as that chat's block (the outcome goes back to it; keys
// inside a block never answer the card), production blocks still asking a second click; a permission never gets them.
// A work chat's request never shows in the Regia (2026-10-13). Screenshots: test-results/shots/regia-esegui-*.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { expandChats, launchDemo, shot } from './helpers';

type Demo = { say(c: string, t: string): void };
const say = (app: ElectronApplication, chatId: string, text: string) =>
  app.evaluate((_e, [c, t]) => { (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.say(c, t); }, [chatId, text] as const);

test('Esegui in the Regia: its own blocks run as hers', async () => {
  const { app, page } = await launchDemo({ regia: true });
  const regia = page.getByTestId('tile-regia');
  await say(app, 'regia', "Lancia questo:\n```powershell\nWrite-Output 'regia ok'\n```");
  const own = regia.locator('.msg-md').getByTestId('codeblock').last();
  await own.getByTestId('cb-exec').click();
  await expect(own.getByTestId('cb-run')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
  await expect(own.getByTestId('cb-out')).toContainText('regia ok');
  expect((await page.evaluate(() => window.sb.invoke('run:list', { chatId: 'regia' }))).at(-1)).toMatchObject({ chatId: 'regia', state: 'ok', exitCode: 0 });
  await expect(own.getByTestId('cb-told')).toHaveAttribute('data-told', '0'); // the Regia waits on her own question: it goes by itself later
  await shot(page, 'regia-esegui-own');
  await app.close();
});

test('the questions window: a work chat\'s question brings the commands of its turn, with Esegui', async () => {
  const { app, page } = await launchDemo({ config: { questionsModal: true } });
  await say(app, 'qa', "Prima di rispondere lancia:\n```powershell\nWrite-Output 'qa ok'\n```\nE questo lo lanci tu:\n```bash\naz webapp restart -n app-prod -g rg-prod\n```");
  await expect(page.getByTestId('qwin')).toBeVisible(); // the demo's requests, the Regia's first
  await page.keyboard.press('Escape'); // set aside, then QA's question called from its tile's line
  await expandChats(page, 'qa'); // the line is on the open strip
  await page.getByTestId('chat-queued-qa-open').click();
  await expect(page.getByTestId('qwin-chat')).toHaveText('QA · Rimborsi');
  const card = page.getByTestId('qwin-card');
  const cmds = page.getByTestId('qwin-card-cmds').getByTestId('codeblock');
  await expect(cmds).toHaveCount(2);
  // Tab from the card reaches an option before any command's Esegui (Tab, Enter never runs a command by mistake)
  await card.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('qwin-card-opt-1')).toBeFocused();
  await cmds.first().getByTestId('cb-exec').click();
  await expect(cmds.first().getByTestId('cb-run')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
  await expect(cmds.first().getByTestId('cb-out')).toContainText('qa ok');
  expect((await page.evaluate(() => window.sb.invoke('run:list', { chatId: 'qa' }))).at(-1)).toMatchObject({ chatId: 'qa', state: 'ok', exitCode: 0 });
  // keys inside the output are the block's own: a digit or Enter there never answers the question
  await cmds.first().getByTestId('cb-out').focus();
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await expect(card).not.toHaveClass(/\bsent\b/);
  await expect(page.getByTestId('qwin-card-opt-1')).toBeEnabled();
  await expect(cmds.first().getByTestId('cb-told')).toHaveAttribute('data-told', '0'); // back to the QA chat by itself, when it is free
  // a production block: the first click only asks to confirm (never clicked twice here)
  await expect(cmds.last().getByTestId('cb-prod')).toBeVisible();
  await cmds.last().getByTestId('cb-exec').click();
  await expect(cmds.last().getByTestId('cb-exec')).toContainText('Confermi?');
  await expect(cmds.last().getByTestId('cb-run')).toHaveCount(0);
  await expect(page.getByTestId('qwin-card-opt-1')).toBeVisible(); // the choices are still there
  await page.mouse.move(2, 2);
  await shot(page, 'regia-esegui-work-chat');
  // a permission: its command is the agent's own, approved, never offered to run
  await say(app, 'feedback', "Lancio i test:\n```bash\nnpm run test:e2e\n```");
  await page.keyboard.press('Escape');
  await expandChats(page, 'feedback'); // the line is on the open strip
  await page.getByTestId('chat-queued-feedback-open').click();
  await expect(page.getByTestId('qwin-chat')).toHaveText('App · Feedback');
  await expect(page.getByTestId('qwin-card-cmds')).toHaveCount(0);
  await app.close();
});
