// E2E of the plain Italian line over every command (frozen demo, dark and light, Claude and Cursor): tool rows say what
// they do ("Legge OrderTotalsService.cs") with the raw command folded under them; permissions, in the questions window,
// say it on top (Bash: the model's description; Cursor: the ACP kind and title) with a two-word summary and the raw
// command whole under it.
// Screenshots in test-results/shots/explain-*.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type Demo = { ask(c: string, r: object): void; stop(c: string): Promise<void> };
const ask = (app: ElectronApplication, chatId: string, req: object) =>
  app.evaluate((_e, [c, r]) => { (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.ask(c, r); }, [chatId, req] as const);

for (const scheme of ['dark', 'light'] as const) {
  test(`every command says what it does, the raw command folded under it (${scheme})`, async () => {
    const { app, page } = await launchDemo({ scheme });
    if (scheme === 'light') await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    // Claude tool rows
    await page.getByTestId('chat-max-fix').click();
    await expect(page.getByTestId('tool-line-fix-t1')).toHaveText('Legge OrderTotalsService.cs');
    await page.getByTestId('tool-toggle-fix-t1').click();
    await expect(page.getByTestId('tool-raw-fix-t1')).toContainText('OrderTotalsService.cs');
    await shot(page, `explain-tools-${scheme}`);
    await page.getByTestId('chat-max-fix').click();

    // a Claude permission: the description on top, its two-word summary, the command whole under it (the questions
    // window; the other demo requests leave so it is the one shown)
    for (const id of ['orchestrator', 'qa']) await app.evaluate((_e, c) => (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.stop(c), id);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+J');
    await expect(page.getByTestId('qwin-card')).toHaveAttribute('data-request-key', 'feedback/feedback-p1');
    await expect(page.getByTestId('qwin-card-explain')).toHaveText('Lancia la suite end-to-end');
    await expect(page.getByTestId('qwin-card-gist')).toHaveText('Esegue test');
    await expect(page.getByTestId('qwin-card-raw')).toContainText('npm run test:e2e');
    await page.mouse.move(2, 2);
    await shot(page, `explain-permission-claude-${scheme}`);
    await page.getByTestId('qwin-later').click();

    // a Cursor permission (ACP kind "Shell" + title): the whole script under it; then its tool rows (browser MCP)
    const long = ['$files = Get-ChildItem -Recurse src', '$files | Measure-Object', 'Write-Output fine'].join('\n');
    await ask(app, 'sms', { type: 'permission', tool: 'Shell', title: 'Conta i file sorgente', detail: long, input: { command: long }, noAlways: true });
    const cur = page.getByTestId('qwin-card');
    await expect(cur).toHaveAttribute('data-request-key', /^sms\//);
    await expect(page.getByTestId('qwin-card-explain')).toHaveText('Conta i file sorgente');
    await expect(page.getByTestId('qwin-card-raw')).toContainText('$files = Get-ChildItem');
    await expect(page.getByTestId('qwin-card-raw')).toContainText('Write-Output fine');
    await page.mouse.move(2, 2);
    await shot(page, `explain-cursor-permission-${scheme}`);
    await page.getByTestId('qwin-later').click();
    await page.getByTestId('chat-max-sms').click();
    await expect(page.getByTestId('maximized').locator('.tool-line').first()).toContainText('Browser dell’app');
    await shot(page, `explain-cursor-${scheme}`);
    await app.close();
  });
}
