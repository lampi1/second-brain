// E2E of live answers in a chat tile (live demo, unfrozen): the assistant text grows in place over several frames,
// tool rows appear running and flip to ok in real time, "sta scrivendo… / sta pensando…" shows while the turn runs and
// hides at the end, the list never jumps when the user scrolled up to read ("nuove righe" pill instead), and a list
// at the bottom stays there however fast the content grows; a small (compact) tile shows the typing line too; the
// alive marks (dots, spinner) step from lib/beat.ts.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('answers stream in place, tools flip live, the typing line follows the turn', async () => {
  const { app, page } = await launchDemo({ freeze: false });
  const tile = page.getByTestId('tile-chat-mappa');
  await page.getByTestId('chat-input-mappa').fill('Aggiungi la legenda');
  await page.getByTestId('chat-input-mappa').press('Enter');
  await expect(page.getByTestId('typing-mappa')).toBeVisible(); // the turn runs
  // the text grows in place over several frames (one item, longer and longer)
  await expect(tile.locator('.md.streaming')).toHaveCount(1, { timeout: 8000 });
  const lengths = await page.evaluate(async () => {
    const out: number[] = [];
    for (let i = 0; i < 40; i++) {
      const el = document.querySelector('[data-testid="tile-chat-mappa"] .md.streaming');
      out.push(el?.textContent?.length ?? -1);
      await new Promise(r => requestAnimationFrame(() => r(null)));
    }
    return out;
  });
  const grown = lengths.filter(n => n > 0);
  expect(new Set(grown).size).toBeGreaterThan(2);
  expect(grown[grown.length - 1]!).toBeGreaterThan(grown[0]!);
  // the tool row appears running and turns ok
  const running = tile.locator('[data-testid^="tool-"][data-status="running"]');
  await expect(running).toHaveCount(1, { timeout: 8000 });
  await expect(page.getByTestId('typing-mappa')).toHaveAttribute('data-what', 'lavora');
  const id = await running.getAttribute('data-testid');
  await expect(page.getByTestId(id!)).toHaveAttribute('data-status', 'ok', { timeout: 8000 });
  // the turn ends: the typing line goes away
  await expect(page.getByTestId('chat-state-mappa')).toHaveAttribute('data-state', 'idle', { timeout: 10_000 });
  await expect(page.getByTestId('typing-mappa')).toHaveCount(0);
  await app.close();
});

test('scrolled up to read, the list does not jump: a "nuove righe" pill appears', async () => {
  const { app, page } = await launchDemo({ freeze: false });
  await page.getByTestId('chat-max-sms').click();
  const list = page.getByTestId('tile-chat-sms').locator('.items');
  await expect.poll(async () => list.evaluate(el => el.scrollHeight > el.clientHeight + 40), { timeout: 20_000 }).toBe(true); // the browser loop fills it
  await list.hover();
  await page.mouse.wheel(0,-10000);
  await expect.poll(()=>list.evaluate(el=>el.scrollTop)).toBe(0);
  const rows = page.getByTestId('tile-chat-sms').locator('.tool');
  const n = await rows.count();
  await expect.poll(async () => rows.count(), { timeout: 10_000 }).toBeGreaterThan(n);
  expect(await list.evaluate(el => el.scrollTop)).toBe(0);
  await expect(page.getByTestId('tile-chat-sms').getByTestId('unseen')).toBeVisible();
  await page.getByTestId('tile-chat-sms').getByTestId('unseen').click();
  await expect.poll(async () => list.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 30)).toBe(true);
  await app.close();
});

test('at the bottom, the list stays there while content grows frame after frame (its own scroll never detaches it)', async () => {
  const { app, page } = await launchDemo({ freeze: false });
  await page.getByTestId('chat-max-sms').click();
  const tile = page.getByTestId('tile-chat-sms');
  const list = tile.locator('.items');
  await expect.poll(async () => list.evaluate(el => el.scrollHeight > el.clientHeight + 40), { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => list.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 24)).toBe(true);
  // a paragraph (30 px) lands right after each frame's follow pass, so the scroll event of that pass sees new content
  // below it: like a busy PC streaming several chats
  await list.evaluate(async el => {
    for (let i = 0; i < 20; i++) {
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
      const p = document.createElement('div');
      p.style.flex = '0 0 30px'; // the list is a flex column: a plain height would shrink
      el.querySelector('.items-content')!.appendChild(p);
    }
    for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  });
  expect(await list.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(24);
  await expect(tile.getByTestId('unseen')).toHaveCount(0);
  await app.close();
});

test('a small (compact) tile shows the typing line while its chat works', async () => {
  const { app, page } = await launchDemo({ width: 1000, height: 640 }); // two rows of chats
  // without the needs lane the chat zone never gets that short at the window's minimum size: shrink it to test the tile
  await page.addStyleTag({ content: '[data-testid="tile-chat-fix"] { height:220px !important; max-height:220px !important; }' });
  const tile = page.getByTestId('tile-chat-fix');
  await expect(tile).toHaveClass(/\bcompact\b/);
  await expect(tile.getByTestId('chat-last-fix')).toBeVisible();
  await expect(tile.getByTestId('typing-fix')).toBeVisible(); // the demo's "fix" chat is running
  await shot(page, 'compact-typing');
  await app.close();
});

// "Lag nell'app" (2026-10-12): the alive marks of a running turn (typing dots, tool spinner, state dot) step twice a
// second from lib/beat.ts instead of 60 fps CSS animations; with reduced motion they stand still.
test('a running turn\'s dots and spinner step twice a second, and stand still with reduced motion', async () => {
  const { app, page } = await launchDemo({ freeze: false });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByTestId('chat-input-mappa').fill('Aggiungi la legenda');
  await page.getByTestId('chat-input-mappa').press('Enter');
  await expect(page.getByTestId('typing-mappa')).toBeVisible();
  // no infinite CSS animation runs on the page: the marks are still between steps
  expect(await page.evaluate(() => document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations === Infinity).length)).toBe(0);
  const steps = await page.evaluate(async () => {
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) { seen.push(document.documentElement.getAttribute('data-b3') ?? '-'); await new Promise(r => setTimeout(r, 500)); }
    return seen;
  });
  expect(new Set(steps.filter(s => s !== '-')).size).toBeGreaterThanOrEqual(2); // the dots light in turn
  const dots = page.getByTestId('typing-mappa').locator('.typing-dots i');
  await expect.poll(async () => (await dots.evaluateAll(els => els.map(e => getComputedStyle(e).opacity))).filter(o => o === '1').length).toBe(1);
  await shot(page, 'stream-alive-marks');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html[data-b3]')).toHaveCount(0);
  await expect.poll(async () => (await dots.evaluateAll(els => els.map(e => getComputedStyle(e).opacity))).filter(o => o === '1').length).toBe(0);
  await app.close();
});
