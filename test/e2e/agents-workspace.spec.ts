// Main-only acceptance for row-major mosaic flow and native-view gesture cleanup.
import { expect, test, type Page } from '@playwright/test';
import { demoLayout, launchDemo, shot } from './helpers';

async function noOverlap(page: Page) {
  const bounds = await page.locator('[data-workspace-pane]').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  }));
  for (let a = 0; a < bounds.length; a++) for (let b = a + 1; b < bounds.length; b++) {
    const r = bounds[a]!, s = bounds[b]!;
    expect(r.x + r.w <= s.x + 1 || s.x + s.w <= r.x + 1 || r.y + r.h <= s.y + 1 || s.y + s.h <= r.y + 1).toBe(true);
  }
}

for (const width of [1920, 1280, 800]) test(`grid, expansion and reload stay disjoint at ${width}px`, async () => {
  const { app, page } = await launchDemo({ width });
  try {
    const grip = page.getByTestId('workspace-grip-chat:fix'); await expect(grip).toBeVisible();
    await expect(page.getByRole('separator', { name: 'Ridimensiona pannelli' })).toHaveCount(0);
    await noOverlap(page);
    const first = await page.locator('[data-workspace-pane]').first().boundingBox();
    expect(first!.width).toBeGreaterThanOrEqual(width === 800 ? 300 : 480);
    const expand = page.getByTestId('chat-expand-fix');
    await expand.click(); await expect(expand).toHaveAttribute('aria-expanded', 'true'); await noOverlap(page);
    await expand.click(); await expect(expand).toHaveAttribute('aria-expanded', 'false'); await noOverlap(page);
    const old = await page.locator('[data-workspace-pane]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-workspace-pane')));
    await grip.focus(); await page.keyboard.press('Alt+ArrowRight'); await expect(grip).toBeFocused();
    await expect.poll(() => page.locator('[data-workspace-pane]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-workspace-pane')))).not.toEqual(old);
    const saved = await page.evaluate(() => localStorage.getItem('sb.agents.workspace.v1'));
    const order = await page.locator('[data-workspace-pane]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-workspace-pane')));
    await page.reload(); await expect(grip).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('sb.agents.workspace.v1'))).toBe(saved);
    expect(await page.locator('[data-workspace-pane]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-workspace-pane')))).toEqual(order);
    await noOverlap(page); await shot(page, `agents-grid-${width}`);
  } finally { await app.close(); }
});

test('Escape cancels a pointer gesture and restores native views without persisting a move', async () => {
  const { app, page } = await launchDemo({ width: 1920 });
  try {
    const grip = page.getByTestId('workspace-grip-chat:fix'); await expect(grip).toBeVisible();
    const saved = await page.evaluate(() => localStorage.getItem('sb.agents.workspace.v1'));
    const box = (await grip.boundingBox())!;
    const target = page.locator('[data-workspace-pane]').filter({ hasNot: grip }).first();
    const destination = (await target.boundingBox())!;
    await page.mouse.move(box.x + 8, box.y + 8); await page.mouse.down();
    await page.mouse.move(destination.x + 10, destination.y + 60, { steps: 8 });
    await expect(target).toHaveAttribute('data-drop', 'before');
    await expect.poll(async () => (await demoLayout(app)).every(view => view.rect === null)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('sb.agents.workspace.v1'))).toBe(saved);
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(page.locator('.workspace-dragging')).toHaveCount(0);
    await expect(page.locator('[data-drop]')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('sb.agents.workspace.v1'))).toBe(saved);
    await noOverlap(page); await shot(page, 'agents-grid-drag-cancel');
  } finally { await app.close(); }
});

test('an offscreen transcript catches up without losing the mounted composer draft', async () => {
  const { app, page } = await launchDemo({ width: 1920 });
  try {
    await page.evaluate(async () => {
      const chat = (await window.sb.invoke('chat:list', undefined)).find(chat => chat.id === 'fix')!;
      for (let i = 0; i < 3; i++) await window.sb.invoke('chat:create', { harness: 'claude', cwd: chat.cwd, title: `Scroll fixture ${i}`, prompt: '' });
    });
    await page.getByTestId('chat-expand-fix').click();
    const tile = page.getByTestId('tile-chat-fix');
    const transcript = tile.locator('.chat-transcript');
    await expect(transcript).toHaveAttribute('data-transcript-visible', 'true');
    await expect(tile.locator('[data-chat-log="fix"]')).toBeVisible();
    expect((await transcript.boundingBox())!.height).toBeGreaterThan(0);
    const input = page.getByTestId('chat-input-fix');
    await input.fill('draft kept while another agent streams');
    await app.evaluate(() => (globalThis as unknown as { __sbDemo: { say(id: string, text: string): void } }).__sbDemo.say('fix', 'visible transcript marker'));
    await expect(tile.locator('[data-chat-log="fix"]')).toContainText('visible transcript marker');
    await page.locator('.workspace-canvas').evaluate(canvas => { canvas.scrollTop = canvas.scrollHeight; });
    await expect.poll(() => tile.evaluate(node => node.getBoundingClientRect().bottom <= node.closest('.workspace-canvas')!.getBoundingClientRect().top)).toBe(true);
    await expect(transcript).toHaveAttribute('data-transcript-visible', 'false');
    await app.evaluate(() => (globalThis as unknown as { __sbDemo: { say(id: string, text: string): void } }).__sbDemo.say('fix', 'latest message while offscreen'));
    await expect(tile.locator('[data-chat-log="fix"]')).not.toContainText('latest message while offscreen');
    await page.locator('.workspace-canvas').evaluate(canvas => { canvas.scrollTop = 0; });
    await expect(transcript).toHaveAttribute('data-transcript-visible', 'true');
    await expect(tile.locator('[data-chat-log="fix"]')).toContainText('latest message while offscreen');
    await expect(input).toHaveValue('draft kept while another agent streams');
    await noOverlap(page); await shot(page, 'agents-transcript-catches-up');
  } finally { await app.close(); }
});
