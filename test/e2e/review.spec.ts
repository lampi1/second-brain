// E2E of the review fixes (frozen demo): sanitized markdown (no area/map/forms/frames, no file:/UNC/protocol-relative
// URLs), the keyboard handed back to the app by a toast action, the layer reloading its toasts after a crash, tabs
// without a snapshot, free text for Cursor questions too (with a note), long permission details keeping the buttons
// visible, a failed answer coming back answerable, browser tiles without a snapshot showing title and address. The
// layer's request cards (S2, C1, C8) are gone since 2026-10-22: every request is in the questions window.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { expandChats, launchDemo, layerPage, layerState, goPage, showBrowsers } from './helpers';

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
  // a local path (file:, UNC) is never a navigable URL: it becomes an inert #sb-file= fragment that only opens the
  // app's file viewer on a click (lib/markdown.ts localFileLink, LinkPeek.tsx); //host and javascript: lose their href
  expect(r.hrefs).toEqual(['A:#sb-file=%5Cevil%5Cshare%5Cx.html', 'A:#sb-file=file%3A%2F%2F%2FC%3A%2Fx.html', 'A:https://example.com/ok', 'A:mailto:a@example.com']);
  expect(r.srcs).toEqual([]);
  expect(r.styles).toBe(0);
  expect(r.target).toBe('_blank');
  const url = page.url();
  await md.getByText('proto').click();
  await md.getByText('unc').click();
  expect(page.url()).toBe(url);
  await app.close();
});

test('S3: a toast action gives the keyboard back to the app', async () => {
  const { app, page } = await launchDemo();
  await goPage(page, 'costi');
  await expect(page.getByTestId('brain-page-costi')).toBeVisible();
  // a chat's turn failing toasts (a logged error no longer does: lib/notify.ts TOAST_KINDS, "only what needs the user
  // interrupts"); the layer holds toasts only since 2026-10-22, requests are in the questions window
  await demo(app, (d, e) => d.event(e), { kind: 'chat-failed', title: 'Turno finito con un errore', chatId: 'mappa' });
  await expect.poll(async () => (await layerState(app)).toasts).toBeGreaterThan(0);
  const layer = await layerPage(app);
  await layer.getByTestId('ev-toast-close-chat-failed').click();
  await expect.poll(async () => (await focusOf(app)).app).toBe(true);
  await app.close();
});

test('C9: the layer page reloads after a crash and shows its toasts again', async () => {
  const { app, page } = await launchDemo();
  await goPage(page, 'costi');
  await demo(app, (d, e) => d.event(e), { kind: 'chat-failed', title: 'Turno finito con un errore', chatId: 'mappa' });
  await expect.poll(async () => (await layerState(app)).toasts).toBe(1);
  await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().includes('#overlay'))?.forcefullyCrashRenderer());
  await page.waitForTimeout(1200);
  await expect.poll(async () => app.evaluate(async ({ webContents }) => {
    const w = webContents.getAllWebContents().find(x => x.getURL().includes('#overlay'));
    if (!w || w.isCrashed() || w.isLoading()) return 0;
    const q = w.executeJavaScript('document.querySelectorAll("[data-toast]").length').catch(() => 0) as Promise<number>;
    return Promise.race([q, new Promise<number>(r => setTimeout(() => r(0), 1000))]);
  }), { timeout: 15_000 }).toBe(1);
  await app.close();
});

test('C2/C10: an old finished chat is reachable from the palette, tabs without a snapshot show title and address', async () => {
  const { app, page } = await launchDemo();
  await demo(app, d => d.clearThumbs(), null);
  await showBrowsers(page, 'qa', 'sms'); // the browsers under the strips show once their globe is pressed
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
  const ask = (chatId: string, q: object) => demo(app, (d, [c, r]) => d.ask(c as string, r as object), [chatId, q]);
  const question = (q: string) => ({ type: 'question', tool: 'AskUserQuestion', title: q, detail: '', input: {}, questions: [{ question: q, multiSelect: false, options: [{ label: 'Uno' }, { label: 'Due' }] }] });
  // C3: a Cursor chat (sms) asks a question: "Altro…" is there too, and its box says how Cursor receives it
  await ask('sms', question('Quale nodo?'));
  const win = page.getByTestId('qwin');
  await expect(win).toContainText('Quale nodo?');
  await page.getByTestId('qwin-card-other').click();
  await expect(page.getByTestId('qwin-card-other-note')).toContainText('Cursor la riceve come risposta scritta');
  await page.getByTestId('qwin-card-other-cancel').click();
  await page.getByTestId('qwin-card-opt-1').click(); // answered
  await expect(win).toHaveCount(0);
  // a Claude chat's question has it too, without the note
  await ask('fix', question('Quale ramo?'));
  await expect(win).toContainText('Quale ramo?');
  await page.getByTestId('qwin-card-other').click();
  await expect(page.getByTestId('qwin-card-other-input')).toBeVisible();
  await expect(page.getByTestId('qwin-card-other-note')).toHaveCount(0);
  await page.getByTestId('qwin-card-other-cancel').click();
  await page.getByTestId('qwin-card-opt-1').click();
  await expect(win).toHaveCount(0);
  // C4: a permission with a very long command, on a page: the window keeps its buttons in sight
  await goPage(page, 'costi');
  await expect(page.getByTestId('brain-page-costi')).toBeVisible();
  const long = Array.from({ length: 200 }, (_, i) => `echo riga ${i}`).join('\n');
  await ask('mappa', { type: 'permission', tool: 'Bash', title: 'Bash · script lungo', detail: long, input: { command: long } });
  const allow = page.getByTestId('qwin-card-opt-1');
  await expect(allow).toBeVisible();
  const box = (await allow.boundingBox())!;
  const vh = await page.evaluate(() => innerHeight);
  expect(box.y + box.height).toBeLessThanOrEqual(vh);
  // C7: a failed answer brings the card back, answerable again
  await demo(app, d => d.failNextAnswer(), null);
  const card = page.getByTestId('qwin-card');
  await card.focus();
  await page.keyboard.press('1');
  await expect(page.getByTestId('toasts')).toContainText('Risposta non inviata');
  await expect(card).toBeVisible();
  await expect(card).not.toHaveAttribute('aria-busy', 'true');
  await card.focus();
  await page.keyboard.press('1');
  await expect(win).toHaveCount(0);
  await app.close();
});
