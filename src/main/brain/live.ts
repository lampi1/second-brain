// Live feed of the brain: watches the brain folder and the chats and turns every change into a small event ("idea
// dell'IA aggiunta", "errore registrato", "la chat X ti aspetta"). Zero tokens: file reads and the brain's read-only
// harness/cursor/chats.mjs only (the user, 2026-10-11: "vedrò aggiornarsi in automatico tutto quanto ... un meccanismo di
// notifiche tipo 'un'idea aggiunta, un errore trovato'"). Port of the tested prototype (<brain>/app/prototype/core/
// live.mjs). The brain's own parsers (<brainRoot>/ops/tools/brain-site/parse.mjs) are imported at runtime; without
// them the feed has chats, playbooks and mail only. The first scan is a baseline: it emits nothing except what changed
// since the last run of the app (keys persisted in userData/live-state.json), marked away ("mentre eri via").
// Used by brain/index.ts, which stamps, stores and notifies the events. Pure diff functions are exported for tests.
import { timersFor } from '../timers';
const { setInterval, clearInterval } = timersFor('brain/live');
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { ChatSummary, FeedAction, FeedEvent, Priority } from '../../shared/contract';
import { log, errText } from '../log';
import { runNode, type NodeRunner } from './node';
import { brainScript } from '../rules/tools';

/** urgent = the user is needed now (toast by default) · normal = worth a look · quiet = feed only. Labels are Italian UI. */
export const KINDS: Record<string, { label: string; priority: Priority }> = {
  'agent-created': { label: 'Agente creato', priority: 'quiet' },
  'agent-suggested': { label: 'Agente suggerito', priority: 'normal' },
  'agent-proposal': { label: 'Modifica proposta', priority: 'normal' },
  'agent-updated': { label: 'Agente aggiornato', priority: 'quiet' },
  'agent-archived': { label: 'Agente archiviato', priority: 'quiet' },
  'agent-restored': { label: 'Agente ripristinato', priority: 'quiet' },
  'agent-rolledback': { label: 'Versione ripristinata', priority: 'quiet' },
  'agent-feedback': { label: 'Feedback Agente', priority: 'quiet' },
  'chat-waiting': { label: 'Chat che ti aspetta', priority: 'urgent' },
  login: { label: 'Accesso da rifare', priority: 'urgent' },   // browser: an agent waits for the user to sign in to an environment
  question: { label: 'Domanda per te', priority: 'urgent' },
  'chat-done': { label: 'Chat finita', priority: 'quiet' },     // pull-only (the user, 2026-10-13: 627 toasts a day)
  'chat-failed': { label: 'Chat finita con errore', priority: 'urgent' }, // an app chat's turn ended with an error
  'chat-closed': { label: 'Chat chiusa', priority: 'quiet' },  // the Orchestrator closed a chat (app_close_chat)
  error: { label: 'Errore registrato', priority: 'normal' },
  idea: { label: 'Idea aggiunta', priority: 'normal' },
  reflection: { label: "Riflessione dell'IA", priority: 'normal' },
  win: { label: 'Lode registrata', priority: 'normal' },
  budget: { label: 'Limite di spesa', priority: 'normal' },
  proposal: { label: 'Proposta', priority: 'quiet' },
  playbook: { label: 'Taccuino aggiornato', priority: 'quiet' },
  done: { label: 'Fatto', priority: 'quiet' },
  decision: { label: 'Decisione', priority: 'quiet' },
  now: { label: 'Filo aggiornato', priority: 'quiet' },
  mail: { label: 'Posta tra chat', priority: 'quiet' },
  'mail-blocked': { label: 'Messaggio bloccato', priority: 'normal' },
  'sync-ok': { label: 'GitHub aggiornato', priority: 'quiet' },
  'sync-blocked': { label: 'Pubblicazione bloccata dal controllo', priority: 'normal' },
  'sync-error': { label: 'Pubblicazione non riuscita', priority: 'normal' },
  'brain-sync': { label: 'Sincronizzazione del cervello ferma', priority: 'urgent' }, // brain/sync.ts: a domain stopped (ADR 0059)
  task: { label: 'Task', priority: 'normal' },   // tasks/service.ts: news on my work items, PRs and the tickets I follow
  'task-alert': { label: 'Task per te', priority: 'normal' },  // tasks/service.ts: a mention or a change on my things (toast + sound, ADR 0029)
  'agent-kept': { label: 'Agente tenuto', priority: 'quiet' },      // chats/manager.ts: a probation agent passed (AGENTS-DESIGN §4.7)
  'agent-retired': { label: 'Agente ritirato', priority: 'normal' }, // a probation agent was archived; the card offers Ripristina
};

/** An event before stamping. `priority` overrides the kind's default (a budget alert at 100 % is urgent). */
export interface RawEvent { kind: string; title: string; detail?: string; who?: string; chatId?: string; file?: string; update?: boolean; away?: boolean; priority?: Priority; action?: FeedAction }
/** The only actions a card may carry, checked again here: an event from a script never names anything else. */
export function feedAction(v: unknown): FeedAction | undefined {
  const a = v as Partial<FeedAction> | null;
  if (a?.kind === 'agent-proposals') return { kind: 'agent-proposals' };
  if (a?.kind === 'agent-undo') {
    const u = a.undo;
    if (u && typeof u.agentId === 'string' && /^[a-z][a-z0-9_-]{0,79}$/.test(u.agentId) && Number.isFinite(u.expectedRevision) && ['archive', 'restore', 'version'].includes(u.operation) && (u.operation !== 'version' || Number.isSafeInteger(u.version) && u.version! > 0)) return { kind: 'agent-undo', undo: { agentId: u.agentId, expectedRevision: u.expectedRevision, operation: u.operation, ...(u.operation === 'version' ? { version: u.version } : {}) } };
    return undefined;
  }
  return a && typeof a === 'object' && a.kind === 'agent-restore' && typeof a.agentId === 'string' && /^[a-z][a-z0-9_-]{0,79}$/.test(a.agentId) ? { kind: 'agent-restore', agentId: a.agentId } : undefined;
}

export function stamp(e: RawEvent, at = Date.now()): FeedEvent {
  const k = KINDS[e.kind] ?? { label: e.kind, priority: 'quiet' as Priority };
  const out: FeedEvent = { id: crypto.randomUUID(), at, kind: e.kind, label: k.label, priority: e.priority ?? k.priority, title: e.title, detail: e.detail ?? '' };
  if (e.who) out.who = e.who;
  if (e.chatId) out.chatId = e.chatId;
  if (e.file) out.file = e.file;
  if (e.away) out.away = true;
  const action = feedAction(e.action);
  if (action) out.action = action;
  return out;
}

const hash = (s: unknown) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
export const cut = (s: unknown, n = 160): string => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const s = (v: unknown) => String(v ?? '');

type Row = Record<string, unknown>;
/** The brain's parse.mjs: each export takes a file's text (and the date of a journal file) and returns rows. */
export type Parsers = Record<string, unknown>;
export interface Keyed { key: string; sig: string; r: Row }
export interface Prev { key: string; sig: string }
export interface Source { id: string; parser: string; file: string | ((day: string) => string); rows(text: string, day: string): Keyed[]; event(row: Keyed, old: Prev | null): RawEvent }

// Each source: which file, how its text becomes keyed rows, how a new or changed row becomes an event.
// key = identity of a row; sig = its content (same key, new sig = an update, e.g. an idea's state).
export function sources(P: Parsers): Source[] {
  const fn = (name: string) => P[name] as (t: string, d?: string) => Row[];
  const all: Source[] = [
    { id: 'errors', parser: 'aiErrors', file: 'ai-errors.md', rows: t => fn('aiErrors')(t).map(r => ({ key: hash(r.riga), sig: '', r })),
      event: ({ r }) => ({ kind: 'error', title: cut(r.detto || r.riga, 120), detail: cut(r.vero ? `Vero: ${s(r.vero)}` : '', 200), who: s(r.chi) }) },
    { id: 'wins', parser: 'aiWins', file: 'ai-wins.md', rows: t => fn('aiWins')(t).map(r => ({ key: hash(r.riga), sig: '', r })),
      event: ({ r }) => ({ kind: 'win', title: cut(r.parole || r.esito || r.riga, 120), detail: cut(r.consegnato, 200), who: s(r.chat) }) },
    { id: 'ideas', parser: 'ideas', file: 'ideas.md', rows: t => fn('ideas')(t).map(r => ({ key: hash(`${s(r.data)}|${s(r.titolo)}`), sig: s(r.stato), r })),
      event: ({ r }, old) => old
        ? { kind: 'idea', title: `${s(r.titolo)}: ${old.sig} → ${s(r.stato)}`, detail: '', who: r.chi === 'IA' ? "dell'IA" : 'tua', update: true }
        : { kind: 'idea', title: s(r.titolo), detail: cut(r.idea || r.notato, 200), who: r.chi === 'IA' ? "dell'IA" : 'tua' } },
    { id: 'reflections', parser: 'reflections', file: 'ai-reflections.md', rows: t => fn('reflections')(t).map(r => ({ key: hash(`${s(r.data)}|${s(r.chat)}|${s(r.titolo)}`), sig: '', r })),
      event: ({ r }) => ({ kind: 'reflection', title: s(r.titolo), detail: cut(r.penso || r.notato, 200), who: s(r.chat) }) },
    { id: 'proposals', parser: 'proposals', file: 'proposals.md', rows: t => fn('proposals')(t).map(r => ({ key: s(r.id), sig: s(r.stato), r })),
      event: ({ r }, old) => ({ kind: 'proposal', title: old ? `${cut(r.proposta, 90)}: ${old.sig} → ${s(r.stato)}` : cut(r.proposta, 120), detail: '', update: !!old }) },
    { id: 'now', parser: 'now', file: 'now.md', rows: t => fn('now')(t).map(r => ({ key: hash(`${s(r.sezione)}|${s(r.filo)}`), sig: hash(`${s(r.stato)}|${s(r.prossimo)}|${s(r.dove)}`), r })),
      event: ({ r }, old) => ({ kind: 'now', title: s(r.filo), detail: cut([r.stato, r.prossimo].filter(Boolean).join(' · '), 200), update: !!old }) },
    { id: 'journal', parser: 'journal', file: d => `journal/${d}.md`,
      rows: (t, d) => fn('journal')(t, d).filter(r => ['fatto', 'decisione'].includes(s(r.tag))).map(r => ({ key: hash(`${s(r.ora)}|${s(r.testo)}`), sig: '', r })),
      event: ({ r }) => ({ kind: r.tag === 'decisione' ? 'decision' : 'done', title: cut(r.testo, 140), detail: '' }) },
  ];
  // an older or different brain may lack a parser: that source is skipped, the others still work
  return all.filter(x => typeof P[x.parser] === 'function');
}

/** Rows now vs before → events. `before` null = baseline (nothing emitted). */
export function diffRows(src: Source, before: Map<string, Prev> | null, now: Keyed[]): RawEvent[] {
  if (!before) return [];
  const out: RawEvent[] = [];
  for (const row of now) {
    const old = before.get(row.key);
    if (!old) out.push(src.event(row, null));
    else if (old.sig !== row.sig) out.push(src.event(row, old));
  }
  return out;
}

export interface ChatRow { harness: string; title: string; folder: string; when: string; state: string; id: string }

/** chats.mjs list output: `- Harness · title (may hold " · ") · folder · dd/mm, hh:mm · state · id xxxxxxxx`. */
export function parseChatList(text: string): ChatRow[] {
  const out: ChatRow[] = [];
  for (const l of String(text ?? '').split(/\r?\n/)) {
    if (!l.startsWith('- ')) continue;
    const p = l.slice(2).split(' · ');
    if (p.length < 6) continue;
    const id = p.pop()!.replace(/^id\s+/, ''), state = p.pop()!, when = p.pop()!, folder = p.pop()!, harness = p.shift()!;
    out.push({ harness, title: p.join(' · '), folder, when, state, id });
  }
  return out;
}

/** Chat list before vs now → waiting / done transitions. First poll (before null) is a baseline. */
export function diffChats(before: Map<string, ChatRow> | null, now: ChatRow[]): RawEvent[] {
  if (!before) return [];
  const out: RawEvent[] = [];
  for (const c of now) {
    const old = before.get(c.id);
    const was = old?.state ?? '';
    if (/^aspetta te/.test(c.state) && !/^aspetta te/.test(was))
      out.push({ kind: 'chat-waiting', title: c.title, detail: c.state.replace(/^aspetta te\s*/, '').replace(/[()]/g, '') || 'ti aspetta', chatId: c.id, who: c.harness });
    else if (/^finito/.test(c.state) && old && /^in corso/.test(was))
      out.push({ kind: 'chat-done', title: c.title, detail: 'ha finito il turno', chatId: c.id, who: c.harness });
  }
  return out;
}

/** The end of an app chat's turn (or its CLI dying mid-turn: `crash` = the error) → its feed event. An Orchestrator's own turns are no event (it reports in its own tile);
 *  a turn that ended with an error is "chat-failed" (a toast: the user is needed), any other "chat-done" (center only). */
export function doneEvent(c: Pick<ChatSummary, 'id' | 'title' | 'isOrchestrator' | 'lastResult'> | undefined, crash?: string): RawEvent | null {
  if (!c || c.isOrchestrator) return null;
  // the CLI died mid-turn (no result): a failure too, with the engine's error as the detail
  if (crash) return { kind: 'chat-failed', title: c.title || 'Chat', detail: cut(`il motore si è chiuso a metà turno: ${crash}`, 200), chatId: c.id };
  return c.lastResult?.isError
    ? { kind: 'chat-failed', title: c.title || 'Chat', detail: 'il turno è finito con un errore', chatId: c.id }
    : { kind: 'chat-done', title: c.title || 'Chat', detail: 'ha finito il turno', chatId: c.id };
}

const ROME_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
// one formatter for all calls: building one costs ~0.25 ms, and the Cursor ledger asks this for every row every 30 s
export const romeDay = (t = Date.now()): string => ROME_DAY.format(new Date(t));

/** Paths under the brain that never produce events (git internals, dependencies, worktree copies of the brain). */
export const IGNORED = /^(\.git|node_modules|app\/node_modules|\.claude\/worktrees|out|test-results)\//;

/** Loads the brain's parsers; null (and a warning) when the brain has none or they fail to load. */
export async function loadParsers(root: string): Promise<Parsers | null> {
  const f = brainScript(root, 'ops/tools/brain-site/parse.mjs') ?? path.join(root, 'ops', 'tools', 'brain-site', 'parse.mjs');
  if (!fs.existsSync(f)) { log.warn('brain', 'no parsers in this brain: feed of chats, playbooks and mail only', { data: { file: f } }); return null; }
  try { return (await import(/* @vite-ignore */ pathToFileURL(f).href)) as Parsers; }
  catch (e) { log.error('brain', 'brain parsers failed to load', { cause: errText(e), hint: `check ${f} with: node --check "${f}"` }); return null; }
}

export interface LiveOptions {
  root: string;
  stateFile: string;          // where row keys survive restarts (away diff)
  node: NodeRunner;           // how to run chats.mjs
  onEvents: (events: RawEvent[]) => void;
  chatsEveryMs?: number;      // default 15 s
  debounceMs?: number;        // default 400 ms
  /** chats to leave out of the poll (the app's own chats: their events come from the chat manager) */
  skipChat?: (id: string) => boolean;
  /** every changed path (relative, forward slashes), before any parsing: e.g. the Brain pages' refresh (brainmodel) */
  onFile?: (f: string) => void;
}

export class Live {
  private snap = new Map<string, Map<string, Prev>>();
  private chats: Map<string, ChatRow> | null = null;
  private timers = new Map<string, NodeJS.Timeout>();
  private watcher: fs.FSWatcher | null = null;
  private chatTimer: NodeJS.Timeout | null = null;
  private polling = false;
  /** completed chats.mjs polls (diagnostics, tests) */
  chatPolls = 0;
  private stopped = false;
  private src: Source[] = [];
  private chatsScript: string;

  constructor(private o: LiveOptions) { this.chatsScript = brainScript(o.root, 'harness/cursor/chats.mjs') ?? path.join(o.root, 'harness', 'cursor', 'chats.mjs'); }

  async start(): Promise<void> {
    const P = await loadParsers(this.o.root);
    this.src = P ? sources(P) : [];
    let saved: Record<string, Record<string, string>> = {};
    try { saved = JSON.parse(fs.readFileSync(this.o.stateFile, 'utf8')) as typeof saved; } catch { /* first run */ }
    const away: RawEvent[] = [];
    for (const s of this.src) {
      const rows = this.read(s);
      const prev = saved[s.id] ? new Map(Object.entries(saved[s.id]!).map(([key, sig]) => [key, { key, sig }])) : null;
      // parser failed: keep what we knew (the saved keys, or nothing = baseline at the next good read)
      if (!rows) { if (prev) this.snap.set(s.id, prev); continue; }
      away.push(...diffRows(s, prev, rows).filter(e => (KINDS[e.kind]?.priority ?? 'quiet') !== 'quiet'));
      this.snap.set(s.id, new Map(rows.map(r => [r.key, r])));
    }
    this.persist();
    this.hashPlaybooks();
    if (away.length) this.o.onEvents(away.map(e => ({ ...e, away: true })));
    try {
      this.watcher = fs.watch(this.o.root, { recursive: true }, (_ev, f) => { if (f) this.changed(String(f).replace(/\\/g, '/')); });
      this.watcher.on('error', e => log.warn('brain', 'brain watcher stopped', { data: { error: errText(e) } }));
    } catch (e) {
      log.error('brain', 'cannot watch the brain folder', { cause: errText(e), hint: 'check that the brain folder exists and is readable (settings: brainRoot)' });
    }
    if (fs.existsSync(this.chatsScript)) {
      void this.pollChats(true);
      this.chatTimer = setInterval(() => void this.pollChats(false), this.o.chatsEveryMs ?? 15000);
    } else log.warn('brain', 'no chats.mjs in this brain: no chat events', { data: { file: this.chatsScript } });
    log.info('brain', 'live feed started', { data: { root: this.o.root, sources: this.src.map(x => x.id), away: away.length } });
  }

  /** content hash of each playbook: a save that leaves the text as it was (a touch, an editor re-save) is no event */
  private playbooks = new Map<string, string>();

  /** Baseline of the playbooks' hashes (at start): only a later change of content is an event. */
  private hashPlaybooks(): void {
    let names: string[] = [];
    try { names = fs.readdirSync(path.join(this.o.root, 'playbooks')).filter(n => n.endsWith('.md')); } catch { return; }
    for (const n of names) { const h = this.fileHash(`playbooks/${n}`); if (h) this.playbooks.set(`playbooks/${n}`, h); }
  }

  private fileHash(f: string): string | null {
    try { return hash(fs.readFileSync(path.join(this.o.root, f))); } catch { return null; }
  }

  /** A playbook event when its content changed since the last look (deleted or unreadable: nothing). */
  playbookEvent(f: string): RawEvent[] {
    const h = this.fileHash(f);
    if (!h || this.playbooks.get(f) === h) return [];
    this.playbooks.set(f, h);
    return [{ kind: 'playbook', title: f.replace(/^playbooks\/|\.md$/g, ''), detail: '', file: f }];
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.close();
    if (this.chatTimer) clearInterval(this.chatTimer);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private fileOf(s: Source): string { return typeof s.file === 'function' ? s.file(romeDay()) : s.file; }

  /** Rows of a source's file; null when the brain's parser throws (e.g. a file read halfway through a save). */
  private read(s: Source): Keyed[] | null {
    const f = this.fileOf(s);
    let t = '';
    try { t = fs.readFileSync(path.join(this.o.root, f), 'utf8'); } catch { /* missing file = no rows */ }
    try { return s.rows(t, f.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''); }
    catch (e) { log.warn('brain', 'a brain parser failed on its file: snapshot kept', { data: { file: f, error: errText(e) } }); return null; }
  }

  /** New rows of the mailbox log since the last look: "blocked" ones (Claude <-> Cursor switch off, inbox.mjs exit 5)
   *  become a normal "Messaggio bloccato" event; any other activity one quiet "mail" event. */
  private inboxOffset = -1;
  inboxEvents(): RawEvent[] {
    const logFile = path.join(this.o.root, 'ops', 'state', 'inbox', 'inbox.log');
    let text = '';
    try {
      const size = fs.statSync(logFile).size;
      if (this.inboxOffset < 0 || size < this.inboxOffset) this.inboxOffset = size; // first look or rotated: nothing old
      else if (size > this.inboxOffset) {
        const fd = fs.openSync(logFile, 'r');
        const buf = Buffer.alloc(Math.min(size - this.inboxOffset, 1e6));
        fs.readSync(fd, buf, 0, buf.length, this.inboxOffset);
        fs.closeSync(fd);
        this.inboxOffset = size;
        text = buf.toString('utf8');
      }
    } catch { /* no log yet */ }
    const blocked: RawEvent[] = [];
    for (const line of text.split('\n')) {
      let r: { action?: string; from?: string; to?: string; fromHarness?: string; toHarness?: string };
      try { r = JSON.parse(line) as typeof r; } catch { continue; }
      if (r.action === 'blocked') blocked.push({ kind: 'mail-blocked', title: `${r.from ?? '?'} → ${r.to ?? '?'}`, detail: 'Messaggio bloccato tra chat di motori diversi: «Chat tra motori diversi» è spento (Impostazioni → Motori).' });
    }
    return blocked.length ? blocked : [{ kind: 'mail', title: 'nuovi messaggi tra chat', detail: '' }];
  }

  /** A path (relative to the brain, forward slashes) changed on disk. */
  changed(f: string): void {
    if (this.stopped || IGNORED.test(f)) return;
    this.o.onFile?.(f);
    if (/^playbooks\/[^/]+\.md$/.test(f)) return this.debounce(f, () => { const ev = this.playbookEvent(f); if (ev.length) this.o.onEvents(ev); });
    if (/^ops\/state\/inbox\//.test(f)) return this.debounce('inbox', () => this.o.onEvents(this.inboxEvents()), 3000);
    const s = this.src.find(x => this.fileOf(x) === f);
    if (!s) return;
    this.debounce(f, () => {
      const rows = this.read(s);
      if (!rows) return; // keep the previous snapshot; the next save of the file triggers another read
      const events = diffRows(s, this.snap.get(s.id) ?? null, rows);
      this.snap.set(s.id, new Map(rows.map(r => [r.key, r])));
      this.persist();
      if (events.length) this.o.onEvents(events.map(e => ({ ...e, file: f })));
    });
  }

  private debounce(key: string, fn: () => void, ms = this.o.debounceMs ?? 400): void {
    const t = this.timers.get(key);
    if (t) clearTimeout(t);
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); if (!this.stopped) fn(); }, ms));
  }

  private persist(): void {
    const o: Record<string, Record<string, string>> = {};
    for (const [id, m] of this.snap) o[id] = Object.fromEntries([...m].map(([k, r]) => [k, r.sig]));
    try { fs.mkdirSync(path.dirname(this.o.stateFile), { recursive: true }); fs.writeFileSync(this.o.stateFile, JSON.stringify(o)); } catch { /* best effort */ }
  }

  private async pollChats(first: boolean): Promise<void> {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      const r = await runNode(this.o.node, this.chatsScript, ['list', '--days', '2'], this.o.root, 60000);
      if (this.stopped) return;
      if (r.error && !r.stdout) { log.warn('brain', 'chats.mjs list failed', { data: { error: r.error, stderr: r.stderr.slice(0, 300) } }); return; }
      const list = parseChatList(r.stdout).filter(c => !this.o.skipChat?.(c.id));
      const events = diffChats(first ? null : this.chats, list);
      this.chats = new Map(list.map(c => [c.id, c]));
      this.chatPolls++;
      if (events.length) this.o.onEvents(events);
    } finally { this.polling = false; }
  }
}
