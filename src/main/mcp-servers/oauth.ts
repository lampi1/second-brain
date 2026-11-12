// The MCP OAuth login of a remote connector (issue #389, ADR 0273): for a server that answers 401 and protects itself
// with OAuth (a Keycloak in front of an MCP server, say), the user clicks «Accedi» on its card and logs in in the system
// browser; the app keeps the tokens and refreshes them, so the connector keeps working after its access token expires.
// The flow, as the MCP authorization spec writes it (2025-06-18):
//   1. discovery: the 401's WWW-Authenticate `resource_metadata` (else the server's /.well-known/oauth-protected-resource)
//      → the Protected Resource Metadata → its first authorization server → that server's metadata (RFC 8414 or OpenID
//      discovery, both well-known forms);
//   2. the client: the connector's own pre-registered client id (some servers, Keycloak among them, refuse dynamic
//      registration), else dynamic client registration (RFC 7591) as a public client;
//   3. authorization code + PKCE S256 in the system browser, the answer on a one-shot loopback listener on 127.0.0.1
//      (RFC 8252; a fixed port when the connector names one), `resource` = the server (RFC 8707), the state checked;
//   4. the token exchange; then refresh_token whenever the access token is within REFRESH_EARLY_MS of its end, or the
//      server answers 401 (one refresh, single flight per connector). A refused refresh drops the session: «Accedi» again.
// Every URL must be https (http only on this computer). The tokens never leave main: the store keeps them encrypted
// (store.ts setOAuth, the same cipher as the connectors' tokens), the gateway puts the access token in that server's own
// Authorization header (service.ts endpoint), and each one is added to the logs' redaction. «Connesso come …» is read
// from the token's own claims (preferred_username, email, name), never checked: it is a label.
// Used by service.ts (login, logout, the endpoints' auth); pinned by test/unit/mcp-oauth.test.ts.
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { addRedaction, errText, log } from '../log';
import { McpClientError } from './client';
import { CLIENT_PROTOCOL } from './client';

/** What the store keeps for one connector (encrypted as a whole). */
export interface OAuthSession {
  access: string; refresh?: string; expiresAt?: number;
  clientId: string; clientSecret?: string; tokenEndpoint: string; resource: string; scope?: string;
  /** «Connesso come …» */
  who?: string; at: number;
}
export interface OAuthConfig { clientId?: string; port?: number }
export interface OAuthDeps {
  /** the session saved for a connector, or null */
  load(id: string): OAuthSession | null;
  save(id: string, s: OAuthSession): void;
  drop(id: string): void;
  /** opens the system browser on the login page */
  openExternal(url: string): Promise<void> | void;
  fetch?: typeof fetch;
  now?(): number;
  /** how long the browser login may take */
  loginMs?: number;
  /** tests: the login's way back without a real port (default: loopback) */
  listen?(state: string, port: number | undefined): Promise<Listener>;
}

/** The login's way back: the loopback address it listens on, the code once the browser brings it, and close. */
export interface Listener { port: number; redirect: string; code: Promise<string>; close(): void }

export const REFRESH_EARLY_MS = 60_000;
const LOGIN_MS = 5 * 60_000;
const FETCH_MS = 15_000;

const safeUrl = (raw: unknown, what: string): URL => {
  let u: URL;
  try { u = new URL(String(raw)); } catch { throw new McpClientError('auth', `${what}: indirizzo non valido.`, 'Il server OAuth pubblica dati non validi: chiedi a chi lo gestisce.'); }
  const loop = /^(127\.0\.0\.1|localhost|\[::1\])$/i.test(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loop)) throw new McpClientError('auth', `${what}: serve https.`, 'Il server OAuth deve usare https.');
  return u;
};
const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The `key="value"` pairs of a WWW-Authenticate Bearer challenge. */
export function challenge(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  const re = /([a-zA-Z_][\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header))) out[m[1]!.toLowerCase()] = (m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1');
  return out;
}

/** The claims of a JWT, read without checking (only for the «Connesso come …» label); null when it is not one. */
export function whoOf(...tokens: (string | undefined)[]): string | undefined {
  for (const t of tokens) {
    const part = t?.split('.')[1];
    if (!part) continue;
    try {
      const c = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as Record<string, unknown>;
      for (const k of ['preferred_username', 'email', 'name', 'upn', 'sub']) if (typeof c[k] === 'string' && c[k]) return String(c[k]).slice(0, 120);
    } catch { /* not a JWT */ }
  }
  return undefined;
}

/** The well-known places of an issuer's metadata, in the spec's order. */
export function metadataUrls(issuer: string): string[] {
  const u = safeUrl(issuer, 'Server di autorizzazione');
  const p = u.pathname.replace(/\/+$/, '');
  return p ? [`${u.origin}/.well-known/oauth-authorization-server${p}`, `${u.origin}/.well-known/openid-configuration${p}`, `${u.origin}${p}/.well-known/openid-configuration`]
    : [`${u.origin}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/openid-configuration`];
}

interface AsMeta { issuer?: string; authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string; code_challenge_methods_supported?: string[]; scopes_supported?: string[] }
export interface Discovery { resource: string; as: AsMeta; scope?: string }

export class McpOAuth {
  private refreshing = new Map<string, Promise<string | null>>();
  private logins = new Map<string, Promise<OAuthSession>>();
  constructor(private readonly d: OAuthDeps) {}

  private get f(): typeof fetch { return this.d.fetch ?? fetch; }
  private now(): number { return this.d.now?.() ?? Date.now(); }

  private async json(url: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> | null }> {
    const res = await this.f(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(FETCH_MS) });
    const text = await res.text().catch(() => '');
    let body: Record<string, unknown> | null = null;
    try { const v = JSON.parse(text) as unknown; if (v && typeof v === 'object' && !Array.isArray(v)) body = v as Record<string, unknown>; } catch { /* not JSON */ }
    return { status: res.status, body };
  }

  /** Step 1: from the MCP server's URL to its authorization server's metadata. */
  async discover(serverUrl: string): Promise<Discovery> {
    const server = safeUrl(serverUrl, 'Server MCP');
    // the 401 tells where the resource metadata is (and maybe the scope)
    let ch: Record<string, string> = {};
    try {
      const res = await this.f(server.toString(), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(FETCH_MS),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': CLIENT_PROTOCOL },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: CLIENT_PROTOCOL, capabilities: {}, clientInfo: { name: 'second-brain', version: '1' } } }) });
      ch = challenge(res.headers.get('www-authenticate'));
      await res.body?.cancel().catch(() => {});
    } catch (e) { throw new McpClientError('network', `Server non raggiungibile (${server.host}).`, `Controlla l’indirizzo, la rete o la VPN: ${errText(e)}.`); }
    const path = server.pathname.replace(/\/+$/, '');
    const prmUrls = [...(ch.resource_metadata ? [safeUrl(ch.resource_metadata, 'Metadati della risorsa').toString()] : []),
      ...(path ? [`${server.origin}/.well-known/oauth-protected-resource${path}`] : []), `${server.origin}/.well-known/oauth-protected-resource`];
    let issuer: string | null = null, resource = server.toString(), scopes: string[] = [];
    for (const u of prmUrls) {
      const r = await this.json(u).catch(() => null);
      const servers = r?.status === 200 ? r.body?.authorization_servers : undefined;
      if (Array.isArray(servers) && typeof servers[0] === 'string') {
        issuer = servers[0];
        if (typeof r!.body!.resource === 'string') resource = safeUrl(r!.body!.resource, 'Risorsa').toString();
        if (Array.isArray(r!.body!.scopes_supported)) scopes = (r!.body!.scopes_supported as unknown[]).filter((s): s is string => typeof s === 'string');
        break;
      }
    }
    // an older server with no resource metadata: its own origin is the authorization server
    issuer ??= server.origin;
    let as: AsMeta | null = null;
    for (const u of metadataUrls(issuer)) {
      const r = await this.json(u).catch(() => null);
      const b = r?.status === 200 ? r.body : null;
      if (b && typeof b.authorization_endpoint === 'string' && typeof b.token_endpoint === 'string') { as = b as unknown as AsMeta; break; }
    }
    if (!as) throw new McpClientError('auth', 'Il server non pubblica un login OAuth.', 'Non usa il login MCP: inserisci un token nel campo Token, o chiedi a chi lo gestisce.');
    safeUrl(as.authorization_endpoint, 'Pagina di login');
    safeUrl(as.token_endpoint, 'Indirizzo dei token');
    if (as.registration_endpoint) safeUrl(as.registration_endpoint, 'Registrazione del client');
    if (as.code_challenge_methods_supported && !as.code_challenge_methods_supported.includes('S256')) throw new McpClientError('auth', 'Il server OAuth non supporta PKCE S256.', 'Il login MCP lo richiede: chiedi a chi gestisce il server.');
    const scope = ch.scope || (scopes.length ? scopes.join(' ') : undefined);
    return { resource, as, ...(scope ? { scope } : {}) };
  }

  /** «Accedi»: the whole login, in the system browser. One at a time per connector. */
  login(id: string, serverUrl: string, cfg: OAuthConfig = {}): Promise<OAuthSession> {
    const running = this.logins.get(id);
    if (running) return running;
    const p = this.doLogin(id, serverUrl, cfg).finally(() => this.logins.delete(id));
    this.logins.set(id, p);
    return p;
  }

  private async doLogin(id: string, serverUrl: string, cfg: OAuthConfig): Promise<OAuthSession> {
    const disc = await this.discover(serverUrl);
    const verifier = b64url(crypto.randomBytes(32)), state = b64url(crypto.randomBytes(16));
    const challengeS256 = b64url(crypto.createHash('sha256').update(verifier).digest());
    const { port, redirect, code, close } = await (this.d.listen ?? ((st: string, p: number | undefined) => loopback(st, p, this.d.loginMs ?? LOGIN_MS)))(state, cfg.port);
    try {
      let clientId = cfg.clientId?.trim(), clientSecret: string | undefined;
      if (!clientId) {
        if (!disc.as.registration_endpoint) throw new McpClientError('auth', 'Il server non permette di registrare l’app da sola.', 'Chiedi a chi lo gestisce un Client ID per second-brain e scrivilo in «Modifica» → Client ID OAuth.');
        const r = await this.json(disc.as.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ client_name: 'second-brain', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', ...(disc.scope ? { scope: disc.scope } : {}) }) });
        if ((r.status !== 200 && r.status !== 201) || typeof r.body?.client_id !== 'string') throw new McpClientError('auth', `Registrazione dell’app rifiutata (HTTP ${r.status}).`, 'Chiedi a chi gestisce il server un Client ID e scrivilo in «Modifica» → Client ID OAuth.');
        clientId = r.body.client_id;
        if (typeof r.body.client_secret === 'string') { clientSecret = r.body.client_secret; addRedaction(clientSecret); }
      }
      const auth = new URL(disc.as.authorization_endpoint);
      const q = { response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challengeS256, code_challenge_method: 'S256', state, resource: disc.resource, ...(disc.scope ? { scope: disc.scope } : {}) };
      for (const [k, v] of Object.entries(q)) auth.searchParams.set(k, v);
      log.info('mcp-servers', 'MCP OAuth login opened in the browser', { data: { server: id, port, as: auth.host, registered: !cfg.clientId } });
      await this.d.openExternal(auth.toString());
      const got = await code;
      const tok = await this.token(disc.as.token_endpoint, { grant_type: 'authorization_code', code: got, redirect_uri: redirect, client_id: clientId, code_verifier: verifier, resource: disc.resource, ...(clientSecret ? { client_secret: clientSecret } : {}) });
      const s: OAuthSession = { ...tok, clientId, ...(clientSecret ? { clientSecret } : {}), tokenEndpoint: disc.as.token_endpoint, resource: disc.resource, ...(disc.scope ? { scope: disc.scope } : {}), at: this.now() };
      this.d.save(id, s);
      log.info('mcp-servers', 'MCP OAuth login done', { data: { server: id, refresh: !!s.refresh, expiresIn: s.expiresAt ? Math.round((s.expiresAt - this.now()) / 1000) : null } });
      return s;
    } finally { close(); void code.catch(() => {}); }
  }

  /** A token endpoint call (form-encoded), its answer as the session's token part. */
  private async token(endpoint: string, form: Record<string, string>): Promise<Pick<OAuthSession, 'access' | 'refresh' | 'expiresAt' | 'who'>> {
    const r = await this.json(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(form).toString() });
    const b = r.body;
    if (r.status !== 200 || typeof b?.access_token !== 'string' || !b.access_token) {
      const code = typeof b?.error === 'string' ? b.error.slice(0, 60) : `HTTP ${r.status}`;
      // 400/401 (invalid_grant…) = refused: log in again; anything else = the login server is in trouble: retry later
      const refused = r.status === 400 || r.status === 401 || (r.status === 200 && !!b);
      throw new McpClientError(refused ? 'auth' : 'http', `Token rifiutato dal server di login (${code}).`, refused ? 'Premi di nuovo «Accedi».' : 'Il server di login non risponde bene: riprova tra poco.');
    }
    const access = b.access_token, refresh = typeof b.refresh_token === 'string' ? b.refresh_token : undefined;
    addRedaction(access); if (refresh) addRedaction(refresh);
    const secs = typeof b.expires_in === 'number' ? b.expires_in : Number(b.expires_in);
    const who = whoOf(typeof b.id_token === 'string' ? b.id_token : undefined, access);
    return { access, ...(refresh ? { refresh } : {}), ...(Number.isFinite(secs) && secs > 0 ? { expiresAt: this.now() + secs * 1000 } : {}), ...(who ? { who } : {}) };
  }

  /** The access token to send now: refreshed when it is about to end, or when `force` (the server said 401). null = no
   *  session, or it could not be renewed (the session is dropped: «Accedi» again). */
  access(id: string, force = false): Promise<string | null> {
    const s = this.d.load(id);
    if (!s) return Promise.resolve(null);
    if (!force && (!s.expiresAt || s.expiresAt - REFRESH_EARLY_MS > this.now())) { addRedaction(s.access); return Promise.resolve(s.access); }
    const running = this.refreshing.get(id);
    if (running) return running;
    const p = this.refresh(id, s).finally(() => this.refreshing.delete(id));
    this.refreshing.set(id, p);
    return p;
  }

  private async refresh(id: string, s: OAuthSession): Promise<string | null> {
    if (!s.refresh) {
      // nothing to renew it with: still good, or gone
      if (s.expiresAt && s.expiresAt > this.now()) return s.access;
      this.d.drop(id);
      return null;
    }
    try {
      const tok = await this.token(s.tokenEndpoint, { grant_type: 'refresh_token', refresh_token: s.refresh, client_id: s.clientId, resource: s.resource, ...(s.clientSecret ? { client_secret: s.clientSecret } : {}) });
      const next: OAuthSession = { ...s, ...tok, refresh: tok.refresh ?? s.refresh, who: tok.who ?? s.who };
      if (!tok.expiresAt) delete next.expiresAt;
      this.d.save(id, next);
      log.info('mcp-servers', 'MCP OAuth token refreshed', { data: { server: id } });
      return next.access;
    } catch (e) {
      if (e instanceof McpClientError && e.code === 'auth') {
        log.warn('mcp-servers', 'MCP OAuth refresh refused: logged out', { data: { server: id }, cause: e.message, hint: 'the user presses «Accedi» on the connector card' });
        this.d.drop(id);
        return null;
      }
      // the login server is unreachable: the old token, if still valid, else nothing (the session stays for later)
      log.warn('mcp-servers', 'MCP OAuth refresh failed', { data: { server: id }, cause: errText(e) });
      return s.expiresAt && s.expiresAt > this.now() ? s.access : null;
    }
  }
}

/** The loopback listener the browser comes back to: one request with the right state, or the login's end. */
export function loopback(state: string, fixed: number | undefined, loginMs: number): Promise<Listener> {
  return new Promise((resolveListen, rejectListen) => {
    let settle!: (v: string) => void, fail!: (e: Error) => void;
    const code = new Promise<string>((res, rej) => { settle = res; fail = rej; });
    const page = (ok: boolean, text: string) => `<!doctype html><meta charset="utf-8"><title>second-brain</title><body style="font:16px system-ui;margin:3em"><h1>${ok ? 'Accesso fatto' : 'Accesso non riuscito'}</h1><p>${text}</p></body>`;
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const err = u.searchParams.get('error'), got = u.searchParams.get('code');
      const ok = !err && !!got && u.searchParams.get('state') === state;
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(ok, ok ? 'Puoi chiudere questa scheda e tornare a second-brain.' : 'Torna a second-brain e premi di nuovo «Accedi».'));
      done();
      if (ok) settle(got!);
      else fail(new McpClientError('auth', err ? `Login rifiutato (${err.slice(0, 60)}).` : 'Risposta del login non valida.', 'Premi di nuovo «Accedi».'));
    });
    const timer = setTimeout(() => { done(); fail(new McpClientError('timeout', 'Il login nel browser non è finito in tempo.', 'Premi di nuovo «Accedi» e completa il login entro 5 minuti.')); }, loginMs);
    timer.unref?.();
    const done = () => { clearTimeout(timer); if (server.listening) server.close(); };
    server.on('error', e => { clearTimeout(timer); rejectListen(new McpClientError('auth', `La porta di ritorno del login non si apre (${errText(e)}).`, 'Cambia la porta di ritorno in «Modifica», o lasciala vuota.')); });
    server.listen(fixed ?? 0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolveListen({ port, redirect: `http://127.0.0.1:${port}/callback`, code, close: () => { done(); fail(new McpClientError('auth', 'Login interrotto.', 'Premi di nuovo «Accedi».')); } });
    });
  });
}
