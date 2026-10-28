// What the routine browser's pages do on their own, kept for the agent (owner, 2026-10-28: "tutti gli strumenti"): console
// messages and uncaught page errors with their stack, recent requests with the failed ones and the responses >= 400 (a
// short body), dialogs (alert/confirm/prompt, answered by the policy the agent set with `dialog`), downloads (saved into
// the step's evidence folder) and new tabs. Bounded buffers; query values that look like tokens are hidden here, and
// browser-mcp.ts masks the credentials in every reply. Used by browser-mcp.ts, one watcher per server (step).
import fs from 'node:fs';
import path from 'node:path';

/** The Playwright event objects the watcher reads (structural: tests pass real pages). */
interface ConsoleMessage { type(): string; text(): string; location(): { url: string; lineNumber: number } }
interface Request { method(): string; url(): string; resourceType(): string; failure(): { errorText: string } | null }
interface Response { status(): number; url(): string; request(): Request; headers(): Record<string, string>; text(): Promise<string> }
interface Dialog { type(): string; message(): string; defaultValue(): string; accept(text?: string): Promise<void>; dismiss(): Promise<void> }
interface Download { suggestedFilename(): string; saveAs(file: string): Promise<void>; failure(): Promise<string | null> }
/** The page side the watcher listens to. */
export interface WatchedPage {
  url(): string;
  on(event: string, handler: (arg: never) => void): unknown;
}

export interface LogEntry { seq: number; at: number; level: string; text: string }
export interface NetEntry { seq: number; at: number; method: string; url: string; status: number | null; error?: string; body?: string }
/** The answer to the next dialogs: accept (with a prompt's text) or dismiss. Default: an alert is accepted, a confirm
 *  or prompt dismissed (nothing is confirmed unless the agent asked for it). */
export interface DialogPolicy { accept: boolean; text?: string; once: boolean }

const MAX_LOG = 300;
const MAX_NET = 300;
const BODY = 300;
/** long-lived or decorative requests that never make the page busy */
const QUIET = new Set(['eventsource', 'websocket', 'image', 'font', 'media']);
const SECRETISH = /token|auth|key|secret|pass|pwd|code|sig|session|jwt/i;

/** A URL with the values of token-like query parameters hidden (a widget frame's ?auth=…). */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (SECRETISH.test(k)) u.searchParams.set(k, '***');
    const s = u.toString().replace(/%2A%2A%2A/g, '***');
    return s.length > 300 ? `${s.slice(0, 299)}…` : s;
  } catch { return url.slice(0, 300); }
}

const push = <T>(list: T[], item: T, max: number) => { list.push(item); if (list.length > max) list.splice(0, list.length - max); };

export function createWatcher(evidence: string, now: () => number = Date.now) {
  const logs: LogEntry[] = [];
  const net: NetEntry[] = [];
  const notes: string[] = [];
  let seq = 0;
  /** the sequence numbers already reported in an action's one-line summary */
  let reportedLog = 0, reportedNet = 0;
  let policy: DialogPolicy | null = null;
  const watched = new WeakSet<object>();
  const bodies = new Set<Promise<unknown>>();
  /** requests in flight (an AJAX call after a click) and since when: Playwright's 'networkidle' only covers a page load; one open for 15 s (a long poll) no longer counts */
  const open = new Map<Request, number>();
  let lastActivity = 0;

  /** Resolves true once no request has been in flight for `quiet` ms, false after `timeout` ms. */
  async function idle(timeout: number, quiet = 500): Promise<boolean> {
    const end = Date.now() + timeout;
    for (;;) {
      if (![...open.values()].some(at => Date.now() - at < 15_000) && Date.now() - lastActivity >= quiet) return true;
      if (Date.now() >= end) return false;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  function watch(page: WatchedPage): void {
    if (watched.has(page)) return;
    watched.add(page);
    page.on('console', ((m: ConsoleMessage) => {
      const loc = m.location();
      push(logs, { seq: ++seq, at: now(), level: m.type(), text: `${m.text().slice(0, 2000)}${loc.url ? ` (${safeUrl(loc.url)}:${loc.lineNumber})` : ''}` }, MAX_LOG);
    }) as (arg: never) => void);
    page.on('pageerror', ((e: Error) => {
      push(logs, { seq: ++seq, at: now(), level: 'pageerror', text: (e.stack || `${e.name}: ${e.message}`).split('\n').slice(0, 12).join('\n').slice(0, 2000) }, MAX_LOG);
    }) as (arg: never) => void);
    page.on('request', ((r: Request) => { if (!QUIET.has(r.resourceType())) { open.set(r, Date.now()); lastActivity = Date.now(); } }) as (arg: never) => void);
    page.on('requestfinished', ((r: Request) => { if (open.delete(r)) lastActivity = Date.now(); }) as (arg: never) => void);
    page.on('requestfailed', ((r: Request) => {
      if (open.delete(r)) lastActivity = Date.now();
      push(net, { seq: ++seq, at: now(), method: r.method(), url: safeUrl(r.url()), status: null, error: r.failure()?.errorText ?? 'failed' }, MAX_NET);
    }) as (arg: never) => void);
    page.on('response', ((r: Response) => {
      const req = r.request();
      if (['image', 'font', 'media', 'stylesheet'].includes(req.resourceType()) && r.status() < 400) return;
      const entry: NetEntry = { seq: ++seq, at: now(), method: req.method(), url: safeUrl(r.url()), status: r.status() };
      push(net, entry, MAX_NET);
      if (r.status() >= 400 && /json|text|html|xml/.test(r.headers()['content-type'] ?? '')) {
        const read = r.text().then(t => { entry.body = t.replace(/\s+/g, ' ').trim().slice(0, BODY); }).catch(() => undefined)
          .finally(() => bodies.delete(read));
        bodies.add(read);
      }
    }) as (arg: never) => void);
    page.on('dialog', ((d: Dialog) => {
      const p = policy ?? { accept: d.type() === 'alert' || d.type() === 'beforeunload', once: true };
      if (policy?.once) policy = null;
      const answer = p.accept ? d.accept(d.type() === 'prompt' ? (p.text ?? d.defaultValue()) : undefined) : d.dismiss();
      answer.catch(() => undefined);
      notes.push(`A ${d.type()} dialog said "${d.message().slice(0, 300)}" and was ${p.accept ? 'accepted' : 'dismissed'}${p.accept && d.type() === 'prompt' ? ' with a text' : ''}.${!p.accept ? ' To accept the next one: dialog {accept: true}, then repeat the action.' : ''}`);
    }) as (arg: never) => void);
    page.on('download', ((dl: Download) => {
      const name = dl.suggestedFilename().replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').slice(0, 100) || 'download';
      fs.mkdirSync(evidence, { recursive: true });
      let file = path.join(evidence, name);
      for (let i = 2; fs.existsSync(file); i++) file = path.join(evidence, `${i}-${name}`);
      dl.saveAs(file).then(() => notes.push(`Downloaded ${file}.`)).catch(e => notes.push(`A download (${name}) failed: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}.`));
    }) as (arg: never) => void);
  }

  /** The one-line summary of what went wrong since the last action, plus dialogs, downloads and new tabs; '' = nothing. */
  function summary(): string {
    const errors = logs.filter(l => l.seq > reportedLog && (l.level === 'error' || l.level === 'pageerror')).length;
    const bad = net.filter(n => n.seq > reportedNet && (n.status === null || n.status >= 400)).length;
    reportedLog = reportedNet = seq;
    const parts = [...notes.splice(0)];
    if (errors || bad) parts.push(`New: ${[errors ? `${errors} console error${errors > 1 ? 's' : ''}` : '', bad ? `${bad} failed request${bad > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')} (tools console, network).`);
    return parts.join(' ');
  }

  function consoleText(level: string, clear: boolean): string {
    const pick = logs.filter(l => level === 'all' || (level === 'error' ? l.level === 'error' || l.level === 'pageerror' : l.level === 'error' || l.level === 'pageerror' || l.level === 'warning'));
    const text = pick.slice(-100).map(l => `[${l.level}] ${l.text}`).join('\n') || '(none)';
    if (clear) logs.length = 0;
    return text;
  }

  async function networkText(filter: string, clear: boolean): Promise<string> {
    // the bodies of the error responses still being read: up to 2 s
    await Promise.race([Promise.all([...bodies]), new Promise(resolve => setTimeout(resolve, 2000))]);
    const pick = net.filter(n => filter === 'all' || n.status === null || n.status >= 400);
    const text = pick.slice(-100).map(n => `${n.method} ${n.url} → ${n.status ?? `failed (${n.error})`}${n.body ? ` | ${n.body}` : ''}`).join('\n') || '(none)';
    if (clear) net.length = 0;
    return text;
  }

  return {
    watch, summary, consoleText, networkText, idle,
    setPolicy: (p: DialogPolicy | null) => { policy = p; },
    note: (text: string) => { notes.push(text); },
  };
}
