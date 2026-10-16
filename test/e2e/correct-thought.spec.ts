// End to end: "Correggi il pensiero" (ADR 0058) with the real chat UI and the fake engines. A turn streams its reasoning;
// the user selects a sentence of it, clicks "No, così", writes the fix: Correggi interrupts the turn and the correction
// (the sentence quoted) runs next, shown as its own bubble, the sentence marked in the reasoning; on Claude, Maiusc+Invio
// sends it into the running turn instead (no interrupt); an open question or permission refuses it with the reason;
// Cursor offers only Correggi. Screenshots: test-results/shots/correct-thought-<engine>-form.png, -done.png,
// correct-thought-claude-step.png, correct-thought-blocked.png.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatItem, ChatSummary } from '../../src/shared/contract';
import { correctionText } from '../../src/renderer/lib/correction';
import { launch, setSize, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures');
const SENTENCE = 'Penso di usare la libreria vecchia.';
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const fakes = (ticks: number) => ({
  SB_CLAUDE_PATH: path.join(FIX, 'fake-claude.mjs'), CLAUDE_CONFIG_DIR: tmp('sb-e2e-claude-'), FAKE_CLAUDE_DELAY: '60', FAKE_CLAUDE_SLOW_TICKS: String(ticks),
  SB_CURSOR_PATH: path.join(FIX, 'fake-cursor-acp.mjs'), FAKE_CURSOR_DELAY: '60', FAKE_CURSOR_THINK_TICKS: String(ticks), CURSOR_CONFIG_DIR: tmp('sb-e2e-cursor-user-'),
});

const itemsOf = (page: Page, id: string) => page.evaluate(c => window.sb.invoke('chat:items', { chatId: c }), id) as Promise<ChatItem[]>;
const usersOf = async (page: Page, id: string) => (await itemsOf(page, id)).filter(i => i.kind === 'user').map(i => (i as { text: string }).text);
const resultsOf = async (page: Page, id: string) => (await itemsOf(page, id)).filter(i => i.kind === 'result').map(i => !!(i as { interrupted?: boolean }).interrupted);
/** Whether a turn ended after the correction was sent (its result follows the correction's user item). Waiting on the
 *  tile's "idle" alone is not enough: under load the tile can still show the idle that came before the correction. */
const endedAfter = async (page: Page, id: string, text: string) => {
  const items = await itemsOf(page, id);
  const at = items.findIndex(i => i.kind === 'user' && (i as { text: string }).text === text);
  return at >= 0 && items.slice(at + 1).some(i => i.kind === 'result');
};

/** Opens the chat's first reasoning block and selects SENTENCE in it, as a mouse would (press, select, release). */
async function selectSentence(page: Page, chatId: string): Promise<void> {
  const tile = page.getByTestId(`tile-chat-${chatId}`);
  await expect(tile.getByTestId('thinking-toggle').first()).toBeVisible({ timeout: 15000 });
  const toggle = tile.getByTestId('thinking-toggle').first();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const box = tile.getByTestId('thinking-text').first();
  await expect(box).toContainText(SENTENCE);
  await box.evaluate((el, s) => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const at = n.textContent?.indexOf(s) ?? -1;
      if (at < 0) continue;
      const r = document.createRange();
      r.setStart(n, at); r.setEnd(n, at + s.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges(); sel.addRange(r);
      break;
    }
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, SENTENCE);
}

for (const engine of ['claude', 'cursor'] as const) {
  test(`${engine}: Correggi stops the turn and runs the correction, quoted, as the next turn`, async () => {
    const { app, page } = await launch(fakes(400));
    await setSize(app, 1400, 900);
    const chat: ChatSummary = await page.evaluate(([h, dir]) => window.sb.invoke('chat:create', { harness: h, cwd: dir, prompt: 'think', title: 'Pensiero' }), [engine, tmp('sb-e2e-cwd-')] as const);
    await expect(page.getByTestId(`chat-state-${chat.id}`)).toHaveAttribute('data-state', 'running', { timeout: 15000 });

    await selectSentence(page, chat.id);
    await page.getByTestId('thought-pick').click();
    await expect(page.getByTestId('thought-fix')).toContainText(SENTENCE);
    // Cursor takes no message mid-turn: only Correggi
    await expect(page.getByTestId('thought-fix-step')).toHaveCount(engine === 'claude' ? 1 : 0);
    await page.getByTestId('thought-fix-input').fill('usa la libreria nuova');
    await shot(page, `correct-thought-${engine}-form`);
    await page.getByTestId('thought-fix-input').press('Enter');

    const sent = correctionText(SENTENCE, 'usa la libreria nuova');
    await expect.poll(() => usersOf(page, chat.id), { timeout: 20000 }).toEqual(['think', sent]);
    await expect.poll(() => endedAfter(page, chat.id, sent), { timeout: 30000 }).toBe(true);
    await expect(page.getByTestId(`chat-state-${chat.id}`)).toHaveAttribute('data-state', 'idle', { timeout: 30000 });
    expect(await resultsOf(page, chat.id)).toEqual([true, false]); // the stopped turn, then the correction's own
    await expect(page.getByTestId('thought-fix')).toHaveCount(0);
    await expect(page.getByTestId('correction-bubble')).toContainText('usa la libreria nuova');
    await expect(page.getByTestId(`tile-chat-${chat.id}`).locator('.thought-fixed').first()).toHaveText(SENTENCE);
    await shot(page, `correct-thought-${engine}-done`);
    await app.close();
  });
}

test('claude: Maiusc+Invio sends the correction into the running turn, nothing is interrupted', async () => {
  const { app, page } = await launch(fakes(60));
  await setSize(app, 1400, 900);
  const chat: ChatSummary = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'think', title: 'Passo' }), tmp('sb-e2e-cwd-'));
  await expect(page.getByTestId(`chat-state-${chat.id}`)).toHaveAttribute('data-state', 'running', { timeout: 15000 });
  await selectSentence(page, chat.id);
  await page.keyboard.press('Control+Shift+X'); // the shortcut opens the same form
  await page.getByTestId('thought-fix-input').fill('controlla prima i test');
  await page.getByTestId('thought-fix-input').press('Shift+Enter');
  const sent = correctionText(SENTENCE, 'controlla prima i test');
  await expect.poll(() => usersOf(page, chat.id), { timeout: 20000 }).toEqual(['think', sent]);
  await expect.poll(() => endedAfter(page, chat.id, sent), { timeout: 30000 }).toBe(true);
  await expect(page.getByTestId(`chat-state-${chat.id}`)).toHaveAttribute('data-state', 'idle', { timeout: 30000 });
  expect(await resultsOf(page, chat.id)).not.toContain(true);
  await shot(page, 'correct-thought-claude-step');
  await app.close();
});

test('an open question refuses the correction with the reason, and nothing is sent', async () => {
  const { app, page } = await launch(fakes(3));
  await setSize(app, 1400, 900);
  const chat: ChatSummary = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'think', title: 'Domanda' }), tmp('sb-e2e-cwd-'));
  await expect(page.getByTestId(`chat-state-${chat.id}`)).toHaveAttribute('data-state', 'idle', { timeout: 20000 });
  await page.evaluate(id => window.sb.invoke('chat:send', { chatId: id, text: 'ask' }), chat.id);
  await expect(page.getByTestId(`chat-state-${chat.id}`)).toHaveAttribute('data-state', 'waiting', { timeout: 15000 });
  await selectSentence(page, chat.id);
  await page.getByTestId('thought-pick').click();
  await page.getByTestId('thought-fix-input').fill('no');
  await expect(page.getByTestId('thought-fix-why')).toContainText('rispondi prima al pannello');
  await expect(page.getByTestId('thought-fix-stop')).toBeDisabled();
  await shot(page, 'correct-thought-blocked');
  expect(await usersOf(page, chat.id)).toEqual(['think', 'ask']);
  await app.close();
});
