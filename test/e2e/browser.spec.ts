// Internal browser + MCP, end to end: the real app (SB_MCP_PORT=0), a local fixture site with a form, a same-origin and
// a cross-origin (out-of-process) iframe, dialogs, popups, fetches and console errors. The test drives the MCP endpoint
// over HTTP exactly like an agent would, and lays out two tabs side by side through views:layout.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './helpers';
import { startSites, McpClient, refOf, pngSize, type Sites } from './fixture-server';

let app: ElectronApplication;
let page: Page;
let userData: string;
let sites: Sites;
let agent: McpClient;

test.describe.serial('internal browser over MCP', () => {
  test.beforeAll(async () => {
    sites = await startSites();
    ({ app, page, userData } = await launch());
    // Playwright attaches its own CDP session to every page of the app (our tabs too) and auto-dismisses JavaScript
    // dialogs unless someone listens: listen and do nothing, so the dialogs stay for the app's agent to answer.
    app.context().on('dialog', () => {});
    // this test drives views:layout itself: the UI stops reporting its browser tiles' rects (ui:command layout off)
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().startsWith('file:')) w.webContents.send('ui:command', { action: 'layout', value: 'off' }); });
    const info = await page.evaluate(() => window.sb.invoke('app:info', undefined));
    expect(info.mcpUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    agent = new McpClient(info.mcpUrl);
    const init = await agent.init();
    expect(init.protocolVersion).toBe('2025-06-18');
    expect(String(init.instructions)).toContain('handle_dialog');
    expect(agent.sessionId).not.toBe('');
  });

  test.afterAll(async () => {
    await app?.close();
    await sites?.close();
  });

  test('lists the tools and refuses foreign origins', async () => {
    const r = await agent.rpc('tools/list');
    const names = (r.result?.tools as Array<{ name: string }>).map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['tabs_list', 'navigate', 'read_page', 'click', 'fill_form', 'handle_dialog', 'network_requests', 'handoff_to_user']));
    expect(names.length).toBeLessThanOrEqual(30);
    const evil = await agent.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { origin: 'http://evil.example' });
    expect(evil.status).toBe(403);
    const local = await agent.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { origin: sites.a });
    expect(local.status).toBe(403);
  });

  test('navigates and reads the page, both iframes included (cross-origin too)', async () => {
    const nav = await agent.ok('navigate', { url: `${sites.a}/index.html` });
    expect(nav).toContain('Fixture QA');
    const tree = await agent.ok('read_page');
    expect(tree).toMatch(/textbox "Nome" \[e\d+\]/);
    expect(tree).toMatch(/combobox "Città" value="--" options=--\|Roma\|Milano \[e\d+\]/);
    expect(tree).toMatch(/iframe "Frame interno" \[e\d+\] → frame f\d+ http:\/\/127\.0\.0\.1:\d+/);
    expect(tree).toMatch(/iframe "Frame esterno" \[e\d+\] → frame f\d+ http:\/\/localhost:\d+ \(cross-origin\)/);
    expect(tree).toMatch(/button "Bottone interno" \[f\d+e\d+\]/);
    expect(tree).toMatch(/button "Conferma codice" \[f\d+e\d+\]/);
    // the cross-origin frame really runs in its own process (an out-of-process iframe)
    const pids = await app.evaluate(({ webContents }) => webContents.getAllWebContents()
      .filter(w => w.getURL().endsWith('/index.html')).map(w => w.mainFrame.framesInSubtree.map(f => `${f.origin} ${f.osProcessId}`)));
    const frames = pids.flat();
    const topPid = frames.find(f => f.startsWith('http://127.0.0.1'))!.split(' ')[1];
    const crossPid = frames.find(f => f.startsWith('http://localhost'))!.split(' ')[1];
    expect(crossPid).not.toBe(topPid);
    const interactive = await agent.ok('read_page', { filter: 'interactive' });
    expect(interactive).not.toContain('heading "Pagina di prova"');
    const found = await agent.ok('find', { query: 'conferma' });
    expect(found).toMatch(/button "Chiedi conferma" \[e\d+\]/);
    expect(found).toMatch(/\(in iframe f\d+ http:\/\/localhost:\d+\)/);
  });

  test('fills a form in one call and submits it with a trusted click', async () => {
    const tree = await agent.ok('read_page', { filter: 'interactive' });
    const filled = await agent.ok('fill_form', { fields: [
      { ref: refOf(tree, /textbox "Nome"/), value: 'Mario' },
      { ref: refOf(tree, /textbox "Email"/), value: 'mario@example.com' },
      { ref: refOf(tree, /combobox "Città"/), value: 'Roma' },
      { ref: refOf(tree, /checkbox "Accetto"/), value: true },
    ] });
    expect(filled).toContain('= "Mario"');
    expect(filled).toContain('= "Roma"');
    expect(filled).toContain('= checked');
    expect(filled).not.toContain('FAILED');
    await agent.ok('click', { ref: refOf(tree, /button "Invia"/) });
    expect(await agent.ok('get_page_text')).toContain('Inviato: Mario / mario@example.com / rm / true');
    // type adds real key presses to a field
    const typed = await agent.ok('type', { ref: refOf(tree, /textbox "Nome"/), text: ' Rossi' });
    expect(typed).toContain('Typed 6 characters');
    expect(await agent.ok('javascript', { code: 'document.getElementById("nome").value' })).toBe('Mario Rossi');
  });

  test('clicks and types inside the same-origin and the cross-origin iframe', async () => {
    let tree = await agent.ok('read_page');
    const inner = refOf(tree, /button "Bottone interno"/);
    await agent.ok('click', { ref: inner });
    await agent.ok('click', { ref: inner });
    expect(await agent.ok('get_page_text')).toMatch(/Clic interni: 2/);
    tree = await agent.ok('read_page');
    await agent.ok('type', { ref: refOf(tree, /textbox "Codice"/), text: '42' });
    const res = await agent.ok('click', { ref: refOf(tree, /button "Conferma codice"/) });
    expect(res).not.toContain('Failed requests');
    expect(await agent.ok('wait_for', { text: 'Codice: 42', timeout_ms: 5000 })).toContain('Done');
    const net = await agent.ok('network_requests', { urlPattern: '/api/cross' });
    expect(net).toMatch(/r\d+ 200 GET Fetch \[iframe\] http:\/\/localhost:\d+\/api\/cross\?c=42/);
    expect(await agent.ok('javascript', { code: 'document.getElementById("out").textContent', frame: refOf(tree, /button "Conferma codice"/).replace(/e\d+$/, '') })).toBe('Codice: 42');
  });

  test('dialogs never freeze the agent', async () => {
    const tree = await agent.ok('read_page', { filter: 'interactive' });
    const shown = await agent.ok('click', { ref: refOf(tree, /button "Mostra alert"/) });
    expect(shown).toContain('Dialog open: alert "Ciao agente"');
    const blocked = await agent.call('read_page');
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toContain('handle_dialog');
    const tabs = await page.evaluate(() => window.sb.invoke('browser:list', undefined));
    expect(tabs.find(t => t.dialog)?.dialog).toBe('alert: Ciao agente');
    // the agent can still see the page while the dialog is open
    expect((await agent.call('screenshot')).images).toHaveLength(1);
    expect(await agent.ok('handle_dialog', { accept: true })).toContain('Accepted the alert "Ciao agente"');
    // confirm: OK
    expect(await agent.ok('click', { ref: refOf(tree, /button "Chiedi conferma"/) })).toContain('Dialog open: confirm "Sei sicuro?"');
    await agent.ok('handle_dialog', { accept: true });
    expect(await agent.ok('get_page_text')).toContain('Conferma: true');
    // confirm raised inside the cross-origin iframe: Cancel
    expect(await agent.ok('click', { ref: refOf(tree, /button "Conferma nel frame"/) })).toContain('Dialog open: confirm "Confermi dal frame?"');
    await agent.ok('handle_dialog', { accept: false });
    expect(await agent.ok('get_page_text')).toContain('Frame conferma: false');
    expect(await agent.ok('handle_dialog', { accept: true })).toContain('No dialog is open');
  });

  test('reports network, failed requests and console errors, and saves a response body', async () => {
    const tree = await agent.ok('read_page', { filter: 'interactive' });
    await agent.ok('click', { ref: refOf(tree, /button "Carica dati"/) });
    expect(await agent.ok('wait_for', { text: 'Dati: uno, due, tre' })).toContain('Done');
    const list = await agent.ok('network_requests', { urlPattern: '/api/data' });
    const id = /(r\d+) 200 GET Fetch/.exec(list)?.[1];
    expect(id).toBeTruthy();
    const detail = await agent.ok('network_requests', { requestId: id });
    const saved = /saved to (.+)$/m.exec(detail)?.[1];
    expect(saved && fs.readFileSync(saved, 'utf8')).toContain('"uno"');
    expect(saved?.startsWith(path.join(userData, 'evidence'))).toBe(true);
    expect(await agent.ok('click', { ref: refOf(tree, /button "Richiesta fallita"/) })).toMatch(/Failed requests \(1\): r\d+ 500 GET Fetch/);
    expect(await agent.ok('click', { ref: refOf(tree, /button "Errore console"/) })).toContain('Console errors (1 new): boom dal pulsante');
    expect(await agent.ok('console_messages', { onlyErrors: true })).toContain('[error] boom dal pulsante');
    expect(await agent.ok('network_requests', { status: 'error' })).toContain('/api/fail');
  });

  test('popups and target=_blank links open as tabs of the same agent', async () => {
    const tree = await agent.ok('read_page', { filter: 'interactive' });
    const first = /Tab (t\d+)/.exec(tree)![1]!;
    const blank = await agent.ok('click', { ref: refOf(tree, /link "Apri in nuova scheda"/) });
    expect(blank).toMatch(/New tab t\d+ opened by t\d+: "Popup"/);
    expect(await agent.ok('get_page_text')).toContain('opener: no');
    await agent.ok('tabs_select', { tabId: first });
    const pop = await agent.ok('click', { ref: refOf(tree, /button "Apri popup"/) });
    expect(pop).toMatch(/New tab t\d+ opened by t\d+: "Popup"/);
    expect(await agent.ok('get_page_text')).toContain('opener: si');   // window.opener kept: OAuth popups work
    const list = await agent.ok('tabs_list');
    expect(list.split('\n')).toHaveLength(3);
    // the popup is a full agent tab (trusted input works there), and closing itself hands the agent back to its opener
    const popTree = await agent.ok('read_page', { filter: 'interactive' });
    await agent.ok('click', { ref: refOf(popTree, /button "Saluta"/) });
    expect(await agent.ok('get_page_text')).toContain('opener: si / ciao');
    const closed = await agent.ok('click', { ref: refOf(popTree, /button "Chiudi"/) });
    expect(closed).toContain(`closed itself. Your active tab is now ${first}`);
    expect((await agent.ok('tabs_list')).split('\n')).toHaveLength(2);
    await agent.ok('tabs_select', { tabId: first });
  });

  test('screenshots are CSS-pixel PNGs and can be saved as evidence', async () => {
    const shot = await agent.call('screenshot');
    expect(shot.images[0]?.mimeType).toBe('image/png');
    expect(pngSize(shot.images[0]!.data)).toEqual({ width: 1280, height: 800 });
    const saved = await agent.ok('screenshot', { save_to: 'TC-1/home.png', return_image: false });
    const file = /Saved: (.+)$/m.exec(saved)?.[1] ?? '';
    expect(fs.existsSync(file)).toBe(true);
    expect(file).toContain(path.join('evidence', `external-${agent.sessionId.slice(0, 8)}`, 'TC-1', 'home.png'));
    const escape = await agent.call('screenshot', { save_to: '../../outside.png' });
    expect(escape.isError).toBe(true);
    const full = await agent.call('screenshot', { full_page: true });
    expect(pngSize(full.images[0]!.data).width).toBe(1280);
    const region = await agent.call('screenshot', { region: [0, 0, 200, 100] });
    expect(region.text).toContain('region (0,0)-(200,100)');
    fs.mkdirSync(path.resolve('test-results', 'shots'), { recursive: true });
    fs.writeFileSync(path.resolve('test-results', 'shots', 'browser-agent-tab.png'), Buffer.from(shot.images[0]!.data, 'base64'));
  });

  test('each MCP session only sees its own tabs', async () => {
    const other = new McpClient(agent.url);
    await other.init();
    expect(other.sessionId).not.toBe(agent.sessionId);
    expect(await other.ok('tabs_list')).toContain('No tabs yet');
    const mine = /^(t\d+)/m.exec(await agent.ok('tabs_list'))![1]!;
    const steal = await other.call('click', { tabId: mine, coordinate: [10, 10] });
    expect(steal.isError).toBe(true);
    expect(steal.text).toContain(`No tab "${mine}" among your tabs`);
    // a tab the user opens for an app chat belongs to that chat, not to external clients
    await page.evaluate(() => window.sb.invoke('browser:open', { url: 'about:blank', ownerChatId: 'c-e2e' }));
    const all = await page.evaluate(() => window.sb.invoke('browser:list', undefined));
    expect(all.find(t => t.ownerChatId === 'c-e2e')?.group).toBe('chat:c-e2e');
    expect(await other.ok('tabs_list')).toContain('No tabs yet');
  });

  test('a hand-off waits for the user and resolves when they click Fatto', async () => {
    type W = { __handoffs: unknown[] };
    await page.evaluate(() => { (window as unknown as W).__handoffs = []; window.sb.on('browser:handoff', h => { (window as unknown as W).__handoffs.push(h); }); });
    const waiting = agent.ok('handoff_to_user', { reason: 'Login richiesto', instructions: 'Accedi con il tuo account di test', wait_seconds: 30 });
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('browser:handoffs', undefined))).length).toBe(1);
    const [h] = await page.evaluate(() => window.sb.invoke('browser:handoffs', undefined));
    expect(h).toMatchObject({ reason: 'Login richiesto', state: 'open' });
    const blocked = await agent.call('click', { coordinate: [5, 5] });
    expect(blocked.text).toContain('The user is working in this tab');
    await page.evaluate(id => window.sb.invoke('browser:handoffResolve', { id, outcome: 'done', note: 'fatto' }), h!.id);
    expect(await waiting).toContain('The user clicked Fatto (done): "fatto"');
    const events = await page.evaluate(() => (window as unknown as { __handoffs: unknown[] }).__handoffs);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ id: h!.id, state: 'open' }), expect.objectContaining({ id: h!.id, state: 'done' })]));
    const short = await agent.ok('handoff_to_user', { reason: 'MFA', wait_seconds: 5 });
    expect(short).toMatch(/Still waiting for the user \(hand-off (h\d+)/);
    const id = /hand-off (h\d+)/.exec(short)![1]!;
    await page.evaluate(i => window.sb.invoke('browser:handoffResolve', { id: i, outcome: 'failed' }), id);
    expect(await agent.ok('handoff_to_user', { handoff_id: id, wait_seconds: 5 })).toContain('Non riesco (failed)');
  });

  test('two tabs laid out side by side in the window (views:layout)', async () => {
    await agent.ok('tabs_create', { url: `${sites.b}/cross.html` });
    const tabs = await page.evaluate(() => window.sb.invoke('browser:list', undefined));
    const shown = tabs.filter(t => t.group?.startsWith('mcp:') && /index\.html|cross\.html/.test(t.url)).slice(0, 2);
    expect(shown).toHaveLength(2);
    await page.evaluate(ids => window.sb.invoke('views:layout', [
      { tabId: ids[0]!, rect: { x: 0, y: 60, width: 790, height: 900 } },
      { tabId: ids[1]!, rect: { x: 800, y: 60, width: 790, height: 900 } },
    ]), shown.map(t => t.id));
    const bounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:'))!;
      return win.contentView.children.map(v => v.getBounds());
    });
    expect(bounds).toEqual([{ x: 0, y: 60, width: 790, height: 900 }, { x: 800, y: 60, width: 790, height: 900 }]);
    expect(await agent.ok('tabs_list')).toMatch(/\[on screen\]/);
    // the agent's screenshot follows the tile size
    expect(pngSize((await agent.call('screenshot', { tabId: shown[1]!.id })).images[0]!.data)).toEqual({ width: 790, height: 900 });
    await page.waitForTimeout(500);
    const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:'))!;
      const size = win.getContentSize();
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: size[0]!, height: size[1]! } });
      const src = sources.find(s => s.id === win.getMediaSourceId()) ?? sources.find(s => s.name === 'second-brain');
      return src ? src.thumbnail.toPNG().toString('base64') : '';
    });
    expect(png.length).toBeGreaterThan(1000);
    fs.mkdirSync(path.resolve('test-results', 'shots'), { recursive: true });
    fs.writeFileSync(path.resolve('test-results', 'shots', 'browser-two-tabs.png'), Buffer.from(png, 'base64'));
    // hiding them parks them offscreen: they keep rendering for the agent
    await page.evaluate(() => window.sb.invoke('views:layout', []));
    const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:'))!.contentView.children.length);
    expect(after).toBe(0);
    expect((await agent.call('screenshot', { tabId: shown[1]!.id })).images).toHaveLength(1);
  });
});
