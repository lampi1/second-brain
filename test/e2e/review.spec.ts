// E2E of the review fixes (frozen demo): sanitized markdown (no area/map/forms/frames, no file:/UNC/protocol-relative
// URLs), the global layer never answering from another control, the keyboard handed back to the app (toast action,
// Ctrl+J to an app card, last card answered), the layer reloading after a crash, tabs without a snapshot, free text
// for Cursor questions too (with a note), long permission details keeping the buttons visible, a failed answer coming
// back answerable, browser tiles without a snapshot showing title and address.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { expandChats, launchDemo, layerPage, layerState, goPage } from './helpers';

type Demo = { stop(c: string): Promise<void>; say(c: string, t: string): void; ask(c: string, r: object): void; event(e: object): void; failNextAnswer(): void; clearThumbs(): void };
const demo = <T,>(app: ElectronApplication, fn: (d: Demo, arg: T) => void, arg: T) =>
  app.evaluate((_e, [src, a]) => { const d = (globalThis as unknown as { __sbDemo: Demo }).__sbDemo; return new Function('d', 'a', `(${src})(d, a)`)(d, a); }, [fn.toString(), arg] as const);
const focusOf = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]!;
  const layer = win.contentView.children.map(v => (v as { webContents?: Electron.WebContents }).webContents).find(w => w?.getURL().includes('#overlay'));
  return { app: win.webContents.isFocused(), layer: !!layer?.isFocused() };
});

test('S1: markdown from a chat cannot navigate the app window (area/map, forms, frames, file:, UNC, //host)', async () => {
  const { app, page } = await launchDemo();
  const evil = [
    '[proto](//evil.example/x) [unc](\\\\evil\\share\\x.html) [file](file:///C:/x.html) [js](javascript:alert(1)) [ok](https://example.com/ok) [mail](mailto:a@example.com)',
    '<map name="m"><area shape="rect" coords="0,0,99,99" href="//evil.example/a"></map><img src="file:///C:/x.png" usemap="#m" alt="i">',
    '<form action="//evil.example"><button formaction="//evil.example">x</button><input value="y"></form>',
    '<iframe src="//evil.example"></iframe><object data="//evil.example"></object><embed src="//evil.example"><base href="//evil.example/"><meta http-equiv="refresh" content="0;url=//evil.example"><link rel="stylesheet" href="//evil.example/s.css">',
    '<div href="//evil.example" style="color:red">div</div>',
  ].join('\n\n');
  await expandChats(page, 'fix'); // a strip of the Grindhouse shows its transcript once open
  await demo(app, (d, t) => d.say('fix', t), evil);
  const md = page.getByTestId('tile-chat-fix').locator('.msg-assistant .md').last();
  await expect(md).toContainText('ok');
  const r = await md.evaluate(el => ({
    bad: el.querySelectorAll('area, map, form, button, input, iframe, object, embed, base, meta, link, style').length,
    hrefs: [...el.querySelectorAll('[href]')].map(x => `${x.tagName}:${x.getAttribute('href')}`),
    srcs: [...el.querySelectorAll('[src]')].map(x => x.getAttribute('src')),
    styles: el.querySelectorAll('[style], [usemap]').length,
    target: el.querySelector('a[href^="https:"]')?.getAttribute('target'),
  }));
  expect(r.bad).toBe(0);
  expect(r.hrefs).toEqual(['A:https://example.com/ok', 'A:mailto:a@example.com']);
  expect(r.srcs).toEqual([]);
  expect(r.styles).toBe(0);
  expect(r.target).toBe('_blank');
  const url = page.url();
  await md.getByText('proto').click();
  await md.getByText('unc').click();
  expect(page.url()).toBe(url);
  await app.close();
});

test('S2/S3/C8: Enter on "Apri" never answers; a toast action and the last answer give the keyboard back to the app', async () => {
  const { app, page } = await launchDemo();
  await goPage(page, 'costi');
  await page.keyboard.press('Control+R'); // the Orchestrator overlay: its card is the one popup, the layer waits
  await expect.poll(async () => (await layerState(app)).cards).toBe(0);
  await demo(app, d => d.stop('orchestrator'), null); // her request leaves ("Rispondi dopo" would quiet them all): QA and Feedback float
  await expect.poll(async () => (await layerState(app)).cards).toBe(2);
  const layer = await layerPage(app);
  await layer.getByTestId('layer-open').focus();
  await layer.keyboard.press('Enter');
  await expect(page.getByTestId('view-agents')).toBeVisible(); // "Apri" opened the chat…
  await expect(page.getByTestId('request-qa-qa-q1')).toBeVisible(); // …and did not answer it
  await expect.poll(async () => (await focusOf(app)).app).toBe(true);
  // a toast action hands the keyboard back (a chat's turn failing toasts; a logged error no longer does: lib/notify.ts
  // TOAST_KINDS, "only what needs the user interrupts")
  await goPage(page, 'costi');
  await demo(app, (d, e) => d.event(e), { kind: 'chat-failed', title: 'Turno finito con un errore', chatId: 'mappa' });
  await layer.getByTestId('ev-toast-close-chat-failed').click();
  await expect.poll(async () => (await focusOf(app)).app).toBe(true);
  // answering the last card while a toast keeps the layer up: back to the app
  await demo(app, (d, e) => d.event(e), { kind: 'chat-failed', title: 'Un altro errore', chatId: 'fix' });
  await page.keyboard.press('Control+J'); // QA, in the layer
  await expect.poll(async () => (await focusOf(app)).layer).toBe(true);
  await layer.keyboard.press('1');
  await expect(layer.locator('[data-request-key="feedback/feedback-p1"]')).toBeVisible();
  await layer.keyboard.press('1');
  await expect.poll(async () => (await layerState(app)).cards).toBe(0);
  expect((await layerState(app)).toasts).toBeGreaterThan(0);
  await expect.poll(async () => (await focusOf(app)).app).toBe(true);
  await app.close();
});

test('C1: Ctrl+J from inside the layer to an app card brings the keyboard back to the app', async () => {
  const { app, page } = await launchDemo();
  await goPage(page, 'costi');
  await page.keyboard.press('Control+R');
  await expect.poll(async () => (await layerState(app)).cards).toBe(0); // the Orchestrator's card is the one popup
  await page.keyboard.press('Control+J'); // Orchestrator (dock, app)
  await page.keyboard.press('Control+J'); // QA (layer): the popup moves there, the Orchestrator's card steps aside
  await expect.poll(async () => (await focusOf(app)).layer).toBe(true);
  const layer = await layerPage(app);
  await layer.keyboard.press('Control+J'); // Feedback (layer)
  await expect(layer.locator('[data-request-key="feedback/feedback-p1"]')).toBeFocused();
  await layer.keyboard.press('Control+J'); // back to the Orchestrator: an app card
  await expect.poll(async () => (await focusOf(app)).app).toBe(true);
  await expect(page.locator('[data-request-key="orchestrator/orchestrator-q1"]')).toBeFocused();
  await expect.poll(async () => (await layerState(app)).cards).toBe(0); // back in the Orchestrator: the layer empties again
  await app.close();
});

test('C9: the layer page reloads after a crash and shows the cards again', async () => {
  const { app, page } = await launchDemo();
  await goPage(page, 'costi');
  await expect.poll(async () => (await layerState(app)).cards).toBe(3);
  await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().includes('#overlay'))?.forcefullyCrashRenderer());
  await page.waitForTimeout(1200);
  await expect.poll(async () => app.evaluate(async ({ webContents }) => {
    const w = webContents.getAllWebContents().find(x => x.getURL().includes('#overlay'));
    if (!w || w.isCrashed() || w.isLoading()) return 0;
    const q = w.executeJavaScript('document.querySelectorAll("[data-testid=layer-card]").length').catch(() => 0) as Promise<number>;
    return Promise.race([q, new Promise<number>(r => setTimeout(() => r(0), 1000))]);
  }), { timeout: 15_000 }).toBe(1);
  await app.close();
});

test('C2/C10: an old finished chat is reachable from the palette, tabs without a snapshot show title and address', async () => {
  const { app, page } = await launchDemo();
  await demo(app, d => d.clearThumbs(), null);
  await expect(page.getByTestId('browser-info-tab-qa')).toContainText('Rimborso 2026/118');
  await expect(page.getByTestId('browser-info-tab-sms')).toContainText('test-2.app.example.com');
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('report settimanale');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tile-chat-report')).toBeVisible();
  await expect(page.getByTestId('chat-input-report')).toBeFocused();
  await app.close();
});

test('C3/C4/C7: free text for Cursor questions too, with a note; long details keep the buttons visible; a failed answer comes back', async () => {
  const { app, page } = await launchDemo();
  // C3: a Cursor chat (sms) asks a question: "Altro…" is there too, and its box says how Cursor receives it
  await demo(app, (d, q) => d.ask('sms', q), { type: 'question', tool: 'AskUserQuestion', title: 'Quale nodo?', detail: '', input: {}, questions: [{ question: 'Quale nodo?', multiSelect: false, options: [{ label: 'Uno' }, { label: 'Due' }] }] });
  await page.getByTestId('chat-max-sms').click();
  await expect(page.getByTestId('maximized').locator('[data-request-key^="sms/"]')).toContainText('Quale nodo?');
  await page.getByTestId('maximized').locator('[data-testid^="request-sms-"][data-testid$="-other"]').click();
  await expect(page.getByTestId('maximized').locator('[data-testid$="-other-note"]')).toContainText('Cursor la riceve come risposta scritta');
  await page.keyboard.press('Escape');
  await page.getByTestId('maximized').locator('[data-testid^="request-sms-"][data-testid$="-opt-1"]').click(); // answered
  await page.keyboard.press('Escape');
  await page.getByTestId('chat-max-qa').click();
  await expect(page.getByTestId('request-qa-qa-q1-other')).toBeVisible();
  await page.keyboard.press('Escape');
  // C4: a permission with a very long command, floating in the layer on a page
  await goPage(page, 'costi');
  const long = Array.from({ length: 200 }, (_, i) => `echo riga ${i}`).join('\n');
  await demo(app, (d, c) => d.ask('mappa', { type: 'permission', tool: 'Bash', title: 'Bash · script lungo', detail: c, input: {} }), long);
  const layer = await layerPage(app);
  await page.keyboard.press('Control+R'); // the Orchestrator overlay: its card is the one popup
  await expect.poll(async () => (await layerState(app)).cards).toBe(0);
  await demo(app, d => d.stop('orchestrator'), null); // her request leaves: the others float, the long one queued
  await expect.poll(async () => (await layerState(app)).cards).toBe(3);
  for (const key of ['qa/qa-q1', 'feedback/feedback-p1']) {
    await layer.locator(`[data-request-key="${key}"]`).focus();
    await layer.keyboard.press('1'); // answered: the next one comes up
  }
  const allow = layer.locator('[data-request-key^="mappa/"] [data-testid$="-opt-1"]');
  await expect(allow).toBeVisible();
  const box = await allow.boundingBox();
  const vh = await layer.evaluate(() => innerHeight);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh);
  // C7: back in the Grindhouse, a failed answer brings the card back, answerable again
  await page.getByTestId('nav-home').click();
  await demo(app, d => d.failNextAnswer(), null);
  const card = page.locator('[data-request-key^="mappa/"]').first(); // the long permission, in its tile
  await card.focus();
  await page.keyboard.press('1');
  await expect(page.getByTestId('toasts')).toContainText('Risposta non inviata');
  await expect(card).toBeVisible();
  await expect(card).not.toHaveAttribute('aria-busy', 'true');
  await card.focus();
  await page.keyboard.press('1');
  await expect(card).toHaveCount(0);
  await app.close();
});
