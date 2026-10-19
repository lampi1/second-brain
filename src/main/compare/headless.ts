// One prompt run on an engine as a hidden, read-only session: the comparison's side b (ADR 0046 §4). Why: the owner,
// 14/10, wants both sides of a comparison to run inside the app, on any engine he turned on, with the app's own logins
// and keys, so the brain's scripts never get a key. A run has no chat record, never reaches the UI (no emitter, no
// item store) and gets no MCP endpoint; it starts only on an engine that is on and trusted (engines/policy.ts engineOn)
// and goes through the one session factory (engines/sessions.ts sessionFor) with SessionOptions.readOnly, so each
// adapter adds its own read-only means (Claude: plan mode, only the read tools, deny rules, no MCP, no hooks, no
// transcript; ACP: the engine's read-only mode, no allow rules). On top of that this module answers every permission
// itself: only reading, searching and thinking are allowed (never inside a denied folder: the brain's
// reviews/compare and the folders the brain lists for a run, where the other side's answers and the verdicts live;
// the adapters also get them as deny rules), everything else (edit, delete, move, shell, web, MCP,
// ExitPlanMode) is refused, and every question gets a refusal. A run ends at its first finished turn, or after 45 min
// (killed); its session is always closed and its process tree killed. Logs carry the engine, round, duration and
// cost, never the prompt nor the answer. Under tests only the fakes start (SB_<ID>_PATH to a .mjs). Used by
// compare/queue.ts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Answer, ChatItem, Effort, Harness, ModelRegistry, PendingRequest, Settings } from '../../shared/contract';
import { KIND_NAME } from '../chats/acp';
import { READ_ONLY_TOOLS } from '../chats/claude';
import type { HarnessSession, SessionPatch, SessionSink, TokenUsage } from '../chats/session';
import { modelRow, isFable } from '../brain/routing';
import { agentsMayOpen, engineOn } from '../engines/policy';
import { engineOf, type EngineDef } from '../engines/registry';
import { readOnlyConfigDir, sessionFor } from '../engines/sessions';
import { errText, log, redact } from '../log';

/** One run asked by the brain's queue (harness/compare/app-queue.mjs `list`). */
export interface HeadlessRequest {
  engine: Harness;
  prompt: string;
  /** the folder the run reads (an existing absolute path) */
  cwd: string;
  model: string | null;
  effort: string | null;
  /** the comparison round, for the logs */
  round: string;
  /** absolute folders this run may never read (the brain's list: the other side's output), on top of HeadlessDeps.denyRead */
  denyRead?: string[];
  /** Agent one-shot jobs use shorter deadlines and deny every permission, including reads. */
  timeoutMs?: number;
  maxTokens?: number;
  noTools?: boolean;
}

/** What a run gives back: the answer and what it cost, or why it failed (short, never a key). */
export type HeadlessResult =
  | { ok: true; text: string; model: string | null; effort: Effort | null; costUsd: number | null; tokens: TokenUsage | null; turns: number | null; durationMs: number }
  | { ok: false; error: string; durationMs: number; refused?: true };

export interface HeadlessDeps {
  userData: string;
  settings: () => Pick<Settings, 'engineOn' | 'engines'>;
  /** the brain's model registry (Fable is recognized by it; brain/routing.ts modelRow); absent = by name only */
  registry?: () => ModelRegistry | null;
  /** the user's API key for an engine, read only when its session needs it (engines/service.ts keyFor) */
  keyFor: (id: Harness) => string | null;
  /** per engine, its command override (registry.ts enginePathsFromEnv: the tests' fakes) */
  enginePaths: () => Partial<Record<Harness, string>>;
  appVersion?: string;
  /** how long one run may take (default 45 min), then it is killed */
  timeoutMs?: number;
  /** the environment that says whether this is a test run (default process.env) */
  env?: NodeJS.ProcessEnv;
  /** absolute folders no run may ever read, whatever the brain lists (wiring: <brain>/reviews/compare, where the other
   *  side's answers and the verdicts live) */
  denyRead?: () => string[];
}

export const RUN_TIMEOUT_MS = 45 * 60_000;
const CLOSE_WAIT_MS = 15_000;
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** A model id as an engine takes it on its command line: never a flag, no spaces or shell characters. */
const MODEL = /^[A-Za-z0-9][\w.:/[\]=,-]{0,99}$/;

/** What every question gets: nobody is there to answer. */
export const NO_QUESTIONS = 'Nessuno può rispondere: questo è un confronto automatico in sola lettura. Decidi da solo e scrivi la risposta finale come testo.';
/** What every refused tool gets. */
export const READ_ONLY_REFUSAL = 'Sola lettura: in questo confronto puoi solo leggere e cercare nei file. Scrivi la risposta finale come testo con quello che hai trovato.';
/** What Claude's ExitPlanMode gets: the answer is the text, there is no plan to approve. */
export const NO_PLAN = 'Niente piano da approvare: scrivi la risposta finale come testo.';
/** What a read of a network or device path gets (\\host\share, \\?\…). */
export const NO_NETWORK_PATH = 'Percorso di rete non ammesso: in questo confronto leggi solo i file locali con il loro percorso normale.';
/** What a read inside a denied folder gets (the other side's answers and the verdicts). */
export const DENIED_READ = 'Cartella vietata: contiene le risposte dell\'altro lato del confronto e i verdetti. Lavora sugli altri file.';

/** The tools a read-only run may use, per adapter: Claude's read tools, ACP's read / search / think kinds (as acp.ts
 *  names them in a permission panel); an HTTP model has no tools. */
const READ_TOOLS: Record<EngineDef['kind'], ReadonlySet<string>> = {
  claude: new Set(READ_ONLY_TOOLS),
  acp: new Set([KIND_NAME.read, KIND_NAME.search, KIND_NAME.think].filter((x): x is string => !!x)),
  // Codex: its read-only sandbox reads without asking; every request it does send (a command or edit out of the
  // sandbox) is refused (chats/codex.ts also refuses a run with folders it cannot keep it from reading)
  codex: new Set(),
  api: new Set(),
};

/** The answer to a request a hidden run is blocked on: allow only the read-only tools of its adapter, refuse the rest;
 *  a question (AskUserQuestion, cursor/ask_question, cursor/create_plan) always gets a refusal. */
export function readOnlyAnswer(kind: EngineDef['kind'], req: Pick<PendingRequest, 'type' | 'tool'> & Partial<Pick<PendingRequest, 'input' | 'detail'>>, scope?: { cwd: string; deny: readonly string[] }): Answer {
  if (req.type !== 'permission') return { kind: 'permission', allow: false, message: NO_QUESTIONS };
  if (READ_TOOLS[kind].has(req.tool)) {
    if (readsNetwork(req)) return { kind: 'permission', allow: false, message: NO_NETWORK_PATH };
    if (scope && readsDenied(req, scope.cwd, scope.deny)) return { kind: 'permission', allow: false, message: DENIED_READ };
    return { kind: 'permission', allow: true };
  }
  return { kind: 'permission', allow: false, message: req.tool === 'ExitPlanMode' ? NO_PLAN : READ_ONLY_REFUSAL };
}

/** A path as compared against the denied folders: absolute, through its real path (symlinks and junctions resolved,
 *  for the longest part that exists), forward slashes, no trailing slash, lower case on Windows. */
export function pathKey(p: string, cwd = process.cwd()): string {
  const abs = path.resolve(cwd, p.replace(/^file:\/\/\/?/i, ''));
  let real = abs, rest = '';
  for (;;) {
    try { real = path.join(fs.realpathSync.native(real), rest); break; } catch { /* go up */ }
    const up = path.dirname(real);
    if (up === real) { real = abs; break; }
    rest = path.join(path.basename(real), rest);
    real = up;
  }
  const k = real.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? k.toLowerCase() : k;
}

const within = (child: string, parent: string): boolean => child === parent || child.startsWith(`${parent}/`);
/** request input keys that may hold a path, a folder or a glob */
const PATH_KEY = /path|file|dir|folder|cwd|glob|pattern|target|uri|location|root/i;
/** keys that set where a search looks (absent: the run's folder) */
const SCOPE_KEY = /^(path|dir|directory|folder|cwd|root|target_directory|location)$/i;
const SEARCHES = new Set(['Grep', 'Glob', 'LS', KIND_NAME.search]);

function stringsIn(v: unknown, key: string, depth: number, out: { key: string; value: string }[]): void {
  if (depth > 4 || out.length > 200) return;
  if (typeof v === 'string') { if (PATH_KEY.test(key)) out.push({ key, value: v }); return; }
  if (Array.isArray(v)) { for (const x of v) stringsIn(x, key, depth + 1, out); return; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) stringsIn(x, k, depth + 1, out);
}

/** The strings of a request that may be paths: its input's path-like keys, and (ACP) the absolute lines of its detail,
 *  where acp.ts puts the tool call's locations. */
function pathsIn(req: Partial<Pick<PendingRequest, 'input' | 'detail'>>): { key: string; value: string }[] {
  const found: { key: string; value: string }[] = [];
  stringsIn(req.input, '', 0, found);
  for (const raw of (req.detail ?? '').split('\n')) {
    const line = raw.trim();
    if (path.isAbsolute(line) || /^[\\/]{2}/.test(line) || /^file:/i.test(line)) found.push({ key: 'location', value: line });
  }
  return found;
}

/** A path that reaches another machine, or this one through a share or a device namespace: \\host\share,
 *  //host/share, \\?\UNC\…, \\?\C:\…, \\.\…, file://host/…. Such a path dodges the folder checks (\\localhost\C$\
 *  is C:\), so a hidden run never reads one. */
export function isNetworkPath(p: string): boolean {
  const v = p.trim();
  return /^[\\/]{2}/.test(v) || /^file:[\\/]{2}(?![\\/])/i.test(v) || /^file:[\\/]{4}/i.test(v);
}

/** Whether a read / search request names a network or device path (isNetworkPath) anywhere it may hold a path. */
export function readsNetwork(req: Partial<Pick<PendingRequest, 'input' | 'detail'>>): boolean {
  return pathsIn(req).some(f => isNetworkPath(f.value));
}

/** Whether a read / search request reaches a denied folder: a path in its input (or, for ACP, a location in its detail)
 *  inside one, a glob whose fixed part leads into one, or a search whose scope (its folder, else the run's folder)
 *  contains one. Errs on refusing. */
export function readsDenied(req: Partial<Pick<PendingRequest, 'tool' | 'input' | 'detail'>>, cwd: string, deny: readonly string[]): boolean {
  if (!deny.length) return false;
  const keys = deny.map(d => pathKey(d));
  const found = pathsIn(req);
  for (const { value } of found) {
    if (!value.trim()) continue;
    const wild = value.search(/[*?[{]/);
    const fixed = wild >= 0 ? value.slice(0, wild) : value;
    const k = pathKey(fixed || '.', cwd);
    if (keys.some(d => within(k, d))) return true;
    // a glob's fixed part that is a prefix of a denied folder ("reviews/comp*", "reviews/**") may match into it
    if (wild >= 0 && keys.some(d => d.startsWith(k))) return true;
  }
  if (SEARCHES.has(req.tool ?? '')) {
    const scopes = found.filter(f => SCOPE_KEY.test(f.key) || f.key === 'location').map(f => pathKey(f.value, cwd));
    for (const s of scopes.length ? scopes : [pathKey(cwd)]) if (keys.some(d => within(d, s))) return true;
  }
  return false;
}

/** The model as asked, or why it cannot be passed. null = the engine's default. */
export function checkModel(model: string | null): { model: string | null } | { error: string } {
  if (model === null || model === '') return { model: null };
  return MODEL.test(model) ? { model } : { error: `modello non valido: ${model.slice(0, 40)}` };
}

/** The effort a run uses: the asked one when the engine takes an effort (caps.effort), else none. */
export function effortFor(engine: Pick<EngineDef, 'caps'>, effort: string | null): Effort | null {
  return engine.caps.effort && EFFORTS.includes(effort as Effort) ? (effort as Effort) : null;
}

/** Why a run may not start now (null = it may): an unknown engine, one the user did not turn on (or whose definition
 *  changed since), one the agents may not use («Gli Orchestrator possono usare X» off: the run is asked by the brain's files,
 *  which agents write), and under tests anything but a fake (a .mjs override; an HTTP engine only on this machine). */
export function refusal(id: Harness, settings: Pick<Settings, 'engineOn' | 'engines'>, override: string | undefined, env: NodeJS.ProcessEnv): string | null {
  const engine = engineOf(id);
  if (!engine) return `motore sconosciuto: ${id}`;
  if (!engineOn(settings, id)) return `${engine.label} è spento nelle impostazioni (o la sua definizione è cambiata): l'app non lo avvia`;
  if (!agentsMayOpen(settings, id)) return `gli Orchestrator non possono usare ${engine.label} (impostazione «Gli Orchestrator possono usare ${engine.label}»): il confronto non lo avvia`;
  if (!(env.SB_TEST || env.VITEST)) return null;
  if (engine.kind === 'api') return /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(engine.baseUrl ?? '') ? null : `nei test ${engine.label} parte solo verso questo computer`;
  return override && /\.mjs$/i.test(override) ? null : `nei test il motore ${engine.label} reale non parte mai: serve il fake (SB_${id.toUpperCase().replace(/-/g, '_')}_PATH)`;
}

/** Why the asked model or effort may not run (null = they may), as for the routing table (brain/routing.ts): never
 *  Fable (it costs too much: the user, 2026-10-14), never effort max (only when the user asks for it). */
export function askRefusal(model: string | null, effort: string | null, reg: ModelRegistry | null): string | null {
  if (model && (/fable/i.test(model) || isFable(modelRow(model, reg)))) return `modello non ammesso nel confronto: ${model.slice(0, 40)} (Fable costa troppo)`;
  if (effort === 'max') return "sforzo max non ammesso nel confronto (solo quando lo chiede l'utente)";
  return null;
}

/** Collects what a session reports into the run's outcome. done = a turn finished and the session went idle (an ACP
 *  engine's automatic retry after a network error keeps it running, so its first failed turn does not end the run). */
export class RunCollector {
  /** assistant messages by id, in the order they first came (a replace keeps its place) */
  private texts = new Map<string, string>();
  private errorText = '';
  private resultSeen = false;
  private lastResultError = false;
  private costKnown = true;
  private cost = 0;
  private results = 0;
  private turnCount = 0;
  model: string | null = null;
  /** the run's tokens, summed over its turns; null when no turn reported any (never a context size or an estimate) */
  tokens: TokenUsage | null = null;

  item(item: ChatItem): void {
    if (item.kind === 'assistant') this.texts.set(item.id, item.text);
    else if (item.kind === 'system' && item.level === 'error') this.errorText = item.text;
    else if (item.kind === 'result') {
      this.resultSeen = true;
      this.results += 1;
      this.cost += item.costUsd;
      this.turnCount += item.turns;
      this.lastResultError = item.isError;
    }
  }

  /** true when this patch ends the run */
  changed(p: SessionPatch): boolean {
    if (p.model) this.model = p.model;
    if (p.costKnown === false) this.costKnown = false;
    if (p.turnTokens) {
      const t = this.tokens ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
      this.tokens = { input: t.input + p.turnTokens.input, cacheRead: t.cacheRead + p.turnTokens.cacheRead, cacheWrite: t.cacheWrite + p.turnTokens.cacheWrite, output: t.output + p.turnTokens.output };
    }
    if (p.state === 'running') this.resultSeen = false;
    return p.state === 'idle' && this.resultSeen;
  }

  /** The run's outcome once done: the last answer the model wrote, or why there is none. */
  outcome(): { ok: true; text: string; costUsd: number | null; turns: number | null } | { ok: false; error: string } {
    if (this.lastResultError) return { ok: false, error: this.errorText || 'il turno è finito con un errore' };
    // the answer is the last assistant message that says something (the text after the last tool call)
    const text = [...this.texts.values()].reverse().find(t => t.trim())?.trim() ?? '';
    if (!text) return { ok: false, error: 'nessuna risposta testuale dal modello' };
    return { ok: true, text, costUsd: this.results && this.costKnown ? Math.round(this.cost * 1e6) / 1e6 : null, turns: this.results ? this.turnCount : null };
  }
}

/** A short, safe error for the brain and the logs: one line, no key (log.ts redact), at most 300 characters. */
export const shortError = (s: string): string => {
  const one = redact(s).replace(/\s+/g, ' ').trim();
  return one.length > 300 ? `${one.slice(0, 299)}…` : one;
};

/** Runs hidden read-only prompts; keeps the sessions it started so a quit can kill them. */
export class HeadlessRunner {
  private readonly live = new Set<HarnessSession>();
  private stopped = false;

  constructor(private readonly d: HeadlessDeps) {}

  /** sessions running now */
  get running(): number { return this.live.size; }

  /** Why this run may not start on this machine now (null = it may): the engine (refusal), the model and the effort.
   *  Asked before the brain is told the run is taken (compare/queue.ts): a refused run stays queued, untouched. */
  refuses(req: Pick<HeadlessRequest, 'engine' | 'model' | 'effort'>): string | null {
    const why = refusal(req.engine, this.d.settings(), this.d.enginePaths()[req.engine], this.d.env ?? process.env);
    if (why) return why;
    const m = checkModel(req.model);
    if ('error' in m) return m.error;
    return askRefusal(req.model, req.effort, this.d.registry?.() ?? null);
  }

  async run(req: HeadlessRequest): Promise<HeadlessResult> {
    const t0 = Date.now();
    const fail = (error: string): Extract<HeadlessResult, { ok: false }> => ({ ok: false, error: shortError(error), durationMs: Date.now() - t0 });
    if (this.stopped) return { ...fail("l'app si sta chiudendo"), refused: true };
    const why = this.refuses(req);
    if (why) return { ...fail(why), refused: true };
    const engine = engineOf(req.engine)!;
    const override = this.d.enginePaths()[req.engine];
    const m = checkModel(req.model) as { model: string | null };
    if (isNetworkPath(req.cwd)) return fail(`cartella di rete non ammessa: ${req.cwd}`);
    if (!path.isAbsolute(req.cwd) || !isDir(req.cwd)) return fail(`cartella non trovata: ${req.cwd}`);
    const deny = denyList([...(this.d.denyRead?.() ?? []), ...(req.denyRead ?? [])]);
    const cwdKey = pathKey(req.cwd);
    if (deny.some(d => within(cwdKey, pathKey(d)))) return fail(`cartella vietata per questo confronto: ${req.cwd}`);
    const effort = effortFor(engine, req.effort);
    const chatId = `cmp_${crypto.randomBytes(5).toString('hex')}`;
    const where = { engine: engine.id, round: req.round, chat: chatId };
    log.info('compare', 'headless run start', { chat: chatId, data: { engine: engine.id, round: req.round, model: m.model, effort } });

    const c = new RunCollector();
    let session: HarnessSession | null = null;
    let settle!: (r: { error: string | null }) => void;
    const ended = new Promise<{ error: string | null }>(r => { settle = r; });
    const sink: SessionSink = {
      item: item => c.item(item),
      changed: p => { if (c.changed(p)) settle({ error: null }); },
      pending: req2 => {
        const answer: Answer = req.noTools
          ? { kind: 'permission', allow: false, message: 'Questo job usa solo il digest ricevuto. Nessuno strumento è consentito.' }
          : readOnlyAnswer(engine.kind, req2, { cwd: req.cwd, deny });
        log.info('compare', 'headless permission answered', { chat: chatId, data: { engine: engine.id, type: req2.type, tool: req2.tool, allow: answer.kind === 'permission' && answer.allow } });
        // answered right after the session finished reporting the request
        queueMicrotask(() => {
          try { session?.answer(req2.id, answer); } catch (e) { log.warn('compare', 'headless answer refused by the session', { chat: chatId, data: { ...where, error: errText(e) } }); }
        });
      },
      resolved: () => { /* nothing waits on it */ },
      exit: info => settle({ error: info.error ?? 'il motore si è chiuso prima di finire' }),
    };
    const timeoutMs = req.timeoutMs ?? this.d.timeoutMs ?? RUN_TIMEOUT_MS;
    const timer = setTimeout(() => settle({ error: `tempo scaduto (${Math.round(timeoutMs / 60_000) || '<1'} min): fermato` }), timeoutMs);
    timer.unref?.();
    try {
      session = sessionFor(engine, { chatId, cwd: req.cwd, model: m.model, effort, readOnly: true, denyRead: deny, mcpConfig: null,
        ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
        ...(req.noTools ? { toolPolicy: { allow: [] }, ceiling: 'plan' } : {}),
      }, sink, {
        userData: this.d.userData, mcpUrl: null, appMcpUrl: null, showReplay: false, acpModelConfig: null,
        key: () => this.d.keyFor(engine.id), ...(override ? { path: override } : {}), ...(this.d.appVersion ? { appVersion: this.d.appVersion } : {}),
      });
      this.live.add(session);
      session.start();
      if (session.alive) {
        const ready = await Promise.race([Promise.resolve(session.ready).then(() => true), ended.then(() => false)]);
        if (ready && session.alive) session.send(req.prompt);
      }
      const end = await ended;
      const durationMs = Date.now() - t0;
      const out = end.error ? { ok: false as const, error: end.error } : c.outcome();
      const result: HeadlessResult = out.ok
        ? { ok: true, text: out.text, model: c.model ?? m.model, effort, costUsd: out.costUsd, tokens: c.tokens, turns: out.turns, durationMs }
        : { ok: false, error: shortError(out.error), durationMs };
      log.info('compare', 'headless run end', { chat: chatId, data: { ...where, ok: result.ok, durationMs, costUsd: result.ok ? result.costUsd : null, turns: result.ok ? result.turns : null, error: result.ok ? null : result.error } });
      return result;
    } catch (e) {
      log.warn('compare', 'headless run failed', { chat: chatId, data: { ...where, error: errText(e) } });
      return fail(errText(e));
    } finally {
      clearTimeout(timer);
      if (session) await this.end(session, chatId);
      // an HTTP engine keeps its conversation for a resume: a hidden run has none
      if (engine.kind === 'api') fs.rm(path.join(this.d.userData, 'api-chats', `${chatId}.json`), { force: true }, () => {});
      // a Cursor run's own config copy (engines/sessions.ts): nothing else reads it
      if (engine.cursorExtras) fs.rm(readOnlyConfigDir(this.d.userData, engine.id, chatId), { recursive: true, force: true }, () => {});
    }
  }

  /** Closes a session: the tree killed at once (a run has nothing to finish), then its exit awaited for a while. */
  private async end(s: HarnessSession, chatId: string): Promise<void> {
    try {
      if (s.alive) s.killNow();
      await Promise.race([s.close(0), new Promise<void>(r => setTimeout(r, CLOSE_WAIT_MS).unref?.())]);
    } catch (e) { log.warn('compare', 'headless session close failed', { chat: chatId, data: { error: errText(e) } }); }
    finally { this.live.delete(s); }
  }

  /** App quit: no new run starts, every running one is killed now (process trees). */
  killAll(): void {
    this.stopped = true;
    for (const s of this.live) { try { s.killNow(); } catch { /* gone */ } }
  }
}

/** The denied folders as the engines' rules take them: absolute ones only, each also through its real path when that
 *  differs (a junction or symlink), no duplicates. */
export function denyList(dirs: readonly string[]): string[] {
  const out = new Set<string>();
  for (const d of dirs) {
    if (typeof d !== 'string' || !path.isAbsolute(d)) continue;
    // a network folder is left out: never resolved over the network (a share could keep the app waiting), and every
    // read of a network path is refused anyway (isNetworkPath)
    if (isNetworkPath(d)) continue;
    out.add(path.resolve(d));
    try { out.add(fs.realpathSync.native(d)); } catch { /* not there yet: its own path */ }
  }
  return [...out];
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
