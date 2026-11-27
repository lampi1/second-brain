// What the user asked about, told when it is done (ADR 0371 point 4, #492: «come procede?», «mi fai il punto?» asked
// again and again, because a clean result is quiet news and nobody told him). When his own message to the Orchestrator
// names a work chat (a distinctive part of its title, as a whole word), or asks how the work is going in so many words,
// the open root chats it means are watched for WATCH_TTL_MS (a watch with no result ends then too). When one of them
// delivers its result as quiet news, the Orchestrator is told to tell him in ONE short line, now, unasked; once per
// ask. wiring.ts folds that into the clean report's own wake (orchestrator-wake.ts cleanReport `asked`): one turn, never
// two; only when that wake is off does resultReleased send its own note. A result the Orchestrator already writes about
// (synthesis) only ends the watch.
// Wired by wiring.ts with ChatManager.onOwnerAsked, onCleanReport and onResultReleased (chats/manager-work.ts, the hook
// in manager-delegation.ts releaseResult). Pure apart from the injected clock and send. Unit tests:
// test/unit/agents/watched-asks.test.ts.

/** How long an ask stays watched: a job asked about in the morning is still his in the afternoon, not tomorrow. */
export const WATCH_TTL_MS = 6 * 3600_000;
/** The shortest title part that names a chat by itself («Login», «Ordini»): shorter ones match too much. */
const PART_MIN = 5;
/** Words a title may hold that the user writes about anything («lancia i test», «il piano», «fai la review»): a part
 *  that is only these never names a chat. */
const COMMON = new Set(['test', 'tests', 'piano', 'plan', 'review', 'build', 'deploy', 'release', 'codice', 'code', 'lavoro', 'report',
  'chat', 'nuova', 'nuovo', 'fix', 'bug', 'bugs', 'analisi', 'verifica', 'controllo', 'modifica', 'modifiche', 'aggiorna', 'update', 'ricerca',
  'domanda', 'risposta', 'progetto', 'task', 'compito', 'pagina', 'file', 'cartella', 'errore', 'errori', 'prova', 'demo', 'app', 'brain']);

/** Asked about the work in so many words: «come procede?», «a che punto siamo», «mi fai il punto», «come sta andando»,
 *  «novità sui lavori», «novità?» alone. Never «aggiornamenti», «situazione» or «come va» (an update, a greeting). */
const GENERAL = /\b(?:come\s+(?:procede|procedono|sta\s+andando|stanno\s+andando|vanno\s+i\s+lavori|va\s+il\s+lavoro)|a\s+che\s+punto\s+(?:siamo|sei|sono|e|sta|stanno)|(?:mi\s+)?fai\s+il\s+punto|fammi\s+il\s+punto|stato\s+dei\s+lavori|novita\s+(?:sui|sul|dai|dalle)\s+(?:lavori|lavoro|chat|agenti)|how\s+is\s+it\s+going|status\s+update)\b|^\s*(?:novita|news)\s*[?!.]*\s*$/u;
/** At most this many watches (one per chat): the oldest goes first. */
const WATCH_MAX = 200;

export interface WatchedChat { id: string; title: string; state: string; isOrchestrator?: boolean; parentId?: string | null; closedAt?: number | null }
export interface ReleasedResult { chatId: string; title: string; role: string; summary: string; quiet: boolean }
export interface WatchedAsksDeps {
  /** the chats now (ChatManager.list) */
  list: () => WatchedChat[];
  /** an app message to the open Orchestrator (null = none open) */
  orchestrator: () => string | null;
  send: (chatId: string, text: string) => Promise<void> | void;
  now?: () => number;
  log?: (what: string, data: Record<string, unknown>) => void;
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** «Ordini · Piano», «Login – fix», «App: menu»: the parts a user names a chat by, and the whole title. */
const partsOf = (title: string): string[] => {
  const whole = fold(title).trim();
  const parts = whole.split(/\s*(?:·|•|–|—|-|:|\|)\s*/u).map(p => p.trim());
  // a part names the chat when it is long enough and not only words he writes about anything
  const distinctive = (p: string): boolean => p.length >= PART_MIN && p.split(/[^\p{L}\p{N}]+/u).some(w => w.length >= PART_MIN && !COMMON.has(w));
  return [...new Set([whole, ...parts])].filter(distinctive);
};
const names = (text: string, title: string): boolean => partsOf(title).some(p => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(p)}(?![\\p{L}\\p{N}])`, 'u').test(text));
const working = (c: WatchedChat): boolean => c.state === 'running' || c.state === 'starting' || c.state === 'waiting';

/** The one line the Orchestrator reads (English: the app's words to an agent; it writes to the user in Italian). */
export function doneNote(r: Pick<ReleasedResult, 'title' | 'role' | 'summary' | 'chatId'>): string {
  const summary = r.summary.replace(/\s+/g, ' ').trim().slice(0, 300);
  return `[second-brain] The user asked you about «${r.title}» (${r.role}) and it has just finished: ${summary || 'done'}. Tell him now in ONE short line in Italian (what is done; the chat to open only if he must look), without waiting for him to ask. Nothing else in this turn.`;
}

export class WatchedAsks {
  private readonly watched = new Map<string, number>();
  constructor(private readonly d: WatchedAsksDeps) {}
  private now(): number { return (this.d.now ?? Date.now)(); }
  /** A watch whose time passed ends even when no result came. */
  private prune(): void {
    const now = this.now();
    for (const [id, until] of this.watched) if (until < now) this.watched.delete(id);
  }
  /** How many chats are watched now (the expired ones gone). */
  get size(): number { this.prune(); return this.watched.size; }

  /** His own message to the Orchestrator: the root work chats it names (or, asked in general, every one at work)
   *  are watched. Returns their ids. */
  noteUserText(text: string): string[] {
    this.prune();
    const t = fold(text);
    if (!t.trim()) return [];
    const roots = this.d.list().filter(c => !c.isOrchestrator && !c.parentId && !c.closedAt);
    const named = roots.filter(c => c.title && names(t, c.title));
    const picked = named.length ? named : GENERAL.test(t) ? roots.filter(working) : [];
    const until = this.now() + WATCH_TTL_MS;
    for (const c of picked) { this.watched.delete(c.id); this.watched.set(c.id, until); }
    while (this.watched.size > WATCH_MAX) this.watched.delete(this.watched.keys().next().value!);
    if (picked.length) this.d.log?.('watching what the user asked about', { chats: picked.length, general: !named.length });
    return picked.map(c => c.id);
  }

  /** The chat is watched now; the watch ends here (once per ask). */
  claim(chatId: string): boolean {
    this.prune();
    const until = this.watched.get(chatId);
    if (until === undefined) return false;
    this.watched.delete(chatId);
    return until >= this.now();
  }

  /** A root chat's result was delivered: a watched quiet one becomes one short line for the user, through the
   *  Orchestrator. True = the note went. */
  resultReleased(r: ReleasedResult): boolean {
    if (!this.claim(r.chatId)) return false;
    // the Orchestrator already writes about a result it synthesizes: the watch ends, nothing more is sent
    if (!r.quiet) return false;
    return this.tell(r);
  }

  /** The note to the Orchestrator itself, when the clean report's wake could not carry it (orchestrator-wake.ts off). */
  tell(r: Pick<ReleasedResult, 'chatId' | 'title' | 'role' | 'summary'>): boolean {
    const to = this.d.orchestrator();
    if (!to) return false;
    try { void Promise.resolve(this.d.send(to, doneNote(r))).catch(e => this.d.log?.('done note not sent', { cause: String(e) })); }
    catch (e) { this.d.log?.('done note not sent', { cause: String(e) }); return false; }
    this.d.log?.('told the user what he asked about is done', { chat: r.chatId });
    return true;
  }
}

/** The manager side wiring.ts attaches: his messages and the released results. */
export interface WatchedAsksSource {
  onOwnerAsked(fn: (text: string) => void): void;
  onResultReleased(fn: (r: ReleasedResult) => void): void;
}
export function attachWatchedAsks(source: WatchedAsksSource, deps: WatchedAsksDeps): WatchedAsks {
  const w = new WatchedAsks(deps);
  source.onOwnerAsked(text => { w.noteUserText(text); });
  source.onResultReleased(r => { w.resultReleased(r); });
  return w;
}
