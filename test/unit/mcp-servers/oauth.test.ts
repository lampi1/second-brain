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

const cipher: SecretCipher = { unavailable: () => null, encrypt: s => Buffer.from([...Buffer.from(s)].map(b => b ^ 0x5a)), decrypt: b => Buffer.from([...b].map(x => x ^ 0x5a)).toString() };
const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const MCP = 'https://mcp.example.com/mcp', KC = 'https://kc.example.com/realms/team';
const AS = { issuer: KC, authorization_endpoint: `${KC}/protocol/openid-connect/auth`, token_endpoint: `${KC}/protocol/openid-connect/token`, code_challenge_methods_supported: ['S256'] };

function world(o: { registration?: boolean; token?: (form: URLSearchParams) => Response } = {}) {
  const calls: { url: string; body?: string }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, ...(body ? { body } : {}) });
    if (url === MCP) return new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="mcp:tools"' } });
    if (url === 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp') return json(200, { resource: MCP, authorization_servers: [KC] });
    if (url === `${KC}/.well-known/openid-configuration`) return json(200, { ...AS, ...(o.registration ? { registration_endpoint: `${KC}/clients-registrations/openid-connect` } : {}) });
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
    load: id => saved.get(id) ?? null, save: (id, s) => saved.set(id, s), drop: id => saved.delete(id),
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

  it('no registration and no client id: says to ask for one', async () => {
    await expect(world().oauth.login('kc', MCP)).rejects.toThrow(/registrare/);
  });
});

describe('MCP OAuth: the access token', () => {
  const session = (o: Partial<OAuthSession> = {}): OAuthSession => ({ access: 'a1', refresh: 'r1', expiresAt: 1_000_000 + 600_000, clientId: 'c', tokenEndpoint: AS.token_endpoint, resource: MCP, at: 1, ...o });

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
