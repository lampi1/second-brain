// Structured logs for humans and agents (the user, 2026-10-11: "l'IA deve sapere perfettamente come testarla da sola
// vedere i log"). One JSON object per line in <userData>/logs/app-YYYY-MM-DD.jsonl:
//   {"t":"2026-10-11T09:40:51.123Z","lvl":"info","scope":"chats","msg":"session started","chat":"c_12","data":{...}}
// Levels: debug < info < warn < error (SB_LOG_LEVEL, default info). Errors carry `cause` and `hint` (the next step).
// Correlation (ADR 0192): an entry may carry `run` (the agent run id, filled from `chat` by the resolver the chat manager
// registers, correlate), `step` (a tool call's id, an engine turn's id) and `op`, named after the OpenTelemetry GenAI
// operations where one fits (invoke_agent = an agent turn, execute_tool = a tool call, chat = a model call):
// `npm run logs -- --run <id>` follows one job across chats, engines and tools.
// Files rotate daily; files older than 14 days are deleted, at start and at each day's rollover, once the daily digest
// (log-digest.ts, kept 90 days) has summarized them. Secrets are redacted before writing (token-like
// strings, Authorization headers, ?token= / per-chat MCP tokens, and the exact value of every API key the app holds,
// engines/secrets.ts addRedaction). Read them with `node scripts/logs.mjs` (filters by
// level, scope, chat, text, since). Used by every main-process module: `import { log } from './log'`.
import fs from 'node:fs';
import path from 'node:path';
import { redact } from '../../packages/routine-runtime/src/mask';
import { JOURNAL_DIR, updateDigest } from './log-digest';

export type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** OpenTelemetry GenAI operation names (gen_ai.operation.name) the app uses, plus its own for the rest. */
export type LogOp = 'invoke_agent' | 'execute_tool' | 'chat' | 'create_agent';
export interface Entry { t: string; lvl: Level; scope: string; msg: string; chat?: string; run?: string; step?: string; op?: LogOp; data?: unknown; cause?: string; hint?: string }

/** Raw log files are kept this many days (their summary lives on in the digest, log-digest.ts). */
export const LOG_KEEP_DAYS = 14;

// The masking itself lives in the shared routine runtime (ADR 0175): the app log and the routine run folders use one
// list of secret shapes and one set of registered values.
export { addRedaction, redact } from '../../packages/routine-runtime/src/mask';

class Logger {
  private dir: string | null = null;
  private day = '';
  private fd: number | null = null;
  private min: Level = (process.env.SB_LOG_LEVEL as Level) in ORDER ? (process.env.SB_LOG_LEVEL as Level) : 'info';
  readonly recent: Entry[] = []; // last 500, for the app MCP / diagnostics
  private readonly listeners: ((e: Entry) => void)[] = [];
  /** Sees every written entry, already redacted (the Log page's journal takes the warnings and errors). */
  onWrite(fn: (e: Entry) => void): void { this.listeners.push(fn); }

  private userData: string | null = null;
  private housekeeping: Promise<void> | null = null;
  private runOf: ((chatId: string) => string | undefined) | null = null;
  /** The chat manager tells which agent run a chat is: every entry with `chat` and no `run` gets it (ADR 0192). */
  correlate(fn: ((chatId: string) => string | undefined) | null): void { this.runOf = fn; }

  init(userData: string): string {
    this.dir = path.join(userData, 'logs');
    this.userData = userData;
    fs.mkdirSync(this.dir, { recursive: true });
    void this.housekeep();
    return this.dir;
  }

  /** The past days not yet summarized go to the digest, then the raw files past LOG_KEEP_DAYS are deleted (never a
   *  digest file: those rotate by themselves at 90 days). At start and at each day's rollover; one at a time. */
  housekeep(now = Date.now()): Promise<void> {
    if (this.housekeeping) return this.housekeeping;
    const dir = this.dir, userData = this.userData;
    if (!dir) return Promise.resolve();
    this.housekeeping = (async () => {
      await updateDigest(dir, userData ? path.join(userData, JOURNAL_DIR) : null, now);
      const cutoff = now - LOG_KEEP_DAYS * 864e5;
      let names: string[] = [];
      try { names = fs.readdirSync(dir); } catch { return; }
      for (const f of names) {
        if (f.startsWith('digest-')) continue;
        const full = path.join(dir, f);
        try { if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full); } catch { /* in use or gone */ }
      }
    })().catch(() => { /* never breaks the app */ }).finally(() => { this.housekeeping = null; });
    return this.housekeeping;
  }

  get folder(): string | null { return this.dir; }

  write(lvl: Level, scope: string, msg: string, extra: Omit<Entry, 't' | 'lvl' | 'scope' | 'msg'> = {}): void {
    if (ORDER[lvl] < ORDER[this.min]) return;
    const e: Entry = { t: new Date().toISOString(), lvl, scope, msg, ...extra };
    if (e.chat && !e.run && this.runOf) { try { const run = this.runOf(e.chat); if (run) e.run = run; } catch { /* never breaks the log */ } }
    let line: string;
    try { line = JSON.stringify(e, (key, value: unknown) => /^(password|passwd|secret|apiKey|api_key|token)$/i.test(key) ? '[redacted]' : typeof value === 'string' && key !== 'lvl' && key !== 't' ? redact(value) : value); } catch { line = JSON.stringify({ t: e.t, lvl, scope, msg: redact(msg), data: '[unserializable]' }); }
    const entry = JSON.parse(line) as Entry;
    this.recent.push(entry);
    if (this.recent.length > 500) this.recent.shift();
    for (const fn of this.listeners) try { fn(entry); } catch { /* a listener never stops the log */ }
    if (process.env.SB_LOG_STDOUT === '1' || (lvl === 'error' && !this.dir)) console.log(line);
    if (!this.dir) return;
    const day = e.t.slice(0, 10);
    if (day !== this.day || this.fd === null) {
      const rolled = this.fd !== null && this.day !== '' && day !== this.day;
      if (this.fd !== null) try { fs.closeSync(this.fd); } catch { /* closed */ }
      this.fd = fs.openSync(path.join(this.dir, `app-${day}.jsonl`), 'a');
      this.day = day;
      // a new day: yesterday goes to the digest (a little later: never inside the write that crossed midnight)
      if (rolled) { const t = setTimeout(() => { void this.housekeep(); }, 5_000); t.unref?.(); }
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
