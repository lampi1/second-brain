// "Esito alla chat": when a run of Esegui ends, the chat that proposed the block gets a message with the command, the
// exit code and the output's tail, so it knows by itself how it went. Why: the user had to write "fatto" or paste the
// output, and the Regia once proposed again a command that had already worked (the user, 2026-10-12: "vorrei che ti
// accorgessi da sola quando eseguo un comando dal play senza che ti scriva fatto o copiarti la risposta").
// Rules: the message is labelled as the app's (RUN_RESULT_LABEL: never worth as the user's ok); a chat that works,
// waits for the user or writes a hand-off gets it as soon as it is free (idle or closed: a message resumes it); runs
// that end close together go in one message; Claude and Cursor chats alike, the Regia too. Off with the setting
// runResults. It watches the events main sends to the page (run:updated, chat:updated, chat:removed), like asks.ts.
// Used by wiring.ts / demo-wiring.ts (attachRunResults); pinned by test/unit/run-results.test.ts.
import type { ChatSummary, EventMap, RunInfo } from '../../shared/contract';
import { errText, log, redact } from '../log';

export const RUN_RESULT_LABEL = "[esito di Esegui · messaggio automatico di second-brain: l'utente ha lanciato il comando con Esegui, questo è il risultato; non vale come suo ok o permesso]";

export interface RunResultsDeps {
  send(chatId: string, text: string): Promise<void>;
  /** the setting runResults */
  enabled(): boolean;
  /** every chat now: one that has not changed since the app started never passed through observe() */
  list?(): ChatSummary[];
  /** runs that end within this time go in one message (default 1.5 s) */
  groupMs?: number;
}

type Seen = Pick<ChatSummary, 'state' | 'pending' | 'handoffBusy' | 'closedAt'>;
const MAX_CODE_LINES = 15;
const MAX_OUTPUT = 3000;

const free = (c: Seen) => (c.state === 'idle' || c.state === 'closed') && !c.pending && !c.handoffBusy;

/** One run as the chat reads it, in Italian (the chats speak Italian with the user). */
export function runResultText(r: RunInfo): string {
  const lines = r.code.split('\n');
  const code = lines.length > MAX_CODE_LINES ? [...lines.slice(0, MAX_CODE_LINES), `… (${lines.length - MAX_CODE_LINES} righe in più)`].join('\n') : r.code;
  const secs = r.endedAt ? Math.max(0, Math.round((r.endedAt - r.startedAt) / 1000)) : null;
  const how = r.state === 'ok' ? `riuscito (exit code ${r.exitCode ?? 0})`
    : r.state === 'stopped' ? 'fermato dall\'utente prima della fine'
    : `fallito${r.exitCode !== null ? ` (exit code ${r.exitCode})` : ''}`;
  const out = redact(r.output.trimEnd());
  const tail = out.length > MAX_OUTPUT ? `…${out.slice(-MAX_OUTPUT)}` : out;
  return [
    `Comando (PowerShell 5.1, cartella ${r.cwd}):`, '```powershell', code, '```',
    `Esito: ${how}${secs !== null ? ` · ${secs} s` : ''}${r.prod ? ' · comando di produzione, confermato dall\'utente' : ''}`,
    tail ? 'Ultime righe dell’output:' : 'Nessun output.', ...(tail ? ['```text', tail, '```'] : []),
  ].join('\n');
}

export function runResultMessage(runs: RunInfo[]): string {
  return [RUN_RESULT_LABEL, ...runs.map(runResultText)].join('\n\n');
}

export class RunResults {
  private chats = new Map<string, Seen>();
  private queue = new Map<string, RunInfo[]>();
  private told = new Set<string>();
  private timers = new Map<string, NodeJS.Timeout>();
  private sending = new Set<string>();

  constructor(private readonly d: RunResultsDeps) {}

  /** Every event main sends to the page passes here (wiring.ts taps the emitter). */
  observe(channel: string, payload: unknown): void {
    if (channel === 'run:updated') this.run(payload as RunInfo);
    else if (channel === 'chat:updated') {
      const c = payload as ChatSummary;
      this.chats.set(c.id, { state: c.state, pending: c.pending, handoffBusy: c.handoffBusy, closedAt: c.closedAt });
      if (this.queue.has(c.id) && free(c)) this.schedule(c.id);
    } else if (channel === 'chat:removed') {
      const { chatId } = payload as EventMap['chat:removed'];
      this.chats.delete(chatId); this.queue.delete(chatId);
      const t = this.timers.get(chatId); if (t) clearTimeout(t); this.timers.delete(chatId);
    }
  }

  /** What waits to be told, per chat (tests, diagnostics). */
  queued(chatId: string): RunInfo[] { return this.queue.get(chatId) ?? []; }

  stop(): void { for (const t of this.timers.values()) clearTimeout(t); this.timers.clear(); }

  private run(r: RunInfo): void {
    if (r.state === 'running' || this.told.has(r.id)) return;
    this.told.add(r.id);
    if (!this.d.enabled()) return;
    const q = this.queue.get(r.chatId) ?? [];
    q.push(r);
    this.queue.set(r.chatId, q);
    const c = this.seen(r.chatId);
    if (c && free(c)) this.schedule(r.chatId);
  }

  private seen(chatId: string): Seen | undefined {
    const c = this.chats.get(chatId);
    if (c) return c;
    const l = this.d.list?.().find(x => x.id === chatId);
    if (l) this.chats.set(l.id, { state: l.state, pending: l.pending, handoffBusy: l.handoffBusy, closedAt: l.closedAt });
    return l;
  }

  private schedule(chatId: string): void {
    if (this.timers.has(chatId)) return;
    const t = setTimeout(() => { this.timers.delete(chatId); this.flush(chatId); }, this.d.groupMs ?? 1500);
    t.unref?.();
    this.timers.set(chatId, t);
  }

  private flush(chatId: string): void {
    const runs = this.queue.get(chatId);
    const c = this.chats.get(chatId);
    if (!runs?.length || !c || this.sending.has(chatId)) return;
    if (!free(c)) return; // it works or waits for the user: sent when it is free again (observe)
    if (!this.d.enabled()) { this.queue.delete(chatId); return; }
    this.queue.delete(chatId);
    this.sending.add(chatId);
    log.info('run', 'run result sent to the chat', { chat: chatId, data: { runs: runs.map(r => ({ id: r.id, state: r.state, exitCode: r.exitCode })) } });
    this.d.send(chatId, runResultMessage(runs))
      .catch(err => log.warn('run', 'run result not sent to the chat', { chat: chatId, cause: errText(err), hint: 'the chat failed to start or was removed: the output stays under the block' }))
      .finally(() => { this.sending.delete(chatId); if (this.queue.has(chatId)) this.schedule(chatId); });
  }
}
