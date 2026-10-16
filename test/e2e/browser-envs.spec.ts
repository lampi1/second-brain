// Browser environments, sign-in status and the password guard, end to end on the fixture site:
// - two environments open together on the same remote host keep their sessions apart (a login cookie set in one is
//   absent in the other); a local stack loads only in "local" (ADR 0063); session status valid / expiring / expired;
//   last sign-in time;
// - HARD LIMIT: on a remote host (127.0.0.2 is not a local stack) nothing puts a password into a field or reads one:
//   type / fill_form / key (also after Tab), a "show password" toggle, a field that becomes a password on focus,
//   javascript (reading, during a hand-off, shadow roots, hidden fields, type changes), credentials in URLs; on
//   127.0.0.1 the agent signs in by itself with a test account;
// - a login hand-off reaches the feed as "Rifai l'accesso a <env>"; DELETE of an MCP session closes its tabs.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launch } from './helpers';
import { startSites, McpClient, refOf, type Sites } from './fixture-server';

let app: ElectronApplication;
let page: Page;
let sites: Sites;
let agent: McpClient;

const cookiesIn = (env: string) => app.evaluate(async ({ session }, e) => (await session.fromPartition(`persist:env-${e}`).cookies.get({ name: 'sb_auth' })).length, env);
const envLine = async (id: string) => (await agent.ok('environments')).split('\n').find(l => l.startsWith(`${id}:`)) ?? '';
const refused = async (name: string, args: Record<string, unknown>, text = 'Refused') => {
  const r = await agent.call(name, args);
  expect(r.isError, `${name} ${JSON.stringify(args)} → ${r.text}`).toBe(true);
  expect(r.text).toContain(text);
  return r.text;
};

test.describe.serial('browser environments and the password guard', () => {
  test.beforeAll(async () => {
    sites = await startSites();
    ({ app, page } = await launch());
    app.context().on('dialog', () => {});     // see browser.spec.ts: leave dialogs to the app's agent
    const info = await page.evaluate(() => window.sb.invoke('app:info', undefined));
    agent = new McpClient(info.mcpUrl);
    await agent.init();
  });

  test.afterAll(async () => {
    await app?.close();
    await sites?.close();
  });

  test('the agent signs in by itself on a local stack, in environment "local" (the only one for local stacks, ADR 0063)', async () => {
    const opened = await agent.ok('tabs_create', { url: `${sites.a}/login` });
    expect(opened).toContain('env local');
    expect(opened).toContain('Sign-in page on a local stack (127.0.0.1): you may sign in');
    const form = await agent.ok('read_page', { filter: 'interactive' });
    // 127.0.0.1 is a local stack: a password may be filled (test accounts)
    const filled = await agent.ok('fill_form', { fields: [{ ref: refOf(form, /textbox "Utente"/), value: 'mario' }, { ref: refOf(form, /type=password/), value: 'test-only' }] });
    expect(filled).not.toContain('FAILED');
    await agent.ok('click', { ref: refOf(form, /button "Entra"/) });
    expect(await agent.ok('wait_for', { text: 'Benvenuto mario' })).toContain('Done');
    expect(await cookiesIn('local')).toBe(1);
    // a local stack never loads in another environment (a chat once opened localhost where it had no session)
    await refused('tabs_create', { url: `${sites.a}/app`, env: 'local-b' }, 'local stacks always load in environment "local"');

    const envs = await page.evaluate(() => window.sb.invoke('browser:envList', undefined));
    const local = envs.find(e => e.id === 'local')!;
    expect(local.lastLoginAt).toBeGreaterThan(0);
    expect(local.hosts[0]).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(local.lastUrl).toMatch(/\/app$/);
    expect(typeof local.encryptedAtRest === 'boolean' || local.encryptedAtRest === null).toBe(true);
    expect(envs.find(e => e.id === 'local-b')).toBeUndefined();
  });

  test('two environments on the same remote host keep their sessions apart', async () => {
    test.skip(!sites.remote, '127.0.0.2 cannot be bound on this machine');
    const opened = await agent.ok('tabs_create', { url: `${sites.remote}/login`, env: 'remote-a' });
    expect(opened).toContain('env remote-a');
    // the user signs in on the page (on a remote host an agent never types a password)
    await app.evaluate(({ webContents }, u) => webContents.getAllWebContents().find(w => w.getURL().startsWith(`${u}/login`))!.executeJavaScript(
      'user.value = "mario"; pass.value = "test-only"; document.getElementById("f").requestSubmit();'), sites.remote!);
    expect(await agent.ok('wait_for', { text: 'Benvenuto mario' })).toContain('Done');
    expect(await cookiesIn('remote-a')).toBe(1);

    // the second environment, same host, opened together: no cookie, the app sends it to the login page
    const other = await agent.ok('tabs_create', { url: `${sites.remote}/app`, env: 'remote-b' });
    expect(other).toContain('/login?next=/app');
    expect(other).toContain('env remote-b');
    expect(await cookiesIn('remote-b')).toBe(0);
    await expect.poll(() => agent.ok('tabs_list')).toMatch(/env=remote-a \(session valid/);
    await expect.poll(() => agent.ok('tabs_list')).toMatch(/env=remote-b \(session expired/);

    const tabs = await page.evaluate(() => window.sb.invoke('browser:list', undefined));
    const a = tabs.find(t => t.env === 'remote-a')!, b = tabs.find(t => t.env === 'remote-b')!;
    expect(a.envColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(a.envColor).not.toBe(b.envColor);
    expect(a.session).toBe('valid');
    expect(b.session).toBe('expired');

    const envs = await page.evaluate(() => window.sb.invoke('browser:envList', undefined));
    const ea = envs.find(e => e.id === 'remote-a')!;
    expect(ea.lastLoginAt).toBeGreaterThan(0);
    expect(ea.hosts[0]).toMatch(/^127\.0\.0\.2:\d+$/);
    expect(ea.lastUrl).toMatch(/\/app$/);
    expect(envs.find(e => e.id === 'remote-b')?.lastLoginAt).toBeNull();
  });

  test('session status: expiring within 24 h, expired once the auth cookie is gone', async () => {
    await agent.ok('tabs_create', { url: `${sites.a}/login?short=1` });
    const form = await agent.ok('read_page', { filter: 'interactive' });
    await agent.ok('fill_form', { fields: [{ ref: refOf(form, /textbox "Utente"/), value: 'anna' }, { ref: refOf(form, /type=password/), value: 'test-only' }] });
    await agent.ok('click', { ref: refOf(form, /button "Entra"/) });
    await agent.ok('wait_for', { text: 'Benvenuto anna' });
    await expect.poll(() => envLine('local')).toContain('session expiring');
    const app2 = await agent.ok('read_page', { filter: 'interactive' });
    await agent.ok('click', { ref: refOf(app2, /link "Esci"/) });
    expect(await cookiesIn('local')).toBe(0);
    await expect.poll(() => envLine('local')).toContain('session expired');
  });

  test('the default environment comes from the host, and a used tab tells when another host would default elsewhere', async () => {
    test.skip(!sites.remote, '127.0.0.2 cannot be bound on this machine');
    const t = await agent.ok('tabs_create', { url: `${sites.b}/popup.html` });
    expect(t).toContain('env local');                           // localhost → local
    const moved = await agent.ok('navigate', { url: `${sites.remote}/index.html`, env: 'remote-a' });
    expect(moved).toMatch(/Opened tab t\d+ in environment remote-a \(tab t\d+ stays in local\)/);
  });

  test('environments shows an agent only its own tabs, and no hosts of environments only the user used', async () => {
    await page.evaluate(u => window.sb.invoke('browser:open', { url: u, env: 'own-only' }), `${sites.a}/popup.html`);
    await expect.poll(() => envLine('own-only')).toContain('hosts (hidden: used only by the user)');
    expect(await envLine('own-only')).toContain('your tabs -');
    const other = new McpClient(agent.url);
    await other.init();
    await other.ok('tabs_create', { url: `${sites.a}/popup.html` });
    const mine = (await agent.ok('environments')).split('\n').find(l => l.startsWith('local:'))!;
    const theirs = (await other.ok('environments')).split('\n').find(l => l.startsWith('local:'))!;
    const ids = (l: string) => /your tabs ([^\n]*)$/.exec(l)![1]!.split(', ');
    expect(ids(mine).some(id => ids(theirs).includes(id))).toBe(false);
  });

  test('HARD LIMIT: type, fill_form and key never put a password into a remote field', async () => {
    test.skip(!sites.remote, '127.0.0.2 cannot be bound on this machine');
    const nav = await agent.ok('tabs_create', { url: `${sites.remote}/login` });
    expect(nav).toContain('env ip-127-0-0-2');
    expect(nav).toContain('Sign-in page in environment ip-127-0-0-2 (127.0.0.2)');
    expect(nav).toContain('handoff_to_user with kind "login"');
    let form = await agent.ok('read_page', { filter: 'interactive' });
    const user = refOf(form, /textbox "Utente"/), pass = refOf(form, /textbox "Password"/), pin = refOf(form, /textbox "Codice di sblocco"/);

    await refused('fill_form', { fields: [{ ref: user, value: 'mario' }, { ref: pass, value: 'x' }] }, 'handoff_to_user');
    expect(await agent.ok('read_page', { filter: 'interactive' })).not.toMatch(/textbox "Utente" value=/);   // nothing filled at all
    await refused('type', { ref: pass, text: 'segreto' }, 'password field on 127.0.0.2');
    await agent.ok('click', { ref: pass });
    await refused('key', { keys: 's e g r e t o' });
    await refused('key', { keys: 'ctrl+v' });
    expect((await agent.call('key', { keys: 'shift+Tab' })).isError).toBe(false);   // moving focus is fine

    // focus-moving keys inside one call: the check runs again before every segment
    await refused('type', { ref: user, text: 'mario\tSegreto1' }, 'password field');
    form = await agent.ok('read_page', { filter: 'interactive' });
    expect(form).toMatch(/textbox "Utente" value="mario"/);
    expect(form).not.toMatch(/type=password value=/);           // the password field stayed empty
    await agent.ok('click', { ref: user });
    await refused('key', { keys: 'Tab S e g r e t o' });
    expect(await agent.ok('read_page', { filter: 'interactive' })).not.toMatch(/type=password value=/);

    // a "show password" toggle turns it into type=text: still a password field (seen as one before)
    await agent.ok('click', { ref: refOf(form, /button "Mostra"/) });
    expect(await agent.ok('read_page', { filter: 'interactive' })).toMatch(/textbox "Password" password \[/);
    await refused('type', { ref: pass, text: 'segreto' });
    await refused('fill_form', { fields: [{ ref: pass, value: 'segreto' }] });
    // a field that becomes a password only on focus: fill_form checks again after focusing
    await refused('fill_form', { fields: [{ ref: pin, value: '1234' }] });
    expect(await agent.ok('read_page', { filter: 'interactive' })).not.toMatch(/Codice di sblocco" .*value=/);

    // a non-password field on the same remote page is fine
    expect(await agent.ok('type', { ref: user, text: '!' })).toContain('Typed 1 characters');
  });

  test('HARD LIMIT: javascript cannot read or change password fields on remote hosts', async () => {
    test.skip(!sites.remote, '127.0.0.2 cannot be bound on this machine');
    await agent.ok('navigate', { url: `${sites.remote}/login` });
    await refused('javascript', { code: 'document.getElementById("pass").value' }, 'holds a password field');
    await refused('javascript', { code: '[...document.querySelectorAll("input")].map(i => i.value)' });
    await refused('javascript', { code: 'document.title' });                       // any script, reading included
    await agent.ok('navigate', { url: `${sites.remote}/shadow.html` });          // password inside an open shadow root
    await refused('javascript', { code: '1 + 1' }, 'holds a password field');
    await agent.ok('navigate', { url: `${sites.remote}/hidden.html` });          // a hidden password field counts too
    await refused('javascript', { code: '1 + 1' }, 'holds a password field');
    await agent.ok('navigate', { url: `${sites.remote}/index.html` });           // no password field here...
    expect(await agent.ok('javascript', { code: 'document.title' })).toBe('Fixture QA');
    await refused('javascript', { code: 'document.getElementById("nome").type = "text"' }, "change an input's type");   // ...but no type changes
    await refused('javascript', { code: 'document.getElementById("nome").setAttribute("type", "text")' }, "change an input's type");
  });

  test('HARD LIMIT: no credentials in remote URLs, and they never show in results', async () => {
    test.skip(!sites.remote, '127.0.0.2 cannot be bound on this machine');
    const host = sites.remote!.replace('http://', '');
    const cred = ['mario', 'segreto'].join(':');   // user:password, built here so the source holds no credential URL
    await refused('navigate', { url: `http://${cred}@${host}/index.html` }, 'carries credentials');
    const local = await agent.ok('navigate', { url: `http://${cred}@${sites.a.replace('http://', '')}/index.html`, env: 'local' });
    expect(local).not.toContain('segreto');
  });

  test('a login hand-off blocks javascript while the user signs in, is announced in the feed and records the sign-in', async () => {
    test.skip(!sites.remote, '127.0.0.2 cannot be bound on this machine');
    await agent.ok('navigate', { url: `${sites.remote}/index.html`, env: 'ip-127-0-0-2' });   // the last tab is in "local"
    const waiting = agent.ok('handoff_to_user', { kind: 'login', wait_seconds: 30 });
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('browser:handoffs', undefined))).length).toBe(1);
    const [h] = await page.evaluate(() => window.sb.invoke('browser:handoffs', undefined));
    expect(h).toMatchObject({ kind: 'login', env: 'ip-127-0-0-2', reason: "Rifai l'accesso a ip-127-0-0-2", state: 'open' });
    await refused('javascript', { code: 'document.title' }, 'is working in this tab');   // even without a password field
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('feed:list', undefined))).some(e => e.kind === 'login' && e.title === "Rifai l'accesso a ip-127-0-0-2")).toBe(true);
    await page.evaluate(id => window.sb.invoke('browser:handoffResolve', { id, outcome: 'done' }), h!.id);
    expect(await waiting).toContain('The user clicked Fatto (done)');
    const env = (await page.evaluate(() => window.sb.invoke('browser:envList', undefined))).find(e => e.id === 'ip-127-0-0-2')!;
    expect(env.lastLoginAt).toBeGreaterThan(0);
    // another client cannot read someone else's hand-off (ids are sequential)
    const other = new McpClient(agent.url);
    await other.init();
    const peek = await other.call('handoff_to_user', { handoff_id: h!.id, wait_seconds: 5 });
    expect(peek.isError).toBe(true);
    expect(peek.text).toContain(`No hand-off "${h!.id}" for you`);
  });

  test('ending an MCP session (DELETE) closes its tabs', async () => {
    const other = new McpClient(agent.url);
    await other.init();
    await other.ok('tabs_create', { url: `${sites.a}/popup.html` });
    const before = (await page.evaluate(() => window.sb.invoke('browser:list', undefined))).filter(t => t.group === `mcp:${other.sessionId}`);
    expect(before).toHaveLength(1);
    const res = await fetch(agent.url, { method: 'DELETE', headers: { 'mcp-session-id': other.sessionId } });
    expect(res.status).toBe(204);
    await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('browser:list', undefined))).filter(t => t.group === `mcp:${other.sessionId}`).length).toBe(0);
  });
});
