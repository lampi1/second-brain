// E2E of the plain Italian line over every command (frozen demo, dark and light, Claude and Cursor): tool rows say what
// they do ("Legge OrderTotalsService.cs") with the raw command folded under them; permission panels say it on top
// (Bash: the model's description; Cursor: the ACP kind and title) with the raw command one line, unfolded on click.
// Screenshots in test-results/shots/explain-*.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type Demo = { ask(c: string, r: object): void };
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

    // a Claude permission: the description on top, the command under it (in its tile too, never the description alone)
    await expect(page.getByTestId('request-feedback-feedback-p1')).toContainText('npm run test:e2e');
    await page.getByTestId('chat-max-feedback').click();
    const perm = page.getByTestId('request-feedback-feedback-p1');
    await expect(perm.getByTestId('request-feedback-feedback-p1-explain')).toHaveText('Lancia la suite end-to-end');
    await expect(perm.getByTestId('request-feedback-feedback-p1-raw')).toContainText('npm run test:e2e');
    await shot(page, `explain-permission-claude-${scheme}`);
    await page.getByTestId('chat-max-feedback').click();

    // a Cursor permission (ACP kind "Shell" + title) and its tool rows (browser MCP)
    const long = ['$files = Get-ChildItem -Recurse src', '$files | Measure-Object', 'Write-Output fine'].join('\n');
    await ask(app, 'sms', { type: 'permission', tool: 'Shell', title: 'Conta i file sorgente', detail: long, input: { command: long }, noAlways: true });
    await page.getByTestId('chat-max-sms').click();
    const cur = page.getByTestId('maximized').locator('[data-request-key^="sms/"]');
    await expect(cur.locator('[data-testid$="-explain"]')).toHaveText('Conta i file sorgente');
    await expect(cur.locator('[data-testid$="-raw"]')).toContainText('$files = Get-ChildItem');
    await cur.locator('[data-testid$="-raw-toggle"]').click();
    await expect(cur.locator('[data-testid$="-raw"]')).toContainText('Write-Output fine');
    await expect(page.getByTestId('maximized').locator('.tool-line').first()).toContainText('Browser dell’app');
    await shot(page, `explain-cursor-${scheme}`);
    await app.close();
  });
}
