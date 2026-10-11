// ChatManager = the ChatService of the app (src/main/services.ts): every chat the user runs inside the cockpit, on one of
// the two engines (ADR 0010): Claude (embedded binary, claude.ts) or Cursor (the installed CLI over ACP, cursor.ts).
// It owns the chat records (summary, items capped at ~2000, open questions/permissions), starts one engine session per
// chat on demand, turns session reports into contract events (chat:updated, chat:item with replace for streaming,
// pending:added/resolved, chat:removed), persists the chats (store.ts) and restores them as 'closed' on start; the
// first message to a closed chat resumes it (Claude --resume after loading its past from the transcript, transcript.ts;
// Cursor session/load). An app Claude chat can be forked (a copy, never two writers on one transcript). Brain hooks
// (options onRateLimit, onTurnEnd, onWaiting, onDone, estimateFor; method isOwnSession) let wiring.ts feed the brain
// without this module knowing it. Wired in src/main/wiring.ts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Answer, ChatItem, ChatSummary, CliStatus, Effort, EstimateResult, Harness, JobKind, NewChat, PendingRequest, PermissionMode } from '../../shared/contract';
import type { Emitter } from '../ipc';
import { errText, log } from '../log';
import type { ChatService } from '../services';
import { ClaudeSession } from './claude';
import { cliVersion, killTrees, resolveClaude } from './cli';
import { CursorSession } from './cursor';
import { cut, isUuid, nextId, type HarnessSession, type SessionOptions, type SessionPatch, type SessionSink } from './session';
import { ChatStore, type StoredChat } from './store';
import { claudeHome, findTranscript, readHistory } from './transcript';

export interface ChatManagerOptions {
  emitter: Pick<Emitter, 'emit'>;
  userData: string;
  /** Claude engine override (a .mjs fake for tests); default: the embedded binary (cli.ts resolveClaude) */
  claudePath?: string;
  /** Cursor engine override (a .mjs fake for tests); default: the installed CLI (cli.ts resolveCursor) */
  cursorPath?: string;
  /** app version, for the engines' clientInfo */
  appVersion?: string;
  /** per-chat MCP endpoint of the app (browser tools); null/undefined = none passed */
  mcpUrlFor?: ((chatId: string) => string | null) | null;
  /** the app-control MCP (/mcp/app) for the Regia only: it reads the app and creates the work chats by itself */
  appMcpUrl?: (() => string | null) | null;
  /** where Claude Code keeps transcripts (default ~/.claude or CLAUDE_CONFIG_DIR) */
  claudeHome?: string;
  maxItems?: number;
  env?: NodeJS.ProcessEnv;
  extraArgs?: string[];
  /** custom session factory (tests, future engines) */
  sessionFactory?: (harness: Harness, opts: SessionOptions, sink: SessionSink) => HarnessSession;

  // ---- hooks for the brain (wiring.ts connects them; a throwing hook is logged, never breaks a chat) ----
  /** every stream-json `rate_limit_event` and every get_usage answer (→ BrainService.ingestRateLimits) */
  onRateLimit?: (msg: unknown) => void;
  /** a turn ended (→ the job ledger: estimate vs actual) */
  onTurnEnd?: (info: TurnEndInfo) => void;
  /** a question or permission opened in an app chat (→ feed "chat waiting") */
  onWaiting?: (chatId: string, pending: PendingRequest) => void;
  /** a turn ended with nothing pending: the chat is idle again (→ feed "chat done") */
  onDone?: (chatId: string) => void;
  /** cost/time estimate at the first send of a job (→ BrainService.estimate); shown as ChatSummary.estimate */
  estimateFor?: (req: { harness: Harness; model: string | null; effort: Effort | null; prompt: string }) => EstimateResult | null;
  /** min ms between two get_usage asks after turns (default 60 s) */
  usageEveryMs?: number;
}

export interface TurnEndInfo {
  chatId: string;
  sessionId: string | null;
  harness: Harness;
  model: string | null;
  effort: Effort | null;
  kind?: JobKind;
  /** only on the first turn of the job (the brain stores its length and kind, never the text) */
  firstPrompt?: string;
  costUsd: number;
  durationMs: number;
  turns: number;
  isError: boolean;
}

interface Rec {
  s: ChatSummary;
  createdAt: number;
  /** permissionMode null = no choice: the CLI follows the user's settings.json (ADR 0002) */
  choice: { model: string | null; effort: Effort | null; permissionMode: PermissionMode | null };
  forkFrom?: string;
  worktree: boolean;
  costTotalUsd: number;
  items: ChatItem[];
  pending: Map<string, PendingRequest>;
  session: HarnessSession | null;
  historyLoaded: boolean;
  /** a job not started yet (a chat created in this run): its first send gets the estimate and the first prompt */
  jobNew: boolean;
  firstPrompt: string | null;
  kind?: JobKind;
  /** a turn ran since the last onDone */
  turnSinceDone: boolean;
  /** a resumed session still opening (sends wait for it) */
  opening?: Promise<void> | undefined;
  /** Cursor: close the session when this turn ends, so the next message reopens it with the new --model */
  reopen?: boolean;
}

const MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'];
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export class ChatManager implements ChatService {
  private chats = new Map<string, Rec>();
  private store: ChatStore;
  private home: string;
  private max: number;
  private version: string | null = null;
  private probing = false;
  private killedPids = new Set<number>();
  private coalesce = new Map<string, { items: Map<string, ChatItem>; timer: NodeJS.Timeout }>();
  private lastUsageAt = 0;
  private readonly onExit = (): void => { this.killAll(); };

  constructor(private readonly opts: ChatManagerOptions) {
    this.store = new ChatStore(opts.userData);
    this.home = opts.claudeHome ?? claudeHome();
    this.max = opts.maxItems ?? 2000;
    for (const c of this.store.load()) this.chats.set(c.id, this.restore(c));
    process.on('exit', this.onExit); // Windows keeps orphaned children alive: kill them when the app dies
    const claude = resolveClaude(opts.claudePath ?? null);
    log.info('chats', 'manager ready', { data: { restored: this.chats.size, claude: claude ? `${claude.source}: ${claude.path}` : 'not found', cursorOverride: opts.cursorPath ?? null } });
  }

  // ---- ChatService ----

  list(): ChatSummary[] {
    return [...this.chats.values()].sort((a, b) => a.createdAt - b.createdAt).map(r => ({ ...r.s }));
  }

  items(chatId: string): ChatItem[] {
    const r = this.chats.get(chatId);
    if (!r) return [];
    this.ensureHistory(r);
    return r.items.slice();
  }

  pending(): PendingRequest[] {
    return [...this.chats.values()].flatMap(r => [...r.pending.values()]).sort((a, b) => a.at - b.at);
  }

  async create(req: NewChat): Promise<ChatSummary> {
    if (req.harness !== 'claude' && req.harness !== 'cursor') throw new Error('Harness sconosciuto.');
    const cwd = typeof req.cwd === 'string' ? req.cwd.trim() : '';
    if (!cwd || !path.isAbsolute(cwd) || !fs.existsSync(cwd)) throw new Error(`Cartella non valida: ${cwd || '(vuota)'}`);
    const cursor = req.harness === 'cursor';
    if (req.permissionMode && !MODES.includes(req.permissionMode)) throw new Error(`Modalità permessi non valida: ${req.permissionMode}`);
    if (req.effort && !EFFORTS.includes(req.effort)) throw new Error(`Effort non valido: ${req.effort}`);
    if (cursor && req.effort) throw new Error('L’effort non si imposta con Cursor: scegli il modello.');
    if (req.model !== undefined && !/^[\w.:@/=[\],-]{1,120}$/.test(req.model)) throw new Error(`Modello non valido: ${req.model}`);
    // only a copy of one of the app's own Claude chats (ADR 0010: no sessions from other apps; never two writers)
    const forkOf = req.resumeSessionId?.trim() || null;
    if (forkOf) {
      const src = [...this.chats.values()].find(r => r.s.sessionId === forkOf);
      if (!req.fork || cursor || !isUuid(forkOf) || !src || src.s.harness !== 'claude') throw new Error('Si può solo duplicare (fork) una chat Claude dell’app.');
    }

    const id = `c_${crypto.randomBytes(5).toString('hex')}`;
    const now = Date.now();
    const title = req.title?.trim() || (req.prompt?.trim() ? cut(req.prompt, 50) : forkOf ? 'Fork' : 'Nuova chat');
    const r: Rec = {
      s: {
        id, harness: req.harness, origin: 'app', title, cwd, sessionId: forkOf || cursor ? null : crypto.randomUUID(),
        model: req.model ?? null, effort: req.effort ?? null, permissionMode: req.permissionMode ?? null,
        state: 'starting', costUsd: 0, pending: 0, isRegia: !!req.regia, lastText: '', updatedAt: now, browserTabIds: [],
        ...(cursor ? { costKnown: false as const } : {}),
      },
      createdAt: now,
      choice: { model: req.model ?? null, effort: req.effort ?? null, permissionMode: req.permissionMode ?? null },
      ...(forkOf ? { forkFrom: forkOf } : {}),
      worktree: !!req.worktree && !cursor,
      costTotalUsd: 0,
      items: [], pending: new Map(), session: null, historyLoaded: false,
      jobNew: true, firstPrompt: null, turnSinceDone: false,
    };
    this.chats.set(id, r);
    this.ensureHistory(r); // a fork shows the past it starts from
    this.persist();
    log.info('chats', 'chat created', { chat: id, data: { harness: req.harness, cwd, fork: !!forkOf, model: r.choice.model, permissionMode: r.choice.permissionMode, regia: r.s.isRegia } });
    this.updated(r);
    this.startSession(r);
    // the chat exists from here on: a failed first send shows as state 'error' + lastError, not as a lost chat
    if (req.prompt?.trim()) {
      try { await this.send(id, req.prompt); } catch (e) {
        if (!r.s.lastError) r.s.lastError = errText(e);
        this.updated(r);
      }
    }
    return { ...r.s };
  }

  async send(chatId: string, text: string): Promise<void> {
    const r = this.need(chatId);
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t) throw new Error('Messaggio vuoto.');
    this.ensureHistory(r);
    if (!r.session) {
      this.startSession(r);
      // a resumed Cursor chat replays its past while it opens: let it land before this message, in order
      const started = r.session as HarnessSession | null;
      if (started?.ready && r.s.harness === 'cursor' && isUuid(r.s.sessionId)) r.opening = started.ready;
    }
    if (r.opening) { await r.opening; r.opening = undefined; }
    if (!r.session) throw new Error(r.s.lastError ?? 'Avvio della chat non riuscito.');
    this.addItem(r, { kind: 'user', id: nextId('u'), at: Date.now(), text: t }, false);
    if (r.jobNew) this.startJob(r, t);
    try { r.session.send(t); } catch (e) {
      throw new Error(`Messaggio non inviato: ${errText(e)}`);
    }
    if (r.s.lastError) { delete r.s.lastError; this.updated(r); }
  }

  async answer(chatId: string, requestId: string, answer: Answer): Promise<void> {
    const r = this.need(chatId);
    if (!r.pending.has(requestId)) throw new Error('Questa richiesta non è più aperta.');
    if (!r.session) { this.dropPending(r, requestId); throw new Error('La chat non è più attiva: la richiesta è scaduta.'); }
    const ok = r.session.answer(requestId, answer);
    if (!ok) this.dropPending(r, requestId);
  }

  /** Interrupts whenever a process exists, whatever the shown state says (an interrupt on an idle CLI is harmless). */
  async stop(chatId: string): Promise<void> {
    const r = this.need(chatId);
    if (!r.session) return;
    try { await r.session.interrupt(); } catch (e) {
      log.warn('chats', 'interrupt failed', { chat: chatId, data: errText(e) });
      throw new Error(`Stop non riuscito: ${errText(e)}`);
    }
  }

  /** Interrupts every live session; returns how many were working. */
  async stopAll(): Promise<number> {
    const live = [...this.chats.values()].filter(r => r.session);
    const busy = live.filter(r => r.session?.busy).length;
    await Promise.allSettled(live.map(r => r.session?.interrupt()));
    log.info('chats', 'stop all', { data: { live: live.length, busy } });
    return busy;
  }

  /** Removes the chat from the app (its process ends; the transcript stays where the CLI keeps it). */
  async close(chatId: string): Promise<void> {
    const r = this.need(chatId);
    const sess = r.session;
    if (sess) await sess.close();
    for (const id of [...r.pending.keys()]) this.dropPending(r, id);
    this.flushItems(chatId);
    this.chats.delete(chatId);
    this.persist();
    log.info('chats', 'chat closed', { chat: chatId });
    this.opts.emitter.emit('chat:removed', { chatId });
  }

  async set(chatId: string, patch: { model?: string; effort?: Effort; permissionMode?: PermissionMode; title?: string }): Promise<ChatSummary> {
    const r = this.need(chatId);
    const sess = r.session;
    const later: string[] = [];
    const apply = async (what: string, fn: (() => Promise<void>) | undefined): Promise<void> => {
      if (!sess || !fn) return;
      try { await fn(); } catch (e) { later.push(what); log.warn('chats', 'setting not applied live', { chat: chatId, data: { what, error: errText(e) } }); }
    };
    if (patch.title !== undefined) {
      const t = patch.title.trim();
      if (!t) throw new Error('Titolo vuoto.');
      r.s.title = t;
      await apply('titolo', sess ? () => sess.rename(t) : undefined);
    }
    if (patch.model !== undefined) {
      const m = patch.model.trim() || null;
      if (m && !/^[\w.:@/=[\],-]{1,120}$/.test(m)) throw new Error(`Modello non valido: ${m}`);
      r.choice.model = m; r.s.model = m;
      if (r.s.harness === 'cursor') {
        // never live (session/set_model writes the user's Cursor config): reopen the session with --model, same history
        if (sess && !sess.busy) await sess.close();
        else if (sess) r.reopen = true; // after this turn
        if (sess) this.addItem(r, { kind: 'system', id: nextId('s'), at: Date.now(), text: `Modello ${m ?? 'predefinito'}: Cursor riparte con questo modello dal prossimo messaggio${r.reopen ? ', finito questo turno' : ''}.`, level: 'info' }, false);
      } else await apply('modello', sess ? () => sess.setModel(m) : undefined);
    }
    if (patch.effort !== undefined) {
      if (!EFFORTS.includes(patch.effort)) throw new Error(`Effort non valido: ${patch.effort}`);
      if (r.s.harness === 'cursor') throw new Error('L’effort non si imposta con Cursor: scegli il modello.');
      const e = patch.effort;
      r.choice.effort = e; r.s.effort = e;
      await apply('effort', sess ? () => sess.setEffort(e) : undefined);
    }
    if (patch.permissionMode !== undefined) {
      if (!MODES.includes(patch.permissionMode)) throw new Error(`Modalità permessi non valida: ${patch.permissionMode}`);
      const pm = patch.permissionMode;
      r.choice.permissionMode = pm; r.s.permissionMode = pm;
      await apply('permessi', sess ? () => sess.setPermissionMode(pm) : undefined);
    }
    if (later.length) this.addItem(r, { kind: 'system', id: nextId('s'), at: Date.now(), text: `Applicato dal prossimo avvio: ${later.join(', ')}.`, level: 'warn' }, false);
    this.persist();
    log.info('chats', 'chat settings', { chat: chatId, data: { ...patch, title: patch.title ? '(changed)' : undefined } });
    this.updated(r);
    return { ...r.s };
  }

  /** App quit. A busy CLI gets its tree killed at once (its turn is lost at quit anyway); an idle one gets stdin closed
   *  (it ends by itself) and is killed after graceMs. We wait for the kills to land, because taskkill /T needs
   *  claude.exe alive to find its children and takes 1-3.5 s to start on Windows; then a synchronous kill for anything
   *  left. Resolves within graceMs + 4.5 s (+ one taskkill if something survived). */
  async shutdown(graceMs = 800): Promise<void> {
    this.persist();
    const live = [...this.chats.values()].map(r => r.session).filter((x): x is HarnessSession => !!x && x.alive);
    for (const x of live) if (x.busy) x.killNow();
    const closes = Promise.allSettled(live.map(x => x.close(graceMs)));
    await Promise.race([closes, new Promise(r => setTimeout(r, graceMs + 4500).unref())]);
    this.killAll();
    process.off('exit', this.onExit);
    log.info('chats', 'manager stopped', { data: { sessions: live.length, left: live.filter(x => x.alive).length } });
  }

  /** Synchronous last resort (before app.exit, will-quit, process exit): one blocking taskkill /T for every CLI
   *  process still alive, so none of their children outlives the app. No-op when nothing is alive. */
  killAll(): void {
    // a pid killed synchronously stays "alive" until the loop runs 'close' again: never taskkill it twice (1-3.5 s each)
    const left = [...this.chats.values()].map(r => r.session).filter((x): x is HarnessSession => !!x && x.alive && !!x.pid && !this.killedPids.has(x.pid));
    if (!left.length) return;
    log.warn('chats', 'killing CLI processes still alive at quit', { data: { pids: left.map(x => x.pid) } });
    for (const x of left) if (x.pid) this.killedPids.add(x.pid);
    killTrees(left.map(x => x.pid), { sync: true, fallback: () => { for (const x of left) x.killNow(); } });
  }

  /** Claude engine status: found, path, version (from a session or the background `claude --version`). */
  cliStatus(): CliStatus {
    const p = resolveClaude(this.opts.claudePath ?? null)?.path ?? null;
    const found = !!p && fs.existsSync(p);
    if (found && !this.version && !this.probing) {
      this.probing = true;
      void cliVersion(p).then(v => { if (v && !this.version) { this.version = v; log.info('chats', 'claude CLI', { data: { path: p, version: v } }); } });
    }
    return { found, path: p, version: this.version, loggedIn: null };
  }

  /** The app runs this session (full id or an id prefix of 8+ chars, as chats.mjs prints): the brain's poll skips it. */
  isOwnSession(idOrPrefix: string): boolean {
    const p = String(idOrPrefix ?? '').trim().toLowerCase();
    if (p.length < 8) return false;
    return [...this.chats.values()].some(r => !!r.s.sessionId && r.s.sessionId.toLowerCase().startsWith(p));
  }

  // ---- internals ----

  /** Calls a brain hook; a hook that throws is logged and never breaks the chat. */
  private hook(name: string, fn: () => void): void {
    try { fn(); } catch (e) {
      log.error('chats', `hook ${name} failed`, { cause: errText(e), hint: 'fix the listener wired in src/main/wiring.ts; the chat itself is unaffected' });
    }
  }

  /** First send of a job: the estimate (shown next to the actual cost) and the first prompt for the ledger. */
  private startJob(r: Rec, prompt: string): void {
    r.jobNew = false;
    r.firstPrompt = prompt;
    const fn = this.opts.estimateFor;
    if (!fn) return;
    this.hook('estimateFor', () => {
      const e = fn({ harness: r.s.harness, model: r.choice.model, effort: r.choice.effort, prompt });
      if (!e) return;
      r.kind = e.kind;
      r.s.estimate = e.estimate ? { ...e.estimate, basis: e.basis.count } : null;
      this.updated(r);
    });
  }

  /** A result arrived: the job ledger gets the turn; the plan windows are refreshed now and then. */
  private turnEnded(r: Rec, item: Extract<ChatItem, { kind: 'result' }>): void {
    r.turnSinceDone = true;
    const first = r.firstPrompt;
    r.firstPrompt = null;
    const on = this.opts.onTurnEnd;
    if (on) {
      const info: TurnEndInfo = {
        chatId: r.s.id, sessionId: r.s.sessionId, harness: r.s.harness, model: r.s.model, effort: r.s.effort,
        ...(r.kind ? { kind: r.kind } : {}), ...(first ? { firstPrompt: first } : {}),
        costUsd: item.costUsd, durationMs: item.durationMs, turns: item.turns, isError: item.isError,
      };
      this.hook('onTurnEnd', () => on(info));
    }
    const rate = this.opts.onRateLimit, sess = r.session;
    if (rate && sess && Date.now() - this.lastUsageAt >= (this.opts.usageEveryMs ?? 60000)) {
      this.lastUsageAt = Date.now();
      sess.usage().then(u => { if (u) this.hook('onRateLimit', () => rate(u)); })
        .catch(e => log.debug('chats', 'get_usage not answered', { chat: r.s.id, data: errText(e) }));
    }
  }

  private need(chatId: string): Rec {
    const r = this.chats.get(chatId);
    if (!r) throw new Error('Chat non trovata.');
    return r;
  }

  private restore(c: StoredChat): Rec {
    return {
      s: {
        id: c.id, harness: c.harness, origin: 'app', title: c.title, cwd: c.cwd, sessionId: c.sessionId, model: c.model, effort: c.effort,
        permissionMode: c.permissionMode, state: 'closed', costUsd: 0, pending: 0, isRegia: c.isRegia, lastText: '', updatedAt: c.createdAt, browserTabIds: [],
        ...(c.harness === 'cursor' ? { costKnown: false as const } : {}),
      },
      createdAt: c.createdAt,
      choice: { model: c.model, effort: c.effort, permissionMode: c.permissionMode },
      ...(c.forkFrom ? { forkFrom: c.forkFrom } : {}),
      worktree: false,
      costTotalUsd: c.costTotalUsd ?? 0,
      items: [], pending: new Map(), session: null, historyLoaded: false,
      jobNew: false, firstPrompt: null, turnSinceDone: false, // a restored chat continues a job begun in an earlier run
    };
  }

  private persist(): void {
    this.store.save([...this.chats.values()].map(r => ({
      id: r.s.id, harness: r.s.harness, cwd: r.s.cwd, sessionId: r.s.sessionId, ...(r.forkFrom ? { forkFrom: r.forkFrom } : {}),
      title: r.s.title, model: r.choice.model, effort: r.choice.effort, permissionMode: r.choice.permissionMode, isRegia: r.s.isRegia,
      createdAt: r.createdAt, costTotalUsd: r.costTotalUsd,
    })));
  }

  private updated(r: Rec): void {
    r.s.updatedAt = Date.now();
    this.opts.emitter.emit('chat:updated', { ...r.s });
  }

  private addItem(r: Rec, item: ChatItem, replace: boolean): void {
    let rep = false;
    if (replace) {
      for (let i = r.items.length - 1; i >= 0; i--) if (r.items[i]?.id === item.id) { r.items[i] = item; rep = true; break; }
    }
    if (!rep) {
      r.items.push(item);
      if (r.items.length > this.max) r.items.splice(0, r.items.length - this.max);
    }
    this.emitItem(r.s.id, item, rep);
  }

  /** Streaming without flooding IPC: newer versions of the same item within ~33 ms collapse into one event (at most
   *  ~30 flushes a second per chat). A new item first flushes what is pending, so the order on screen is kept. */
  private emitItem(chatId: string, item: ChatItem, replace: boolean): void {
    if (replace) {
      let b = this.coalesce.get(chatId);
      if (!b) {
        const timer = setTimeout(() => this.flushItems(chatId), 33);
        timer.unref();
        b = { items: new Map(), timer };
        this.coalesce.set(chatId, b);
      }
      b.items.set(item.id, item);
      return;
    }
    this.flushItems(chatId);
    this.opts.emitter.emit('chat:item', { chatId, item, replace: false });
  }

  private flushItems(chatId: string): void {
    const b = this.coalesce.get(chatId);
    if (!b) return;
    clearTimeout(b.timer);
    this.coalesce.delete(chatId);
    for (const item of b.items.values()) this.opts.emitter.emit('chat:item', { chatId, item, replace: true });
  }

  private dropPending(r: Rec, requestId: string): void {
    if (!r.pending.delete(requestId)) return;
    r.s.pending = r.pending.size;
    this.opts.emitter.emit('pending:resolved', { chatId: r.s.id, requestId });
    this.updated(r);
  }

  /** Loads the transcript's past once (resumed or forked chats), before any new item. */
  private ensureHistory(r: Rec): void {
    if (r.historyLoaded) return;
    r.historyLoaded = true;
    if (r.s.harness !== 'claude') return;
    const sid = r.s.sessionId ?? r.forkFrom;
    if (!sid) return;
    const file = findTranscript(sid, r.s.cwd, this.home);
    if (!file) return;
    try {
      const h = readHistory(file, { cwd: r.s.cwd, maxItems: this.max });
      r.items = [...h.items, ...r.items].slice(-this.max);
      if (!r.s.lastText && h.lastText) r.s.lastText = h.lastText;
      // the CLI restores a session's spend on resume (2.1.277+): its total is the baseline for per-turn costs
      if (h.costTotalUsd !== null && !r.costTotalUsd) r.costTotalUsd = h.costTotalUsd;
      if (h.title && (r.s.title === 'Nuova chat' || r.s.title === 'Fork')) r.s.title = r.forkFrom ? `${h.title} (fork)` : h.title;
      log.info('chats', 'history loaded', { chat: r.s.id, data: { items: h.items.length, file: path.basename(file) } });
    } catch (e) {
      log.warn('chats', 'history not readable', { chat: r.s.id, data: { file, error: errText(e) } });
    }
  }

  private mcpConfig(chatId: string): string | null {
    const url = this.opts.mcpUrlFor?.(chatId) ?? null;
    const app = this.chats.get(chatId)?.s.isRegia ? this.opts.appMcpUrl?.() ?? null : null;
    const servers: Record<string, { type: 'http'; url: string }> = {};
    if (url) servers['second-brain'] = { type: 'http', url };
    if (app) servers['second-brain-app'] = { type: 'http', url: app };
    return Object.keys(servers).length ? JSON.stringify({ mcpServers: servers }) : null;
  }

  private startSession(r: Rec): void {
    const chatId = r.s.id;
    let sessionId = r.s.sessionId;
    let resume = false, fork = false;
    if (r.s.harness === 'cursor') resume = isUuid(sessionId); // session/load; a new one gets its id from session/new
    else if (!sessionId && r.forkFrom) { sessionId = r.forkFrom; resume = true; fork = true; }
    else if (isUuid(sessionId) && findTranscript(sessionId, r.s.cwd, this.home)) resume = true;
    else if (!isUuid(sessionId)) { sessionId = crypto.randomUUID(); r.s.sessionId = sessionId; this.persist(); }
    const opts: SessionOptions = {
      chatId, cwd: r.s.cwd, model: r.choice.model, effort: r.choice.effort, permissionMode: r.choice.permissionMode, title: r.s.title,
      sessionId, resume, fork, worktree: r.worktree && !resume, mcpConfig: this.mcpConfig(chatId), costBaseUsd: r.costTotalUsd,
      ...(this.opts.env ? { env: this.opts.env } : {}), ...(this.opts.extraArgs || r.s.isRegia ? { extraArgs: [...(this.opts.extraArgs ?? []), ...(r.s.isRegia && r.s.harness === 'claude' && this.opts.appMcpUrl?.() ? ['--allowedTools', 'mcp__second-brain-app'] : [])] } : {}),
    };
    r.worktree = false; // created once; a resume re-enters it
    let sess: HarnessSession | null = null;
    const live = (): boolean => !!sess && r.session === sess && this.chats.get(chatId) === r;
    const sink: SessionSink = {
      item: (item, replace) => {
        if (!live()) return;
        this.addItem(r, item, replace);
        if (item.kind === 'result' && !replace) this.turnEnded(r, item);
      },
      pending: req => {
        if (!live()) return;
        const full: PendingRequest = { ...req, chatId };
        r.pending.set(req.id, full);
        r.s.pending = r.pending.size;
        this.opts.emitter.emit('pending:added', full);
        this.updated(r);
        const on = this.opts.onWaiting;
        if (on) this.hook('onWaiting', () => on(chatId, full));
      },
      rateLimit: msg => { const on = this.opts.onRateLimit; if (live() && on) this.hook('onRateLimit', () => on(msg)); },
      resolved: id => { if (this.chats.get(chatId) === r) this.dropPending(r, id); },
      changed: p => { if (live()) this.applyPatch(r, p); },
      exit: ({ error }) => {
        if (this.chats.get(chatId) !== r || r.session !== sess) return;
        r.session = null;
        if (error) r.s.lastError = error;
        if (r.s.state !== 'error') r.s.state = error ? 'error' : 'closed';
        this.persist();
        this.updated(r);
      },
    };
    r.s.state = 'starting';
    delete r.s.lastError;
    sess = this.opts.sessionFactory
      ? this.opts.sessionFactory(r.s.harness, opts, sink)
      : r.s.harness === 'cursor'
        ? new CursorSession({
          ...opts, mcpConfig: null, mcpUrl: this.opts.mcpUrlFor?.(chatId) ?? null, showReplay: r.items.length === 0,
          configDir: path.join(this.opts.userData, 'cursor-config'),
          ...(this.opts.cursorPath ? { cursorPath: this.opts.cursorPath } : {}), ...(this.opts.appVersion ? { appVersion: this.opts.appVersion } : {}),
        }, sink)
        : new ClaudeSession({ ...opts, ...(this.opts.claudePath ? { claudePath: this.opts.claudePath } : {}) }, sink);
    r.session = sess;
    this.updated(r);
    sess.start();
  }

  private applyPatch(r: Rec, p: SessionPatch): void {
    let save = false;
    if (p.state) {
      const was = r.s.state;
      r.s.state = p.state;
      // the turn is over and nothing waits for the user: "done" (once per turn, never at boot)
      if (p.state === 'idle' && was !== 'idle' && r.turnSinceDone && r.pending.size === 0) {
        r.turnSinceDone = false;
        const on = this.opts.onDone;
        if (on) this.hook('onDone', () => on(r.s.id));
      }
      // a Cursor model change asked mid-turn: reopen with the new --model now that the turn is over
      if (p.state === 'idle' && r.reopen && r.session && !r.session.busy) {
        r.reopen = false;
        void r.session.close();
      }
    }
    if (p.sessionId && p.sessionId !== r.s.sessionId) { r.s.sessionId = p.sessionId; delete r.forkFrom; save = true; }
    if (p.model) r.s.model = p.model;
    // shown, never persisted: only the user's own choice (create / chat:set) is saved and used on the next start,
    // so a mode the CLI took from a suggestion or ExitPlanMode does not outlive this process
    if (p.permissionMode) r.s.permissionMode = p.permissionMode;
    if (p.effort !== undefined) r.s.effort = p.effort;
    if (p.contextTokens !== undefined) r.s.contextTokens = p.contextTokens;
    if (p.contextMaxTokens !== undefined) r.s.contextMaxTokens = p.contextMaxTokens;
    if (p.turnCostUsd !== undefined) r.s.costUsd = Math.round((r.s.costUsd + p.turnCostUsd) * 1e6) / 1e6;
    if (p.costKnown === true) delete r.s.costKnown;
    else if (p.costKnown === false && !r.s.costUsd) r.s.costKnown = false;
    if (p.totalCostUsd !== undefined) { r.costTotalUsd = p.totalCostUsd; save = true; }
    if (p.lastText !== undefined) r.s.lastText = p.lastText;
    if (p.version) this.version = p.version;
    if (save) this.persist();
    this.updated(r);
  }
}
