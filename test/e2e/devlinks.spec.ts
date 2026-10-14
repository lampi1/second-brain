// End to end, the DevOps link chips of a chat tile (demo data, frozen): the QA chat talked about a test plan, a bug read
// by the DevOps MCP, two PRs and a build; the header shows four chips (newest first, titles from the tool results and
// the cached DevOps data), the fifth sits in the "+1" menu, and a click opens the link in the internal browser.
import { test, expect } from '@playwright/test';
import { launchDemo, shot } from './helpers';
// the demo DevOps data's pull request URL (src/main/devops/demo.ts)
const prUrl = (id: number) => `https://dev.azure.com/o/Shop/_git/shop-web/pullrequest/${id}`;

test('a chat tile shows its DevOps links as chips; a click opens them in the internal browser', async () => {
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
    await page.evaluate(() => window.sb.invoke('devops:refresh', undefined));
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

    // a click opens the PR in a new internal browser tab
    const before = (await page.evaluate(() => window.sb.invoke('browser:list', undefined))).length;
    await page.getByTestId('chat-devlink-qa-pr-812').click();
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('browser:list', undefined))).map(t => t.url))
      .toContain(prUrl(812));
    expect((await page.evaluate(() => window.sb.invoke('browser:list', undefined))).length).toBe(before + 1);
  } finally {
    await app.close();
  }
});
