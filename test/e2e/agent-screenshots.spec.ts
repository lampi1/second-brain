// E2E of agent screenshots everywhere (issue #83): the AT fix report (HTML) with base64 images and a PNG beside it, a
// Markdown report with relative images, a chat message naming a PNG path, and a question with before/after screenshots
// all show their images; a click opens one large in the app's image viewer; remote images are never loaded and say so.
// The question panel's question and context use the app's type scale. Screenshots: test-results/shots/
// shots-report-html-<theme>.png, shots-report-zoom.png, shots-report-md.png, shots-chat.png, shots-question-<theme>.png.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expandChats, launchDemo, shot } from './helpers';

type D = { stop(id: string): Promise<void>; ask(id: string, r: object): void; say(id: string, text: string): void };
const demo = <A extends unknown[]>(app: ElectronApplication, fn: (d: D, ...a: A) => void, ...a: A) =>
  app.evaluate((_e, [src, args]) => { const d = (globalThis as unknown as { __sbDemo: D }).__sbDemo; return new Function('d', 'a', `return (${src})(d, ...a)`)(d, args); }, [fn.toString(), a] as const);
const openFile = async (page: Page, file: string) => { await page.keyboard.press('Control+K'); await page.getByTestId('palette-input').fill('sb://esplora/' + file.replace(/\\/g, '/')); await page.keyboard.press('Enter'); };

/** A real PNG: a colored page with a darker header band and a "button" block, so a thumbnail looks like a screenshot. */
function png(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3;
    const head = y < h / 6, button = y > h / 2 && y < h / 2 + h / 8 && x > w / 10 && x < w / 3;
    const [r, g, b] = head ? rgb.map(v => v * 0.6) : button ? [250, 250, 250] : rgb.map(v => Math.min(255, v + 90));
    raw[o] = r!; raw[o + 1] = g!; raw[o + 2] = b!;
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function fixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-shots-'));
  const ev = path.join(userData, 'evidence', 'fix-at-7');
  fs.mkdirSync(path.join(ev, 'shots'), { recursive: true });
  const before = png(480, 300, [150, 60, 60]), after = png(480, 300, [50, 120, 80]);
  fs.writeFileSync(path.join(ev, 'shots', 'before.png'), before);
  fs.writeFileSync(path.join(ev, 'shots', 'after.png'), after);
  const b64 = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
  fs.writeFileSync(path.join(ev, 'report.html'), `<!doctype html><html><head><title>Fix AT-7</title>
<style>body{font-family:Georgia,serif;color:#222} h1{color:#7a1f1f} .pair{display:flex;gap:16px} .pair figure{margin:0;flex:1} .bad{background:url(https://example.com/track.png)} .fixed{position:fixed;top:0;left:0}</style>
<script>window.__reportRan = true</script></head><body>
<h1>Fix AT-7: rimborso con sconto</h1><p class="bad">Prima e dopo la correzione (<a href="#esito">esito</a>).</p>
<div class="pair"><figure><img alt="Prima (base64)" src="${b64(before)}"><figcaption>Prima</figcaption></figure>
<figure><img alt="Dopo (base64)" src="${b64(after)}"><figcaption>Dopo</figcaption></figure></div>
<p>Accanto al report: <img alt="Dopo (file)" src="shots/after.png" width="240"></p>
<p>Remota: <img alt="remota" src="https://example.com/x.png"> <img src="x" onerror="window.__reportRan=true"></p>
<form action="https://example.com"><input name="q"><button>Invia</button></form><iframe src="https://example.com"></iframe>
<h2 id="esito">Esito</h2><p>Totale 108,00 €: corretto.</p><div class="fixed">fisso</div></body></html>`);
  fs.writeFileSync(path.join(ev, 'report.md'), '# Fix AT-7\n\nPrima e dopo:\n\n![Prima](shots/before.png) ![Dopo](./shots/after.png)\n\n![Remota](https://example.com/x.png)\n');
  return { userData, ev };
}

for (const scheme of ['dark', 'light'] as const) {
  test(`reports in the file viewer show their images, large on a click · ${scheme}`, async () => {
    const { userData, ev } = fixture();
    const { app, page } = await launchDemo({ scheme, userData, config: { theme: scheme } });
    try {
      await openFile(page, path.join(ev, 'report.html'));
      const report = page.getByTestId('viewer-report');
      await expect(report).toBeVisible();
      const imgs = report.locator('img.sb-img');
      await expect(imgs).toHaveCount(3);
      await expect.poll(() => imgs.evaluateAll(list => list.map(i => (i as HTMLImageElement).naturalWidth))).toEqual([480, 480, 480]);
      for (const src of await imgs.evaluateAll(list => list.map(i => (i as HTMLImageElement).getAttribute('src') ?? ''))) expect(src).toMatch(/^data:image\/png;base64,/);
      await expect(report.locator('.sb-img-note')).toHaveCount(2); // the remote one and the "x" one
      await expect(report.locator('.sb-img-note').first()).toContainText('Immagine esterna non caricata');
      // inert: no script ran, no form, frame or handler survived; the CSS fetches nothing; nothing escapes the box
      expect(await page.evaluate(() => (window as unknown as { __reportRan?: boolean }).__reportRan)).toBeUndefined();
      await expect(report.locator('script, form, input, iframe, [onerror]')).toHaveCount(0);
      expect(await report.evaluate(h => h.shadowRoot!.querySelector('style')!.textContent)).not.toMatch(/url\(|example\.com/);
      await expect(report.locator('h1')).toHaveCSS('color', 'rgb(122, 31, 31)'); // its own style, inside the shadow root
      await page.mouse.move(2, 2);
      await shot(page, `shots-report-html-${scheme}`);

      await imgs.nth(1).click();
      const zoom = page.getByTestId('report-img-viewer');
      await expect(zoom).toBeVisible();
      await expect(zoom).toContainText('Dopo (base64) · 2 di 3');
      await page.keyboard.press('ArrowRight');
      await expect(zoom).toContainText('Dopo (file) · 3 di 3');
      if (scheme === 'dark') await shot(page, 'shots-report-zoom');
      await page.keyboard.press('Escape');
      await expect(zoom).toHaveCount(0);

      // the source is one click away, as text
      await page.getByRole('button', { name: 'Sorgente' }).click();
      await expect(page.getByTestId('bx-code')).toContainText('<script>');

      if (scheme === 'dark') {
        await openFile(page, path.join(ev, 'report.md'));
        const md = page.getByTestId('viewer-markdown');
        const mdImgs = md.locator('img.sb-img');
        await expect(mdImgs).toHaveCount(2);
        await expect.poll(() => mdImgs.evaluateAll(list => list.map(i => (i as HTMLImageElement).naturalWidth))).toEqual([480, 480]);
        await expect(md.locator('.sb-img-note')).toContainText('Immagine esterna non caricata');
        await expect(page.locator('img[src^="file:"], img[src^="http"]')).toHaveCount(0);
        await page.mouse.move(2, 2);
        await shot(page, 'shots-report-md');
        await mdImgs.first().click();
        await expect(page.getByTestId('report-img-viewer')).toContainText('Prima · 1 di 2');
        await page.keyboard.press('Escape');
      }
    } finally { await app.close(); }
  });
}

test('a chat message with a screenshot path shows it inline; a click opens it large', async () => {
  const { userData, ev } = fixture();
  const { app, page } = await launchDemo({ userData });
  try {
    const chat = await page.evaluate(cwd => window.sb.invoke('chat:create', { harness: 'claude', cwd, title: 'Fix AT-7' }), ev);
    await demo(app, (d, id, text) => d.say(id, text), chat.id, `Fatto. Prima: ${path.join(ev, 'shots', 'before.png')}\n\nDopo: \`shots/after.png\` · report: [report.html](${path.join(ev, 'report.html')})`);
    const tile = page.getByTestId('tile-chat-' + chat.id), imgs = tile.locator('.ask-imgs-row img');
    await expandChats(page, chat.id);
    await expect(imgs).toHaveCount(2);
    await expect.poll(() => imgs.evaluateAll(list => list.every(i => (i as HTMLImageElement).naturalWidth === 480))).toBe(true);
    await expect(tile.locator('.ask-img figcaption')).toHaveText(['before.png', 'after.png']);
    await tile.locator('.ask-imgs').scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await shot(page, 'shots-chat');
    await tile.locator('.ask-img-open').nth(1).click();
    const viewer = page.locator('[data-testid^="message-"][data-testid$="-img-viewer"]');
    await expect(viewer).toContainText('after.png · 2 di 2');
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    // a question in the questions window (Ctrl+J brings the ones set aside): its question and context in the app's type scale too
    await page.keyboard.press('Control+J');
    await expect(page.getByTestId('qwin')).toBeVisible();
    const fs = await page.evaluate(() => { const s = getComputedStyle(document.documentElement); return { l: s.getPropertyValue('--fs-l').trim(), xl: s.getPropertyValue('--fs-xl').trim() }; });
    await expect(page.locator('.qwin .wq-q').first()).toHaveCSS('font-size', fs.xl);
    await expect(page.locator('.qwin').first()).toHaveCSS('font-size', fs.l);
  } finally { await app.close(); }
});

for (const scheme of ['dark', 'light'] as const) {
  test(`a question with before/after screenshots, in the app's type scale · ${scheme}`, async () => {
    const { userData, ev } = fixture();
    const { app, page } = await launchDemo({ scheme, userData, config: { theme: scheme } });
    try {
      for (const id of ['orchestrator', 'qa', 'feedback']) await demo(app, (d, c) => d.stop(c), id);
      const q = `Ho corretto il calcolo del rimborso con lo sconto. Approvi la correzione? ![Prima](${path.join(ev, 'shots', 'before.png')}) ![Dopo](${path.join(ev, 'shots', 'after.png')})`;
      await demo(app, (d, id, req) => d.ask(id, req), 'qa', {
        type: 'question', tool: 'AskUserQuestion', title: q, detail: q, input: {},
        questions: [{ question: q, header: 'Fix AT-7', multiSelect: false, options: [
          { label: 'Sì, unisci (consigliato)', description: 'Il totale torna 108,00 €.' },
          { label: 'No, rivedi', description: 'Resta aperta.' },
        ] }],
      });
      const imgs = page.getByTestId('qwin-card-imgs');
      await expect(imgs.locator('img')).toHaveCount(2);
      await expect(imgs.locator('figcaption')).toHaveText(['Prima', 'Dopo']);
      const size = (testid: string) => page.getByTestId(testid).evaluate(e => getComputedStyle(e).fontSize);
      const tokens = await page.evaluate(() => { const s = getComputedStyle(document.documentElement); return { l: s.getPropertyValue('--fs-l').trim(), xl: s.getPropertyValue('--fs-xl').trim() }; });
      expect(await size('qwin-card-q')).toBe(tokens.xl);
      expect(await size('qwin-card-ctx-lead')).toBe(tokens.l);
      await page.mouse.move(2, 2);
      await shot(page, `shots-question-${scheme}`);
    } finally { await app.close(); }
  });
}
