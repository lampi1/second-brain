// Browser-only Jira credential handoff: a one-use, CSRF-protected loopback form sends directly to main, never IPC.
// Used only after an explicit login click; no tokens are put into URLs, HTML, logs or renderer state.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { JiraCredential } from './app-service';
import { jiraCredential } from './app-service';
const page = `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Collega Jira · second-brain</title><h1>Collega Jira Cloud</h1><p>Accedi al tuo account Atlassian e crea un token API senza ambiti (classico), poi torna qui. I token con ambiti e Jira Data Center non sono supportati in questo percorso.</p><p><a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer">Apri Atlassian per creare il token</a></p><p>Il token sarà cifrato nel portachiavi locale dell’app. La verifica leggerà il tuo account e fino a 100 progetti, senza modificarli.</p><form method="post" autocomplete="off"><p><label>Sito Jira Cloud <input name="site" type="url" placeholder="https://nome.atlassian.net" required maxlength="256"></label></p><p><label>Email Atlassian <input name="email" type="email" required maxlength="254"></label></p><p><label>Token API (non la password) <input name="token" type="password" autocomplete="new-password" required maxlength="4096"></label></p><button>Salva nel portachiavi cifrato</button><button name="action" value="cancel" formnovalidate>Annulla</button></form><p>Per annullare usa Annulla qui o nell’app. Il collegamento scade dopo cinque minuti.</p></html>`;
export async function credentialEntry(open: (url: string) => Promise<void>, save: (value: JiraCredential) => Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('Accesso annullato');
  const route = `/${randomBytes(32).toString('hex')}`;
  let finish!: (error?: Error) => void;
  const completed = new Promise<void>((resolve, reject) => { finish = error => error ? reject(error) : resolve(); });
  let origin = '', used = false;
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.headers.host !== new URL(origin).host || req.url !== route || used) { res.writeHead(404).end(); return; }
    if (req.method === 'GET') { res.end(page); return; }
    if (req.method !== 'POST' || req.headers.origin !== origin || !/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) { res.writeHead(403).end(); return; }
    let bytes = 0; const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 16384) req.destroy(); else chunks.push(chunk); });
    req.on('end', () => {
      if (used || bytes > 16384) { res.writeHead(409).end(); return; }
      used = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      const reply = (html: string, error?: Error) => {
        if (res.destroyed || res.writableFinished) { finish(error); return; }
        const settled = () => finish(error);
        res.once('finish', settled); res.once('close', settled);
        res.statusCode = error ? 400 : 200; res.end(html);
      };
      void (async () => {
        try {
          const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
          if (form.get('action') === 'cancel') { reply('<p>Accesso annullato. Puoi tornare all’app.</p>', new Error('Accesso annullato')); return; }
          const value = jiraCredential({ site: form.get('site') ?? '', email: form.get('email') ?? '', token: form.get('token') ?? '' });
          await save(value);
          reply('<!doctype html><html lang="it"><meta charset="utf-8"><title>Jira</title><p>Token salvato. Torna a second-brain e premi Verifica accesso.</p></html>');
        } catch { reply('<p>Token non salvato. Torna all’app e riprova il collegamento.</p>', new Error('Collegamento Jira non completato')); }
      })();
    });
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('Collegamento locale non disponibile'); }
  origin = `http://127.0.0.1:${address.port}`;
  const timer = setTimeout(() => finish(new Error('Collegamento Jira scaduto; riprova')), 300000);
  const abort = () => finish(new Error('Accesso annullato'));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try { await Promise.all([open(`${origin}${route}`), completed]); }
  finally { used = true; signal?.removeEventListener('abort', abort); clearTimeout(timer); server.close(); server.closeAllConnections(); }
}
