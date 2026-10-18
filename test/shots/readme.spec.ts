// The README screenshots, generated from the frozen demo (SB_DEMO=1 SB_DEMO_FREEZE=1, the synthetic brain of
// scripts/demo-brain.mjs) so they always show the current UI with fictional data only: dark theme, 1600x1000, saved as
// WebP (< 300 KB each) in docs/screenshots/. Not part of `npm run check`: run by `npm run shots`
// (its own Playwright config, playwright.shots.config.ts). The app runs hidden (SB_HIDDEN, set by launch()).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, openRegia, setSize, waitThumbs, goPage } from '../e2e/helpers';
// @ts-expect-error plain ESM helper without types
import { demoBrain } from '../../scripts/demo-brain.mjs';

const OUT = path.resolve(import.meta.dirname, '..', '..', 'docs', 'screenshots');
const MAX = 300 * 1024;

let app: ElectronApplication, page: Page;
test.beforeAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const brain = (demoBrain as (p: string) => string)('sb-shots-brain-');
  // each chat asks in its own tile (questions as panels), as most users start
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-shots-'));
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ regiaDriven: false }));
  ({ app, page } = await launch({ SB_DEMO: '1', SB_DEMO_FREEZE: '1', SB_BRAIN: brain }, userData));
  await setSize(app, 1600, 1000);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(page.locator('html[data-clock="frozen"]')).toHaveCount(1);
  await expect(page.getByTestId('regia-overlay')).toBeVisible();
});
test.afterAll(async () => { await app?.close(); });

/** Screenshot → WebP in the page (Chromium's encoder: no image dependency), lowering the quality until < 300 KB. */
async function save(name: string): Promise<void> {
  // transient toasts ("DevOps aggiornato") would cover the page
  for (const x of await page.getByTestId('toast-close').all()) await x.click();
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  for (const q of [0.9, 0.82, 0.74, 0.66]) {
    const b64 = await page.evaluate(async ([data, quality]) => {
      const bytes = Uint8Array.from(atob(data as string), c => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      const blob = await c.convertToBlob({ type: 'image/webp', quality: quality as number });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, [png.toString('base64'), q] as const);
    const webp = Buffer.from(b64, 'base64');
    if (webp.length <= MAX || q === 0.66) {
      fs.writeFileSync(path.join(OUT, `${name}.webp`), webp);
      // the publish guard lets an image through only pinned by hash, after a human looked at it: the line to add
      console.log(`${name}.webp ${Math.round(webp.length / 1024)} KB (quality ${q}) · .guardallow line, once you have looked at it:\n` +
        `docs/screenshots/${name}.webp binary-media sha256:${createHash('sha256').update(webp).digest('hex')}`);
      expect(webp.length, `${name}.webp too large`).toBeLessThanOrEqual(MAX);
      return;
    }
  }
}

const tool = (chatId: string, t: { id: string; name: string; input: unknown; summary?: string }) =>
  app.evaluate((_e, [c, x]) => (globalThis as unknown as { __sbDemo: { tool(c: string, t: unknown): void } }).__sbDemo.tool(c, x), [chatId, t] as const);

test('README screenshots', async () => {
  test.setTimeout(180_000);

  // 1. The agents column: chats as strips, their questions as panels, each browser tab under the chat that drives it
  await expect(page.getByTestId('view-agents')).toBeVisible();
  await waitThumbs(page);
  await save('mosaic');

  // 2. The Orchestrator: the coordinating chat, in its column on the right, with its decision waiting
  await openRegia(page);
  await waitThumbs(page);
  await save('regia');

  // 3. A browser driven by an agent, big next to its chat (focus mode on the chat)
  await page.getByTestId('tile-chat-qa').locator('.tile-head').click();
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByTestId('focus-view')).toBeVisible();
  await waitThumbs(page);
  await save('browser');
  await page.getByTestId('focus-exit').click();

  // 4. The 3D brain map, lit where the chats are working right now
  await tool('fix', { id: 'shot-read', name: 'Read', input: { file_path: 'C:\\brains\\demo\\now.md' }, summary: 'now.md' });
  await tool('fix', { id: 'shot-agent', name: 'Agent', input: { subagent_type: 'reviewer' }, summary: 'reviewer' });
  await tool('regia', { id: 'shot-send', name: 'mcp__second-brain-app__app_send_to_chat', input: { chatId: 'feedback', text: 'go' }, summary: 'App · Feedback' });
  await page.getByTestId('nav-dashboard').click();
    await page.getByRole('tab', { name: 'Mappa brain' }).click();
    await page.getByRole('button', { name: 'Esplora in 3D' }).click();
  await expect(page.getByTestId('brain-map').getByTestId('bx-map-canvas').locator('canvas')).toHaveCount(1, { timeout: 30_000 });
  await page.waitForTimeout(5000); // the layout settles
  await save('brain-map');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('brain-map')).toHaveCount(0);

  // 5. DevOps: pull requests, work items and the QA status of each PR, read on demand
  await page.getByTestId('nav-devops').click();
  const dv = page.getByTestId('brain-page-devops');
  await dv.getByTestId('devops-refresh').click();
  await expect(dv.getByTestId('devops-qa')).toBeVisible({ timeout: 30_000 });
  await dv.evaluate(el => { el.scrollTop = 0; });
  await save('devops');

  // 6. Qualità: four measured metrics about how the agents work, each with its source
  await goPage(page, 'qualita');
  await expect(page.getByTestId('page-qualita').getByTestId('bx-q-trovati')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('bx-loading')).toHaveCount(0, { timeout: 30_000 });
  await save('quality');
});
