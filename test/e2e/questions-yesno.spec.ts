// E2E: the decision card (ADR 0150): a yes/no question whose chat sent its brief (show_ui brief, next-ask) shows, inside
// the card, what was done, the screenshot, the checks and the files, what Sì / No do, and the four answers (Sì, No,
// «Scrivi una risposta…», «Non voglio rispondere»), Esc / «Ci penso dopo»; the chat's text before the question stays
// folded. A question set aside comes back on the Orchestrator's recap (ui:command unblock, what app_unblock sends).
// Demo app. Screenshots: qdecision-window.png, qdecision-write.png, qdecision-recap.png, qdecision-light.png.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type D = { stop(id: string): Promise<void>; ask(id: string, r: object): void; say(id: string, t: string): void; show(id: string, a: object): string };
const demo = <A extends unknown[]>(app: ElectronApplication, fn: (d: D, ...a: A) => unknown, ...a: A) =>
  app.evaluate((_e, [src, args]) => { const d = (globalThis as unknown as { __sbDemo: D }).__sbDemo; return new Function('d', 'a', `return (${src})(d, ...a)`)(d, args); }, [fn.toString(), a] as const);
const Q = 'Faccio il commit sul ramo della PR?';

/** a plain RGB PNG (the screenshot the agent took) */
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


for (const scheme of ['dark', 'light'] as const) {
  test(`a yes/no question with its brief: the context is all inside the card · ${scheme}`, async () => {
    test.setTimeout(120_000);
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-decision-'));
    const shotFile = path.join(userData, 'evidence', 'fix-at-7', 'carrello-dopo.png');
    fs.mkdirSync(path.dirname(shotFile), { recursive: true });
    fs.writeFileSync(shotFile, png(640, 360, [50, 120, 80]));
    const { app, page } = await launchDemo({ width: 1366, height: 900, scheme, userData, config: { theme: scheme } });
    for (const id of ['orchestrator', 'qa', 'feedback', 'fix', 'sms', 'mappa']) await demo(app, (d, c) => d.stop(c), id);
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(300);
      const dismiss = page.getByTestId('qwin-card-dismiss');
      if (!(await dismiss.count())) break;
      await dismiss.click();
    }
    await expect(page.getByTestId('qwin')).toHaveCount(0);

    await demo(app, (d, id, t) => d.say(id, t), 'fix', 'Il rimborso ignorava lo sconto dell’ordine: ora lo sottrae. Ho rifatto i test e lo screenshot del carrello come sopra.');
    const shown = await demo(app, (d, id, a) => d.show(id, a), 'fix', { id: 'brief-at7', target: 'next-ask', component: 'brief', title: 'Fix AT-7', summary: 'Rimborso con sconto corretto',
      props: { done: ['Il rimborso ora sottrae lo sconto dell’ordine', 'Rifatti i test del modulo Ordini', 'Screenshot del carrello dopo il fix'],
        ifYes: 'Faccio il commit sul ramo fix/at-7 e aggiorno la PR', ifNo: 'Lascio le modifiche non salvate e mi fermo',
        checks: [{ label: '42/42 test', status: 'ok' }, { label: 'build', status: 'ok' }, { label: 'lint', status: 'warn', detail: '1 avviso' }],
        images: [{ path: shotFile, caption: 'Carrello dopo il fix' }],
        files: [{ path: 'src/Orders/Refund.cs', why: 'sottrae lo sconto', added: 6, removed: 2 }, { path: 'tests/Orders/RefundTests.cs', why: 'nuovo test', added: 18, removed: 0 }] } });
    expect(shown).toContain('Mostrato');
    await demo(app, (d, id, q) => d.ask(id, q), 'fix', { type: 'question', tool: 'AskUserQuestion', title: Q, detail: Q, input: {},
      questions: [{ question: Q, header: 'Fix', multiSelect: false, options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] }] });
    const card = page.getByTestId('qwin-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('qwin-card-q')).toHaveText(Q);
    await expect(page.getByTestId('qwin-card-brief')).toContainText('Il rimborso ora sottrae lo sconto');
    await expect(page.getByTestId('qwin-card-checks')).toContainText('42/42 test');
    await expect(page.getByTestId('qwin-card-files')).toContainText('src/Orders/Refund.cs');
    await expect(page.getByTestId('qwin-card-imgs')).toBeVisible();
    await expect(page.getByTestId('qwin-card-effects')).toContainText('Faccio il commit sul ramo fix/at-7');
    await expect(page.getByTestId('qwin-card-opt-1')).toContainText('Sì');
    await expect(page.getByTestId('qwin-card-opt-2')).toContainText('No');
    await expect(page.getByTestId('qwin-card-other')).toContainText('Scrivi una risposta');
    await expect(page.getByTestId('qwin-card-skip')).toContainText('Non voglio rispondere');
    await expect(page.getByTestId('qwin-later')).toContainText('Ci penso dopo');
    // the chat's text before the question is folded: the card does not lean on it
    await expect(page.getByTestId('qwin-card-ctx-body')).toHaveCount(0);
    await expect(page.getByTestId('qwin-card-nobrief')).toHaveCount(0);
    // one card in the whole window: no second set of Sì / No anywhere
    await expect(page.locator('.qwin [data-decision]')).toHaveCount(1);
    await expect(page.locator('.qwin .gu-yn')).toHaveCount(0);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    await shot(page, scheme === 'dark' ? 'qdecision-window' : 'qdecision-light');
    if (scheme === 'light') { await app.close(); return; }

    // T: write an answer; Esc goes back to the buttons
    await card.focus();
    await page.keyboard.press('t');
    await expect(page.getByTestId('qwin-card-other-input')).toBeFocused();
    await page.keyboard.type('Prima fai girare anche i test di Pagamenti');
    await shot(page, 'qdecision-write');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('qwin-card-other-input')).toHaveCount(0);

    // «Ci penso dopo»: the window goes, the question still waits; the recap brings it back, the brief still on it
    await page.getByTestId('qwin-later').click();
    await expect(page.getByTestId('qwin')).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().startsWith('file:')) w.webContents.send('ui:command', { action: 'unblock' }); });
    await expect(page.getByTestId('qwin')).toBeVisible();
    await expect(page.getByTestId('qwin-card-brief')).toBeVisible();
    await shot(page, 'qdecision-recap');
    await app.close();
  });
}

test('a brief whose screenshot cannot be shown: no empty column, the line and its «Apri» read across the card', async () => {
  test.setTimeout(120_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-decision-'));
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-outside-')), 'impostazioni-microfono.png');
  fs.writeFileSync(outside, png(320, 200, [60, 60, 140]));
  const { app, page } = await launchDemo({ width: 1366, height: 900, scheme: 'dark', userData, config: { theme: 'dark' } });
  for (const id of ['orchestrator', 'qa', 'feedback', 'fix', 'sms', 'mappa']) await demo(app, (d, c) => d.stop(c), id);
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(300);
    const dismiss = page.getByTestId('qwin-card-dismiss');
    if (!(await dismiss.count())) break;
    await dismiss.click();
  }
  await demo(app, (d, id, a) => d.show(id, a), 'fix', { id: 'brief-mic', target: 'next-ask', component: 'brief', title: 'Microfono', summary: 'Permesso negato',
    props: { done: ['Windows: accesso al microfono acceso', 'second-brain non compare tra le app desktop'], ifYes: 'Una chat Scout cerca dove l’app nega il permesso', ifNo: 'Il microfono resta non disponibile',
      images: [{ path: outside, caption: 'Impostazioni microfono di Windows' }] } });
  await demo(app, (d, id, q) => d.ask(id, q), 'fix', { type: 'question', tool: 'AskUserQuestion', title: 'Cerco il blocco nel codice?', detail: 'Cerco il blocco nel codice?', input: {},
    questions: [{ question: 'Cerco il blocco nel codice?', header: 'Microfono', multiSelect: false, options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] }] });
  const bad = page.getByTestId('qwin-card-img-bad');
  await expect(bad).toContainText('Fuori dalle cartelle ammesse');
  const open = page.getByTestId('qwin-card-img-bad-open');
  const box = (await open.boundingBox())!, done = (await page.locator('.qwin .dc-done').boundingBox())!, line = (await bad.boundingBox())!;
  expect(box.height).toBeLessThan(32);                      // one line, never A-p-r-i down the card
  expect(line.y).toBeGreaterThan(done.y + done.height - 1); // under what was done, not in a column beside it
  expect(line.width).toBeGreaterThan(done.width - 40);
  await page.mouse.move(2, 2);
  await shot(page, 'qdecision-img-refused');
  await app.close();
});
