// Structured logs for humans and agents (the user, 2026-10-11: "l'IA deve sapere perfettamente come testarla da sola
// vedere i log"). One JSON object per line in <userData>/logs/app-YYYY-MM-DD.jsonl:
//   {"t":"2026-10-11T09:40:51.123Z","lvl":"info","scope":"chats","msg":"session started","chat":"c_12","data":{...}}
// Levels: debug < info < warn < error (SB_LOG_LEVEL, default info). Errors carry `cause` and `hint` (the next step).
// Files rotate daily; files older than 14 days are deleted at start. Secrets are redacted before writing (token-like
// strings, Authorization headers, ?token= / per-chat MCP tokens, and the exact value of every API key the app holds,
// engines/secrets.ts addRedaction). Read them with `node scripts/logs.mjs` (filters by
// level, scope, chat, text, since). Used by every main-process module: `import { log } from './log'`.
import fs from 'node:fs';
import path from 'node:path';

export type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Entry { t: string; lvl: Level; scope: string; msg: string; chat?: string; data?: unknown; cause?: string; hint?: string }

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk-[A-Za-z0-9_-]{16,})\b/g,                       // API keys
  /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})\b/g, // JWTs
  /(authorization["']?\s*[:=]\s*["']?)(bearer\s+)?[^\s"',}]+/gi,
  /([?&](?:token|access_token|code|password|pwd)=)[^&\s"]+/gi,
  /(\/mcp\/chat\/[^/\s"]+\/)[A-Za-z0-9_-]{8,}/g,          // per-chat MCP endpoint tokens
  /("(?:password|passwd|secret|apiKey|api_key|token)"\s*:\s*")[^"]*(?=")/gi,
  /\b([a-z][a-z0-9+.-]{0,15}:\/\/)[^/\s:@"']{1,256}:[^/\s@"']{0,256}(?=@)/gi,  // user:password@ in URLs (bounded: no backtracking blow-up)
];

/** The API keys main has read (engines/secrets.ts), as they appear in a JSON line too: replaced whatever their shape. */
const known = new Set<string>();

/** Redacts this exact value from every later log line (an API key the app stores or reads). */
export function addRedaction(value: string): void {
  if (value.length < 8) return; // too short to be a key: redacting it would blank ordinary words
  known.add(value);
  known.add(JSON.stringify(value).slice(1, -1));
}

export function redact(s: string): string {
  let out = s;
  for (const k of known) if (out.includes(k)) out = out.split(k).join('[redacted]');
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m, p1?: string) => (typeof p1 === 'string' && m.startsWith(p1) && p1 !== m ? `${p1}[redacted]` : '[redacted]'));
  return out;
}

class Logger {
  private dir: string | null = null;
  private day = '';
  private fd: number | null = null;
  private min: Level = (process.env.SB_LOG_LEVEL as Level) in ORDER ? (process.env.SB_LOG_LEVEL as Level) : 'info';
  readonly recent: Entry[] = []; // last 500, for the app MCP / diagnostics
  private readonly listeners: ((e: Entry) => void)[] = [];
  /** Sees every written entry, already redacted (the Log page's journal takes the warnings and errors). */
  onWrite(fn: (e: Entry) => void): void { this.listeners.push(fn); }

  init(userData: string): string {
    this.dir = path.join(userData, 'logs');
    fs.mkdirSync(this.dir, { recursive: true });
    const cutoff = Date.now() - 14 * 864e5;
    for (const f of fs.readdirSync(this.dir)) {
      const full = path.join(this.dir, f);
      try { if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full); } catch { /* in use or gone */ }
    }
    return this.dir;
  }

  get folder(): string | null { return this.dir; }

  write(lvl: Level, scope: string, msg: string, extra: Omit<Entry, 't' | 'lvl' | 'scope' | 'msg'> = {}): void {
    if (ORDER[lvl] < ORDER[this.min]) return;
    const e: Entry = { t: new Date().toISOString(), lvl, scope, msg, ...extra };
    let line: string;
    try { line = redact(JSON.stringify(e)); } catch { line = JSON.stringify({ t: e.t, lvl, scope, msg: redact(msg), data: '[unserializable]' }); }
    const entry = JSON.parse(line) as Entry;
    this.recent.push(entry);
    if (this.recent.length > 500) this.recent.shift();
    for (const fn of this.listeners) try { fn(entry); } catch { /* a listener never stops the log */ }
    if (process.env.SB_LOG_STDOUT === '1' || (lvl === 'error' && !this.dir)) console.log(line);
    if (!this.dir) return;
    const day = e.t.slice(0, 10);
    if (day !== this.day || this.fd === null) {
      if (this.fd !== null) try { fs.closeSync(this.fd); } catch { /* closed */ }
      this.fd = fs.openSync(path.join(this.dir, `app-${day}.jsonl`), 'a');
      this.day = day;
    }
    try { fs.writeSync(this.fd, `${line}\n`); } catch { /* disk full: keep running */ }
  }

  debug(scope: string, msg: string, extra?: Omit<Entry, 't' | 'lvl' | 'scope' | 'msg'>) { this.write('debug', scope, msg, extra); }
  info(scope: string, msg: string, extra?: Omit<Entry, 't' | 'lvl' | 'scope' | 'msg'>) { this.write('info', scope, msg, extra); }
  warn(scope: string, msg: string, extra?: Omit<Entry, 't' | 'lvl' | 'scope' | 'msg'>) { this.write('warn', scope, msg, extra); }
  /** An error always says why (cause) and what to do next (hint), so an agent can act on it. */
  error(scope: string, msg: string, extra: Omit<Entry, 't' | 'lvl' | 'scope' | 'msg'> & { cause: string; hint: string }) { this.write('error', scope, msg, extra); }
}

export const log = new Logger();
export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
