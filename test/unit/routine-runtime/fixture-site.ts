// A local stand-in for Air's login (used by the routine browser tests and the CLI demo test): /Account/Login shows the
// AJAX local login form (Air's real markup) only with ?mode=local (like Air), its button posts the credentials with fetch, /home needs the
// session cookie (else a redirect to /Account/Login?ReturnUrl=… that drops mode=local), /logout ends the session, /form
// has a text input and a password input. With `{ portal: true }` it acts like an Air node behind its portal: a request
// with no session (the bare root included) and /Account/Login without ?mode=local are redirected to a second server,
// another origin, whose /Account/Login shows a login form the runtime must never fill. 127.0.0.1 only, random ports.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

/** Air test 1's real login form markup, copied from an anonymous GET of /Account/Login?mode=local. */
export const AIR_LOGIN_FORM = fs.readFileSync(path.join(__dirname, 'fixtures', 'air-login-form.html'), 'utf8');

export const FIXTURE_USER = 'qa.user';
export const FIXTURE_PASSWORD = 'fixture-Pass-7781';

const page = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

const listen = async (server: http.Server): Promise<string> => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
const shut = (server: http.Server) => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });

export async function startFixtureSite(opts: { portal?: boolean } = {}): Promise<{ origin: string; portalOrigin: string | null; logins: number; portalHits: number; close(): Promise<void> }> {
  const sessions = new Set<string>();
  const state = { logins: 0, portalHits: 0 };
  // the portal: another origin with its own login form (Email, Password, Access), like test.air.orisline.com
  const portal = opts.portal ? http.createServer((req, res) => {
    state.portalHits++;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page('Login - Portal', '<form method="post" action="/Account/Login"><input type="email" name="Email"><input type="password" name="Password"><button type="submit">Access</button></form>'));
  }) : null;
  const portalOrigin = portal ? await listen(portal) : null;
  const toPortal = (res: http.ServerResponse) => { res.writeHead(302, { location: `${portalOrigin}/Account/Login` }); res.end(); };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const sid = /(?:^|;\s*)sid=([a-z0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
    const signed = !!sid && sessions.has(sid);
    const html = (status: number, text: string) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }); res.end(text); };
    if (url.pathname === '/Account/Login' && req.method === 'GET') {
      if (url.searchParams.get('mode') !== 'local') return portalOrigin ? toPortal(res) : html(200, page('SSO', '<p>Single sign-on only</p>'));
      // Air's real #loginForm markup (fixtures/air-login-form.html): <input type="button" id="btnLogin" onclick="Login.submit()">
      return html(200, page('Login', `<style>.display-hide { display: none; }</style>${AIR_LOGIN_FORM}
        <script>window.Login = { submit: async () => {
          const r = await fetch('/Account/LoginAjax', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ u: document.getElementById('txtEmail').value, p: document.getElementById('txtPassword').value }) });
          if (r.ok) location.href = '/home';
        } };</script>`));
    }
    if (url.pathname === '/Account/LoginAjax' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += String(c); });
      req.on('end', () => {
        const { u, p } = JSON.parse(body || '{}') as { u?: string; p?: string };
        if (u !== FIXTURE_USER || p !== FIXTURE_PASSWORD) { res.writeHead(401); res.end(); return; }
        const id = Math.random().toString(36).slice(2);
        sessions.add(id); state.logins++;
        res.writeHead(200, { 'set-cookie': `sid=${id}; Path=/; HttpOnly` }); res.end('{}');
      });
      return;
    }
    if (url.pathname === '/logout') { if (sid) sessions.delete(sid); return html(200, page('Bye', '<p>signed out</p>')); }
    if (!signed && portalOrigin) return toPortal(res);
    if (!signed) { res.writeHead(302, { location: `/Account/Login?ReturnUrl=${encodeURIComponent(url.pathname)}` }); res.end(); return; }
    if (url.pathname === '/home' || url.pathname === '/') return html(200, page('Home', `<h1>Agenda</h1><p>Welcome ${FIXTURE_USER} (debug: ${FIXTURE_PASSWORD})</p><a href="/form">Form</a>`));
    if (url.pathname === '/form') return html(200, page('Form', '<label>Note <input type="text" id="note"></label><label>New password <input type="password" id="np"></label><select id="s"><option value="a">Alpha</option><option value="b">Beta</option></select>'));
    html(404, page('404', 'not found'));
  });
  const origin = await listen(server);
  return {
    origin, portalOrigin,
    get logins() { return state.logins; },
    get portalHits() { return state.portalHits; },
    close: async () => { await shut(server); if (portal) await shut(portal); },
  };
}
