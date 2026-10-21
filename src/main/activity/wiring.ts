// Feeds the Log's journal (activity/journal.ts) from what the app already does, without touching the modules: the
// events sent to the window (the chats' chain through chat-watch.ts, the brain feed's errors, notes and role changes),
// the technical log's warnings and errors, and the brain's memory store (memory/records.json, read when its time
// changes: the CLI writes it outside the app too). Also serves log:list and pushes log:events. Zero tokens.
// Called once by main/wiring.ts; the pure mapping functions are exported for test/unit/activity/wiring.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { ChatSummary, EventChannel, EventMap, FeedEvent } from '../../shared/contract';
import type { LogInput } from '../../shared/activity-log';
import type { Emitter } from '../ipc';
import { log, type Entry } from '../log';
import { timersFor } from '../timers';
import { ChatWatch } from './chat-watch';
import { journal } from './journal';
const { setInterval } = timersFor('activity');

/** The brain feed's own events that are not already a chat's (chat-watch.ts says those). */
export function feedToLog(e: FeedEvent): LogInput | null {
  const by = e.who ? ` · ${e.who}` : '';
  switch (e.kind) {
    case 'error': return { kind: 'error', level: 'warn', title: `Errore registrato nel brain: ${e.title}`, text: `${e.detail}${by}`.replace(/^ · /, ''), ...(e.chatId ? { chatId: e.chatId } : {}) };
    case 'idea': case 'reflection': case 'win': case 'now': case 'decision': case 'done': case 'proposal':
      return { kind: 'memory', level: 'info', title: `${e.label}: ${e.title}`, text: `${e.detail}${by}`.replace(/^ · /, ''), ...(e.chatId ? { chatId: e.chatId } : {}) };
    case 'agent-updated': case 'agent-rolledback': case 'agent-proposal': case 'agent-feedback':
      return { kind: 'brain', level: 'info', title: `${e.label}: ${e.title}`, text: e.detail || undefined };
    case 'budget': return { kind: 'app', level: 'warn', title: `${e.label}: ${e.title}`, text: e.detail || undefined };
    default: return null;
  }
}

/** A technical warning or error, readable: its scope, message, cause and hint. */
export function entryToLog(e: Entry): LogInput | null {
  if (e.lvl !== 'warn' && e.lvl !== 'error') return null;
  return { kind: 'app', level: e.lvl, title: `${e.scope}: ${e.msg}`, ...(e.cause ? { error: e.cause } : {}), ...(e.hint ? { text: `Prossimo passo: ${e.hint}` } : {}), ...(e.chat ? { chatId: e.chat } : {}) };
}

interface MemRow { memoryId: string; status: string; value: string; scope?: { roleId?: string } }
const MEM_STATUS: Record<string, string> = { observed: 'osservata', proposed: 'proposta', confirmed: 'confermata', disputed: 'contestata', retracted: 'ritirata' };
/** What changed in the memory store between two reads: new facts and status changes. */
export function memoryDiff(before: ReadonlyMap<string, string>, rows: readonly MemRow[]): LogInput[] {
  const out: LogInput[] = [];
  for (const r of rows) {
    if (!r || typeof r.memoryId !== 'string') continue;
    const was = before.get(r.memoryId), role = r.scope?.roleId ? ` di ${r.scope.roleId}` : '';
    if (was === undefined) out.push({ kind: 'memory', level: 'info', title: `Memoria${role} aggiornata: ${r.value}`, text: `Nuovo fatto, ${MEM_STATUS[r.status] ?? r.status}` });
    else if (was !== r.status) out.push({ kind: 'memory', level: r.status === 'retracted' || r.status === 'disputed' ? 'warn' : 'ok', title: `Memoria${role}: fatto ${MEM_STATUS[r.status] ?? r.status}`, text: r.value });
  }
  return out;
}

export interface ActivityDeps {
  userData: string;
  emitter: Emitter;
  chats: () => readonly ChatSummary[];
  brainRoot: () => string | null;
}

export function attachActivity(d: ActivityDeps): { list: () => ReturnType<typeof journal.list>; answered: (chatId: string, requestId: string) => void } {
  journal.init(d.userData, events => d.emitter.emit('log:events', events));
  const watch = new ChatWatch();
  const last = new Map<string, ChatSummary>();
  try { const all = d.chats(); watch.seed(all); for (const c of all) last.set(c.id, c); } catch { /* starts empty */ }
  const put = (rows: LogInput[]) => { for (const r of rows) journal.record(r); };
  d.emitter.tap(<K extends EventChannel>(ch: K, payload: EventMap[K]) => {
    if (ch === 'log:events') return;
    if (ch === 'chat:updated') { const c = payload as ChatSummary; last.set(c.id, c); put(watch.updated(c)); }
    else if (ch === 'chat:item') { const p = payload as EventMap['chat:item']; if (!p.replace || p.item.kind !== 'assistant' || !p.item.streaming) put(watch.item(p.chatId, p.item, last.get(p.chatId))); }
    else if (ch === 'pending:added') { const p = payload as EventMap['pending:added']; put(watch.pendingAdded(p, last.get(p.chatId))); }
    else if (ch === 'pending:resolved') { const p = payload as EventMap['pending:resolved']; put(watch.pendingResolved(p.chatId, p.requestId, last.get(p.chatId))); }
    else if (ch === 'chat:removed') { const p = payload as EventMap['chat:removed']; watch.removed(p.chatId); last.delete(p.chatId); }
    else if (ch === 'feed:events') for (const e of payload as FeedEvent[]) { if (e.away) continue; const r = feedToLog(e); if (r) journal.record({ ...r, at: e.at }); }
  });
  // the technical log's warnings and errors; the same line again within a minute is said once
  const recentLines = new Map<string, number>();
  log.onWrite(e => {
    const r = entryToLog(e); if (!r) return;
    const key = r.title, now = Date.now();
    if ((recentLines.get(key) ?? 0) > now - 60_000) return;
    recentLines.set(key, now);
    if (recentLines.size > 500) for (const [k, t] of recentLines) if (t < now - 60_000) recentLines.delete(k);
    journal.record(r);
  });
  // the memory store: the first read is a baseline, later changes are logged
  let memKey = '', memRoot: string | null = null, mem = new Map<string, string>();
  const readMem = () => {
    const root = d.brainRoot();
    if (!root) return;
    const file = path.join(root, 'memory', 'records.json');
    let st: fs.Stats;
    try { st = fs.statSync(file); } catch { if (root !== memRoot) { memRoot = root; mem = new Map(); memKey = ''; } return; }
    const key = `${st.mtimeMs}:${st.size}`;
    if (key === memKey && root === memRoot) return;
    let rows: MemRow[];
    try { rows = JSON.parse(fs.readFileSync(file, 'utf8')) as MemRow[]; if (!Array.isArray(rows)) return; } catch { return; }
    if (root === memRoot) put(memoryDiff(mem, rows).slice(0, 50));
    memRoot = root; memKey = key; mem = new Map(rows.filter(r => r && typeof r.memoryId === 'string').map(r => [r.memoryId, r.status]));
  };
  readMem();
  setInterval(readMem, 10_000).unref?.();
  return { list: () => journal.list(), answered: (chatId, requestId) => watch.answeredByUser(chatId, requestId) };
}
