// Unit tests of a remote connector's MCP OAuth login (issue #389, ADR 0273): discovery from the 401's challenge to the
// authorization server (a Keycloak-style issuer path included), dynamic registration or a pre-registered client id,
// PKCE + resource in the login URL, the token exchange and «Connesso come …», the refresh (early, forced by a 401,
// refused = logged out, server down = old token while valid), the HTTP client retrying once with a fresh token, and the
// store keeping the session encrypted, bound to the server's origin. No real port or network: fetch and the loopback
// listener are fakes.
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpOAuth, challenge, metadataUrls, whoOf, type Listener, type OAuthSession } from '../../../src/main/mcp-servers/oauth';
import { McpServerStore } from '../../../src/main/mcp-servers/store';
import { connect } from '../../../src/main/mcp-servers/client';
import type { SecretCipher } from '../../../src/main/engines/secrets';
import { tmp } from '../chats/helpers';
import { McpServersService } from '../../../src/main/mcp-servers/service';
import { McpServer } from '../../../src/main/mcp/server';
import { redact } from '../../../src/main/log';
import { OAUTH_SECRET_SLOT } from '../../../src/shared/mcp-servers';

const cipher: SecretCipher = { unavailable: () => null, encrypt: s => Buffer.from([...Buffer.from(s)].map(b => b ^ 0x5a)), decrypt: b => Buffer.from([...b].map(x => x ^ 0x5a)).toString() };
const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const MCP = 'https://mcp.example.com/mcp', KC = 'https://kc.example.com/realms/team';
const AS = { issuer: KC, authorization_endpoint: `${KC}/protocol/openid-connect/auth`, token_endpoint: `${KC}/protocol/openid-connect/token`, code_challenge_methods_supported: ['S256'] };

function world(o: { registration?: boolean; token?: (form: URLSearchParams) => Response; resource?: string; issuer?: string } = {}) {
  const calls: { url: string; body?: string }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, ...(body ? { body } : {}) });
    if (url === MCP) return new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="mcp:tools"' } });
    if (url === 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp') return json(200, { resource: o.resource ?? MCP, authorization_servers: [KC] });
    if (url === `${KC}/.well-known/openid-configuration`) return json(200, { ...AS, ...(o.issuer ? { issuer: o.issuer } : {}), ...(o.registration ? { registration_endpoint: `${KC}/clients-registrations/openid-connect` } : {}) });
    if (url.endsWith('/clients-registrations/openid-connect')) return json(201, { client_id: 'dyn-1' });
    if (url === AS.token_endpoint) return (o.token ?? (() => json(200, { access_token: jwt({ preferred_username: 'davide' }), refresh_token: 'r1', expires_in: 300 })))(new URLSearchParams(body));
    return json(404, {});
  }) as typeof fetch;
  const saved = new Map<string, OAuthSession>();
  let opened = '', now = 1_000_000;
  const listen = async (_state: string, port: number | undefined): Promise<Listener> => {
    let give!: (c: string) => void;
    const code = new Promise<string>(r => { give = r; });
    listening.push({ give, port });
    return { port: port ?? 50123, redirect: `http://127.0.0.1:${port ?? 50123}/callback`, code, close: () => {} };
  };
  const listening: { give(c: string): void; port: number | undefined }[] = [];
  const oauth = new McpOAuth({
    load: id => saved.get(id) ?? null, save: (id, s) => { saved.set(id, s); return true; }, drop: id => { saved.delete(id); },
    openExternal: url => { opened = url; listening.at(-1)!.give('the-code'); }, fetch: fetchFn, now: () => now, listen,
  });
  return { oauth, calls, saved, opened: () => opened, listening, tick: (ms: number) => { now += ms; } };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('MCP OAuth: pieces', () => {
  it('reads the Bearer challenge, the who label and the issuer metadata places', () => {
    expect(challenge('Bearer realm="x", resource_metadata="https://a/b", scope=read')).toEqual({ realm: 'x', resource_metadata: 'https://a/b', scope: 'read' });
    expect(whoOf(undefined, jwt({ sub: 's', email: 'someone@example.com' }))).toBe('someone@example.com');
    expect(whoOf('opaque-token')).toBeUndefined();
    expect(metadataUrls(KC)).toEqual(['https://kc.example.com/.well-known/oauth-authorization-server/realms/team', 'https://kc.example.com/.well-known/openid-configuration/realms/team', `${KC}/.well-known/openid-configuration`]);
    expect(() => metadataUrls('http://kc.example.com')).toThrow(/https/);
  });
});

describe('MCP OAuth: login', () => {
  it('discovers Keycloak, registers the app, opens the browser with PKCE and resource, keeps the tokens', async () => {
    const w = world({ registration: true });
    const s = await w.oauth.login('kc', MCP);
    const u = new URL(w.opened());
    expect(u.origin + u.pathname).toBe(AS.authorization_endpoint);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: 'code', client_id: 'dyn-1', code_challenge_method: 'S256', resource: MCP, scope: 'mcp:tools', redirect_uri: 'http://127.0.0.1:50123/callback' });
    const exchange = new URLSearchParams(w.calls.find(c => c.url === AS.token_endpoint)!.body);
    expect(exchange.get('code')).toBe('the-code');
    expect(exchange.get('code_verifier')).toMatch(/^[\w-]{43}$/);
    expect(s).toMatchObject({ clientId: 'dyn-1', refresh: 'r1', who: 'davide', resource: MCP, expiresAt: 1_000_000 + 300_000 });
    expect(w.saved.get('kc')?.who).toBe('davide');
  });

  it('a pre-registered client id and a fixed port: no registration', async () => {
    const w = world();
    await w.oauth.login('kc', MCP, { clientId: 'second-brain', port: 8765 });
    expect(new URL(w.opened()).searchParams.get('client_id')).toBe('second-brain');
    expect(w.listening[0]!.port).toBe(8765);
    expect(w.calls.some(c => c.url.includes('clients-registrations'))).toBe(false);
  });

  it('refuses metadata about another server, or an authorization server with another issuer', async () => {
    await expect(world({ resource: 'https://victim.example.com/mcp' }).oauth.login('kc', MCP, { clientId: 'c' })).rejects.toThrow(/altro indirizzo/);
    await expect(world({ issuer: 'https://evil.example.com' }).oauth.login('kc', MCP, { clientId: 'c' })).rejects.toThrow(/altro nome/);
  });

  it('«Esci» while a refresh runs: the refresh answer is forgotten', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const w = world({ token: () => json(200, { access_token: 'late', expires_in: 300 }) });
    const slow = w.oauth as unknown as { token: (...a: unknown[]) => Promise<unknown> };
    const orig = slow.token.bind(w.oauth);
    slow.token = async (...a: unknown[]) => { await gate; return orig(...a); };
    w.saved.set('kc', { access: 'a1', refresh: 'r1', expiresAt: 1, clientId: 'c', tokenEndpoint: AS.token_endpoint, resource: MCP, origin: 'https://mcp.example.com', at: 1 });
    const p = w.oauth.access('kc');
    w.saved.delete('kc');
    release();
    expect(await p).toBeNull();
    expect(w.saved.has('kc')).toBe(false);
  });

  it('no registration and no client id: says to ask for one', async () => {
    await expect(world().oauth.login('kc', MCP)).rejects.toThrow(/registrare/);
  });
});

describe('MCP OAuth: the access token', () => {
  const session = (o: Partial<OAuthSession> = {}): OAuthSession => ({ access: 'a1', refresh: 'r1', expiresAt: 1_000_000 + 600_000, clientId: 'c', tokenEndpoint: AS.token_endpoint, resource: MCP, origin: 'https://mcp.example.com', at: 1, ...o });

  it('fresh: as saved; about to end or forced: refreshed, the refresh token rotated', async () => {
    const w = world({ token: f => json(200, { access_token: `a-${f.get('refresh_token')}`, refresh_token: 'r2', expires_in: 300 }) });
    w.saved.set('kc', session());
    expect(await w.oauth.access('kc')).toBe('a1');
    w.tick(560_000);
    expect(await w.oauth.access('kc')).toBe('a-r1');
    expect(w.saved.get('kc')?.refresh).toBe('r2');
    expect(await w.oauth.access('kc', true)).toBe('a-r2');
  });

  it('two calls at once refresh once', async () => {
    let n = 0;
    const w = world({ token: () => { n++; return json(200, { access_token: 'new', expires_in: 300 }); } });
    w.saved.set('kc', session({ expiresAt: 1 }));
    expect(await Promise.all([w.oauth.access('kc'), w.oauth.access('kc')])).toEqual(['new', 'new']);
    expect(n).toBe(1);
    expect(w.saved.get('kc')?.refresh).toBe('r1');   // not rotated: the old one stays
  });

  it('a refused refresh logs out; a login server in trouble keeps the old token while it is valid', async () => {
    const refused = world({ token: () => json(400, { error: 'invalid_grant' }) });
    refused.saved.set('kc', session({ expiresAt: 1 }));
    expect(await refused.oauth.access('kc')).toBeNull();
    expect(refused.saved.has('kc')).toBe(false);
    const down = world({ token: () => json(503, {}) });
    down.saved.set('kc', session({ expiresAt: 1_000_000 + 30_000 }));
    expect(await down.oauth.access('kc')).toBe('a1');
    expect(down.saved.has('kc')).toBe(true);
  });
});

describe('MCP OAuth: the HTTP client', () => {
  it('sends the access token and, on a 401, retries once with a refreshed one', async () => {
    const seen: (string | null)[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization ?? null;
      seen.push(auth);
      if (auth !== 'Bearer fresh') return new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
      const msg = JSON.parse(String(init.body)) as { id?: number; method: string };
      if (msg.id === undefined) return new Response(null, { status: 202 });
      const result = msg.method === 'initialize' ? { protocolVersion: '2025-06-18', serverInfo: { name: 'kc-mcp' } } : { tools: [{ name: 'search' }] };
      return json(200, { jsonrpc: '2.0', id: msg.id, result });
    });
    const forced: boolean[] = [];
    const up = connect({ transport: 'http', url: MCP, headers: {}, auth: async force => { forced.push(force); return force ? 'fresh' : 'stale'; } });
    expect((await up.tools()).map(t => t.name)).toEqual(['search']);
    expect(seen.slice(0, 2)).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(forced.slice(0, 2)).toEqual([false, true]);
  });

  it('a 401 with a Bearer challenge and no login says «Accedi»', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://x"' } }));
    const err = await connect({ transport: 'http', url: MCP, headers: {} }).tools().catch(e => e as { login?: boolean; fix: string });
    expect(err).toMatchObject({ login: true });
    expect((err as { fix: string }).fix).toMatch(/Accedi/);
  });
});

describe('MCP OAuth: the store', () => {
  it('keeps the session encrypted, out of the masks, across an edit of the same origin; drops it when the origin moves', () => {
    const dir = tmp('mcp-oauth');
    const st = new McpServerStore(dir, cipher);
    st.upsert({ id: 'kc', label: 'KC', transport: 'http', url: MCP, secrets: [], enabled: true, oauth: { clientId: 'second-brain' } });
    st.setOAuthSession('kc', JSON.stringify({ access: 'secret-access' }), { who: 'davide', at: 5 });
    expect(st.oauthLabel('kc')).toEqual({ who: 'davide', at: 5 });
    expect(st.masks('kc')).toEqual({});
    expect(JSON.stringify(new McpServerStore(dir, cipher).oauthSession('kc'))).toContain('secret-access');
    expect(fs.readFileSync(`${dir}/mcp-secrets.json`, 'utf8')).not.toContain('secret-access');
    st.upsert({ id: 'kc', label: 'KC 2', transport: 'http', url: `${MCP}/v2`, secrets: [], enabled: false, oauth: { clientId: 'second-brain' } }, 'kc');
    expect(st.oauthLabel('kc')?.who).toBe('davide');
    expect(st.def('kc')?.oauth).toEqual({ clientId: 'second-brain' });
    st.upsert({ id: 'kc', label: 'KC 3', transport: 'http', url: 'https://other.example.com/mcp', secrets: [], enabled: true }, 'kc');
    expect(st.oauthLabel('kc')).toBeNull();
  });

  it('rejects a bad port or client id', () => {
    const st = new McpServerStore(tmp('mcp-oauth-bad'), cipher);
    expect(() => st.upsert({ id: 'a', label: 'A', transport: 'http', url: MCP, secrets: [], enabled: true, oauth: { port: 80 } })).toThrow(/Porta/);
    expect(() => st.upsert({ id: 'b', label: 'B', transport: 'http', url: MCP, secrets: [], enabled: true, oauth: { clientId: 'a b' } })).toThrow(/spazi/);
  });
});

describe('MCP OAuth: the service', () => {
  it('«Esci» keeps the login row (a test that asks for «Accedi»); a logged-in server sends its access token, no pasted one', async () => {
    const eps: unknown[] = [];
    const svc = new McpServersService({ userData: tmp('mcp-oauth-svc'), cipher, mcp: new McpServer({ name: 't', version: '1' }), context: () => null,
      connect: ep => { eps.push(ep); return { serverInfo: undefined, tools: async () => [], call: async () => ({ content: [] }), close() {} }; } });
    svc.save({ def: { id: 'kc', label: 'KC', transport: 'http', url: MCP, secrets: [{ where: 'header', name: 'Authorization', prefix: 'Bearer ' }], enabled: true } });
    svc.store.setOAuthSession('kc', JSON.stringify({ access: 'acc', clientId: 'c', tokenEndpoint: AS.token_endpoint, resource: MCP, origin: 'https://mcp.example.com', at: 1 }), { who: 'davide', at: 1 });
    await svc.test('kc');
    const ep = eps[0] as { headers: Record<string, string>; auth?: (f: boolean) => Promise<string | null> };
    expect(ep.headers.Authorization).toBeUndefined();
    expect(await ep.auth!(false)).toBe('acc');
    expect(svc.state().servers[0]!.login).toEqual({ who: 'davide', at: 1 });
    const out = svc.logout('kc').servers[0]!;
    expect(out.login).toBeNull();
    expect(out.lastTest?.error).toMatchObject({ code: 'auth', login: true });
  });
});

// A pre-registered client with a secret (Google's «Desktop app» clients: the token endpoint wants client_secret), and a
// scope pinned by the connector (Google's metadata lists every Gmail scope, send included).
const SECRET = ['GOCSPX', 'made', 'up', 'client', 'value', '1234'].join('-');   // built at run time: a guard-safe fake
describe('MCP OAuth: a client secret and a pinned scope', () => {
  const form = (w: ReturnType<typeof world>) => w.calls.filter(c => c.url === AS.token_endpoint).map(c => new URLSearchParams(c.body));

  it('sends client_secret at the code exchange and at the refresh when set, keeps it in the session', async () => {
    const w = world({ token: f => json(200, { access_token: `a-${f.get('grant_type')}`, refresh_token: 'r1', expires_in: 300 }) });
    const s = await w.oauth.login('g', MCP, { clientId: 'cid.apps.googleusercontent.com', clientSecret: SECRET });
    expect(form(w)[0]!.get('client_secret')).toBe(SECRET);
    expect(form(w)[0]!.get('client_id')).toBe('cid.apps.googleusercontent.com');
    expect(s.clientSecret).toBe(SECRET);
    w.tick(400_000);
    expect(await w.oauth.access('g')).toBe('a-refresh_token');
    expect(form(w)[1]!.get('grant_type')).toBe('refresh_token');
    expect(form(w)[1]!.get('client_secret')).toBe(SECRET);
    // the authorization URL (the browser sees it) never carries the secret
    expect(w.opened()).not.toContain(SECRET);
  });

  it('sends no client_secret when none is set (public client), and ignores a secret without a client id', async () => {
    const w = world();
    const s = await w.oauth.login('g', MCP, { clientId: 'cid' });
    w.tick(400_000);
    await w.oauth.access('g');
    expect(form(w).every(f => !f.has('client_secret'))).toBe(true);
    expect(s.clientSecret).toBeUndefined();
    const dyn = world({ registration: true });
    await dyn.oauth.login('d', MCP, { clientSecret: SECRET });
    expect(form(dyn).every(f => f.get('client_secret') !== SECRET)).toBe(true);
    expect(dyn.opened()).not.toContain(SECRET);
  });

  it('the pinned scope replaces the server list in the login URL and the session', async () => {
    const w = world();
    const s = await w.oauth.login('g', MCP, { clientId: 'cid', scope: 'https://www.googleapis.com/auth/gmail.readonly' });
    expect(new URL(w.opened()).searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(s.scope).toBe('https://www.googleapis.com/auth/gmail.readonly');
  });

  it('asks Google for a refresh token (access_type=offline) and nobody else', async () => {
    const w = world();
    await w.oauth.login('kc', MCP, { clientId: 'cid' });
    expect(new URL(w.opened()).searchParams.has('access_type')).toBe(false);
    const GOOGLE = 'https://accounts.google.com', GMCP = 'https://gmailmcp.googleapis.com/mcp/v1';
    const fetchFn = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === GMCP) return new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://gmailmcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1"' } });
      if (url.includes('oauth-protected-resource')) return json(200, { resource: GMCP, authorization_servers: [`${GOOGLE}/`], scopes_supported: ['https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.readonly'] });
      if (url === `${GOOGLE}/.well-known/oauth-authorization-server` || url === `${GOOGLE}/.well-known/openid-configuration`) return json(200, { issuer: GOOGLE, authorization_endpoint: `${GOOGLE}/o/oauth2/v2/auth`, token_endpoint: 'https://oauth2.googleapis.com/token', code_challenge_methods_supported: ['S256'] });
      if (url === 'https://oauth2.googleapis.com/token') return json(200, { access_token: 'g-access', refresh_token: 'g-refresh', expires_in: 3600 });
      return json(404, {});
    }) as typeof fetch;
    let opened = '';
    const oauth = new McpOAuth({ load: () => null, save: () => true, drop: () => {}, fetch: fetchFn, listen: async () => ({ port: 50123, redirect: 'http://127.0.0.1:50123/callback', code: Promise.resolve('c'), close: () => {} }), openExternal: u => { opened = u; } });
    await oauth.login('g', GMCP, { clientId: 'cid', clientSecret: SECRET, scope: 'https://www.googleapis.com/auth/gmail.readonly' });
    const q = new URL(opened).searchParams;
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('prompt')).toBe('consent');
    expect(q.get('resource')).toBe(GMCP);
    expect(q.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
  });
});

describe('MCP OAuth: the client secret in the store and the service', () => {
  const def = { id: 'gm', label: 'Gmail', transport: 'http', url: MCP, secrets: [], enabled: true, oauth: { clientId: 'cid', scope: 'https://www.googleapis.com/auth/gmail.readonly' } };

  it('is stored encrypted, bound to the origin, shown only as a flag, and redacted from the logs', () => {
    const dir = tmp('mcp-oauth-secret');
    const st = new McpServerStore(dir, cipher);
    st.upsert(def);
    expect(st.oauthSecretSet('gm')).toBe(false);
    expect(st.oauthClientSecret('gm')).toBeNull();
    st.setSecret('gm', OAUTH_SECRET_SLOT, SECRET);
    expect(st.oauthSecretSet('gm')).toBe(true);
    expect(st.oauthClientSecret('gm')).toBe(SECRET);
    expect(st.masks('gm')).toEqual({});
    expect(fs.readFileSync(`${dir}/mcp-secrets.json`, 'utf8')).not.toContain(SECRET);
    expect(fs.readFileSync(`${dir}/mcp-servers.json`, 'utf8')).not.toContain(SECRET);
    expect(JSON.stringify(st.servers())).not.toContain(SECRET);
    expect(new McpServerStore(dir, cipher).oauthClientSecret('gm')).toBe(SECRET);
    expect(redact(`the secret ${SECRET} leaked`)).not.toContain(SECRET);
    // an edit of the same origin keeps it, an address on another origin drops it, a delete forgets it
    st.upsert({ ...def, label: 'Gmail 2' }, 'gm');
    expect(st.oauthSecretSet('gm')).toBe(true);
    st.deleteSecret('gm', OAUTH_SECRET_SLOT);
    expect(st.oauthSecretSet('gm')).toBe(false);
    st.setSecret('gm', OAUTH_SECRET_SLOT, SECRET);
    st.upsert({ ...def, url: 'https://other.example.com/mcp' }, 'gm');
    expect(st.oauthSecretSet('gm')).toBe(false);
  });

  it('«Esci» (the session forgotten) keeps the secret; a stdio server and a blank or spaced secret are refused', () => {
    const st = new McpServerStore(tmp('mcp-oauth-secret2'), cipher);
    st.upsert(def);
    st.setSecret('gm', OAUTH_SECRET_SLOT, SECRET);
    st.setOAuthSession('gm', JSON.stringify({ access: 'x', clientSecret: SECRET }), { at: 1 });
    st.deleteOAuthSession('gm');
    expect(st.oauthClientSecret('gm')).toBe(SECRET);
    expect(() => st.setSecret('gm', OAUTH_SECRET_SLOT, '  ')).toThrow(/vuoto/);
    expect(() => st.setSecret('gm', OAUTH_SECRET_SLOT, 'a b')).toThrow(/spazi/);
    st.upsert({ id: 'local', label: 'Local', transport: 'stdio', command: 'node', args: [], secrets: [], enabled: true });
    expect(() => st.setSecret('local', OAUTH_SECRET_SLOT, SECRET)).toThrow(/remoto/);
  });

  it('the scope is normalised and kept in the definition; a bad one is refused', () => {
    const st = new McpServerStore(tmp('mcp-oauth-scope'), cipher);
    expect(st.upsert({ ...def, oauth: { scope: ' a   b ' } }).oauth).toEqual({ scope: 'a b' });
    expect(() => st.upsert({ ...def, id: 'x', oauth: { scope: 'a \u0000b' } })).toThrow(/Scope/);
  });

  it('«Accedi» hands the stored secret to the login; the cards and the state carry only the flag', async () => {
    const svc = new McpServersService({ userData: tmp('mcp-oauth-svc2'), cipher, mcp: new McpServer({ name: 't', version: '1' }), context: () => null,
      connect: () => ({ serverInfo: undefined, tools: async () => [], call: async () => ({ content: [] }), close() {} }) });
    svc.save({ def });
    expect(svc.state().servers[0]!.oauthSecretSet).toBe(false);
    const st = svc.setSecret({ id: 'gm', slot: OAUTH_SECRET_SLOT, value: SECRET });
    expect(st.servers[0]!.oauthSecretSet).toBe(true);
    expect(JSON.stringify(st)).not.toContain(SECRET);
    expect(JSON.stringify(svc.views())).not.toContain(SECRET);
    const login = vi.spyOn(svc.oauth, 'login').mockResolvedValue({} as OAuthSession);
    await svc.login('gm');
    expect(login.mock.calls[0]![2]).toEqual({ clientId: 'cid', scope: 'https://www.googleapis.com/auth/gmail.readonly', clientSecret: SECRET });
    expect(JSON.stringify(svc.state())).not.toContain(SECRET);
    expect(svc.deleteSecret({ id: 'gm', slot: OAUTH_SECRET_SLOT }).servers[0]!.oauthSecretSet).toBe(false);
    await svc.login('gm');
    expect(login.mock.calls[1]![2]).not.toHaveProperty('clientSecret', SECRET);
  });
});
