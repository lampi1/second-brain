// End to end, the DevOps link chips of a chat tile (demo data, frozen): the QA chat talked about a test plan, a bug read
// by the DevOps MCP, two PRs and a build; the header shows four chips (newest first, titles from the tool results and
// the cached DevOps data), the fifth sits in the "+1" menu, and a click hands the link to the system browser (where the
// user is signed in to DevOps; a hidden run only records it, __sbOpened), never an internal tab.
import { test, expect, type ElectronApplication } from '@playwright/test';
import { launchDemo, shot } from './helpers';
// the demo DevOps data's pull request URL (src/main/tasks/demo.ts)
const prUrl = (id: number) => `https://dev.azure.com/o/Shop/_git/shop-web/pullrequest/${id}`;
// what the hidden run would have opened outside the app (main/window.ts hiddenOpened)
const opened = (app: ElectronApplication) => app.evaluate(() => [...((globalThis as unknown as { __sbOpened: string[] }).__sbOpened)]);

test('a chat tile shows its DevOps links as chips; a click opens them in the system browser', async () => {
  test.setTimeout(120_000); // a launch takes 40-50 s on a loaded machine
  const { app, page } = await launchDemo();
  try {
    const chips = page.getByTestId('chat-devlinks-qa');
    await expect(chips).toBeVisible();
    // newest first: the build and the PR of the last message, then the PR and the bug read by the tools
    await expect(chips.locator('.devlink:not(.devlink-more)')).toHaveCount(4);
    await expect(chips.locator('.devlink').first()).toHaveAttribute('data-testid', 'chat-devlink-qa-build-20931');
    // before any DevOps read the PR only in a URL has no title: the type and the id
    await expect(page.getByTestId('chat-devlink-qa-pr-812')).toHaveText('PR812');
    await page.evaluate(() => window.sb.invoke('tasks:refresh', undefined));
    await expect(page.getByTestId('chat-devlink-qa-pr-812')).toContainText('Rimborso: lo sconto in origine entra nel totale');  // cached DevOps data
    await expect(page.getByTestId('chat-devlink-qa-pr-815')).toContainText('Resi: IVA calcolata una volta sola');              // tool result
    await expect(page.getByTestId('chat-devlink-qa-workitem-4720')).toContainText('Bug');
    await expect(page.getByTestId('chat-devlink-qa-workitem-4720')).toContainText('Reso parziale: IVA arrotondata due volte');
    await shot(page, 'devlinks-tile');

    // the oldest (the test plan) is in the "+1" menu
    await page.getByTestId('chat-devlinks-more-qa').click();
    const menu = page.getByTestId('chat-devlinks-menu-qa');
    await expect(menu).toContainText('Test plan 5100');
    await shot(page, 'devlinks-menu');
    await page.keyboard.press('Escape');

    // a click hands the PR to the system browser, from a maximized chat too; no internal tab opens
    const before = (await page.evaluate(() => window.sb.invoke('browser:list', undefined))).length;
    await page.getByTestId('chat-devlink-qa-pr-812').click();
    await expect.poll(() => opened(app)).toContain(`external ${prUrl(812)}`);
    await page.getByTestId('chat-max-qa').click();
    await page.getByTestId('chat-devlink-qa-workitem-4720').click();
    await expect.poll(() => opened(app)).toContain('external https://dev.azure.com/o/Shop/_workitems/edit/4720');
    // the "+1" menu too
    await page.getByTestId('chat-devlinks-more-qa').click();
    await page.getByTestId('chat-devlinks-menu-qa').getByText('Test plan 5100').click();
    await expect.poll(async () => (await opened(app)).some(u => /^external https:\/\/dev\.azure\.com\/o\/Shop\/_testPlans\/.*planId=5100/.test(u))).toBe(true);
    expect((await page.evaluate(() => window.sb.invoke('browser:list', undefined))).length).toBe(before);
  } finally {
    await app.close();
  }
});
