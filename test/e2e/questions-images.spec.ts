// E2E of images in a question (the user, 2026-10-14: "mi piacerebbe che le immagini si potessero vedere direttamente
// nella domanda"): a question naming local PNGs (markdown images, an option's description) shows them as captioned
// thumbnails in the questions window; a click opens one large inside the app, ← → move, Esc closes the viewer only
// (the question stays, it is not "Rispondi dopo"); a file outside the allowed folders is not shown and says why; the
// markdown never shows in the title. Screenshots: test-results/shots/qimg-window-<theme>.png, qimg-viewer.png.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type D = { stop(id: string): Promise<void>; ask(id: string, r: object): void };
const demo = <A extends unknown[]>(app: ElectronApplication, fn: (d: D, ...a: A) => void, ...a: A) =>
  app.evaluate((_e, [src, args]) => { const d = (globalThis as unknown as { __sbDemo: D }).__sbDemo; return new Function('d', 'a', `return (${src})(d, ...a)`)(d, args); }, [fn.toString(), a] as const);

/** The Orchestrator's input has the keyboard by default (OrchestratorTile.tsx) and the window takes the keyboard only when
 *  no field has it (ADR 0019, 0044): the field is left first, as a user who is not writing anywhere. */
async function leaveFields(page: Page): Promise<void> {
  await expect(page.getByTestId('orchestrator-input')).toBeFocused();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** A real PNG of one color with a lighter band (so the thumbnails differ), built without a dependency. */
function png(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3; const band = y < h / 4 ? 60 : 0;
    raw[o] = Math.min(255, rgb[0] + band); raw[o + 1] = Math.min(255, rgb[1] + band); raw[o + 2] = Math.min(255, rgb[2] + band);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const scheme of ['dark', 'light'] as const) {
  test(`a question shows its images, large on a click · ${scheme}`, async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-'));
    const ev = path.join(userData, 'evidence', 'qimg');
    fs.mkdirSync(ev, { recursive: true });
    const files = [['0-prima.png', [120, 40, 40]], ['1-proposta.png', [40, 90, 160]], ['2-chiaro.png', [40, 130, 80]]] as const;
    for (const [n, c] of files) fs.writeFileSync(path.join(ev, n), png(320, 200, [...c]));
    const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-out-')), 'fuori.png');
    fs.writeFileSync(outside, png(40, 40, [200, 200, 0]));

    const { app, page } = await launchDemo({ scheme, userData, config: { theme: scheme } });
    for (const id of ['orchestrator', 'qa', 'feedback']) await demo(app, (d, c) => d.stop(c), id);
    await leaveFields(page);
    const q = `Approvi il nuovo disegno? ![Prima (oggi)](${path.join(ev, '0-prima.png')}) ![Dopo](${path.join(ev, '1-proposta.png')})`;
    await demo(app, (d, id, req) => d.ask(id, req), 'qa', {
      type: 'question', tool: 'AskUserQuestion', title: q, detail: q, input: {},
      questions: [{ question: q, header: 'Disegno', multiSelect: false, options: [
        { label: 'Sì, procedi (consigliato)', description: `anche in chiaro: ${path.join(ev, '2-chiaro.png')}` },
        { label: 'Cambia qualcosa', description: `questa no: ${outside}` },
      ] }],
    });
    const card = page.getByTestId('qwin-card');
    await expect(card).toBeFocused();
    await expect(page.getByTestId('qwin-card-q')).toHaveText('Approvi il nuovo disegno?'); // no ![](…) in the title
    const imgs = page.getByTestId('qwin-card-imgs');
    await expect(imgs.locator('img')).toHaveCount(3);
    await expect(imgs.locator('figcaption')).toHaveText(['Prima (oggi)', 'Dopo', 'Sì, procedi']);
    await expect(page.getByTestId('qwin-card-img-bad')).toContainText('Fuori dalle cartelle');
    await expect(page.getByTestId('qwin-card-img-bad-open')).toBeVisible(); // still one click from the file
    await expect(page.locator('.qwin-keys')).toHaveText('1–3 scegli ↑↓ muovi Invio conferma');
    for (const src of await imgs.locator('img').evaluateAll(els => els.map(e => (e as HTMLImageElement).src))) expect(src.startsWith('data:image/png;base64,')).toBe(true);
    await page.mouse.move(2, 2);
    await shot(page, `qimg-window-${scheme}`);

    // large inside the app: ← → move, Esc closes the viewer and nothing else
    await imgs.getByRole('button', { name: /Prima \(oggi\)/ }).click();
    const viewer = page.getByTestId('qwin-card-img-viewer');
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText('Prima (oggi) · 1 di 3');
    await page.keyboard.press('ArrowRight');
    await expect(viewer).toContainText('Dopo · 2 di 3');
    if (scheme === 'dark') await shot(page, 'qimg-viewer');
    // keys pressed in the viewer never answer the question behind it
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect(viewer).toBeVisible();
    await expect(page.getByTestId('qwin-card-q')).toHaveText('Approvi il nuovo disegno?');
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(page.getByTestId('qwin')).toBeVisible();
    await expect(page.getByTestId('topbar-next')).not.toContainText('Da rispondere');
    await app.close();
  });
}
