// E2E of "Mandato" (ADR 0038; frozen demo, an idle chat): a mail the chat wrote in a fenced text block gets Copia and
// Mandato (a shell block gets no Mandato); Copia leaves "Copiato hh:mm" and tells the chat nothing; Mandato shows
// "Mandato ✓ hh:mm" with Annulla, and after the undo window the chat receives one folded line "[Mandato] <first
// line>" (never the whole mail); an Esegui run's outcome reaches the chat by itself and the block says so.
// Screenshots in test-results/shots/mandato-*.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type Demo = { say(c: string, t: string): void };
const say = (app: ElectronApplication, chatId: string, text: string) =>
  app.evaluate((_e, [c, t]) => { (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.say(c, t); }, [chatId, text] as const);

const MAIL = [
  'Ecco la mail per Marco:',
  '```',
  'Ciao Marco,',
  'il rimborso 2026/118 è stato emesso oggi: lo vedi nel portale da domani.',
  'Studio Demo',
  '```',
  'E per controllare:',
  '```powershell',
  "Write-Output 'controllo mandato'",
  '```',
].join('\n');

test('Mandato on a text to send: Copiato, Mandato ✓, the chat gets one line; Esegui outcome reaches the chat by itself', async () => {
  // the demo sends Esegui outcomes to the chat only with SB_RUN_RESULTS=1 (demo-wiring.ts)
  const { app, page } = await launchDemo({ width: 1500, height: 950, env: { SB_RUN_RESULTS: '1' } });
  // a finished chat: a tile of the mosaic until it closes by itself
  await expect(page.getByTestId('chat-max-mappa')).toBeVisible();
  await say(app, 'mappa', MAIL);
  await page.getByTestId('chat-max-mappa').click();
  const tile = page.getByTestId('maximized');
  const blocks = tile.getByTestId('codeblock');
  await expect(blocks).toHaveCount(2);
  const mail = blocks.nth(0), ps = blocks.nth(1);
  await expect(mail.getByTestId('cb-mandato')).toBeVisible();
  await expect(ps.getByTestId('cb-mandato')).toHaveCount(0); // a command is run, not sent

  // Copia: "Copiato hh:mm" stays on the block; the chat hears nothing (copying is not sending)
  const before = await page.evaluate(() => window.sb.invoke('chat:items', { chatId: 'mappa' }));
  await mail.getByTestId('cb-copy').click();
  await expect(mail.getByTestId('cb-copy')).toHaveAttribute('data-mark', 'copied');
  await page.waitForTimeout(2000); // past the short "Copiato" flash: the mark with its time remains
  await expect(mail.getByTestId('cb-copy')).toContainText(/Copiato \d\d:\d\d/);
  expect((await page.evaluate(() => window.sb.invoke('chat:items', { chatId: 'mappa' }))).length).toBe(before.length);

  // Mandato: marked at once with Annulla, told to the chat after the undo window as one folded line
  await mail.getByTestId('cb-mandato').focus();
  await page.keyboard.press('Enter'); // by keyboard: the focus moves to Annulla, never out of the block
  await expect(mail.getByTestId('cb-sent')).toContainText(/Mandato ✓ \d\d:\d\d/);
  await expect(mail.getByTestId('cb-undo')).toBeFocused();
  await page.mouse.move(2, 2);
  await shot(page, 'mandato-block');
  await expect(mail.getByTestId('cb-undo')).toHaveCount(0, { timeout: 10_000 });
  const done = tile.locator('[data-foreign="done"]');
  await expect(done).toHaveCount(1, { timeout: 10_000 });
  await expect(done).toContainText('[Mandato] Ciao Marco,');
  const told = (await page.evaluate(() => window.sb.invoke('chat:items', { chatId: 'mappa' }))).filter(i => i.kind === 'user').map(i => (i as { text: string }).text);
  const line = told.find(t => t.includes('[Mandato]'))!;
  expect(line).toBe('[Mandato] Ciao Marco,'); // Mandato replaced the block's Copiato note: one line, never the mail
  expect(line).not.toContain('rimborso');
  await expect(mail.getByTestId('cb-sent')).toBeVisible(); // still marked after the chat answered

  // Esegui: the outcome goes to the chat by itself when it is free; the block says so ("Rimanda" only resends)
  await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('chat:list', undefined))).find(c => c.id === 'mappa')?.state, { timeout: 20_000 }).toBe('idle');
  await ps.getByTestId('cb-exec').click();
  await expect(ps.getByTestId('cb-run')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
  await expect(ps.getByTestId('cb-told')).toHaveAttribute('data-told', '1', { timeout: 20_000 });
  await expect(ps.getByTestId('cb-report')).toContainText('Rimanda');
  await expect(tile.locator('[data-foreign="run"]').last()).toBeVisible();
  await page.mouse.move(2, 2);
  await shot(page, 'mandato-esegui');
  await app.close();
});
