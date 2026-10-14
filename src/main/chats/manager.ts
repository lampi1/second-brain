// ChatManager = the ChatService of the app (src/main/services.ts): every chat the user runs inside the cockpit, on one of
// the engines of the registry (engines/registry.ts, ADR 0046; today Claude, embedded binary, and Cursor over ACP): it
// asks an engine's caps, never its name, and gets the session from engines/sessions.ts.
// It owns the chat records (summary, items capped at ~2000, open questions/permissions), starts one engine session per
// chat on demand, turns session reports into contract events (chat:updated, chat:item with replace for streaming,
// pending:added/resolved, chat:removed), persists the chats (store.ts) and restores them as 'closed' on start; the
// first message to a closed chat resumes it (Claude --resume after loading its past from the transcript, transcript.ts;
// Cursor session/load). A finished chat can be archived (closedAt: its process ends, the record and transcript stay,
// the palette lists it under "Chiuse", Ctrl+K) and reopened; a message to an archived chat reopens it. A turn cut by a quit or
// crash (persisted "working") resumes by itself on the next start (resumeInterrupted). An app Claude chat can be forked (a copy, never two writers on one transcript). There may be
// several Regie (ADR 0021), each with its tab name; a work chat answers to one (regiaOf); a Regia created with
// `replaces` takes that one's role and work chats (the old one goes on as a normal chat). Long chats:
// each chat carries its context size (Claude: get_context_usage; Cursor: an estimate); every Claude engine gets the
// compaction window (option compactWindowTokens, ADR 0031); continueChat ("Riprendi") opens a NEW chat from a hand-off
// note, linked to the old one (handoff.ts); a cold chat (idle, long, Claude) writes its note quietly while the cache is
// warm and a message after the cache expired goes on in a fresh session of the same chat (coldTick / coldSwitch, ADR
// 0031), counted with the other context numbers (context-stats.ts, contextStats()). Brain hooks
// (options onRateLimit, onTurnEnd, onWaiting, onDone, estimateFor; method isOwnSession) let wiring.ts feed the brain
// without this module knowing it. Wired in src/main/wiring.ts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Answer, ChatCommand, ChatItem, ChatSpace, ChatSummary, CliStatus, ContextStats, CursorReasoning, Effort, EstimateResult, HandoffInfo, Harness, JobKind, NewChat, PendingRequest, PermissionMode } from '../../shared/contract';
import { checkImages } from './images';
import type { Emitter } from '../ipc';
import { errText, log } from '../log';
import type { ChatService } from '../services';
import { cliVersion, killTrees, killTreesWithin, resolveClaude } from './cli';
import { reapAfterQuit, reapEnabled, reapEngine, snapshotTrees } from './proctree';
import { jobGuard } from './jobguard';
import { REGIA_COMPACT, regiaDayDue, romeDay } from './regia-day';
import { AFTER_CALLS, autoHandoff, CACHE_TTL_MS, coldArmed, coldAsk, coldPrompt, coldRoute, type ColdView, continuePrompt, extractHandoff, HANDOFF_END, HANDOFF_START, handoffRequest, HandoffStore, nextTitle } from './handoff';
import { ContextCounters } from './context-stats';

/** The app's own message to a chat whose turn a restart cut (resumeInterrupted). */
export const RESUME_TEXT = "[second-brain] L'app è stata riavviata mentre lavoravi e il tuo turno si è interrotto. Riprendi da dove eri: prima rileggi lo stato (file, worktree, comandi che avevi lanciato), poi continua.";
import { cut, isUuid, nextId, type HarnessSession, type SessionOptions, type SessionPatch, type SessionSink } from './session';
import { ChatStore, type PastSession, type StoredChat } from './store';
import { BufferedSink, WarmPool, type WarmEngine } from './warm';
import { AdmissionQueue, MAIL_WAITS, type AdmissionLimits, type LoadSampler } from './admission';
import { AgentMayNotWake } from '../engines/policy';
import { isAppChat } from '../brain/routing';
import { engineOf, engineOrThrow } from '../engines/registry';
import { sessionFor } from '../engines/sessions';
import { cleanRegiaName, regieOf } from '../../shared/regia';
import { claudeHome, findTranscript, readHistory } from './transcript';

export interface ChatManagerOptions {
  emitter: Pick<Emitter, 'emit'>;
  userData: string;
  /** per engine, its command override (a .mjs fake for tests); absent = the installed one (cli.ts) */
  enginePaths?: Partial<Record<Harness, string>>;
  /** may a chat start on this engine now (the user's engineOn.* switches); absent = every engine may */
  engineOn?: (h: Harness) => boolean;
  /** may an agent's message wake a stopped chat on this engine («Le Regie possono usare X», engines/policy.ts) */
  agentsMayOpen?: (h: Harness) => boolean;
  /** the user's API key for this engine (engines/service.ts keyFor), read only when its process or request starts */
  keyFor?: (h: Harness) => string | null;
  /** app version, for the engines' clientInfo */
  appVersion?: string;
  /** per-chat MCP endpoint of the app (browser tools); null/undefined = none passed */
  mcpUrlFor?: ((chatId: string) => string | null) | null;
  /** the app-control MCP for the Regie only: each work Regia its own /mcp/app/r/<id>/<token> (ADR 0021), the app's
   *  Regia ("Migliora l'app", space 'app') /mcp/improve; it reads the app and creates the chats of its space by itself */
  appMcpUrl?: ((regiaId: string, space?: ChatSpace) => string | null) | null;
  /** where Claude Code keeps transcripts (default ~/.claude or CLAUDE_CONFIG_DIR) */
  claudeHome?: string;
  maxItems?: number;
  env?: NodeJS.ProcessEnv;
  extraArgs?: string[];
  /** keep one Claude engine started ahead for the next new chat in the same folder (warm.ts); default off */
  prewarm?: boolean;
  /** ms after a new Claude chat (or the app's start) before the next waiting engine starts (default 5 s / 20 s) */
  prewarmDelayMs?: number;
  /** the CPU-aware queue (ADR 0036): agents' starts and turns wait while the machine is busy; absent = never wait */
  admission?: { sampler: LoadSampler; limits: () => AdmissionLimits; tickMs?: number; autoTick?: boolean };
  /** custom session factory (tests, future engines) */
  sessionFactory?: (harness: Harness, opts: SessionOptions, sink: SessionSink) => HarnessSession;

  // ---- hooks for the brain (wiring.ts connects them; a throwing hook is logged, never breaks a chat) ----
  /** every stream-json `rate_limit_event` and every get_usage answer (→ BrainService.ingestRateLimits) */
  onRateLimit?: (msg: unknown) => void;
  /** the models a CLI session offers (→ BrainService.recordModels, for the Settings page) */
  onModels?: (harness: Harness, list: { id: string; name: string }[]) => void;
  /** a turn ended (→ the job ledger: estimate vs actual) */
  onTurnEnd?: (info: TurnEndInfo) => void;
  /** a question or permission opened in an app chat (→ feed "chat waiting") */
  onWaiting?: (chatId: string, pending: PendingRequest) => void;
  /** a turn ended with nothing pending: the chat is idle again (→ feed "chat done") */
  onDone?: (chatId: string) => void;
  /** the CLI died in the middle of a turn, with an error and no result (→ feed "chat finita con errore") */
  onCrash?: (chatId: string, error: string) => void;
  /** cost/time estimate at the first send of a job (→ BrainService.estimate); shown as ChatSummary.estimate */
  estimateFor?: (req: { harness: Harness; model: string | null; effort: Effort | null; prompt: string; title?: string }) => EstimateResult | null;
  /** the user's reasoning and fast for every ACP chat, read at each session start (settings regiaChats.*) */
  acpModelConfig?: () => { reasoning: CursorReasoning | ''; fast: boolean } | null;
  /** min ms between two get_usage asks after turns (default 60 s) */
  usageEveryMs?: number;

  // ---- long chats (settings compactWindowTokens / contextHandoff / coldHandoffMin; the brain's mem.mjs) ----
  /** the auto-compact window of every Claude engine, read at each start (0 = the user's Claude settings decide) */
  compactWindowTokens?: () => number;
  /** the invisible continuation of cold chats (ADR 0031; default off here, wiring reads the setting) */
  coldHandoff?: () => boolean;
  /** «Regie corte» (ADR 0051): a Regia with a context from an earlier day compacts it once on a new day (default off
   *  here, wiring reads the setting regiaDayCompact) */
  regiaDayCompact?: () => boolean;
  /** ms after the last call before an idle long chat writes its cold note (default 50 min) */
  coldIdleMs?: () => number;
  /** how long the prompt cache lives after its last use (default 55 min; tests shorten it) */
  cacheTtlMs?: number;
  /** ms between two checks of the cold chats (default 60 s; 0 = no timer, tests call coldTick) */
  coldEveryMs?: number;
  /** absolute path of the brain's mem.mjs, when it has one: the hand-off request asks to update the now.md line too */
  memTool?: () => string | null;
  /** how long a chat may take to write its hand-off before the app builds one itself (default 5 min) */
  handoffTimeoutMs?: number;
}

export interface HandoffOptions {
  reason?: 'manual' | 'threshold' | 'finished' | 'continue' | 'cold';
  /** false = never start a stopped engine for it (an agent asking about a Cursor chat): a token-free note instead */
  allowStart?: boolean;
  /** false = never ask the chat, even a running one: always the token-free note (the automatic closing of finished
   *  chats, owner 2026-10-11: no turn and no tokens at close) */
  ask?: boolean;
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
  /** only on the first turn: when the job started and the title its estimate was made on (before it ran) */
  jobAt?: number;
  jobTitle?: string;
  costUsd: number;
  durationMs: number;
  turns: number;
  isError: boolean;
}

interface Rec {
  s: ChatSummary;
  createdAt: number;
  /** last start or message: an idle engine is released this long after it (releaseIdle) */
  activeAt?: number;
  /** its engine is ending because it sat idle: the chat stays 'idle', the next message waits for it, then resumes */
  releasing?: Promise<void> | undefined;
  /** permissionMode null = no choice: the CLI follows the user's settings.json (ADR 0002) */
  choice: { model: string | null; effort: Effort | null; permissionMode: PermissionMode | null };
  forkFrom?: string;
  worktree: boolean;
  /** the chat was created with "Worktree separato": its work is in a worktree the CLI made, not in cwd */
  inWorktree?: boolean;
  costTotalUsd: number;
  items: ChatItem[];
  pending: Map<string, PendingRequest>;
  session: HarnessSession | null;
  /** the "/" commands its engine reported (in memory: a new engine reports them again) */
  commands?: ChatCommand[];
  /** engines ended while the chat went on (model or Regia change, continued): their tools are reaped at the real close */
  kept?: HarnessSession[];
  historyLoaded: boolean;
  /** a job not started yet (a chat created in this run): its first send gets the estimate and the first prompt */
  jobNew: boolean;
  firstPrompt: string | null;
  kind?: JobKind;
  /** when the job started and the title its estimate was made on (the brain records the prediction with them) */
  jobAt?: number;
  jobTitle?: string;
  /** a turn ran since the last onDone */
  turnSinceDone: boolean;
  /** a resumed session still opening (sends wait for it) */
  opening?: Promise<void> | undefined;
  /** an archive closing the session (a send waits for it, then reopens the chat on a new session) */
  archiving?: Promise<void> | undefined;
  /** a turn is running (persisted): set when the CLI reports running/waiting, cleared by its result, a CLI exit
   *  while the app runs, or an archive; still set after a quit or crash = resume it on the next start */
  working?: boolean;
  /** close the session when this turn ends, so the next message reopens it (Cursor: the new --model; a former Regia:
   *  without the app-control tools) */
  reopen?: boolean;
  /** the end of the last real turn (not a hand-off turn): a hand-off older than this is stale */
  lastTurnAt: number;
  /** a hand-off turn in flight: the assistant texts it produced, and who waits for them; quiet = a cold note (ADR
   *  0031): its items stay out of the tile */
  handoffTurn?: { texts: Map<string, string>; done: (text: string | null) => void; quiet?: boolean } | undefined;
  /** the saved hand-off is a cold note written at this time (persisted): a message after the cache expired goes on
   *  in a fresh session from it */
  coldNoteAt?: number | undefined;
  /** the lastTurnAt the cold note was asked for (once per idle stretch, even when it failed) */
  coldAskedFor?: number | undefined;
  /** when the context in force began: the first real turn since the session start or the last compaction (persisted) */
  ctxSince?: number | undefined;
  /** the Rome day a Regia was last asked for its day compaction (once a day, even when it failed) */
  dayCompactOn?: string | undefined;
  /** the sessions before its cold continuations, oldest first (persisted; their transcripts show folded above) */
  pastSessions?: PastSession[];
  /** a cold continuation switching sessions: a second message waits for it */
  switching?: Promise<ColdStep> | undefined;
  /** archived by the auto-close while it waited for its cold note: its engine ends once the note is written */
  closeAfterCold?: boolean;
  /** the next API calls count as "after" a continuation or a compaction (ADR 0031 counters) */
  after?: { kind: 'continuation' | 'compaction'; left: number } | undefined;
  /** the last hand-off turn ended in an error or was stopped by the user: a "Riprendi" waiting on it is cancelled */
  handoffStopped?: boolean;
}

/** A cold switch in flight (coldSwitch → ensureSession → coldDone / coldUndo): the note, the old session, what to restore. */
interface ColdStep {
  h: HandoffInfo; old: string | null; at: number; idleMin: number; notePath: string;
  prev: { forkFrom: Rec['forkFrom']; costTotalUsd: Rec['costTotalUsd']; contextTokens: number | undefined; contextMaxTokens: number | undefined; coldNoteAt: number | undefined; after: Rec['after'] };
}

/** The divider of a cold continuation (ADR 0031): the same id live and when the history is read again. */
const coldDivider = (fromSession: string, at: number, notePath: string): ChatItem => ({
  kind: 'system', id: `cont-${fromSession}`, at, level: 'info', continued: { notePath, ...(isUuid(fromSession) ? { session: fromSession } : {}) },
  text: 'Continua da qui: sessione nuova dal passaggio di consegne (la cache della precedente era scaduta).',
});

const MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'];
/** archived chats kept (the oldest beyond this leave the app; their transcripts stay where the CLI keeps them) */
const MAX_ARCHIVED = 60;
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** A model id as the CLIs take it; never starting with '-', which an ACP CLI would read as one of its flags. */
const MODEL_ID = /^[\w.:@/[\]][\w.:@/=[\],-]{0,119}$/;

export class ChatManager implements ChatService {
  private chats = new Map<string, Rec>();
  /** "Riprendi" in flight per old chat: a double click or two agents get the same new chat, never two. */
  private continuing = new Map<string, Promise<ChatSummary>>();
  private store: ChatStore;
  private handoffs: HandoffStore;
  private home: string;
  private max: number;
  private version: string | null = null;
  private probing = false;
  private killedPids = new Set<number>();
  private quitting = false; // shutdown started: a CLI exit now is the quit's, its cut turn resumes on the next start
  private coalesce = new Map<string, { items: Map<string, ChatItem>; timer: NodeJS.Timeout }>();
  private lastUsageAt = 0;
  private usageTimer: NodeJS.Timeout | null = null;
  private lastUsageChat: string | null = null;
  private coldTimer: NodeJS.Timeout | null = null;
  private readonly counters: ContextCounters;
  private readonly onExit = (): void => { this.killAll(); };
  /** the CPU queue (ADR 0036); null = not wired: everything runs at once */
  private readonly admission: AdmissionQueue | null;
  // no engine is started ahead while the machine is busy or chats wait in the CPU queue (ADR 0036)
  private readonly warm = new WarmPool({ spawn: cwd => this.spawnWarm(cwd), enabled: () => !!this.opts.prewarm && !this.quitting && !this.admission?.busy() && this.opts.engineOn?.('claude') !== false });

  constructor(private readonly opts: ChatManagerOptions) {
    this.store = new ChatStore(opts.userData);
    this.admission = opts.admission ? new AdmissionQueue({ ...opts.admission, onChange: () => this.refreshQueued() }) : null;
    this.handoffs = new HandoffStore(opts.userData);
    this.counters = new ContextCounters(opts.userData);
    this.home = opts.claudeHome ?? claudeHome();
    this.max = opts.maxItems ?? 2000;
    for (const c of this.store.load()) this.chats.set(c.id, this.restore(c));
    // Regie saved before regiaSince keep their list order (ADR 0021)
    let seat = 0;
    for (const r of this.chats.values()) if (r.s.isRegia && r.s.regiaSince === undefined) r.s.regiaSince = seat++;
    // one app Regia ("Migliora l'app"): the newest keeps the role
    const appRegie = [...this.chats.values()].filter(r => r.s.appRegia).sort((a, b) => b.createdAt - a.createdAt);
    for (const r of appRegie.slice(1)) delete r.s.appRegia;
    if (appRegie.length > 1) this.persist();
    process.on('exit', this.onExit); // Windows keeps orphaned children alive: kill them when the app dies
    // the plan windows stay fresh in the top bar even while a long turn runs (get_usage spends no model call)
    if (opts.onRateLimit) { this.usageTimer = setInterval(() => this.askUsage(), opts.usageEveryMs ?? 60000); this.usageTimer.unref?.(); }
    if ((opts.coldEveryMs ?? 60_000) > 0) { this.coldTimer = setInterval(() => this.coldTick(), opts.coldEveryMs ?? 60_000); this.coldTimer.unref?.(); }
    if (opts.prewarm) {
      const last = [...this.chats.values()].filter(r => !!engineOf(r.s.harness)?.caps.warm && r.s.origin === 'app' && !r.s.isRegia && !r.s.appRegia).sort((a, b) => b.createdAt - a.createdAt)[0];
      if (last && fs.existsSync(last.s.cwd)) this.warm.schedule(last.s.cwd, opts.prewarmDelayMs ?? 20000);
    }
    const claude = resolveClaude(opts.enginePaths?.claude ?? null);
    log.info('chats', 'manager ready', { data: { restored: this.chats.size, claude: claude ? `${claude.source}: ${claude.path}` : 'not found', overrides: opts.enginePaths ?? null } });
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

  /** The commands its engine reported, null when it has not reported any yet (the caller falls back to the disk). */
  commands(chatId: string): ChatCommand[] | null {
    return this.chats.get(chatId)?.commands ?? null;
  }

  pending(): PendingRequest[] {
    return [...this.chats.values()].flatMap(r => [...r.pending.values()]).sort((a, b) => a.at - b.at);
  }

  async create(req: NewChat, by: 'user' | 'agent' = 'user'): Promise<ChatSummary> {
    const engine = engineOrThrow(req.harness);
    this.needOn(engine.id);
    const caps = engine.caps;
    const cwd = typeof req.cwd === 'string' ? req.cwd.trim() : '';
    if (!cwd || !path.isAbsolute(cwd) || !fs.existsSync(cwd)) throw new Error(`Cartella non valida: ${cwd || '(vuota)'}`);
    if (req.permissionMode && !MODES.includes(req.permissionMode)) throw new Error(`Modalità permessi non valida: ${req.permissionMode}`);
    if (req.effort && !EFFORTS.includes(req.effort)) throw new Error(`Effort non valido: ${req.effort}`);
    if (!caps.effort && req.effort) throw new Error(`L’effort non si imposta con ${engine.label}: scegli il modello.`);
    if (req.model !== undefined && !MODEL_ID.test(req.model)) throw new Error(`Modello non valido: ${req.model}`);
    // only a copy of one of the app's own Claude chats (ADR 0010: no sessions from other apps; never two writers)
    const forkOf = req.resumeSessionId?.trim() || null;
    if (forkOf) {
      const src = [...this.chats.values()].find(r => r.s.sessionId === forkOf);
      if (!req.fork || !caps.fork || !isUuid(forkOf) || !src || src.s.harness !== req.harness) throw new Error('Si può solo duplicare (fork) una chat dell’app, sullo stesso motore, se il motore lo permette.');
    }

    // a plain new Claude chat adopts the engine already waiting in its folder (warm.ts): no 10-25 s start-up
    const warm = caps.warm && !forkOf && !req.worktree && !req.regia && !(req.space === 'app' && req.appRegia === true) && req.permissionMode !== 'bypassPermissions'
      ? this.warm.take(cwd) : null;
    const id = warm?.chatId ?? `c_${crypto.randomBytes(5).toString('hex')}`;
    const now = Date.now();
    // several Regie (ADR 0021): a new one sits next to the others; with `replaces` it takes that one's role, name and
    // work chats, and the old one goes on as a normal chat (history kept, never deleted)
    const old = req.regia && req.replaces ? this.chats.get(req.replaces) : undefined;
    if (req.regia && req.replaces && !old?.s.isRegia) throw new Error('La Regia da sostituire non c’è più.');
    const regiaName = req.regia ? cleanRegiaName(req.regiaName) ?? old?.s.regiaName ?? null : null;
    if (req.regia && req.regiaName !== undefined && !cleanRegiaName(req.regiaName)) throw new Error('Nome della Regia non valido: da 1 a 30 caratteri.');
    const regiaOf = !req.regia && req.regiaOf && this.chats.get(req.regiaOf)?.s.isRegia ? req.regiaOf : null;
    // the app's Regia ("Migliora l'app", ADR 0020) is one and never a work Regia: a new one takes the role
    const space = req.space === 'app' ? 'app' as const : undefined;
    const appRegia = !!space && req.appRegia === true && !req.regia;
    const oldApp = appRegia ? [...this.chats.values()].filter(x => x.s.appRegia) : [];
    const title = req.title?.trim() || (req.regia && regiaName && !old ? `Regia · ${regiaName}` : '') || (req.prompt?.trim() ? cut(req.prompt, 50) : forkOf ? 'Fork' : 'Nuova chat');
    // an agent's chat with a prompt starts with its first message, through the CPU queue (ADR 0036); a warm engine is
    // already running: adopting it is no new start (its first turn still asks the queue)
    const prompt = req.prompt?.trim() ? req.prompt : null;
    const viaQueue = by === 'agent' && !!prompt && !!this.admission;
    const r: Rec = {
      s: {
        id, harness: req.harness, origin: 'app', title, cwd, sessionId: forkOf || !caps.transcript ? null : warm?.sessionId ?? crypto.randomUUID(),
        model: req.model ?? null, effort: req.effort ?? null, permissionMode: req.permissionMode ?? null,
        // a chat that goes through the queue has started nothing yet: 'starting' only with an engine on its way (a queued
        // chat that went starting → idle read as a finished turn: the Regia was told "ha finito il turno", 2026-10-14)
        state: viaQueue && !warm ? 'idle' : 'starting', costUsd: 0, pending: 0, isRegia: !!req.regia, lastText: '', updatedAt: now, browserTabIds: [],
        ...(regiaName ? { regiaName } : {}), ...(regiaOf ? { regiaOf } : {}),
        ...(req.regia ? { regiaSince: old?.s.regiaSince ?? now } : {}),
        ...(caps.cost ? {} : { costKnown: false as const }),
        ...(space ? { space, ...(appRegia ? { appRegia: true } : {}) } : {}),
        ...(req.route ? { route: req.route } : {}),
      },
      createdAt: now,
      choice: { model: req.model ?? null, effort: req.effort ?? null, permissionMode: req.permissionMode ?? null },
      ...(forkOf ? { forkFrom: forkOf } : {}),
      worktree: !!req.worktree && caps.worktree,
      ...(req.worktree && caps.worktree ? { inWorktree: true } : {}),
      costTotalUsd: 0,
      items: [], pending: new Map(), session: null, historyLoaded: false,
      jobNew: true, firstPrompt: null, turnSinceDone: false, lastTurnAt: 0,
    };
    this.chats.set(id, r);
    if (old) this.demoteRegia(old, id);
    for (const x of oldApp) this.demoteRegia(x, id);
    this.ensureHistory(r); // a fork shows the past it starts from
    this.persist();
    log.info('chats', 'chat created', { chat: id, data: { harness: req.harness, cwd, fork: !!forkOf, model: r.choice.model, permissionMode: r.choice.permissionMode, regia: r.s.isRegia, warm: !!warm } });
    this.updated(r);
    if (warm) this.adoptWarm(r, warm); else if (!viaQueue) this.startSession(r);
    if (caps.warm) this.warm.schedule(cwd, this.opts.prewarmDelayMs ?? 5000);
    // the chat exists from here on: a failed first send shows as state 'error' + lastError, not as a lost chat
    if (prompt) {
      try { await (viaQueue ? this.gate(r, () => this.deliver(id, prompt)) : this.send(id, prompt)); } catch (e) {
        if (!r.s.lastError) r.s.lastError = errText(e);
        this.updated(r);
      }
    }
    return { ...r.s };
  }

  /** A message, optionally with images (pasted screenshots; checked here: images.ts). Text may be empty with images.
   *  resumed = the app's own "riprendi" after a restart (keeps the tile's mark; any other message clears it);
   *  from = not the user's: the sender shown above the bubble (another chat's title, the Regia);
   *  liveOnly = mail (chats/mail.ts): never into a chat that has no engine or is closing, never reopens one */
  async send(chatId: string, text: string, images?: unknown, resumed = false, from?: string, liveOnly = false): Promise<void> {
    const r = this.need(chatId);
    this.needAgentMay(r, from);
    if (!this.admission) return this.deliver(chatId, text, images, resumed, from, liveOnly);
    // the user's own message never waits (ADR 0036): what waited for this chat goes first, now, then this one
    if (!resumed && from === undefined) {
      this.admission.admitNow(chatId);
      return this.deliver(chatId, text, images, resumed, from, liveOnly);
    }
    // an agent's message (another chat, the Regia, the app's own resume): checked now, then it may wait for the load
    if (liveOnly && ((!r.session && r.s.state !== 'idle') || r.archiving || r.s.closedAt)) throw new Error('La chat non è attiva: la posta resta da leggere.');
    if (!(typeof text === 'string' && text.trim()) && !checkImages(images).length) throw new Error('Messaggio vuoto.');
    // mail (liveOnly) is taken from the inbox only if delivered now: when it would wait it stays unread (mail.ts undo)
    if (liveOnly && !this.midTurn(r) && this.admission.wouldWait(chatId)) throw new Error(MAIL_WAITS);
    if (r.s.closedAt && !r.archiving) this.unarchive(r); // back on the grid now: its tile shows that it waits
    return this.gate(r, () => this.deliver(chatId, text, images, resumed, from, liveOnly));
  }

  /** a turn runs in a live engine: a message joins it (a chat cut by a restart has working set but no engine) */
  private midTurn(r: Rec): boolean {
    return !!r.session && (r.working === true || r.session.busy);
  }

  /** Agent work through the CPU queue (ADR 0036): runs now (the promise is the delivery's) or waits, and then resolves
   *  at once; a later failure lands on the chat (lastError). A chat in the middle of a turn never waits: the message
   *  joins its running work. */
  private gate(r: Rec, deliver: () => Promise<void>): Promise<void> {
    const adm = this.admission;
    // a chat mid-turn takes the message at once, unless earlier work of its own still waits (never overtaken)
    if (!adm || (this.midTurn(r) && !adm.entry(r.s.id))) return deliver();
    let now: Promise<void> | undefined;
    let late = false;
    // a chat on the app itself waits behind the work chats' (the user, 2026-10-14)
    const q = adm.request(r.s.id, r.session ? 'turn' : 'start', () => {
      const p = deliver();
      if (late) p.catch(e => this.lateFailed(r, e)); else now = p;
    }, isAppChat(r.s.title, r.s.space));
    if (!q) return now ?? Promise.resolve();
    late = true;
    log.info('chats', 'agent work queued: the machine is busy', { chat: r.s.id, data: { kind: q.kind, position: q.position, app: !!q.app, ...adm.load() } });
    return Promise.resolve();
  }

  /** A queued delivery failed when it finally ran: the chat shows it (nobody awaits that promise any more). */
  private lateFailed(r: Rec, e: unknown): void {
    log.warn('chats', 'queued message not delivered', { chat: r.s.id, cause: errText(e), hint: 'the chat shows the error; write to it to retry' });
    if (this.chats.get(r.s.id) !== r) return;
    r.s.lastError = errText(e);
    delete r.s.resumedAt;
    this.updated(r);
  }

  /** The queue moved or the load changed: each chat's "In coda" line follows. */
  private refreshQueued(): void {
    const adm = this.admission;
    if (!adm) return;
    const load = adm.load();
    const waiting = new Map(adm.list().map(e => [e.key, e]));
    for (const r of this.chats.values()) {
      const e = waiting.get(r.s.id);
      const was = r.s.queued;
      if (!e) { if (was) { delete r.s.queued; this.updated(r); } continue; }
      if (was && was.position === e.position && was.kind === e.kind && was.cpu === load.cpu && was.freeRam === load.freeRam) continue;
      r.s.queued = { kind: e.kind, position: e.position, since: e.since, cpu: load.cpu, freeRam: load.freeRam };
      this.updated(r);
    }
  }

  admitNow(chatId: string): boolean {
    this.need(chatId);
    const ok = !!this.admission?.admitNow(chatId);
    if (ok) log.info('chats', 'queued chat started now by the user', { chat: chatId });
    return ok;
  }

  queueState(): ReturnType<ChatService['queueState']> {
    const adm = this.admission;
    if (!adm) return null;
    return { ...adm.load(), enabled: this.opts.admission!.limits().enabled, waiting: adm.list().map(e => ({ chatId: e.key, kind: e.kind, position: e.position, since: e.since })) };
  }

  /** The delivery of a message (send() decided it goes now). */
  private async deliver(chatId: string, text: string, images?: unknown, resumed = false, from?: string, liveOnly = false): Promise<void> {
    const r = this.need(chatId);
    // an engine released for idleness still gets its mail: the chat resumes for it (ensureSession below)
    if (liveOnly && ((!r.session && r.s.state !== 'idle') || r.archiving || r.s.closedAt)) throw new Error('La chat non è attiva: la posta resta da leggere.');
    const t = typeof text === 'string' ? text.trim() : '';
    const imgs = checkImages(images);
    if (!t && !imgs.length) throw new Error('Messaggio vuoto.');
    if (!resumed && r.s.resumedAt) { delete r.s.resumedAt; this.updated(r); }
    this.ensureHistory(r);
    if (r.archiving) await r.archiving; // never into a session that is closing: the archive ends first, then this reopens
    this.needAgentMay(r, from); // again: the engine may have been released while the message waited in the queue
    if (r.s.closedAt) this.unarchive(r); // a message (the user's, or an agent's through app_send_to_chat) reopens it
    // a cold chat (ADR 0031): after the cache expired the message goes on in a fresh session from its note
    const cold = await this.coldSwitch(r);
    try {
      await this.ensureSession(r);
      if (!r.session) throw new Error(r.s.lastError ?? 'Avvio della chat non riuscito.');
    } catch (e) {
      if (cold) this.coldUndo(r, cold); // the note stays for the next message
      throw e;
    }
    if (cold) this.coldDone(r, cold); // the fresh session started: the divider goes above the message
    // a message into the old session makes the note stale (a turn cut before its result would leave it "fresh")
    else if (r.coldNoteAt) { r.coldNoteAt = undefined; this.persist(); }
    const thumbs = imgs.flatMap(im => (im.thumb ? [im.thumb] : []));
    this.addItem(r, { kind: 'user', id: nextId('u'), at: Date.now(), text: t, ...(imgs.length ? { images: imgs.length } : {}), ...(thumbs.length ? { thumbs } : {}), ...(from ? { from: from.slice(0, 80) } : {}) }, false);
    r.activeAt = Date.now();
    if (r.jobNew) this.startJob(r, t || `[${imgs.length} immagini]`);
    try { r.session.send(cold ? coldPrompt({ ...r.s, ...(r.inWorktree ? { inWorktree: true } : {}) }, cold.h, t) : t, imgs); } catch (e) {
      throw new Error(`Messaggio non inviato: ${errText(e)}`);
    }
    // queued behind a quiet note turn: the engine reports no new "running", the tile shows the work from here
    if (r.handoffTurn?.quiet && r.s.state === 'idle') { r.s.state = 'running'; this.updated(r); }
    // queued behind a hand-off turn the CLI reports no new "running": mark the work here, resumed after a restart
    if (r.handoffTurn && !r.working) { r.working = true; this.persist(); }
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
  async stop(chatId: string, keepQueued = false): Promise<void> {
    const r = this.need(chatId);
    if (!r.session) return;
    try { await r.session.interrupt({ keepQueued, byUser: true }); } catch (e) {
      log.warn('chats', 'interrupt failed', { chat: chatId, data: errText(e) });
      throw new Error(`Stop non riuscito: ${errText(e)}`);
    }
  }

  /** Interrupts every live session; returns how many were working. */
  async stopAll(): Promise<number> {
    const live = [...this.chats.values()].filter(r => r.session);
    const busy = live.filter(r => r.session?.busy).length;
    await Promise.allSettled(live.map(r => r.session?.interrupt({ byUser: true })));
    log.info('chats', 'stop all', { data: { live: live.length, busy } });
    return busy;
  }

  /** Removes the chat from the app (its process ends; the transcript stays where the CLI keeps it). */
  async close(chatId: string): Promise<void> {
    const r = this.need(chatId);
    this.admission?.drop(chatId); // its waiting work goes with it
    const sess = r.session;
    if (sess) await sess.close();
    this.reapKept(r);
    for (const id of [...r.pending.keys()]) this.dropPending(r, id);
    this.flushItems(chatId);
    this.chats.delete(chatId);
    this.persist();
    log.info('chats', 'chat closed', { chat: chatId });
    this.opts.emitter.emit('chat:removed', { chatId });
  }

  /** The chat goes on in a new process: the old one ends, but a dev server it started stays for the next turn
   *  (owner, 2026-10-12); its tools are reaped when the chat really closes (reapKept). */
  private closeKeeping(r: Rec, sess: HarnessSession): Promise<void> {
    (r.kept ??= []).push(sess);
    return sess.close(undefined, true);
  }

  /** The chat really closes (✕, Ctrl+W, Chiudi, auto close): the engines it outlived leave nothing behind either. */
  private reapKept(r: Rec): void {
    for (const s of r.kept?.splice(0) ?? []) {
      if (s.root && reapEnabled()) void reapEngine(s.root, { chatId: r.s.id, what: 'a previous engine of this chat' });
    }
  }

  /** Archives a finished work chat: its process ends gracefully, the record stays (closedAt) and reopen() brings it
   *  back with its history. auto = the UI's auto-close: refused if the chat went back to work meanwhile. */
  async archive(chatId: string, opts: { auto?: boolean } = {}): Promise<ChatSummary> {
    const r = this.need(chatId);
    if (r.s.appRegia) throw new Error('La Regia non si chiude.');
    if (r.s.isRegia) {
      // a Regia closes only by the user's hand, never the first one (its title "Regia" is the mail address the brain's
      // rules and its chats write to; /mcp/app acts as it): its work chats go to the first Regia
      const regie = regieOf([...this.chats.values()].map(x => x.s));
      if (opts.auto || regie.length < 2) throw new Error('La Regia non si chiude: è l’unica.');
      if (regie[0]!.id === r.s.id) throw new Error('La prima Regia non si chiude: per ripartire usa Pulisci.');
      this.demoteRegia(r, regie[0]!.id, false); // the archive below ends its engine
    }
    if (r.archiving) await r.archiving;
    if (r.s.closedAt) return { ...r.s };
    if (opts.auto && (r.session?.busy || r.pending.size > 0 || (r.s.background ?? 0) > 0 || r.s.queued)) throw new Error('La chat è tornata al lavoro: resta aperta.');
    // closed by hand while an agent's message waited in the CPU queue: that message is dropped with the chat's work
    if (this.admission?.drop(chatId)) log.info('chats', 'queued work dropped: the chat was archived', { chat: chatId });
    const sess = r.session;
    const note = opts.auto && r.lastTurnAt > 0;
    // a long Claude chat that still waits for its cold note keeps its engine until it wrote it (never a turn at close:
    // the note comes at its usual time, coldTick; ADR 0031)
    const keep = !!opts.auto && !!sess?.alive && this.coldOn() && coldArmed(this.coldView(r), Date.now(), this.ttl());
    if (sess || note) {
      // one promise for the whole close, set before any await: a message sent meanwhile waits for it, then reopens
      r.archiving = (async () => {
        // the auto-close leaves the token-free hand-off for a later "Riprendi" (ADR 0014: never a turn at close)
        if (note) {
          try { await this.ensureHandoff(chatId, { ask: false }); } catch (e) {
            log.warn('chats', 'hand-off before the auto-close not written', { chat: chatId, cause: errText(e), hint: '"Riprendi" on this chat writes it then' });
          }
        }
        if (sess && !keep) { await sess.close(); this.reapKept(r); }
      })();
      try { await r.archiving; } finally { r.archiving = undefined; }
    }
    for (const id of [...r.pending.keys()]) this.dropPending(r, id);
    this.flushItems(chatId);
    r.s.closedAt = Date.now();
    r.s.closedBy = opts.auto ? 'auto' : 'user';
    r.working = false;
    if (keep) r.closeAfterCold = true;
    if (r.s.state !== 'error') r.s.state = 'closed';
    delete r.s.background;
    this.pruneArchived();
    this.persist();
    log.info('chats', 'chat archived', { chat: chatId, data: { auto: !!opts.auto, ...(keep ? { engineKeptForColdNote: true } : {}) } });
    this.updated(r);
    return { ...r.s };
  }

  /** Back on the grid; the session resumes on the next message (Claude --resume, Cursor session/load). */
  async reopen(chatId: string): Promise<ChatSummary> {
    const r = this.need(chatId);
    if (r.s.closedAt) this.unarchive(r);
    return { ...r.s };
  }

  /** After a start: every chat whose turn the last quit or crash cut (working still set) resumes by itself with
   *  RESUME_TEXT and the "ripresa dopo il riavvio" mark (resumedAt). Chats that had finished stay closed. */
  resumeInterrupted(): number {
    const cut = [...this.chats.values()].filter(r => r.working && !r.s.closedAt);
    for (const r of cut) {
      r.s.resumedAt = Date.now();
      this.updated(r);
      log.info('chats', 'resuming a chat cut by the restart', { chat: r.s.id });
      this.send(r.s.id, RESUME_TEXT, undefined, true).catch(e => {
        log.warn('chats', 'resume after restart failed', { chat: r.s.id, cause: errText(e), hint: 'the chat stays closed: a message from the user resumes it' });
        if (r.s.resumedAt) { delete r.s.resumedAt; this.updated(r); }
      });
    }
    return cut.length;
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
      if (m && !MODEL_ID.test(m)) throw new Error(`Modello non valido: ${m}`);
      r.choice.model = m; r.s.model = m;
      const engine = engineOrThrow(r.s.harness);
      if (!engine.caps.liveModel) {
        // never live (Cursor's session/set_model writes the user's config): reopen the session with --model, same history
        if (sess && !sess.busy) await this.closeKeeping(r, sess);
        else if (sess) r.reopen = true; // after this turn
        if (sess) this.addItem(r, { kind: 'system', id: nextId('s'), at: Date.now(), text: `Modello ${m ?? 'predefinito'}: ${engine.label} riparte con questo modello dal prossimo messaggio${r.reopen ? ', finito questo turno' : ''}.`, level: 'info' }, false);
      } else await apply('modello', sess ? () => sess.setModel(m) : undefined);
    }
    if (patch.effort !== undefined) {
      if (!EFFORTS.includes(patch.effort)) throw new Error(`Effort non valido: ${patch.effort}`);
      const engine = engineOrThrow(r.s.harness);
      if (!engine.caps.effort) throw new Error(`L’effort non si imposta con ${engine.label}: scegli il modello.`);
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

  // ---- long chats: hand-off and "Riprendi" ----

  /** The saved hand-off of a chat, or null. */
  readHandoff(chatId: string, session?: string): HandoffInfo | null {
    this.need(chatId);
    return this.handoffs.read(chatId, session);
  }

  /** The chat writes its hand-off now: one short turn, its answer saved as <userData>/handoffs/<chatId>.md. A chat that
   *  cannot be asked (no turn yet, a stopped engine with allowStart false, a failed or malformed answer) gets a
   *  token-free note built by the app (source 'auto'). Refused while the chat works or waits for the user. */
  async handoff(chatId: string, opts: HandoffOptions = {}): Promise<HandoffInfo> {
    const r = this.need(chatId);
    if (r.handoffTurn) throw new Error('La chat sta già facendo un turno breve dell’app (passaggio di consegne o riassunto): riprova tra poco.');
    this.ensureHistory(r);
    const hasTurns = r.lastTurnAt > 0 || r.items.some(i => i.kind === 'result' || i.kind === 'user');
    if (hasTurns && (r.session?.busy || r.pending.size > 0)) throw new Error('La chat sta lavorando o ti aspetta: il passaggio si scrive quando ha finito il turno.');
    // an archived chat is never started for its hand-off (it has no tile for the turn): the app writes the note
    const canAsk = hasTurns && !r.s.closedAt && opts.ask !== false && (opts.allowStart !== false || !!r.session?.alive);
    let text: string | null = null;
    if (canAsk) {
      try { text = await this.askHandoff(r, opts.reason ?? 'manual'); } catch (e) {
        log.warn('chats', 'hand-off turn failed', { chat: chatId, data: errText(e) });
      }
    }
    if (this.chats.get(chatId) !== r) throw new Error('Chat chiusa mentre scriveva il passaggio.');
    // "Riprendi" whose hand-off turn was stopped or failed: nothing saved (a later "Riprendi" asks the chat again)
    if (r.handoffStopped && opts.reason === 'continue') throw new Error('Ripresa annullata: il passaggio di consegne si è interrotto (fermato o in errore). Riprova quando vuoi.');
    const info = this.handoffs.write(chatId, {
      title: r.s.title, text: text ?? autoHandoff(r.s, r.items), at: Date.now(), source: text ? 'chat' : 'auto',
      ...(r.s.contextTokens ? { contextTokens: r.s.contextTokens } : {}),
    });
    r.s.handoffAt = info.at; r.s.handoffSource = info.source;
    this.addItem(r, { kind: 'system', id: nextId('s'), at: info.at, level: 'info', text: info.source === 'chat' ? 'Passaggio di consegne salvato: «Riprendi» apre una chat nuova che parte da qui.' : 'Passaggio di consegne automatico salvato (la chat non lo ha scritto): «Riprendi» apre una chat nuova che parte da qui.' }, false);
    this.persist();
    this.updated(r);
    log.info('chats', 'hand-off saved', { chat: chatId, data: { source: info.source, reason: opts.reason ?? 'manual', chars: info.text.length, contextTokens: r.s.contextTokens ?? null } });
    return info;
  }

  /** "Riprendi": a NEW chat on the same engine, folder and choices that starts from the hand-off (written first when
   *  missing or older than the last turn). The old chat's process ends; it stays readable, linked both ways.
   *  promptPrefix: a label put before the prompt (an agent's request is marked as not the user's). */
  continueChat(chatId: string, opts: { allowStart?: boolean; promptPrefix?: string } = {}): Promise<ChatSummary> {
    const running = this.continuing.get(chatId);
    if (running) return running;
    const p = this.doContinue(chatId, opts).finally(() => this.continuing.delete(chatId));
    this.continuing.set(chatId, p);
    return p;
  }

  private async doContinue(chatId: string, opts: { allowStart?: boolean; promptPrefix?: string }): Promise<ChatSummary> {
    const r = this.need(chatId);
    if (r.s.appRegia) throw new Error("La Regia dell'app non si riprende così: chiudila e creane una nuova dalla sezione «Migliora l'app».");
    if (r.s.isRegia) throw new Error('La Regia non si riprende così: usa «Ricomincia da capo» dal suo menu.');
    const next = r.s.continuedBy && this.chats.get(r.s.continuedBy.id);
    if (next) return { ...next.s };
    // never two agents on the same files: the old chat must have finished its turn (a fresh note does not cover this one)
    const hasTurns = r.lastTurnAt > 0 || r.items.some(i => i.kind === 'result' || i.kind === 'user');
    if (r.handoffTurn || (hasTurns && (r.session?.busy || r.pending.size > 0))) throw new Error('La chat sta lavorando o ti aspetta: si riprende quando ha finito il turno.');
    const saved = this.handoffs.read(chatId);
    const fresh = saved && saved.at >= r.lastTurnAt ? saved : null;
    r.handoffStopped = false;
    const h = fresh ?? await this.handoff(chatId, { reason: 'continue', ...(opts.allowStart === false ? { allowStart: false } : {}) });
    const taken = [...this.chats.values()].map(x => x.s.title);
    const c = await this.create({
      harness: r.s.harness, cwd: r.s.cwd, title: nextTitle(r.s.title, taken), ...(r.s.regiaOf ? { regiaOf: r.s.regiaOf } : {}),
      ...(r.choice.model ? { model: r.choice.model } : {}), ...(r.choice.effort ? { effort: r.choice.effort } : {}), ...(r.choice.permissionMode ? { permissionMode: r.choice.permissionMode } : {}),
      ...(r.s.space ? { space: r.s.space } : {}),
      // a routed job stays one outcome across hand-offs: the new chat writes on the first chat's ledger line
      ...(r.s.route ? { route: { ...r.s.route, ledgerId: r.s.route.ledgerId ?? `app:${r.s.id}`, handoffs: (r.s.route.handoffs ?? 0) + 1 } } : {}),
      prompt: `${opts.promptPrefix ? `${opts.promptPrefix}\n\n` : ''}${continuePrompt({ ...r.s, ...(r.inWorktree ? { inWorktree: true } : {}) }, h)}`,
    });
    const nr = this.chats.get(c.id);
    // the worktree hint follows the chain (A → B → C)
    if (nr) { nr.s.continuedFrom = { id: r.s.id, title: r.s.title }; if (r.inWorktree) nr.inWorktree = true; this.updated(nr); }
    r.s.continuedBy = { id: c.id, title: c.title };
    this.addItem(r, { kind: 'system', id: nextId('s'), at: Date.now(), level: 'info', text: `Il lavoro continua nella chat «${c.title}». Questa resta consultabile.` }, false);
    this.persist();
    this.updated(r);
    // its context is not re-read any more: the process ends now, or when the turn that just wrote the hand-off settles
    if (r.session && !r.session.busy) await this.closeKeeping(r, r.session);
    else if (r.session) r.reopen = true;
    log.info('chats', 'chat continued in a new one', { chat: chatId, data: { next: c.id, handoff: h.source, fresh: !!fresh } });
    return { ...(nr?.s ?? c) };
  }

  /** Writes the hand-off when it is missing or older than the last turn (the auto-close calls it before archiving). */
  async ensureHandoff(chatId: string, opts: HandoffOptions = {}): Promise<HandoffInfo> {
    const r = this.need(chatId);
    const saved = this.handoffs.read(chatId);
    if (saved && saved.at >= r.lastTurnAt) return saved;
    return this.handoff(chatId, { reason: 'finished', ...opts });
  }

  // ---- cold chats: the invisible continuation (ADR 0031) ----

  /** How the Claude chats used their context (zero tokens: from the usage the engines report). */
  contextStats(): ContextStats { return this.counters.snapshot(); }

  private coldOn(): boolean { return !!this.opts.coldHandoff?.(); }
  private ttl(): number { return this.opts.cacheTtlMs ?? CACHE_TTL_MS; }

  private coldView(r: Rec): ColdView {
    return {
      harness: r.s.harness, isRegia: r.s.isRegia, ...(r.s.appRegia ? { appRegia: true } : {}), continuedBy: r.s.continuedBy,
      // an archived chat kept alive for its note counts as idle (archive: closeAfterCold)
      state: r.closeAfterCold && r.s.closedAt && r.s.state === 'closed' ? 'idle' : r.s.state,
      pending: r.pending.size, busy: !!r.session?.busy, alive: !!r.session?.alive, handoffTurn: !!r.handoffTurn,
      contextTokens: r.s.contextTokens ?? 0, lastTurnAt: r.lastTurnAt, noteAt: r.coldNoteAt ?? 0,
      lastCallAt: Math.max(r.lastTurnAt, r.coldNoteAt ?? 0), askedFor: r.coldAskedFor,
    };
  }

  /** Every minute (coldEveryMs): each idle long Claude chat whose cache is about to expire writes its note quietly;
   *  an archived chat kept for its note whose chance passed ends its engine. Returns how many were asked. */
  coldTick(now = Date.now()): number {
    if (this.quitting) return 0;
    const on = this.coldOn(), idle = this.opts.coldIdleMs?.() ?? 50 * 60_000, day = !!this.opts.regiaDayCompact?.();
    let n = 0;
    for (const r of this.chats.values()) {
      const v = this.coldView(r);
      if (on && coldAsk(v, now, idle, this.ttl())) { n++; void this.coldNote(r); continue; }
      if (day && regiaDayDue({ ...v, lastTurnAt: r.lastTurnAt, ctxSince: r.ctxSince, askedOn: r.dayCompactOn }, now)) { n++; void this.regiaCompact(r, now); continue; }
      if (r.closeAfterCold && !r.handoffTurn && (!on || !coldArmed(v, now, this.ttl()))) void this.endKept(r);
    }
    return n;
  }

  /** One quiet hand-off turn on the warm cache: nothing shows in the tile; the note is saved only when the chat wrote
   *  it (a token-free note is no base for a continuation: the next message then resumes the old session). */
  private async coldNote(r: Rec): Promise<void> {
    r.coldAskedFor = r.lastTurnAt;
    const ctx = r.s.contextTokens ?? 0;
    log.info('chats', 'cold chat: asking its note while the cache is warm', { chat: r.s.id, data: { contextTokens: ctx, idleMin: Math.round((Date.now() - Math.max(r.lastTurnAt, r.coldNoteAt ?? 0)) / 60000) } });
    let text: string | null = null;
    try { text = await this.askHandoff(r, 'cold', true); } catch (e) {
      log.warn('chats', 'cold note turn failed', { chat: r.s.id, cause: errText(e), hint: 'the next message resumes the old session (one cold re-read)' });
    }
    if (this.chats.get(r.s.id) !== r) return;
    if (text) {
      const info = this.handoffs.write(r.s.id, { title: r.s.title, text, at: Date.now(), source: 'chat', ...(ctx ? { contextTokens: ctx } : {}) });
      r.s.handoffAt = info.at; r.s.handoffSource = 'chat';
      // a message queued behind the quiet turn goes on in the old session: the note is no base for it
      if (!r.working) r.coldNoteAt = info.at;
      this.counters.note(r.s.id, 'written', { contextTokens: ctx, chars: info.text.length });
      this.persist();
      this.updated(r);
    } else log.info('chats', 'cold note not written', { chat: r.s.id, data: { stopped: !!r.handoffStopped } });
    if (r.closeAfterCold) await this.endKept(r);
  }

  /** A Regia's day compaction (regia-day.ts): one quiet `/compact` turn with what to keep; the engine's compact_boundary
   *  shows in the tile («Contesto compattato») and starts its context's day again. Same chat, same session. */
  private async regiaCompact(r: Rec, now: number): Promise<void> {
    r.dayCompactOn = romeDay(now);
    const sess = r.session;
    if (!sess) return;
    log.info('chats', 'Regia: compacting a context from an earlier day', { chat: r.s.id, data: { contextTokens: r.s.contextTokens ?? null, since: r.ctxSince ?? null } });
    this.addItem(r, { kind: 'system', id: nextId('s'), at: Date.now(), level: 'info', text: 'Giorno nuovo: compatto il contesto della Regia in un riassunto (le chat che segue e la coda restano).' }, false);
    const out = await this.quietTurn(r, sess, REGIA_COMPACT, true).catch((e: unknown) => {
      log.warn('chats', 'Regia day compaction not sent', { chat: r.s.id, cause: errText(e), hint: 'it still compacts by itself at its window (compactWindowTokens); tomorrow it tries again' });
      return null;
    });
    if (out !== null) return;
    log.info('chats', 'Regia day compaction did not finish', { chat: r.s.id, data: { contextTokens: r.s.contextTokens ?? null } });
    this.addItem(r, { kind: 'system', id: nextId('s'), at: Date.now(), level: 'warn', text: 'Non sono riuscito a riassumere il contesto della Regia: ci riprovo domani; intanto si compatta da sola al limite impostato.' }, false);
  }

  /** The engine an auto-close kept for the cold note ends now (the chat stays archived). */
  private async endKept(r: Rec): Promise<void> {
    r.closeAfterCold = false;
    const sess = r.session;
    // the note's result comes a moment before the engine reports idle
    for (let i = 0; i < 50 && sess?.busy && r.session === sess && r.s.closedAt; i++) await new Promise(res => setTimeout(res, 200));
    if (!r.s.closedAt || !sess || sess.busy || r.session !== sess) return;
    await sess.close();
    this.reapKept(r);
  }

  /** A message to a cold chat whose cache expired: the old session ends, a fresh one (new session id, same chat,
   *  title and choices) will start from the note. Returns the step the first message carries (send commits it with
   *  coldDone once the engine started, or undoes it with coldUndo when it did not), null when the chat
   *  goes on as usual. A second message meanwhile waits for the switch. */
  private async coldSwitch(r: Rec): Promise<ColdStep | null> {
    if (r.switching) { await r.switching; return null; }
    if (!this.coldOn() || !coldRoute(this.coldView(r), Date.now(), this.ttl())) return null;
    const h = this.handoffs.read(r.s.id);
    if (!h || h.source !== 'chat' || h.at < r.lastTurnAt) { r.coldNoteAt = undefined; return null; }
    const run = (async (): Promise<ColdStep> => {
      if (r.releasing) await r.releasing;
      if (r.session) await this.closeKeeping(r, r.session);
      const now = Date.now(), old = r.s.sessionId;
      const step: ColdStep = {
        h, old, at: now, idleMin: Math.round((now - Math.max(r.lastTurnAt, r.coldNoteAt ?? 0)) / 60000),
        prev: { forkFrom: r.forkFrom, costTotalUsd: r.costTotalUsd, contextTokens: r.s.contextTokens, contextMaxTokens: r.s.contextMaxTokens, coldNoteAt: r.coldNoteAt, after: r.after },
        notePath: isUuid(old) ? this.handoffs.archive(r.s.id, old) : h.path,
      };
      if (isUuid(old)) { (r.pastSessions ??= []).push({ sessionId: old, at: now, notePath: step.notePath }); r.pastSessions.splice(0, Math.max(0, r.pastSessions.length - 20)); }
      r.s.sessionId = crypto.randomUUID();
      delete r.forkFrom;
      r.costTotalUsd = 0; // the new session's own running total starts from zero
      delete r.s.contextTokens; delete r.s.contextMaxTokens;
      r.coldNoteAt = undefined;
      r.after = { kind: 'continuation', left: AFTER_CALLS };
      return step;
    })();
    r.switching = run;
    try { return await run; } finally { r.switching = undefined; }
  }

  /** The fresh session started: the divider folds the old session, the note counts as used. */
  private coldDone(r: Rec, c: ColdStep): void {
    this.addItem(r, coldDivider(c.old ?? 'x', c.at, c.notePath), false);
    this.counters.note(r.s.id, 'used', { idleMin: c.idleMin, contextTokens: c.h.contextTokens ?? null });
    this.persist();
    this.updated(r);
    log.info('chats', 'cold chat continued in a fresh session', { chat: r.s.id, data: { idleMin: c.idleMin, from: c.old, to: r.s.sessionId, contextTokens: c.h.contextTokens ?? null } });
  }

  /** The fresh session did not start: back to the old one, the note kept for the next message. */
  private coldUndo(r: Rec, c: ColdStep): void {
    if (r.session) return; // an engine on the new id runs: keep it
    if (c.old) r.s.sessionId = c.old;
    if (isUuid(c.old)) r.pastSessions?.pop();
    if (c.prev.forkFrom) r.forkFrom = c.prev.forkFrom;
    r.costTotalUsd = c.prev.costTotalUsd;
    if (c.prev.contextTokens !== undefined) r.s.contextTokens = c.prev.contextTokens;
    if (c.prev.contextMaxTokens !== undefined) r.s.contextMaxTokens = c.prev.contextMaxTokens;
    r.coldNoteAt = c.prev.coldNoteAt;
    r.after = c.prev.after;
    this.persist();
    this.updated(r);
    log.warn('chats', 'cold continuation not started', { chat: r.s.id, cause: r.s.lastError ?? 'engine did not start', hint: 'the note stays: the next message tries the fresh session again' });
  }

  /** App quit. Every CLI gets its tree killed at once, idle ones too: one that ended cleanly would leave its MCP
   *  servers and shells running, and the reap after an exit (a 3-40 s process list) does not finish before the app is
   *  gone (owner, 2026-10-12). Busy turns are lost at quit anyway; transcripts are already on disk. We wait for the
   *  kills to land, because taskkill /T needs claude.exe alive to find its children and takes 1-3.5 s to start on
   *  Windows (15-40 s on a loaded one); then one more kill for anything left, awaited without blocking the main
   *  process. Resolves within `capMs` (under the app's 6 s quit cap, index.ts): what is still alive then is the
   *  orphan sweep's on the next start. */
  async shutdown(graceMs = 800, capMs = 5500): Promise<void> {
    const end = Date.now() + capMs;
    this.quitting = true;
    this.persist();
    this.warm.stop();
    this.admission?.stop(); // what still waits is lost with the run; a cut turn (working) resumes on the next start anyway
    const live = [...this.chats.values()].map(r => r.session).concat(this.warm.current?.session ?? null).filter((x): x is HarnessSession => !!x && x.alive);
    // the engines outside a Job Object: what they started, pictured now (WMI is slow) for the kill at the cap
    // each of these spawns a process (WMI's PowerShell, a taskkill per engine): the slowest says what one costs now
    let spawnMs = 0;
    const timed = <T>(f: () => T): T => { const t = Date.now(); try { return f(); } finally { spawnMs = Math.max(spawnMs, Date.now() - t); } };
    const kids = timed(() => snapshotTrees(process.platform === 'win32' ? live.filter(x => !jobGuard.has(x.jobHandle)).flatMap(x => (x.pid ? [x.pid] : [])) : [], capMs));
    for (const x of live) timed(() => x.killNow());
    const closes = Promise.allSettled(live.map(x => x.close(graceMs)));
    // timed from the start, not from here, and the last kill keeps room for what it spawns (the reaper) at this load:
    // a fixed 1 s let the quit end 146 ms past the app's 6 s cap at full CPU (2026-10-14)
    const last = Math.max(1000, 3 * spawnMs);
    await Promise.race([closes, new Promise(r => setTimeout(r, Math.max(0, Math.min(end - capMs + graceMs + 4500, end - last) - Date.now())).unref())]);
    await this.killLeft(Math.max(0, end - Date.now()), kids, spawnMs);
    if (this.usageTimer) clearInterval(this.usageTimer);
    if (this.coldTimer) clearInterval(this.coldTimer);
    this.counters.flush();
    process.off('exit', this.onExit);
    log.info('chats', 'manager stopped', { data: { sessions: live.length, left: live.filter(x => x.alive).length, ms: Date.now() - end + capMs, spawnMs } });
  }

  /** The engines running now and their chats, the waiting warm engine included (its chat id is the next chat's), plus
   *  the chats still open (the orphan sweep's owners, sweep.ts). */
  engines(): { live: { chatId: string; pid: number }[]; open: string[] } {
    const all = [...this.chats.values()];
    const w = this.warm.current;
    return {
      live: all.flatMap(r => (r.session?.alive && r.session.pid ? [{ chatId: r.s.id, pid: r.session.pid }] : []))
        .concat(w?.session.alive && w.session.pid ? [{ chatId: w.chatId, pid: w.session.pid }] : []),
      open: all.filter(r => !r.s.closedAt).map(r => r.s.id),
    };
  }

  /** Ends the engines of chats idle for `idleMs` (setting engineIdleMin): no turn, question, queue, background task or
   *  hand-off, never a Regia. The chat stays on the grid as idle; its next message resumes it (ensureSession). Each
   *  engine ends like a ✕ (its tools reaped, its job released). Returns how many were released. */
  releaseIdle(idleMs: number, now = Date.now()): number {
    if (idleMs <= 0 || this.quitting) return 0;
    let n = 0;
    for (const r of this.chats.values()) {
      const sess = r.session;
      if (!sess?.alive || sess.busy || r.releasing || r.archiving || r.handoffTurn || r.s.closedAt || r.s.isRegia || r.s.appRegia) continue;
      if (r.s.state !== 'idle' || r.pending.size > 0 || (r.s.background ?? 0) > 0) continue;
      if (now - Math.max(r.activeAt ?? 0, r.lastTurnAt) < idleMs) continue;
      // a long chat waiting for its cold note keeps its engine: a resumed one would miss the cache (ADR 0031)
      if (this.coldOn() && coldArmed(this.coldView(r), now, this.ttl())) continue;
      n++;
      log.info('chats', 'idle engine released', { chat: r.s.id, data: { idleMin: Math.round((now - Math.max(r.activeAt ?? 0, r.lastTurnAt)) / 60000), pid: sess.pid } });
      // like a model change: a dev server or local stack it started stays until the chat really closes (reapKept)
      r.releasing = this.closeKeeping(r, sess).finally(() => { r.releasing = undefined; });
    }
    return n;
  }

  /** Synchronous last resort (before app.exit, will-quit, process exit): a detached taskkill /T for every CLI process
   *  still alive, never waited for (it finishes the tree after the app is gone; the CLI itself dies with libuv's
   *  kill-on-close job). Never blocks: the bounded wait is shutdown's (killLeft). No-op when nothing is alive. */
  killAll(): void {
    const loose = this.takeLeft();
    if (loose.length) killTrees(loose.map(x => x.pid), { fallback: () => { for (const x of loose) x.killNow(); } });
  }

  /** shutdown's last kill: like killAll, then waits (without blocking) at most `ms` for those processes to die; the
   *  ones still alive go with what `kids` pictured them starting. */
  private async killLeft(ms: number, kids: (pid: number) => number[], spawnMs: number): Promise<void> {
    const loose = this.takeLeft();
    const started = new Map(loose.map(x => [x.pid, x.startedAt ?? 0]));
    // their tree kill (taskkill /T) already runs since shutdown's killNow: no second one to spawn
    if (loose.length) await killTreesWithin(loose.map(x => x.pid), ms, { started: { spawnMs }, kids, after: (pids, at) => reapAfterQuit(pids.map(pid => ({ pid, created: started.get(pid) ?? 0, exited: at }))) });
  }

  /** The CLI processes still alive and not killed yet, marked killed; engines in a Job Object end with the guard's
   *  handles (kill-on-close, no taskkill), so only the others ("loose") are returned. */
  private takeLeft(): HarnessSession[] {
    // a killed pid stays "alive" until the loop runs 'close' again: never taskkill it twice (1-40 s each)
    const left = [...this.chats.values()].map(r => r.session).concat(this.warm.current?.session ?? null).filter((x): x is HarnessSession => !!x && x.alive && !x.gone && !!x.pid && !this.killedPids.has(x.pid));
    if (!left.length) return [];
    log.warn('chats', 'killing CLI processes still alive at quit', { data: { pids: left.map(x => x.pid) } });
    for (const x of left) if (x.pid) this.killedPids.add(x.pid);
    const loose = left.filter(x => !jobGuard.has(x.jobHandle));
    if (loose.length < left.length) jobGuard.stop();
    return loose;
  }

  /** Claude engine status: found, path, version (from a session or the background `claude --version`). */
  cliStatus(): CliStatus {
    const p = resolveClaude(this.opts.enginePaths?.claude ?? null)?.path ?? null;
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
    r.jobAt = Date.now();
    r.jobTitle = r.s.title;
    const fn = this.opts.estimateFor;
    if (!fn) return;
    this.hook('estimateFor', () => {
      const e = fn({ harness: r.s.harness, model: r.choice.model, effort: r.choice.effort, prompt, title: r.s.title });
      if (!e) return;
      r.kind = e.kind;
      r.s.estimate = e.estimate ? { ...e.estimate, basis: e.basis.count } : null;
      this.updated(r);
    });
  }

  /** Starts the chat's engine if it is not running (a resumed Cursor chat: waits until its replayed past has landed). */
  private async ensureSession(r: Rec): Promise<void> {
    if (r.releasing) await r.releasing; // never into an engine released for idleness: it ends, then this resumes
    if (!r.session) {
      this.needOn(r.s.harness);
      this.startSession(r);
      // a resumed chat on an engine that replays its past while it opens (ACP): let it land before this message, in order
      const started = r.session as HarnessSession | null;
      if (started?.ready && engineOf(r.s.harness)?.caps.transcript === false && isUuid(r.s.sessionId)) r.opening = started.ready;
    }
    if (r.opening) { await r.opening; r.opening = undefined; }
  }

  /** One hand-off turn: the request goes to the chat (shown as a short line, not as the user's message) and the
   *  answer's text between the markers comes back; null when the chat ended, timed out or answered off format. */
  private async askHandoff(r: Rec, reason: NonNullable<HandoffOptions['reason']>, quiet = false): Promise<string | null> {
    await this.ensureSession(r);
    const sess = r.session;
    if (!sess) return null;
    // a cold note never runs a tool (no now.md line): one short answer on a warm cache
    const text = handoffRequest({ title: r.s.title, reason, contextTokens: r.s.contextTokens ?? null, memTool: quiet ? null : this.opts.memTool?.() ?? null });
    const out = await this.quietTurn(r, sess, text, quiet, () => {
      if (quiet) return;
      r.s.handoffBusy = true;
      this.addItem(r, { kind: 'system', id: nextId('s'), at: Date.now(), level: 'info', text: 'Chiedo alla chat il passaggio di consegne (un turno breve).' }, false);
      this.updated(r);
    });
    return out === null ? null : extractHandoff(out);
  }

  /** One turn of the app's own (a hand-off, a Regia's day compaction), not of the job: its assistant texts come back
   *  joined, null when it was stopped, failed or timed out (then interrupted, its late items still swallowed); `quiet` =
   *  its items stay out of the tile but the system lines. `before` runs once the turn is armed, before the text goes. */
  private quietTurn(r: Rec, sess: HarnessSession, text: string, quiet: boolean, before?: () => void): Promise<string | null> {
    const answer = new Promise<string | null>(resolve => {
      // no answer in time (e.g. a permission nobody answers): the turn is stopped, so a late answer is never taken as a real turn
      const timer = setTimeout(() => {
        finish(null);
        // the stopped turn's last items still belong to the hand-off (markers hidden, not a job turn), then it is over
        // (never for long: a failed interrupt or a CLI that never answers must not block the chat's next turns)
        const drain = (): void => { clearTimeout(expire); if (r.handoffTurn?.done === drain) r.handoffTurn = undefined; };
        const expire = setTimeout(drain, 30_000);
        expire.unref();
        r.handoffTurn = { texts: new Map(), done: drain, ...(quiet ? { quiet } : {}) };
        sess.interrupt().catch(e => { drain(); log.debug('chats', 'hand-off turn not interrupted', { chat: r.s.id, data: errText(e) }); });
      }, this.opts.handoffTimeoutMs ?? 300_000);
      timer.unref();
      const finish = (t: string | null): void => {
        clearTimeout(timer);
        if (r.handoffTurn?.done !== finish) return;
        r.handoffTurn = undefined;
        delete r.s.handoffBusy;
        this.updated(r);
        resolve(t);
      };
      r.handoffTurn = { texts: new Map(), done: finish, ...(quiet ? { quiet } : {}) };
    });
    before?.();
    try { sess.send(text); } catch (e) { r.handoffTurn?.done(null); return Promise.reject(e); }
    return answer;
  }

  /** A result arrived: the job ledger gets the turn; the plan windows are refreshed now and then. */
  private turnEnded(r: Rec, item: Extract<ChatItem, { kind: 'result' }>): void {
    const handoffTurn = r.handoffTurn;
    if (handoffTurn) {
      // stopped or failed (max tokens, cancelled): a cut answer is not a hand-off; the app writes its own note
      // a hand-off cut by a network error is given up too: Cursor's automatic "continua" would write it as a job turn
      const cut = item.isError || !!item.interrupted;
      if (cut) { r.handoffStopped = true; r.session?.noRetry?.(); }
      handoffTurn.done(cut ? null : [...handoffTurn.texts.values()].join('\n\n'));
      return; // not a turn of the job: no ledger entry, no estimate calibration
    }
    r.turnSinceDone = true; r.lastTurnAt = item.at;
    r.ctxSince ??= item.at;
    r.s.lastResult = { at: item.at, isError: item.isError, ...(item.interrupted ? { interrupted: true } : {}) };
    const first = r.firstPrompt;
    r.firstPrompt = null;
    const on = this.opts.onTurnEnd;
    if (on) {
      const info: TurnEndInfo = {
        chatId: r.s.id, sessionId: r.s.sessionId, harness: r.s.harness, model: r.s.model, effort: r.s.effort,
        ...(r.kind ? { kind: r.kind } : {}), ...(first ? { firstPrompt: first, ...(r.jobAt ? { jobAt: r.jobAt } : {}), ...(r.jobTitle !== undefined ? { jobTitle: r.jobTitle } : {}) } : {}),
        costUsd: item.costUsd, durationMs: item.durationMs, turns: item.turns, isError: item.isError,
      };
      this.hook('onTurnEnd', () => on(info));
    }
    this.askUsage(r);
  }

  /** Asks a live Claude session for get_usage, at most once per usageEveryMs: the plan windows for the top bar and, in
   *  a running turn, its real cost so far (claude.ts). Busy chats take turns, so each one's live cost gets corrected. */
  private askUsage(prefer?: Rec): void {
    const rate = this.opts.onRateLimit;
    if (!rate || Date.now() - this.lastUsageAt < (this.opts.usageEveryMs ?? 60000)) return;
    const live = (x: Rec | undefined): x is Rec => !!x?.session?.alive && !!engineOf(x.s.harness)?.caps.usage;
    const all = [...this.chats.values()].filter(live);
    const busy = all.filter(x => x.session?.busy);
    const next = busy.length ? busy[(busy.findIndex(x => x.s.id === this.lastUsageChat) + 1) % busy.length] : undefined;
    const r = live(prefer) ? prefer : next ?? all[0];
    if (!r?.session) return;
    this.lastUsageAt = Date.now();
    this.lastUsageChat = r.s.id;
    r.session.usage().then(u => { if (u) this.hook('onRateLimit', () => rate(u)); })
      .catch(e => log.debug('chats', 'get_usage not answered', { chat: r.s.id, data: errText(e) }));
  }

  /** The Regia role moves elsewhere: the chat stays as a normal one. Its live process keeps the app-control tools it
   *  was started with, so it is closed now (idle) or after this turn: the next message resumes it without them. */
  private demoteRegia(r: Rec, to: string, endSession = true): void {
    r.s.isRegia = false;
    delete r.s.regiaName;
    delete r.s.regiaSince;
    delete r.s.appRegia;
    // its work chats answer to the Regia that takes over
    for (const c of this.chats.values()) if (c.s.regiaOf === r.s.id) { c.s.regiaOf = to; this.updated(c); }
    this.persist();
    const sess = endSession ? r.session : null;
    if (sess && !sess.busy && r.pending.size === 0) void this.closeKeeping(r, sess);
    else if (sess) r.reopen = true;
    log.info('chats', 'regia role moved away', { chat: r.s.id });
    this.updated(r);
  }

  private unarchive(r: Rec): void {
    // an engine the auto-close kept for its cold note is live again: idle release and the cold timer see it
    if (r.closeAfterCold && r.session?.alive && r.s.state === 'closed') r.s.state = r.session.busy ? 'running' : 'idle';
    r.closeAfterCold = false;
    delete r.s.closedAt;
    delete r.s.closedBy;
    this.persist();
    log.info('chats', 'chat reopened', { chat: r.s.id });
    this.updated(r);
  }

  /** Only the newest MAX_ARCHIVED archived chats stay in the app. */
  private pruneArchived(): void {
    const old = [...this.chats.values()].filter(r => r.s.closedAt).sort((a, b) => (b.s.closedAt ?? 0) - (a.s.closedAt ?? 0)).slice(MAX_ARCHIVED);
    for (const r of old) {
      this.chats.delete(r.s.id);
      this.opts.emitter.emit('chat:removed', { chatId: r.s.id });
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
        permissionMode: c.permissionMode, state: 'closed', costUsd: 0, pending: 0, isRegia: c.isRegia, lastText: '', updatedAt: c.closedAt ?? c.createdAt, browserTabIds: [],
        ...(c.regiaName ? { regiaName: c.regiaName } : {}), ...(c.regiaOf ? { regiaOf: c.regiaOf } : {}),
        ...(c.regiaSince !== undefined ? { regiaSince: c.regiaSince } : {}),
        ...(engineOf(c.harness)?.caps.cost ? {} : { costKnown: false as const }),
        ...(c.context ? { contextTokens: c.context.tokens, ...(c.context.max ? { contextMaxTokens: c.context.max } : {}), ...(c.context.estimated ? { contextEstimated: true } : {}) } : {}),
        ...(c.handoffAt ? { handoffAt: c.handoffAt, handoffSource: c.handoffSource ?? 'chat' } : {}),
        ...(c.continuedFrom ? { continuedFrom: c.continuedFrom } : {}), ...(c.continuedBy ? { continuedBy: c.continuedBy } : {}),
        ...(c.closedAt ? { closedAt: c.closedAt, closedBy: c.closedBy ?? 'auto' } : {}),
        ...(c.space ? { space: c.space, ...(c.appRegia ? { appRegia: true } : {}) } : {}),
        ...(c.route ? { route: c.route } : {}),
      },
      createdAt: c.createdAt,
      choice: { model: c.model, effort: c.effort, permissionMode: c.permissionMode },
      ...(c.forkFrom ? { forkFrom: c.forkFrom } : {}),
      worktree: false,
      ...(c.inWorktree ? { inWorktree: true } : {}),
      costTotalUsd: c.costTotalUsd ?? 0,
      working: c.working === true,
      items: [], pending: new Map(), session: null, historyLoaded: false,
      jobNew: false, firstPrompt: null, turnSinceDone: false, // a restored chat continues a job begun in an earlier run
      lastTurnAt: c.lastTurnAt ?? 0,
      ...(c.coldNoteAt ? { coldNoteAt: c.coldNoteAt } : {}),
      // saved before ctxSince existed: its last turn is the latest its context can have begun
      ...(c.ctxSince || c.lastTurnAt ? { ctxSince: c.ctxSince ?? c.lastTurnAt } : {}),
      ...(c.pastSessions?.length ? { pastSessions: c.pastSessions } : {}),
    };
  }

  private persist(): void {
    this.store.save([...this.chats.values()].map(r => ({
      id: r.s.id, harness: r.s.harness, cwd: r.s.cwd, sessionId: r.s.sessionId, ...(r.forkFrom ? { forkFrom: r.forkFrom } : {}),
      title: r.s.title, model: r.choice.model, effort: r.choice.effort, permissionMode: r.choice.permissionMode, isRegia: r.s.isRegia,
      ...(r.s.regiaName ? { regiaName: r.s.regiaName } : {}), ...(r.s.regiaOf ? { regiaOf: r.s.regiaOf } : {}),
      ...(r.s.regiaSince !== undefined ? { regiaSince: r.s.regiaSince } : {}),
      createdAt: r.createdAt, costTotalUsd: r.costTotalUsd, ...(r.inWorktree ? { inWorktree: true } : {}),
      ...(r.lastTurnAt ? { lastTurnAt: r.lastTurnAt } : {}),
      ...(r.coldNoteAt ? { coldNoteAt: r.coldNoteAt } : {}),
      ...(r.ctxSince ? { ctxSince: r.ctxSince } : {}),
      ...(r.pastSessions?.length ? { pastSessions: r.pastSessions } : {}),
      ...(r.s.contextTokens ? { context: { tokens: r.s.contextTokens, ...(r.s.contextMaxTokens ? { max: r.s.contextMaxTokens } : {}), ...(r.s.contextEstimated ? { estimated: true } : {}) } } : {}),
      ...(r.s.handoffAt ? { handoffAt: r.s.handoffAt, handoffSource: r.s.handoffSource ?? 'chat' } : {}),
      ...(r.s.continuedFrom ? { continuedFrom: r.s.continuedFrom } : {}), ...(r.s.continuedBy ? { continuedBy: r.s.continuedBy } : {}),
      ...(r.s.closedAt ? { closedAt: r.s.closedAt, closedBy: r.s.closedBy ?? 'auto' } : {}),
      ...(r.working ? { working: true as const } : {}),
      ...(r.s.space ? { space: r.s.space, ...(r.s.appRegia ? { appRegia: true as const } : {}) } : {}),
      ...(r.s.route ? { route: r.s.route } : {}),
    })));
  }

  private updated(r: Rec): void {
    const now = Date.now();
    r.s.updatedAt = now;
    // work time: starting or running counts; waiting for the user, idle, closed do not
    const working = (r.s.state === 'starting' || r.s.state === 'running') && !r.handoffTurn; // a hand-off turn is no work of the job
    if (working && r.s.workSince === undefined) r.s.workSince = now;
    else if (!working && r.s.workSince !== undefined) {
      r.s.workMs = (r.s.workMs ?? 0) + now - r.s.workSince;
      delete r.s.workSince;
    }
    this.flushItems(r.s.id); // streamed words held for the next step reach the UI before the new state ("finito")
    this.opts.emitter.emit('chat:updated', { ...r.s });
  }

  /** Work time so far (the span in progress included). */
  workMs(chatId: string): number {
    const s = this.chats.get(chatId)?.s;
    return s ? (s.workMs ?? 0) + (s.workSince !== undefined ? Date.now() - s.workSince : 0) : 0;
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

  /** Streaming without flooding IPC: newer versions of the same item within 100 ms collapse into one event (at most
   *  10 flushes a second per chat: the screen shows streamed text in steps, "Lag nell'app" 2026-10-12). A new item
   *  first flushes what is pending, so the order on screen is kept. */
  private emitItem(chatId: string, item: ChatItem, replace: boolean): void {
    if (replace) {
      let b = this.coalesce.get(chatId);
      if (!b) {
        const timer = setTimeout(() => this.flushItems(chatId), 100);
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
    if (!engineOf(r.s.harness)?.caps.transcript) return;
    // the sessions before its cold continuations come first, each closed by its divider (ADR 0031)
    const past: ChatItem[] = [];
    for (const p of r.pastSessions ?? []) {
      const f = findTranscript(p.sessionId, r.s.cwd, this.home);
      try { if (f) past.push(...readHistory(f, { cwd: r.s.cwd, maxItems: this.max }).items); } catch (e) {
        log.warn('chats', 'past session not readable', { chat: r.s.id, data: { file: f, error: errText(e) } });
      }
      past.push(coldDivider(p.sessionId, p.at, p.notePath));
    }
    if (past.length) r.items = [...past, ...r.items].slice(-this.max);
    const sid = r.s.sessionId ?? r.forkFrom;
    if (!sid) return;
    const file = findTranscript(sid, r.s.cwd, this.home);
    if (!file) return;
    try {
      const h = readHistory(file, { cwd: r.s.cwd, maxItems: this.max });
      r.items = [...past, ...h.items, ...r.items.slice(past.length)].slice(-this.max);
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
    const app = this.appMcpFor(this.chats.get(chatId));
    const servers: Record<string, { type: 'http'; url: string }> = {};
    if (url) servers['second-brain'] = { type: 'http', url };
    if (app) servers['second-brain-app'] = { type: 'http', url: app };
    return Object.keys(servers).length ? JSON.stringify({ mcpServers: servers }) : null;
  }

  /** the app-control endpoint of a Regia (work or app), null for any other chat */
  private appMcpFor(r: Rec | undefined): string | null {
    if (!r) return null;
    if (r.s.isRegia) return this.opts.appMcpUrl?.(r.s.id) ?? null;
    if (r.s.appRegia) return this.opts.appMcpUrl?.(r.s.id, 'app') ?? null;
    return null;
  }

  private startSession(r: Rec): void {
    const chatId = r.s.id;
    let sessionId = r.s.sessionId;
    let resume = false, fork = false;
    const engine = engineOrThrow(r.s.harness);
    if (!engine.caps.transcript) resume = isUuid(sessionId); // session/load; a new one gets its id from session/new
    else if (!sessionId && r.forkFrom) { sessionId = r.forkFrom; resume = true; fork = true; }
    else if (isUuid(sessionId) && findTranscript(sessionId, r.s.cwd, this.home)) resume = true;
    else if (!isUuid(sessionId)) { sessionId = crypto.randomUUID(); r.s.sessionId = sessionId; this.persist(); }
    const extraArgs = this.extraArgsFor(r.s.harness, chatId, r);
    const opts: SessionOptions = {
      chatId, cwd: r.s.cwd, model: r.choice.model, effort: r.choice.effort, permissionMode: r.choice.permissionMode, title: r.s.title,
      sessionId, resume, fork, worktree: r.worktree && !resume, mcpConfig: this.mcpConfig(chatId), costBaseUsd: r.costTotalUsd,
      compactWindowTokens: this.compactWindow(),
      ...(this.opts.env ? { env: this.opts.env } : {}), ...(extraArgs ? { extraArgs } : {}),
    };
    r.worktree = false; // created once; a resume re-enters it
    let sess: HarnessSession | null = null;
    const sink = this.sinkFor(r, () => sess);
    r.s.state = 'starting';
    r.activeAt = Date.now();
    delete r.s.lastError;
    sess = this.newSession(engine.id, opts, sink, r);
    r.session = sess;
    this.updated(r);
    sess.start();
  }

  /** pre-allowed on Claude: the Regias' app-control tools (/mcp/app or /mcp/improve), and every chat's mail to other
   *  chats (text only, labelled as not the user's; the auto-mode classifier sometimes refused the same message sent
   *  with Bash, 12/10). r = undefined: a warm engine (warm.ts), never a Regia. */
  private extraArgsFor(harness: Harness, chatId: string, r: Rec | undefined): string[] | null {
    const allowed = !engineOf(harness)?.caps.preAllow ? [] : [
      ...(this.appMcpFor(r) ? ['mcp__second-brain-app'] : []),
      ...(this.opts.mcpUrlFor?.(chatId) ? ['mcp__second-brain__send_to_chat', 'mcp__second-brain__list_chats'] : []),
    ];
    return this.opts.extraArgs || allowed.length ? [...(this.opts.extraArgs ?? []), ...(allowed.length ? ['--allowedTools', allowed.join(',')] : [])] : null;
  }

  /** An agent's message (from = its sender) never wakes a stopped chat (closed, or its engine released for idleness) on
   *  an engine the Regie may not use: it would resume that engine for an agent. A running chat gets it as before. */
  private needAgentMay(r: Rec, from: string | undefined): void {
    if (from === undefined || r.session || this.opts.agentsMayOpen?.(r.s.harness) !== false) return;
    throw new AgentMayNotWake(r.s.harness);
  }

  /** Refuses an engine the user switched off (Impostazioni → Motori): nothing starts on it, whoever asks. */
  private needOn(h: Harness): void {
    if (this.opts.engineOn?.(h) === false) throw new Error(`${engineOrThrow(h).label} è spento nelle impostazioni: riaccendilo in Impostazioni → Motori.`);
  }

  /** A session on an engine: the test factory if given, else the engine's own adapter (engines/sessions.ts). The Regia
   *  on any engine gets the app-control tools (app_create_chat…); r = undefined: a warm engine, never a Regia. */
  private newSession(harness: Harness, opts: SessionOptions, sink: SessionSink, r: Rec | undefined): HarnessSession {
    if (this.opts.sessionFactory) return this.opts.sessionFactory(harness, opts, sink);
    const override = this.opts.enginePaths?.[harness];
    return sessionFor(engineOrThrow(harness), opts, sink, {
      userData: this.opts.userData, mcpUrl: this.opts.mcpUrlFor?.(opts.chatId) ?? null, appMcpUrl: this.appMcpFor(r),
      showReplay: !r?.items.length, acpModelConfig: this.acpModelConfig(), key: () => this.opts.keyFor?.(harness) ?? null,
      ...(override ? { path: override } : {}), ...(this.opts.appVersion ? { appVersion: this.opts.appVersion } : {}),
    });
  }

  /** A Claude engine for the next new chat in cwd: its chat id, session id and MCP endpoint are chosen now; no model,
   *  effort, mode or title (the user's defaults until the chat sends its own as control requests). */
  private spawnWarm(cwd: string): WarmEngine | null {
    const chatId = `c_${crypto.randomBytes(5).toString('hex')}`;
    const sessionId = crypto.randomUUID();
    const extraArgs = this.extraArgsFor('claude', chatId, undefined);
    const opts: SessionOptions = {
      chatId, cwd, model: null, effort: null, permissionMode: null, title: null, sessionId, resume: false, fork: false, worktree: false,
      mcpConfig: this.mcpConfig(chatId), costBaseUsd: 0, compactWindowTokens: this.compactWindow(),
      ...(this.opts.env ? { env: this.opts.env } : {}), ...(extraArgs ? { extraArgs } : {}),
    };
    const sink = new BufferedSink();
    const session = this.newSession('claude', opts, sink, undefined);
    session.start();
    return { chatId, sessionId, cwd, session, sink, at: Date.now() };
  }

  /** The new chat r takes the waiting engine: what it reported so far is replayed into the chat, then the chat's own
   *  choices go as control requests; a send waits for them (r.opening). A refused choice → a fresh engine with flags. */
  private adoptWarm(r: Rec, w: WarmEngine): void {
    const sess = w.session;
    r.session = sess;
    r.s.state = 'starting';
    r.activeAt = Date.now();
    delete r.s.lastError;
    w.sink.attach(this.sinkFor(r, () => sess));
    this.updated(r);
    const c = r.choice;
    const title = r.s.title !== 'Nuova chat' ? r.s.title : null;
    log.info('chats', 'warm engine adopted', { chat: r.s.id, data: { waitedMs: Date.now() - w.at, state: sess.state, model: c.model, effort: c.effort, permissionMode: c.permissionMode } });
    r.opening = (async () => {
      try {
        // a warm engine still starting: its start-up must not eat the controls' own timeout
        await sess.ready;
        if (c.model) await sess.setModel(c.model);
        if (c.effort) await sess.setEffort(c.effort);
        if (c.permissionMode) await sess.setPermissionMode(c.permissionMode);
      } catch (e) {
        log.warn('chats', 'warm engine refused the chat choices: starting a fresh one', { chat: r.s.id, data: errText(e) });
        if (r.session === sess) {
          r.session = null;
          void sess.close(1000);
          r.s.sessionId = crypto.randomUUID(); // never two engines on one session id
          this.startSession(r);
        }
        return;
      }
      // the name the CLI keeps for /resume (a cold start passes --name); never blocks the first message
      if (title) sess.rename(title).catch(e => log.warn('chats', 'warm engine rename failed', { chat: r.s.id, data: errText(e) }));
    })();
  }

  /** The chat's side of a session: every report lands in r while current() is r's session. */
  private sinkFor(r: Rec, current: () => HarnessSession | null): SessionSink {
    const chatId = r.s.id;
    const live = (): boolean => { const sess = current(); return !!sess && r.session === sess && this.chats.get(chatId) === r; };
    return {
      item: (item, replace) => {
        if (!live()) return;
        if (r.handoffTurn && item.kind === 'assistant') {
          r.handoffTurn.texts.set(item.id, item.text);
          // the markers are for the app: the transcript shows the note without them
          item = { ...item, text: item.text.split('\n').filter(l => l.trim() !== HANDOFF_START && l.trim() !== HANDOFF_END).join('\n') };
        }
        // a cold note's turn stays out of the tile (ADR 0031): only its result settles the turn
        if (r.handoffTurn?.quiet && item.kind !== 'system') { if (item.kind === 'result' && !replace) this.turnEnded(r, item); return; }
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
      commands: list => { if (live()) r.commands = list; },
      models: list => { const on = this.opts.onModels; if (live() && on) this.hook('onModels', () => on(r.s.harness, list)); },
      resolved: id => { if (this.chats.get(chatId) === r) this.dropPending(r, id); },
      changed: p => { if (live()) this.applyPatch(r, p); },
      exit: ({ error }) => {
        const sess = current();
        if (!sess || this.chats.get(chatId) !== r || r.session !== sess) return;
        r.session = null;
        // gone mid-turn (crash, close, kill): no result will settle the estimate, which stays as spent (no "≈")
        delete r.s.costLiveUsd;
        r.handoffTurn?.done(null);
        delete r.s.background; // its background tasks died with it
        // died mid-turn with an error while the app runs: no result will come, so no onDone either; tell the brain now
        const crashed = !!error && r.working && !this.quitting;
        if (!this.quitting) r.working = false; // a crash while the app runs shows as an error, it is not resumed later
        if (error) r.s.lastError = error;
        if (error) delete r.s.resumedAt; // a resume that failed is no "ripresa": the error shows alone
        if (r.s.state !== 'error') r.s.state = error ? 'error' : r.releasing ? 'idle' : 'closed';
        this.persist();
        this.updated(r);
        const onCrash = this.opts.onCrash;
        if (crashed && error && onCrash) this.hook('onCrash', () => onCrash(chatId, error));
      },
    };
  }

  /** the compaction window for the next Claude engine (setting compactWindowTokens; 0 = the user's settings) */
  private compactWindow(): number {
    try { return this.opts.compactWindowTokens?.() ?? 0; } catch { return 0; }
  }

  private acpModelConfig(): { reasoning: CursorReasoning | ''; fast: boolean } | null {
    try { return this.opts.acpModelConfig?.() ?? null; } catch (e) { log.warn('chats', 'ACP model settings not read', { data: errText(e) }); return null; }
  }

  private applyPatch(r: Rec, p: SessionPatch): void {
    let save = false;
    if (p.state) {
      const was = r.s.state;
      // a cold note's turn is invisible (ADR 0031): the tile stays as it was
      if (!(r.handoffTurn?.quiet && (p.state === 'running' || p.state === 'starting'))) r.s.state = p.state;
      // a hand-off turn is not the chat's work: never resumed after a restart
      if ((p.state === 'running' || p.state === 'waiting') && !r.working && !r.handoffTurn) { r.working = true; save = true; }
      // idle only once the CLI's queue is empty: a queued turn starts with no state change, so not cleared per result
      if (p.state === 'idle' && r.working) { r.working = false; save = true; }
      // the turn is over and nothing waits for the user: "done" (once per turn, never at boot)
      if (p.state === 'idle' && was !== 'idle' && r.turnSinceDone && r.pending.size === 0) {
        r.turnSinceDone = false;
        const on = this.opts.onDone;
        if (on) this.hook('onDone', () => on(r.s.id));
      }
      // a Cursor model change or a Regia role change asked mid-turn: reopen now that the turn is over
      if (p.state === 'idle' && r.reopen && r.session && !r.session.busy) {
        r.reopen = false;
        void this.closeKeeping(r, r.session);
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
    if (p.turnCostUsd !== undefined || p.liveCostUsd !== undefined) {
      // costUsd = settled turns + the running turn's estimate; a result settles it (its real cost replaces the estimate)
      const live = r.s.costLiveUsd ?? 0;
      const settled = r.s.costUsd - live + (p.turnCostUsd ?? 0);
      const next = p.liveCostUsd ?? (p.turnCostUsd !== undefined ? 0 : live);
      r.s.costUsd = Math.round((settled + next) * 1e6) / 1e6;
      if (next > 0) r.s.costLiveUsd = Math.round(next * 1e6) / 1e6; else delete r.s.costLiveUsd;
    }
    if (p.contextEstimated === true) r.s.contextEstimated = true;
    else if (p.contextEstimated === false) delete r.s.contextEstimated;
    if (p.costKnown === true) delete r.s.costKnown;
    else if (p.costKnown === false && !r.s.costUsd) r.s.costKnown = false;
    if (p.totalCostUsd !== undefined) { r.costTotalUsd = p.totalCostUsd; save = true; }
    if (p.lastText !== undefined) r.s.lastText = p.lastText;
    if (p.background !== undefined) { if (p.background > 0) r.s.background = p.background; else delete r.s.background; }
    if (p.version) this.version = p.version;
    if (p.call) {
      const a = r.after;
      if (a) { a.left--; if (a.left <= 0) r.after = undefined; }
      this.counters.call(r.s.id, p.call, a ? a.kind : null);
    }
    if (p.compacted) {
      this.counters.compaction(r.s.id, p.compacted.pre, p.compacted.post);
      r.after = { kind: 'compaction', left: AFTER_CALLS };
      // the context starts again from its summary: a Regia's next day compaction counts from now
      r.ctxSince = Date.now(); save = true;
    }
    if (p.contextTokens !== undefined && p.contextTokens > 0) save = true; // the meter of a closed chat survives a restart
    if (save) this.persist();
    this.updated(r);
  }
}
