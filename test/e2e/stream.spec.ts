// E2E of live answers in a chat tile (live demo, unfrozen): the assistant text grows in place over several frames,
// tool rows appear running and flip to ok in real time, "sta scrivendo… / sta pensando…" shows while the turn runs and
// hides at the end, and the list never jumps when the user scrolled up to read ("nuove righe" pill instead).
import { expect, test } from '@playwright/test';
import { launchDemo } from './helpers';

test('answers stream in place, tools flip live, the typing line follows the turn', async () => {
  const { app, page } = await launchDemo({ freeze: false });
  await page.getByTestId('folded-mappa').click();
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
  const list = page.getByTestId('tile-chat-sms').locator('.items');
  await expect.poll(async () => list.evaluate(el => el.scrollHeight > el.clientHeight + 40), { timeout: 20_000 }).toBe(true); // the browser loop fills it
  await list.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  const rows = page.getByTestId('tile-chat-sms').locator('.tool');
  const n = await rows.count();
  await expect.poll(async () => rows.count(), { timeout: 10_000 }).toBeGreaterThan(n);
  expect(await list.evaluate(el => el.scrollTop)).toBe(0);
  await expect(page.getByTestId('tile-chat-sms').getByTestId('unseen')).toBeVisible();
  await page.getByTestId('tile-chat-sms').getByTestId('unseen').click();
  await expect.poll(async () => list.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 30)).toBe(true);
  await app.close();
});
