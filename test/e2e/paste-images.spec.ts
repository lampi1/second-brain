// End to end: screenshots pasted (Ctrl+V → a paste event carrying image files, like Windows' Win+Shift+S) or dropped on
// a chat input, with the real UI and the fake engines (Claude stream-json, Cursor ACP): previews above the input, click
// to enlarge, ✕ to remove, sent with the message (also when queued) as image blocks; the history shows them. Also the
// Orchestrator overlay (Ctrl+R) (demo). A fresh Win+Shift+S screenshot the paste event does not carry is read by main (its
// clipboard here the in-memory one of SB_TEST). The system clipboard is never touched (synthetic paste events only).
// Screenshots: test-results/shots/paste-images-<engine>-*.png, paste-images-orchestrator.png, paste-images-fresh-screenshot*.png.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatSummary } from '../../src/shared/contract';
import { closeSetup, expandChats, launch, launchDemo, setSize, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures');

/** Pastes (or drops) n generated PNG screenshots on the element with this test id; text: also plain text on the
 *  clipboard, like Excel (cells as text plus a picture of them). */
async function putImages(page: Page, testid: string, n: number, how: 'paste' | 'drop', hue = 210, text = ''): Promise<void> {
  await page.evaluate(async ([id, count, mode, h, txt]) => {
    const dt = new DataTransfer();
    if (txt) dt.setData('text/plain', txt);
    for (let i = 0; i < count; i++) {
      const c = new OffscreenCanvas(960, 600);
      const g = c.getContext('2d')!;
      g.fillStyle = `hsl(${h + i * 40} 55% 42%)`;
      g.fillRect(0, 0, 960, 600);
      g.fillStyle = '#fff';
      g.font = 'bold 64px sans-serif';
      g.fillText(`Screenshot ${i + 1}`, 60, 320);
      const blob = await c.convertToBlob({ type: 'image/png' });
      dt.items.add(new File([blob], `shot-${i + 1}.png`, { type: 'image/png' }));
    }
    const ta = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
    if (mode === 'paste') { ta.focus(); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }
    else ta.closest('.composer-box')!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [testid, n, how, hue, text] as const);
}

for (const engine of ['claude', 'cursor'] as const) {
  test(`${engine}: pasted and dropped screenshots show as previews and go to the engine with the message, queued too`, async () => {
    const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
    const cwd = tmp('sb-e2e-cwd-');
    const logDir = tmp('sb-e2e-log-');
    const claudeLog = path.join(logDir, 'claude.jsonl'), cursorLogFile = path.join(logDir, 'cursor.jsonl');
    const { app, page } = await launch({
      SB_CLAUDE_PATH: path.join(FIX, 'fake-claude.mjs'), CLAUDE_CONFIG_DIR: tmp('sb-e2e-claude-'), FAKE_CLAUDE_LOG: claudeLog, FAKE_CLAUDE_DELAY: '40', FAKE_CLAUDE_SLOW_TICKS: '5000',
      SB_CURSOR_PATH: path.join(FIX, 'fake-cursor-acp.mjs'), CURSOR_CONFIG_DIR: tmp('sb-e2e-cursor-user-'), FAKE_CURSOR_LOG: cursorLogFile, FAKE_CURSOR_DELAY: '40', FAKE_CURSOR_SLOW_TICKS: '5000',
    });
    await setSize(app, 1400, 900);
    const chat: ChatSummary = await page.evaluate(([h, dir]) => window.sb.invoke('chat:create', { harness: h, cwd: dir, title: 'Screenshot' }), [engine, cwd] as const);
    const input = `chat-input-${chat.id}`;
    await closeSetup(page);
    await expandChats(page, chat.id);
    await expect(page.getByTestId(input)).toBeVisible();

    // Ctrl+V of two screenshots, then one dropped: three previews; the second goes away with its ✕
    await putImages(page, input, 2, 'paste');
    await expect(page.getByTestId(`${input}-images-1`)).toBeVisible();
    await putImages(page, input, 1, 'drop', 20);
    await expect(page.getByTestId(`${input}-images-2`)).toBeVisible();
    await page.getByTestId(`${input}-images-1-remove`).click();
    await expect(page.getByTestId(`${input}-images`).locator('.img-thumb')).toHaveCount(2);
    // a paste with text too (Excel: cells as text + a picture of them) stays a text paste: no preview is added
    await page.getByTestId(input).focus();
    await putImages(page, input, 1, 'paste', 60, 'A1 B1');
    await expect(page.getByTestId(`${input}-images`).locator('.img-thumb')).toHaveCount(2);
    await page.getByTestId(input).fill('cosa vedi in questi screenshot?');
    await shot(page, `paste-images-${engine}-composer`);
    // click → big view, Esc closes it
    await page.getByTestId(`${input}-images-0`).locator('.img-thumb-open').click();
    await expect(page.getByTestId(`${input}-images-viewer`)).toBeVisible();
    await shot(page, `paste-images-${engine}-viewer`);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId(`${input}-images-viewer`)).toHaveCount(0);

    await page.getByTestId(input).press('Enter');
    await expect(page.getByTestId(`${input}-images`)).toHaveCount(0);
    const sent = async (): Promise<string[][]> => {
      if (engine === 'claude') return fs.existsSync(claudeLog) ? fs.readFileSync(claudeLog, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { blocks?: string[] }).flatMap(l => (l.blocks ? [l.blocks.map(b => b.split(':').slice(0, 3).join(':'))] : [])) : [];
      return fs.existsSync(cursorLogFile) ? fs.readFileSync(cursorLogFile, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { method?: string; params?: { prompt?: { type: string; mimeType?: string }[] } }).filter(l => l.method === 'session/prompt').map(l => (l.params?.prompt ?? []).map(b => (b.type === 'image' ? `image:${b.mimeType}` : b.type))) : [];
    };
    const img = engine === 'claude' ? 'image:base64:image/png' : 'image:image/png';
    await expect.poll(sent, { timeout: 15000 }).toEqual([[img, img, 'text']]);
    // the history shows the message with its previews
    const bubble = page.getByTestId(`tile-chat-${chat.id}`).locator('.msg-user').last();
    await expect(bubble.locator('.img-thumb')).toHaveCount(2);
    await expect(bubble.locator('.bubble')).toHaveText('cosa vedi in questi screenshot?');
    await expect(page.getByTestId(`chat-state-${chat.id}`)).toHaveAttribute('data-state', 'idle', { timeout: 15000 });

    // a long turn: a screenshot alone goes in the queue (chip with its preview) and leaves with the message after it
    await page.getByTestId(input).fill('slow');
    await page.getByTestId(input).press('Enter');
    await expect(page.getByTestId(`chat-state-${chat.id}`)).toHaveAttribute('data-state', 'running');
    // "running" must belong to this turn, not the first response still finishing on a busy native runner.
    await expect.poll(sent, { timeout: 15000 }).toEqual([[img, img, 'text'], ['text']]);
    await putImages(page, input, 1, 'paste', 120);
    await expect(page.getByTestId(`${input}-images-0`)).toBeVisible();
    await page.getByTestId(input).press('Enter');
    await expect(page.getByTestId(`${input}-queued-0`).locator('.queued-img img')).toBeVisible();
    await expect(page.getByTestId(`${input}-queued-0`)).toContainText('immagine');
    await shot(page, `paste-images-${engine}-queued`);
    await page.evaluate(id => window.sb.invoke('chat:stop', { chatId: id }), chat.id);
    await expect.poll(sent, { timeout: 15000 }).toEqual([[img, img, 'text'], ['text'], [img]]);
    await expect(page.getByTestId(`${input}-queued-0`)).toHaveCount(0);
    await expect(page.getByTestId(`tile-chat-${chat.id}`).locator('.msg-user').last().locator('.img-thumb')).toHaveCount(1);
    await expect(page.getByTestId(`chat-state-${chat.id}`)).toHaveAttribute('data-state', 'idle', { timeout: 15000 });
    await shot(page, `paste-images-${engine}-history`);
    await app.close();
  });
}

/** A fresh Win+Shift+S screenshot as Chromium's paste event sees it (delayed rendering): no item, no text. Main's
 *  clipboard is the e2e in-memory one (SB_TEST), holding a PNG when `png` is set. */
async function pasteFreshScreenshot(app: ElectronApplication, page: Page, testid: string, png: boolean): Promise<void> {
  await app.evaluate(async (_e, has) => {
    const g = globalThis as Record<string, unknown>;
    if (!has) { g.__sbClipboardImage = []; return; }
    // a 1x1 PNG (Node in main has no canvas)
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    g.__sbClipboardImage = [{ types: ['image/png'], getType: async () => new Blob([bytes], { type: 'image/png' }) }];
  }, png);
  await page.evaluate(id => {
    const ta = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
    ta.focus();
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
  }, testid);
}

test('Ctrl+V of a fresh Windows screenshot the paste event does not carry: main reads it, in a tile and in the Orchestrator', async () => {
  const { app, page } = await launchDemo();
  await expandChats(page, 'qa'); // the input is on the open strip
  await pasteFreshScreenshot(app, page, 'chat-input-qa', true);
  await expect(page.getByTestId('chat-input-qa-images-0')).toBeVisible();
  await expect(page.getByTestId('chat-input-qa')).toHaveValue('');
  await shot(page, 'paste-images-fresh-screenshot');
  // nothing on the clipboard: a toast says so, nothing is attached
  await pasteFreshScreenshot(app, page, 'chat-input-qa', false);
  await expect(page.getByText('Negli appunti non c’è un’immagine né del testo.')).toBeVisible();
  await expect(page.getByTestId('chat-input-qa-images').locator('.img-thumb')).toHaveCount(1);
  // the Orchestrator overlay uses the same input
  await page.keyboard.press('Control+R');
  await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
  await pasteFreshScreenshot(app, page, 'orchestrator-input', true);
  await expect(page.getByTestId('orchestrator-input-images-0')).toBeVisible();
  await shot(page, 'paste-images-fresh-screenshot-orchestrator');
  await app.close();
});

test('a screenshot pasted in one chat stays there when focus mode swaps to another chat', async () => {
  const { app, page } = await launchDemo();
  await expandChats(page, 'qa'); // the input is on the open strip
  await page.getByTestId('chat-input-qa').click();
  await page.keyboard.press('Control+Shift+F');
  const focus = page.getByTestId('focus-view');
  await expect(focus).toBeVisible();
  await putImages(page, 'chat-input-qa', 1, 'paste', 330);
  await expect(page.getByTestId('chat-input-qa-images-0')).toBeVisible();
  await page.keyboard.press('Control+K'); // another chat from the palette: focus mode shows it in the same view
  await page.getByTestId('palette-input').fill('report settimanale');
  await page.keyboard.press('Enter');
  await expect(focus.getByTestId('chat-input-report')).toBeVisible();
  await expect(focus.locator('.composer-images')).toHaveCount(0);
  await shot(page, 'paste-images-focus-other-chat');
  await page.getByTestId('focus-exit').click();
  await expect(page.getByTestId('chat-input-qa-images-0')).toBeVisible(); // still the draft of its own chat
  await app.close();
});

test('the Orchestrator overlay (Ctrl+R) takes pasted screenshots too (here it waits on a decision: queued with its image)', async () => {
  const { app, page } = await launchDemo();
  await expandChats(page, 'qa'); // the input is on the open strip
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('g');
  await page.keyboard.press('q');
  await expect(page.getByTestId('page-qualita')).toBeVisible();
  await page.keyboard.press('Control+R');
  await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
  const input = page.getByTestId('orchestrator-input');
  await putImages(page, 'orchestrator-input', 1, 'paste', 280);
  await expect(page.getByTestId('orchestrator-input-images-0')).toBeVisible();
  await input.fill('guarda questo errore');
  await shot(page, 'paste-images-orchestrator');
  await input.press('Enter');
  await expect(page.getByTestId('orchestrator-input-images')).toHaveCount(0);
  await expect(page.getByTestId('orchestrator-input-queued-0')).toContainText('guarda questo errore');
  await expect(page.getByTestId('orchestrator-input-queued-0').locator('.queued-img img')).toBeVisible();
  await app.close();
});
