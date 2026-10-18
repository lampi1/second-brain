// Main-only acceptance for the Grindhouse strips (ADR 0068): one column, no drag, the Orchestrator's order kept on reload.
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

async function noOverlap(page: Page) {
  const bounds = await page.locator('[data-workspace-pane]').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  }));
  for (let a = 0; a < bounds.length; a++) for (let b = a + 1; b < bounds.length; b++) {
    const r = bounds[a]!, s = bounds[b]!;
    expect(r.x + r.w <= s.x + 1 || s.x + s.w <= r.x + 1 || r.y + r.h <= s.y + 1 || s.y + s.h <= r.y + 1).toBe(true);
  }
}

const panes = (page: Page) => page.locator('[data-workspace-pane]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-workspace-pane')));

for (const width of [1920, 1280, 800]) test(`strips, expansion and reload stay disjoint at ${width}px`, async () => {
  const { app, page } = await launchDemo({ width });
  try {
    await expect(page.getByTestId('tile-chat-fix')).toBeVisible();
    await expect(page.locator('[data-testid^="workspace-grip-"]')).toHaveCount(0); // no drag: the Orchestrator orders the strips
    await noOverlap(page);
    const order = await panes(page);
    const expand = page.getByTestId('chat-expand-fix');
    const was = await expand.getAttribute('aria-expanded');
    await expand.click(); await expect(expand).not.toHaveAttribute('aria-expanded', was!); await noOverlap(page);
    await expand.click(); await expect(expand).toHaveAttribute('aria-expanded', was!); await noOverlap(page);
    expect(await panes(page)).toEqual(order);
    await page.reload(); await expect(page.getByTestId('tile-chat-fix')).toBeVisible();
    expect(await panes(page)).toEqual(order);
    await noOverlap(page); await shot(page, `agents-strips-${width}`);
  } finally { await app.close(); }
});

test('an offscreen transcript catches up without losing the mounted composer draft', async () => {
  const { app, page } = await launchDemo({ width: 1920 });
  try {
    await page.evaluate(async () => {
      const chat = (await window.sb.invoke('chat:list', undefined)).find(chat => chat.id === 'fix')!;
      for (let i = 0; i < 3; i++) await window.sb.invoke('chat:create', { harness: 'claude', cwd: chat.cwd, title: `Scroll fixture ${i}`, prompt: '' });
    });
    const expand = page.getByTestId('chat-expand-fix');
    if (await expand.getAttribute('aria-expanded') !== 'true') await expand.click();
    const tile = page.getByTestId('tile-chat-fix');
    const transcript = tile.locator('.chat-transcript');
    const scroller = page.getByTestId('brain-page-home'); // the Home's own scroller (.bx-scroll)
    await expect(transcript).toHaveAttribute('data-transcript-visible', 'true');
    await expect(tile.locator('[data-chat-log="fix"]')).toBeVisible();
    expect((await transcript.boundingBox())!.height).toBeGreaterThan(0);
    const input = page.getByTestId('chat-input-fix');
    await input.fill('draft kept while another agent streams');
    await app.evaluate(() => (globalThis as unknown as { __sbDemo: { say(id: string, text: string): void } }).__sbDemo.say('fix', 'visible transcript marker'));
    await expect(tile.locator('[data-chat-log="fix"]')).toContainText('visible transcript marker');
    await scroller.evaluate(body => { body.scrollTop = 0; }); // the strip is low in the list: back at the top it is below the fold
    await expect.poll(() => tile.evaluate(node => node.getBoundingClientRect().top >= node.closest('.bx-scroll')!.getBoundingClientRect().bottom)).toBe(true);
    await expect(transcript).toHaveAttribute('data-transcript-visible', 'false');
    await app.evaluate(() => (globalThis as unknown as { __sbDemo: { say(id: string, text: string): void } }).__sbDemo.say('fix', 'latest message while offscreen'));
    await expect(tile.locator('[data-chat-log="fix"]')).not.toContainText('latest message while offscreen');
    await tile.scrollIntoViewIfNeeded();
    await expect(transcript).toHaveAttribute('data-transcript-visible', 'true');
    await expect(tile.locator('[data-chat-log="fix"]')).toContainText('latest message while offscreen');
    await expect(input).toHaveValue('draft kept while another agent streams');
    await noOverlap(page); await shot(page, 'agents-transcript-catches-up');
  } finally { await app.close(); }
});
