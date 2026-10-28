// The routine browser (packages/routine-runtime/src/browser-mcp.ts) against a page that reproduces OrisDent Air's
// widgets, in a real headless Chromium: the snapshot gives refs to a jQuery-style toolbar div.btn, a Bootstrap
// data-toggle span, a datepicker day and an odontogram SVG <g>; `type` fires keyup like bootstrap-datepicker needs;
// `eval` runs only on the declared origins and its result is masked. Skipped when no Chromium/Edge is installed.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBrowserSession, launchBrowser, type BrowserServerConfig } from '../../../packages/routine-runtime/src/browser-mcp';
import { tempDir } from './fakes';

const browserAvailable = (() => {
  try {
    const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : path.join(process.env.HOME ?? '', '.cache', 'ms-playwright');
    if (fs.existsSync(local) && fs.readdirSync(local).some(d => d.startsWith('chromium'))) return true;
    return process.platform === 'win32' && fs.existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
  } catch { return false; }
})();

const SECRET = ['Widget', 'Value', String(7 * 11)].join('-'); // built at run time: the guard reads it as a secret
const PAGE = `<!doctype html><html><head><title>Widgets</title><style>
  .btn-toolbar { cursor: pointer; display: inline-block; padding: 4px; } td.day { cursor: pointer; } td.day.disabled { cursor: default; }
</style></head><body>
<div id="toolbar"><div class="btn btn-col btn-toolbar" id="print"><a><i class="fa fa-print"></i></a></div></div>
<span data-toggle="collapse" data-target="#ins">Inserimento prestazione</span><div id="ins" style="display:none">open</div>
<input id="date" placeholder="Data" value="01/01/2020">
<table class="datepicker"><tr><td class="day disabled">30</td><td class="day">15</td></tr></table>
<svg width="200" height="100"><g id="tooth-11"><g class="body"><rect x="10" y="10" width="40" height="40"></rect></g></g></svg>
<input type="password" id="pw">
<p id="log"></p>
<button id="broken" onclick="console.error('boom'); fetch('/missing?token=abc'); if (confirm('Delete?')) log('deleted');">Broken</button>
<script>
  const log = t => { document.getElementById('log').textContent += t + ';'; };
  document.getElementById('print').addEventListener('click', () => log('print'));
  document.querySelector('[data-toggle]').addEventListener('click', () => { document.getElementById('ins').style.display = 'block'; log('collapse'); });
  document.querySelector('td.day:not(.disabled)').addEventListener('click', () => log('day'));
  document.querySelector('g.body').addEventListener('click', () => log('tooth'));
  // bootstrap-datepicker: the model follows the input only on keyup; on blur forceParse writes the model back
  let model = '01/01/2020'; const d = document.getElementById('date');
  d.addEventListener('keyup', () => { model = d.value; });
  d.addEventListener('blur', () => { d.value = model; log('blur'); });
</script></body></html>`;

type Reply = { result?: { content: { text: string }[]; isError?: boolean } };

describe.skipIf(!browserAvailable)('routine browser on Air-like widgets', () => {
  let server: http.Server;
  let origin = '';
  let browser: Awaited<ReturnType<typeof launchBrowser>>;
  let session: ReturnType<typeof createBrowserSession>;
  let seq = 0;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await session.handle({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } }) as Reply;
    return { text: r.result!.content[0]!.text, isError: r.result!.isError === true };
  };
  const refOf = (snap: string, pattern: string) => new RegExp(`\\[(e\\d+)\\] ${pattern}`).exec(snap)?.[1];
  const log = () => browser.page.evaluate<string>('document.getElementById("log").textContent');

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/missing')) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('no such record'); return; }
      res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const dir = tempDir();
    // the credential signs in another site: no login here, but its password is masked in every reply
    const config: BrowserServerConfig = { origins: [origin], profileDir: path.join(dir, 'profile'), evidence: path.join(dir, 'evidence'), headless: true,
      logins: [{ id: 'tester', loginUrl: 'https://other.example.test/Account/Login', user: 'u', password: SECRET }] };
    browser = await launchBrowser(config);
    session = createBrowserSession(config, { page: async () => browser.page });
  }, 60_000);
  afterAll(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); }, 30_000);

  it('gives refs to the toolbar div.btn, the data-toggle span, the datepicker day and the SVG g, and clicks them', async () => {
    expect((await call('navigate', { url: `${origin}/` })).isError).toBe(false);
    const snap = (await call('snapshot')).text;
    const refs = [refOf(snap, 'div\\.btn "print"'), refOf(snap, 'span "Inserimento prestazione"'), refOf(snap, 'td\\.day "15"'), refOf(snap, 'g\\.body "class body" in #tooth-11')];
    expect(refs.every(Boolean), snap).toBe(true);
    expect(snap).not.toMatch(/td\.day "30"/); // a disabled day is not clickable
    for (const ref of refs) expect((await call('click', { ref })).isError).toBe(false);
    expect(await log()).toBe('print;collapse;day;tooth;');
    // click_at the SVG's centre (page pixels from a new snapshot line: the opened collapse moved it)
    const [, x, y] = /g\.body[^\n]*@(\d+),(\d+)/.exec((await call('snapshot')).text)!;
    expect((await call('click_at', { x: Number(x), y: Number(y) })).text).toMatch(/on rect/);
    expect(await log()).toBe('print;collapse;day;tooth;tooth;');
  }, 60_000);

  it('type fires keyup, so a datepicker keeps the new date after Tab', async () => {
    const snap = (await call('snapshot')).text;
    expect((await call('type', { ref: refOf(snap, 'input "Data"'), text: '15/03/2024', then: 'Tab' })).isError).toBe(false);
    expect(await browser.page.evaluate<string>('document.getElementById("date").value')).toBe('15/03/2024');
    expect(await log()).toContain('blur;');
  }, 60_000);

  it('an action reports new console errors and failed requests; a confirm is dismissed unless dialog accepts it', async () => {
    const broken = refOf((await call('snapshot')).text, 'button "Broken"');
    const first = await call('click', { ref: broken });
    expect(first.text).toMatch(/confirm dialog said "Delete\?" and was dismissed/);
    await call('wait', { idle: true });
    expect((await call('network')).text).toMatch(/GET \S+\/missing\?token=\*\*\* → 404 \| no such record/);
    expect((await call('console', { level: 'error' })).text).toContain('[error] boom');
    expect(await log()).not.toContain('deleted');
    expect((await call('dialog', { accept: true })).isError).toBe(false);
    const second = await call('click', { ref: broken });
    expect(second.text).toMatch(/was accepted/);
    // boom, and Chromium's own line for the 404; the 404 may land after the click's reply, then the next action says it
    const after = `${second.text}\n${(await call('wait', { idle: true })).text}`;
    expect(after).toMatch(/\d console errors?/);
    expect(after).toMatch(/1 failed request/);
    expect(await log()).toContain('deleted;');
  }, 60_000);

  it('eval masks the passwords, is refused while a password field holds one and off the declared origins', async () => {
    expect(await call('eval', { expression: `document.title + ' ' + ${JSON.stringify(SECRET)}` })).toMatchObject({ text: expect.stringMatching(/^Result: "Widgets \*\*\*"/), isError: false });
    const snap = (await call('snapshot')).text;
    expect((await call('fill_secret', { ref: refOf(snap, 'input\\[password\\]'), credential: 'tester' })).isError).toBe(false);
    const held = await call('eval', { expression: 'document.getElementById("pw").value.split("").reverse().join("")' });
    expect(held).toMatchObject({ isError: true, text: expect.stringMatching(/password field/) });
    await browser.page.goto('about:blank');
    expect(await call('eval', { expression: '1 + 1' })).toMatchObject({ isError: true, text: expect.stringMatching(/^Refused: eval runs only on/) });
  }, 60_000);
});
