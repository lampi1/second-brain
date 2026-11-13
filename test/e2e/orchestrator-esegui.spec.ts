// E2E of "Esegui" on commands (the user, 2026-10-12: "eseguire i comandi dell'Orchestrator con un click"): a shell block in
// the Orchestrator's own message runs and its outcome goes to the Orchestrator; a work chat's question in the questions window
// brings the commands that chat gave in the same turn, each run as that chat's block (the outcome goes back to it; keys
// inside a block never answer the card), production blocks still asking a second click; a permission never gets them.
// A work chat's request never shows in the Orchestrator (2026-10-13). Screenshots: test-results/shots/orchestrator-esegui-*.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type Demo = { say(c: string, t: string): void };
/** Esegui runs a block in PowerShell 5.1 on Windows and in the user's login shell ($SHELL -lc) on macOS and Linux
 *  (ADR 0054, main/platform.ts userShell): a command is written for the shell that runs it on this machine. */
const echo = (text: string) => (process.platform === 'win32' ? `Write-Output '${text}'` : `echo '${text}'`);
const say = (app: ElectronApplication, chatId: string, text: string) =>
  app.evaluate((_e, [c, t]) => { (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.say(c, t); }, [chatId, text] as const);

test('Esegui in the Orchestrator: its own blocks run as hers', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  const orchestrator = page.getByTestId('tile-orchestrator');
  await say(app, 'orchestrator', `Lancia questo:\n\`\`\`powershell\n${echo('orchestrator ok')}\n\`\`\``);
  const own = orchestrator.locator('.msg-md').getByTestId('codeblock').last();
  await own.getByTestId('cb-exec').click();
  await expect(own.getByTestId('cb-run')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
  await expect(own.getByTestId('cb-out')).toContainText('orchestrator ok');
  expect((await page.evaluate(() => window.sb.invoke('run:list', { chatId: 'orchestrator' }))).at(-1)).toMatchObject({ chatId: 'orchestrator', state: 'ok', exitCode: 0 });
  await expect(own.getByTestId('cb-told')).toHaveAttribute('data-told', '0'); // the Orchestrator waits on her own question: it goes by itself later
  await shot(page, 'orchestrator-esegui-own');
  await app.close();
});
