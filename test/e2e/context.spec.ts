// Passive context meters and deliberate manual continuation, using fake engines only. No length-only notice on
// Claude or Cursor. Legacy cold continuation is exercised only after explicit opt-in; the fresh default is off.
// Main-only execution: writing this spec on a branch does not authorize running the e2e suite there.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatSummary } from '../../src/shared/contract';
import { closeSetup, expandChats, launch, launchDemo, setSize, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures');
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

for (const engine of ['claude', 'cursor'] as const) {
  test(`${engine}: a long chat shows its meter, writes its hand-off on request, and "Riprendi" continues it in a new linked chat`, async () => {
    const cwd = tmp('sb-e2e-cwd-');
    const env: Record<string, string> = engine === 'claude'
      ? { SB_CLAUDE_PATH: path.join(FIX, 'fake-claude.mjs'), CLAUDE_CONFIG_DIR: tmp('sb-e2e-claude-') }
      : { SB_CURSOR_PATH: path.join(FIX, 'fake-cursor-acp.mjs'), CURSOR_CONFIG_DIR: tmp('sb-e2e-cursor-user-') };
    const { app, page } = await launch(env);
    await setSize(app, 1400, 900);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await closeSetup(page); // a fresh profile opens the first-run setup over the app
    const chat: ChatSummary = await page.evaluate(([h, dir]) => window.sb.invoke('chat:create', { harness: h as 'claude', cwd: dir!, prompt: 'leggi il log big', title: 'Ordini · Fix totale' }), [engine, cwd] as const);
    const tile = page.getByTestId(`tile-chat-${chat.id}`);
    await expect(tile).toBeVisible();

    const meter = page.getByTestId(`chat-ctx-${chat.id}`);
    await expect(meter).toHaveClass(/long/, { timeout: 20_000 });
    const list = () => page.evaluate(() => window.sb.invoke('chat:list', undefined));
    if (engine === 'claude') {
      // 250k on the 200k window the app passed (the fake never compacts by itself): amber, compaction near, no notice (it compacts by itself)
      await expect.poll(async () => (await list()).find(c => c.id === chat.id)?.contextMaxTokens).toBe(200_000);
      await expect(meter).toHaveAttribute('data-tip', /Compatta da sola vicino a 200k/);
      await expect(page.getByTestId(`ctx-bar-${chat.id}`)).toHaveCount(0);
      await page.getByTestId(`chat-menu-${chat.id}`).click();
      await page.getByTestId(`chat-handoff-${chat.id}`).click();
    } else {
      await expect(meter).toContainText('~');
      await expect(page.getByTestId(`ctx-bar-${chat.id}`)).toHaveCount(0);
      await page.getByTestId(`chat-menu-${chat.id}`).click();
      await page.getByTestId(`chat-handoff-${chat.id}`).click();
    }
    // no automatic note any more: the dialog writes it on request
    await expect(page.getByTestId('handoff-none')).toBeVisible();
    await shot(page, `context-${engine}-long`);
    await page.getByTestId('handoff-write').click();
    await expect(page.getByTestId('handoff-meta')).toContainText('Scritto dalla chat', { timeout: 20_000 });
    await expect(page.getByTestId('handoff-text')).toContainText('Prossimo passo');
    await shot(page, `context-${engine}-handoff`);

    // "Riprendi" from the dialog: a new chat, same engine and folder, linked both ways
    await page.getByTestId('handoff-resume').click();
    await expect(page.getByTestId('handoff')).toHaveCount(0);
    await expect.poll(async () => (await list()).some(c => c.continuedFrom?.id === chat.id), { timeout: 15_000 }).toBe(true);
    const next = (await list()).find(c => c.continuedFrom?.id === chat.id)!;
    expect(next).toMatchObject({ harness: engine, cwd, title: 'Ordini · Fix totale (2)' });
    const nextTile = page.getByTestId(`tile-chat-${next.id}`);
    await expandChats(page, next.id, chat.id); // transcripts and links: the strips start folded
    await expect(nextTile).toContainText('Ripreso dal passaggio', { timeout: 15_000 });
    await expect(page.getByTestId(`chat-links-${next.id}`)).toContainText('Segue da «Ordini · Fix totale»');
    await expect(page.getByTestId(`chat-links-${chat.id}`)).toContainText('Il lavoro continua in «Ordini · Fix totale (2)»');
    await expect(page.getByTestId(`ctx-bar-${chat.id}`)).toHaveCount(0);
    await shot(page, `context-${engine}-resumed`);
    await app.close();
  });
}

test('demo: the meter near the compaction, a cold continuation, the hand-off dialog (look)', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 1000 });
  await page.getByTestId('chat-max-mappa').click();
  await expect(page.getByTestId('chat-ctx-mappa')).toHaveText('172k');
  await expect(page.getByTestId('chat-ctx-mappa')).toHaveClass(/long/);
  await expect(page.getByTestId('ctx-bar-mappa')).toHaveCount(0); // a Claude chat compacts by itself: no notice
  await shot(page, 'context-demo-meter');
  await page.getByTestId('chat-menu-mappa').click();
  await expect(page.getByTestId('chat-handoff-mappa')).toBeVisible();
  await shot(page, 'context-demo-menu');
  await page.getByTestId('chat-handoff-mappa').click();
  await expect(page.getByTestId('handoff-none')).toBeVisible();
  await page.getByTestId('handoff-write').click();
  await expect(page.getByTestId('handoff-text')).toContainText('Prossimo passo');
  await shot(page, 'context-demo-dialog');
  await page.keyboard.press('Escape');
  await page.getByTestId('chat-max-mappa').click();

  // a continuation that is closed later no longer counts: the old chat offers "Riprendi" again, the dialog no "Aggiorna"
  await page.getByTestId('chat-menu-mappa').click();
  await page.getByTestId('chat-resume-mappa').click();
  const list = () => page.evaluate(() => window.sb.invoke('chat:list', undefined));
  await expect.poll(async () => (await list()).some(c => c.continuedFrom?.id === 'mappa')).toBe(true);
  const next = (await list()).find(c => c.continuedFrom?.id === 'mappa')!.id;
  await page.evaluate(id => window.sb.invoke('chat:close', { chatId: id }), next);
  await expect.poll(async () => (await list()).some(c => c.id === next)).toBe(false);
  await page.getByTestId('chat-menu-mappa').click();
  await expect(page.getByTestId('chat-resume-mappa')).toHaveText('Riprendi in chat nuova');
  await page.getByTestId('chat-handoff-mappa').click();
  await expect(page.getByTestId('handoff-write')).toBeVisible();
  await expect(page.getByTestId('handoff-resume')).toHaveText('Riprendi in chat nuova');
  await page.keyboard.press('Escape');

  // the demo's cold continuation: the old session folded above "Continua da qui"
  await page.evaluate(() => window.sb.invoke('chat:reopen', { chatId: 'review' })); // closed in the demo (auto-close)
  const review = page.getByTestId('tile-chat-review');
  await expandChats(page, 'review'); // its transcript: the strips start folded
  await expect(review.getByTestId('cold-divider')).toBeVisible();
  await expect(review.getByTestId('cold-past')).toContainText('3 righe');
  await expect(review).not.toContainText('Confronta le due versioni');
  await review.screenshot({ path: 'test-results/shots/context-demo-cold.png' });
  await app.close();
});
