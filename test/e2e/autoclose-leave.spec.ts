// A strip the app closed by itself folds away instead of vanishing in one frame (lib/leave-ghost.ts, owner 2026-10-22:
// «la pulizia delle chat automatica non la vedo fluida»): an anonymous, inert copy stays in its place for a moment and
// goes; a chat the user closed, or any chat under reduced motion, just goes. The closing itself is main's (a tree closes
// from its leaves up, test/unit/chats/auto-close-tree.test.ts); here main's update is injected as it would arrive.
import { expect, test } from '@playwright/test';
import { launchDemo } from './helpers';
import type { ChatSummary } from '../../src/shared/contract';

test('a delegation tree closed by the app leaves anonymous fading copies; a chat closed by the user does not', async () => {
  const { app, page } = await launchDemo({ freeze: false });
  try {
    await app.evaluate(() => (globalThis as unknown as { __sbDemo: { tree(): void } }).__sbDemo.tree());
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.getByTestId('tile-chat-tree-plan')).toBeVisible({ timeout: 15_000 });
    const list = await page.evaluate(() => window.sb.invoke('chat:list', undefined)) as ChatSummary[];
    const tree = list.filter(c => c.id.startsWith('tree-'));
    expect(tree.length).toBeGreaterThan(2);
    const close = (rows: ChatSummary[], by: 'auto' | 'user') => app.evaluate(({ BrowserWindow }, [rs, who]) => {
      const wc = BrowserWindow.getAllWindows()[0]!.webContents;
      for (const r of rs as ChatSummary[]) wc.send('chat:updated', { ...r, closedAt: Date.now(), closedBy: who, state: 'closed' });
    }, [rows, by] as const);

    await close(tree, 'auto');
    await expect(page.getByTestId('tile-chat-tree-plan')).toHaveCount(0);
    const ghosts = page.locator('.leave-ghost');
    await expect(ghosts.first()).toBeAttached();
    expect(await ghosts.evaluateAll(gs => gs.every(g => g.getAttribute('aria-hidden') === 'true' && (g as HTMLElement).inert && !g.querySelector('[data-testid], [data-chat-id], [data-autoclose-id], [data-workspace-pane]')))).toBe(true);
    await expect(ghosts).toHaveCount(0, { timeout: 2_000 });

    await close(list.filter(c => c.id === 'fix'), 'user');
    await expect(page.getByTestId('tile-chat-fix')).toHaveCount(0);
    await expect(ghosts).toHaveCount(0);
  } finally { await app.close(); }
});
