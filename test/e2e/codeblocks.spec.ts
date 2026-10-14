// E2E of the code blocks in chat messages (frozen demo, dark and light, a Claude and a Cursor chat): "Copia" on every
// block, "Esegui" only on shell blocks; a click runs the block in PowerShell 5.1 inside the app with the live output
// under it and the exit code; "Rimanda l'esito" sends it again (it already goes by itself); a production block asks a second click
// (never clicked here). A text for colleagues (```mail, md, teams, comment) shows formatted and Copia puts HTML + the
// markdown on the system clipboard (read back here: the spec is in playwright.config.ts EXCLUSIVE).
// Screenshots in test-results/shots/codeblock-*.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type Demo = { say(c: string, t: string): void };
/** The HTML on the system clipboard ('' if none), through Electron 44's async clipboard.read (no readHTML any more). */
const readHtml = (app: ElectronApplication) => app.evaluate(async ({ clipboard }) => {
  const item = (await clipboard.read()).find(i => i.types.includes('text/html'));
  return item ? ((await item.getType('text/html')) as Blob).text() : '';
});
const say = (app: ElectronApplication, chatId: string, text: string) =>
  app.evaluate((_e, [c, t]) => { (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.say(c, t); }, [chatId, text] as const);

const MSG = [
  'Per verificare lancia questo:',
  '```powershell',
  "Write-Output 'controllo ok'",
  'Get-Date -Format yyyy',
  '```',
  'Il file di configurazione è questo:',
  '```json',
  '{ "port": 4329 }',
  '```',
].join('\n');

for (const scheme of ['dark', 'light'] as const) {
  test(`code blocks: Copia everywhere, Esegui on shell blocks, output and outcome to the chat (${scheme})`, async () => {
    const { app, page } = await launchDemo({ scheme });
    if (scheme === 'light') await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await say(app, 'qa', MSG);
    await page.getByTestId('chat-max-qa').click();
    const tile = page.getByTestId('maximized');
    const blocks = tile.getByTestId('codeblock');
    await expect(blocks).toHaveCount(2);
    const ps = blocks.nth(0), json = blocks.nth(1);
    await expect(ps.getByTestId('cb-copy')).toBeVisible();
    await expect(json.getByTestId('cb-copy')).toBeVisible();
    await expect(json.getByTestId('cb-exec')).toHaveCount(0); // not a shell block
    await json.getByTestId('cb-copy').click();
    await expect(json.getByTestId('cb-copy')).toContainText('Copiato');

    await ps.getByTestId('cb-exec').click();
    const run = ps.getByTestId('cb-run');
    await expect(run).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
    await expect(run).toHaveAttribute('data-exit', '0');
    await expect(ps.getByTestId('cb-out')).toContainText('controllo ok');
    await expect(ps.getByTestId('cb-run-status')).toContainText('exit 0');
    await shot(page, `codeblock-run-${scheme}`);
    // the QA chat waits on a question: the outcome goes to it by itself when it is free (no manual send meanwhile:
    // it would arrive twice)
    await expect(ps.getByTestId('cb-told')).toHaveAttribute('data-told', '0');
    await expect(ps.getByTestId('cb-report')).toHaveCount(0);

    // the chat can read it too (read-only, through the runs list the app MCP tool app_command_runs serves)
    const runs = await page.evaluate(() => window.sb.invoke('run:list', { chatId: 'qa' }));
    expect(runs.at(-1)).toMatchObject({ chatId: 'qa', state: 'ok', exitCode: 0 });

    // a block that looks like production: a red badge, the first click only asks to confirm
    await say(app, 'qa', 'Questo lo lanci tu:\n```bash\naz webapp restart -n app-prod -g rg-prod\n```');
    const prod = tile.getByTestId('codeblock').last();
    await expect(prod.getByTestId('cb-prod')).toBeVisible();
    await prod.getByTestId('cb-exec').click();
    await expect(prod.getByTestId('cb-exec')).toContainText('Confermi?');
    await expect(prod.getByTestId('cb-run')).toHaveCount(0);
    await shot(page, `codeblock-prod-${scheme}`);
    await page.getByTestId('chat-max-qa').click();

    // a Cursor chat: the same toolbar, and a failing command shows its exit code
    await say(app, 'sms', 'Prova:\n```bash\ncmd /c exit 4\n```');
    await page.getByTestId('chat-max-sms').click();
    const cur = page.getByTestId('maximized').getByTestId('codeblock').last();
    await cur.getByTestId('cb-exec').click();
    await expect(cur.getByTestId('cb-run')).toHaveAttribute('data-state', 'error', { timeout: 30_000 });
    await expect(cur.getByTestId('cb-run')).toHaveAttribute('data-exit', '4');
    await shot(page, `codeblock-cursor-${scheme}`);
    await app.close();
  });
}

const MAIL = [
  'Ecco la mail per Sam:',
  '```mail',
  'Hi Sam,',
  '',
  'the fix is **ready** for QA:',
  '',
  '- open the [PR](https://example.com/pr/1)',
  '- run test case `TC-12`',
  '',
  'Thanks, *Alex*',
  '```',
].join('\n');
/** What the block holds: the lines between the fences. */
const MAIL_TEXT = MAIL.split('\n').slice(2, -1).join('\n');

for (const scheme of ['dark', 'light'] as const) {
  test(`a text for colleagues shows formatted and Copia copies HTML + markdown (${scheme})`, async () => {
    const { app, page } = await launchDemo({ scheme });
    if (scheme === 'light') await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await say(app, 'qa', MAIL);
    await page.getByTestId('chat-max-qa').click();
    const block = page.getByTestId('maximized').getByTestId('codeblock').last();
    await expect(block).toHaveAttribute('data-lang', 'mail');
    await expect(block.locator('.cb-lang')).toHaveText('testo formattato');
    const rich = block.getByTestId('cb-rich');
    await expect(rich.locator('strong')).toHaveText('ready');
    await expect(rich.locator('li')).toHaveCount(2);
    await expect(rich.locator('a')).toHaveAttribute('href', 'https://example.com/pr/1');
    await expect(block.locator('pre')).toHaveCount(0);
    // it reads as text, not as code: the paragraph font is the message's, not the monospace one
    const font = await rich.locator('p').first().evaluate(el => getComputedStyle(el).fontFamily);
    expect(font).not.toMatch(/mono|consolas|courier/i);
    await shot(page, `codeblock-rich-${scheme}`);

    await app.evaluate(({ clipboard }) => clipboard.clear());
    await block.getByTestId('cb-copy').click();
    await expect(block.getByTestId('cb-copy')).toContainText('Copiato');
    await expect.poll(() => readHtml(app)).toContain('<strong>ready</strong>');
    const html = await readHtml(app);
    expect(html).toContain('<li>open the <a href="https://example.com/pr/1">PR</a></li>');
    expect(html).toContain('<code>TC-12</code>');
    expect(html).toContain('<em>Alex</em>');
    expect(html).not.toMatch(/target=|rel=|data-copy|<pre/);
    // a plain editor gets the markdown as written
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(MAIL_TEXT);
    await app.close();
  });
}
