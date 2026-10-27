// One chat run by the app through the Codex CLI the user installed (ADR 0060): `codex app-server`, one long-lived
// process per chat, JSON-RPC over stdio (one JSON per line; written by hand like acp.ts, no dependency). Each chat
// spends only Codex's own login or the API key the user saved for it (CODEX_API_KEY in this process's env only, ADR
// 0046). Shapes checked on 16/10 against the generated TypeScript schema of the protocol
// (github.com/openai/codex, codex-rs/app-server-protocol/schema/typescript, v2) and the docs page (app-server); never
// against a running CLI (no agent may run it): everything marked UNVERIFIED below is to check on the owner's first real
// run (the replay fixture under test/fixtures/cli/codex is synthesized from the schema, not recorded).
//   → initialize {clientInfo, capabilities} → {userAgent, codexHome, platformFamily, platformOs}; then `initialized`
//   → account/read {} → {account, requiresOpenaiAuth}: no account = "Accedi a Codex" before any turn (the app
//     never logs in for the user: no account/login/start, ADR 0060)
//   → model/list {} → {data:[{id, model, displayName, hidden}]}: the Settings page's model list (best effort)
//   → skills/extraRoots/set {extraRoots}: the brain's skill folders for this process only (brain/adapters/codex.ts;
//     UNVERIFIED: may need the experimental API; a refusal is logged, never fatal)
//   → thread/start {cwd, model, approvalPolicy, sandbox, developerInstructions} | thread/resume {threadId, …} (a chat
//     restored after a restart shows the turns the resume returns, when showReplay)
//   → turn/start {threadId, input:[text | localImage], model, effort} → {turn}; a message while a turn runs goes in
//     with turn/steer {threadId, input, expectedTurnId}; Stop = turn/interrupt {threadId, turnId} (the turn then
//     completes with status "interrupted")
//   ← item/started | item/completed {item}: agentMessage (assistant), reasoning (thinking), commandExecution (Shell),
//     fileChange (Edit, with diffs), mcpToolCall (mcp__server__tool), webSearch, plan, contextCompaction, imageView;
//     deltas: item/agentMessage/delta, item/reasoning/summaryTextDelta | textDelta, item/commandExecution/outputDelta
//   ← turn/started, turn/completed {turn:{id, status, error}}, turn/plan/updated, thread/tokenUsage/updated (context
//     and the turn's tokens; no USD: the engine reports no cost), error {error, willRetry}
//   ← item/commandExecution/requestApproval, item/fileChange/requestApproval → permission panels answered accept /
//     acceptForSession ("sempre", this session only: Codex keeps it in memory, it writes no rule; UNVERIFIED) / decline;
//     Stop answers cancel. item/tool/requestUserInput → a question panel. MCP elicitation form with an empty object
//     schema → a one-request permission panel, answered {action, content}; other schemas/modes are explicit errors.
//     serverRequest/resolved withdraws a panel without answering it again.
//     Any other request is refused (-32601) and reported to drift.ts; never auto-approved.
// Login: Codex's own (`codex login`, its CODEX_HOME as it is); the app never reads or copies auth.json. Under tests
// only a .mjs fake may start (cli.ts engineAllowed; test/fixtures/fake-codex-app-server.mjs). Used by manager.ts
// through HarnessSession, built by engines/sessions.ts with the per-launch config of brain/adapters/codex.ts.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Answer, ChatItem, ChatState, Effort, FileDiff, ImageAttachment, PendingRequest, PermissionMode, Question } from '../../shared/contract';
import { errText, log } from '../log';
import { timedStep } from '../perf';
import { shortPath } from './claude-map';
import { CLOSE_GRACE_MS, cliArgv, engineAllowed, killTrees, resolveAcp, type CliCommand } from './cli';
import { drift, record } from './drift';
import { estimateTokens } from './handoff';
import { writeImageFiles } from './images';
import type { CodexExecutionPolicy } from '../brain/adapters/codex-policy';
import { closePipes, engineKills, jobGuard, killEngineTree, lowerEnginePriority } from './jobguard';
import { reapEnabled, reapEngine, type Root } from './proctree';
import { AgentChildrenReporter } from './agent-children';
import { codexChildren } from './codex-children';
import { cut, lastLine, nextId, stripAnsi, tokenUsage, trimInput, type ContextUsage, type HarnessSession, type SessionOptions, type SessionSink, type TokenUsage } from './session';

export type CodexApproval = 'untrusted' | 'on-request' | 'never';
export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface CodexOptions extends SessionOptions {
  /** the engine's id (registry): the session's harness, SB_<ID>_PATH, the logs' `engine` */
  engineId: string;
  /** the engine's short name in every text the user reads ("Codex") */
  label: string;
  /** the CLI's command (PATH or Codex app install via resolveAcp; default 'codex') */
  command?: string;
  /** the subcommand and its flags, after the config overrides (['app-server']) */
  args: string[];
  /** per-launch `-c key=value` overrides, before the subcommand (brain/adapters/codex.ts) */
  configArgs?: string[];
  /** the engine's own login, named in the login help ('codex login'); null = none */
  loginCommand?: string | null;
  /** command override (tests: a .mjs fake); default: the installed CLI */
  pathOverride?: string;
  appVersion?: string;
  /** show the turns thread/resume returns (a chat restored after an app restart has no items yet) */
  showReplay?: boolean;
  /** approval policy and sandbox of the thread (default on-request + workspace-write; a read-only run: read-only) */
  approvalPolicy?: CodexApproval;
  sandbox?: CodexSandbox;
  /** Re-read before each new turn; never answers an existing approval. */
  executionPolicy?: () => CodexExecutionPolicy;
  /** the brain's rules for this thread (brain/adapters/codex.ts; UNVERIFIED how Codex composes it with AGENTS.md) */
  developerInstructions?: string | null;
  /** the brain's skill folders, given to this process with skills/extraRoots/set */
  skillRoots?: string[];
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const NOT_ACTIVE = 'La sessione non è attiva.';
class RpcError extends Error {
  constructor(message: string, readonly code: number) { super(message); }
}
interface Rpc { resolve(v: Obj): void; reject(e: Error): void; method: string; timer: NodeJS.Timeout | null }
type ToolItem = Extract<ChatItem, { kind: 'tool' }>;
type StreamItem = Extract<ChatItem, { kind: 'assistant' | 'thinking' }>;
interface Stream { item: StreamItem; emitted: boolean; dirty: boolean }
interface Ask { rpcId: number | string; method: string; questions?: { id: string; text: string }[]; grantRoot?: string; turnId?: string }

/** The app's effort → Codex's reasoning effort (none | minimal | low | medium | high | xhigh): max has no equal. */
export const codexEffort = (e: Effort | null | undefined): string | null => (!e ? null : e === 'max' ? 'xhigh' : e);

/** The login help: the login command, or the key in Settings. */
export const codexAuthHelp = (label: string, loginCommand: string | null): string => (loginCommand
  ? `Accedi a ${label}: premi “Accedi a ${label}” (apre \`${loginCommand}\` in un terminale), oppure salva la sua chiave API in Impostazioni → Motori, e riprova.`
  : `Accedi a ${label}: salva la sua chiave API in Impostazioni → Motori e riprova.`);

/** The shape a Codex message is recorded under (drift.ts record): `result/<method>` for an answer to one of ours,
 *  `request/<method>` for what Codex asks, `notify/<method>`, with the item type for item/started|completed. */
export function codexKey(m: Obj, answered?: string): string {
  const method = s(m.method);
  if (!method) return `result/${answered ?? '?'}`;
  if (m.id !== undefined) return `request/${method}`;
  if (method === 'item/started' || method === 'item/completed') return `notify/${method}/${s(o(o(m.params).item).type)}`;
  return `notify/${method}`;
}

/** The command line as logs may show it: the MCP urls carry the chat's token, never logged. */
export const redactArgs = (args: readonly string[]): string[] => args.map(a => a.replace(/(\.url=).*/, '$1<url>'));

/** Added and removed lines of a unified diff (headers left out). */
export function diffCounts(diff: string): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const l of diff.split(/\r?\n/)) {
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) added++;
    else if (l.startsWith('-')) removed++;
  }
  return { added, removed };
}

// The vocabulary the app knows (anything else goes to drift.ts): notifications it reads or knowingly ignores, item types.
const QUIET = new Set([
  'thread/started', 'thread/status/changed', 'thread/name/updated', 'thread/archived', 'thread/unarchived', 'thread/settings/updated',
  'thread/environment/connected', 'turn/diff/updated', 'item/reasoning/summaryPartAdded', 'item/fileChange/outputDelta', 'item/plan/delta',
  'item/mcpToolCall/progress', 'account/rateLimits/updated', 'account/updated', 'account/login/completed', 'mcpServer/startupStatus/updated',
  'mcpServer/oauthLogin/completed', 'skills/changed', 'hook/started', 'hook/completed', 'model/rerouted', 'sessionConfigured',
]);
const ITEM_TYPES = new Set([
  'userMessage', 'agentMessage', 'plan', 'reasoning', 'commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall',
  'subAgentActivity', 'webSearch', 'imageView', 'enteredReviewMode', 'exitedReviewMode', 'contextCompaction', 'hookPrompt', 'functionCallOutput',
  'sleep', 'imageGeneration',
]);
const TURN_STATUS = new Set(['completed', 'interrupted', 'failed', 'inProgress']);

export class CodexSession implements HarnessSession {
  private readonly childTelemetry: AgentChildrenReporter;
  readonly harness: string;
  state: ChatState = 'starting';
  sessionId: string | null;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private out = '';
  private errTail = '';
  private rpcSeq = 1;
  private rpcs = new Map<number, Rpc>();
  private asks = new Map<string, Ask>();
  private queue: { text: string; images: readonly ImageAttachment[] }[] = [];
  private open = false;               // thread/start or thread/resume done
  private prompting = false;          // a turn/start sent and its turn/completed not yet in
  private turnId: string | null = null;
  private stopping: { sendNow: boolean } | null = null;
  /** Stop came before the turn's id was known (turn/start not answered yet): turn/interrupt goes out as soon as it is. */
  private interruptOnId = false;
  private turnStart = 0;
  private turnFiles: string[] = [];
  private turnError: string | null = null;  // the last `error` notification of this turn (willRetry false)
  private model: string | null;
  private effort: string | null;
  private streams = new Map<string, Stream>();  // agentMessage / reasoning items by Codex item id
  private flushTimer: NodeJS.Timeout | null = null;
  private tools = new Map<string, ToolItem>();
  private planItemId: string | null = null;
  private context: ContextUsage | null = null;
  private totals: TokenUsage | null = null;        // the thread's running token totals (tokenUsage.total)
  private totalsAtTurnStart: TokenUsage | null = null;
  private chars = 0;
  private closing = false;
  private keepChildren = false;
  private exitedRoot: Root | null = null;
  private spawnedAt = 0;
  private killed = false;
  private exited = false;
  private procExited = false;
  private job: number | null = null;
  private jobKilled = false;
  private badLines = 0;
  private cliVersion: string | null = null;
  private recording = false;
  private exitDone!: () => void;
  private readonly exitPromise = new Promise<void>(r => { this.exitDone = r; });
  private readyDone!: () => void;
  readonly ready = new Promise<void>(r => { this.readyDone = r; });

  constructor(private readonly opts: CodexOptions, private readonly sink: SessionSink, private readonly command?: CliCommand | null) {
    this.childTelemetry = new AgentChildrenReporter(sink);
    this.harness = opts.engineId;
    this.sessionId = opts.resume ? opts.sessionId ?? null : null;
    this.model = opts.model ?? null;
    this.effort = codexEffort(opts.effort);
  }

  private get label(): string { return this.opts.label; }
  private get cliName(): string { return this.opts.command ?? 'codex'; }
  private get loginCommand(): string | null { return this.opts.loginCommand === undefined ? `${this.cliName} login` : this.opts.loginCommand; }
  private get engine(): string { return this.opts.engineId; }

  get pid(): number | null { return this.proc?.pid ?? null; }
  get jobHandle(): number | null { return this.job; }
  get gone(): boolean { return this.procExited || this.jobKilled; }
  get root(): Root | null { return this.exitedRoot; }
  get startedAt(): number { return this.spawnedAt; }
  get alive(): boolean { return !!this.proc && !this.exited; }
  get busy(): boolean { return !this.exited && (this.prompting || this.queue.length > 0 || this.asks.size > 0 || this.state === 'starting'); }

  /** The command line after the CLI: the per-launch overrides, then the subcommand (`codex -c k=v … app-server`). */
  args(): string[] { return [...(this.opts.configArgs ?? []), ...(this.opts.extraArgs ?? []), ...this.opts.args]; }

  private executionPolicy(): { approvalPolicy: CodexApproval; sandbox: CodexSandbox; writableRoots: string[] } {
    if (this.opts.readOnly) return { approvalPolicy: 'on-request', sandbox: 'read-only', writableRoots: [] };
    const policy = this.opts.executionPolicy?.();
    return policy ?? { approvalPolicy: this.opts.approvalPolicy ?? 'on-request', sandbox: this.opts.sandbox ?? 'workspace-write', writableRoots: [] };
  }

  /** SandboxPolicy's tagged object uses camelCase; thread SandboxMode and AskForApproval remain kebab-case. */
  private rpcSandbox(sandbox: CodexSandbox): string { return sandbox === 'read-only' ? 'readOnly' : sandbox === 'workspace-write' ? 'workspaceWrite' : 'dangerFullAccess'; }

  start(): void {
    const chat = this.opts.chatId, label = this.label, engine = this.engine;
    const envName = `SB_${engine.toUpperCase().replace(/-/g, '_')}_PATH`;
    const cmd = this.command ?? resolveAcp(engine, this.cliName, this.opts.pathOverride ?? null);
    if (!cmd) return this.fail(`${label} CLI non trovato: installa la CLI di ${label} (${this.cliName}) e fai login.`, `${engine} CLI not found on PATH`, `install the ${label} CLI (npm i -g @openai/codex), log in (${this.loginCommand ?? 'API key in Settings'}), or set ${envName}`);
    if (!engineAllowed(cmd)) return this.fail(`Nei test il motore ${label} reale non parte mai: serve il fake (${envName}=…/fake-codex-app-server.mjs).`, `refused to start the real ${label} engine under tests (${cmd.display})`, `point ${envName} to test/fixtures/fake-codex-app-server.mjs`);
    // Codex's read-only sandbox reads anywhere without asking: a run that must not read some folders (the comparison's
    // side b, compare/headless.ts) cannot be kept out of them, so it does not start
    if (this.opts.readOnly && this.opts.denyRead?.length) return this.fail(`${label} non può fare un confronto in sola lettura: la sua sandbox legge ogni cartella senza chiedere, e il confronto ne vieta alcune. Usa Claude o Cursor per il lato b.`, `${engine} read-only run with denied folders`, 'pick another engine for side b of the comparison');
    if (!fs.existsSync(this.opts.cwd)) return this.fail(`Cartella non trovata: ${this.opts.cwd}`, `cwd missing: ${this.opts.cwd}`, 'pick an existing folder for the chat');
    this.recording = cmd.kind !== 'fake';
    let argv: ReturnType<typeof cliArgv>;
    try { argv = cliArgv(cmd, this.args()); } catch (e) { return this.fail(`Avvio di ${label} non riuscito: ${errText(e)}`, errText(e), 'use a plain model id and plain MCP urls'); }
    const env: NodeJS.ProcessEnv = { ...argv.env, ...this.opts.env };
    const startedAt = Date.now();
    this.spawnedAt = startedAt;
    try {
      this.proc = spawn(argv.command, argv.args, { cwd: this.opts.cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], windowsVerbatimArguments: argv.verbatim });
    } catch (e) {
      return this.fail(`Avvio di ${label} non riuscito: ${errText(e)}`, errText(e), `check the ${label} CLI install`);
    }
    const p = this.proc;
    lowerEnginePriority(p.pid); // below the app's window: a busy PC slows agents, not the app (jobguard.ts)
    // the key is never logged: only whether one was given
    log.info('chats', 'codex session start', { chat, data: { engine, pid: p.pid, kind: cmd.kind, command: cmd.display, cwd: this.opts.cwd, args: redactArgs(this.args()), key: !!this.opts.env?.CODEX_API_KEY } });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d: string) => timedStep('engine codex output', () => this.onStdout(d)));
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d: string) => { this.errTail = (this.errTail + d).slice(-4000); log.debug('chats', 'codex stderr', { chat, data: { engine, text: cut(d, 500) } }); });
    p.stdin.on('error', e => log.warn('chats', 'codex stdin error', { chat, data: { engine, error: errText(e) } }));
    p.on('error', e => this.fail(`Avvio di ${label} non riuscito: ${errText(e)}`, errText(e), `check that \`${this.cliName} --version\` works in a terminal`));
    p.on('close', (code: number | null) => this.onClose(code));
    p.once('exit', () => {
      this.procExited = true;
      if (!p.pid) return;
      this.exitedRoot = { pid: p.pid, created: startedAt, exited: Date.now(), job: this.job };
      if (!this.keepChildren && reapEnabled()) void reapEngine(this.exitedRoot, { chatId: chat, what: label });
    });
    void jobGuard.add(p.pid, chat).then(job => {
      this.job = job;
      if (this.exitedRoot) { this.exitedRoot.job = job; if (!this.keepChildren) void jobGuard.release(job); }
    });
    void this.boot();
  }

  private async boot(): Promise<void> {
    try {
      const init = await this.request('initialize', {
        clientInfo: { name: 'second_brain', title: 'second-brain', version: this.opts.appVersion ?? '0' },
        capabilities: { experimentalApi: false },
      }, 60000);
      // userAgent "codex_cli_rs/0.47.0 (Windows …) …": its version names drift reports and fixtures
      this.cliVersion = s(init.userAgent).match(/\/(\d+\.\d+\.\d+[\w.+-]*)/)?.[1] ?? this.cliVersion;
      if (this.cliVersion) this.sink.changed({ version: this.cliVersion });
      this.notify('initialized', {});
      log.info('chats', 'codex initialized', { chat: this.opts.chatId, data: { engine: this.engine, version: this.cliVersion, platform: s(init.platformOs) || null } });
      await this.checkLogin();
      void this.listModels();
      await this.giveSkills();
      await this.openThread();
      this.open = true;
      if (this.state === 'starting') this.setState(this.queue.length ? 'running' : 'idle');
      this.drain();
    } catch (e) {
      if (this.exited) return;
      if (e instanceof NotLoggedIn) this.stopWith(codexAuthHelp(this.label, this.loginCommand), `${this.engine} not logged in`, `the user logs in (${this.loginCommand ?? 'API key in Settings → Motori'}), then sends again`);
      else this.stopWith(`${this.label} non è partito: ${errText(e)}`, errText(e), `see the stderr lines in the log; run \`${this.cliName} --version\` in a terminal`);
    } finally { this.readyDone(); }
  }

  /** No account: stop before a turn would fail. An unreadable answer is not a stop (best effort). */
  private async checkLogin(): Promise<void> {
    let r: Obj;
    try { r = await this.request('account/read', {}, 20000); } catch (e) {
      log.info('chats', 'codex account/read not answered: login checked at the first turn', { chat: this.opts.chatId, data: { engine: this.engine, error: errText(e) } });
      return;
    }
    // Login is only the user's own `codex login` (owner, 16/10; ADR 0060): the app never calls account/login/start,
    // a saved key goes only into this process's env as CODEX_API_KEY (ADR 0046). Codex reporting no account = the
    // login help, key or not (UNVERIFIED: whether the app-server reads CODEX_API_KEY from its env at all; its docs
    // say nothing about env keys).
    if (r.account === null && r.requiresOpenaiAuth === true) {
      if (this.opts.env?.CODEX_API_KEY) log.info('chats', 'codex reports no account although a key is in its env: the key is not read by the app-server', { chat: this.opts.chatId, hint: 'run `codex login`', data: { engine: this.engine } });
      throw new NotLoggedIn();
    }
  }

  private async listModels(): Promise<void> {
    try {
      const r = await this.request('model/list', {}, 20000);
      const list = arr(r.data).map(o).filter(m => m.hidden !== true && (s(m.model) || s(m.id))).map(m => ({ id: s(m.model) || s(m.id), name: s(m.displayName) || s(m.model) || s(m.id) }));
      if (list.length) this.sink.models?.(list);
    } catch (e) { log.debug('chats', 'codex model/list not answered', { chat: this.opts.chatId, data: { engine: this.engine, error: errText(e) } }); }
  }

  /** The brain's skill folders for this process (no file written anywhere). */
  private async giveSkills(): Promise<void> {
    const roots = this.opts.skillRoots ?? [];
    if (!roots.length) return;
    try {
      await this.request('skills/extraRoots/set', { extraRoots: roots }, 20000);
      log.info('chats', 'codex: brain skills given', { chat: this.opts.chatId, data: { engine: this.engine, roots: roots.length } });
    } catch (e) {
      log.warn('chats', 'codex refused the brain\'s skill folders', { chat: this.opts.chatId, cause: errText(e), hint: 'skills/extraRoots/set may need the experimental API in this Codex version: the chat runs without the brain\'s skills', data: { engine: this.engine } });
    }
  }

  private threadParams(): Obj {
    const policy = this.executionPolicy();
    return {
      cwd: this.opts.cwd, approvalPolicy: policy.approvalPolicy, sandbox: policy.sandbox,
      ...(this.model ? { model: this.model } : {}),
      ...(this.opts.developerInstructions ? { developerInstructions: this.opts.developerInstructions } : {}),
    };
  }

  private async openThread(): Promise<void> {
    if (this.opts.resume && this.opts.sessionId) {
      try {
        const r = await this.request('thread/resume', { threadId: this.opts.sessionId, ...this.threadParams() }, 120000);
        this.sessionId = this.opts.sessionId;
        this.readThread(r);
        for (const turn of arr(o(r.thread).turns).map(o)) for (const item of arr(turn.items)) this.observeChildren(item, 'replay');
        if (this.opts.showReplay) this.replay(arr(o(r.thread).turns));
        return;
      } catch (e) {
        this.sys(`${this.label} non ha ripreso la conversazione precedente (${cut(errText(e), 120)}): ne apro una nuova.`, 'warn');
      }
    }
    const r = await this.request('thread/start', this.threadParams(), 120000);
    const id = s(o(r.thread).id);
    if (!id) throw new Error('thread/start senza id');
    this.sessionId = id;
    this.sink.changed({ sessionId: id });
    this.readThread(r);
  }

  private readThread(r: Obj): void {
    if ('reasoningEffort' in r) this.sink.changed({ effortSessionDefault: s(r.reasoningEffort) || null });
    const model = s(r.model) || s(o(r.thread).model);
    if (model) { this.model = this.model ?? model; this.sink.changed({ model }); }
    const v = s(o(r.thread).cliVersion);
    if (v && !this.cliVersion) { this.cliVersion = v; this.sink.changed({ version: v }); }
  }

  /** The past a resume returns: the user's messages and the answers (tools left out), only for a chat with no items. */
  private replay(turns: unknown[]): void {
    for (const t of turns.map(o)) {
      for (const it of arr(t.items).map(o)) {
        if (it.type === 'userMessage') {
          const text = arr(it.content).map(o).filter(c => c.type === 'text').map(c => s(c.text)).join('\n');
          if (text) this.sink.item({ kind: 'user', id: nextId('u'), at: Date.now(), text }, false);
        } else if (it.type === 'agentMessage' && s(it.text)) {
          this.chars += s(it.text).length;
          this.sink.item({ kind: 'assistant', id: nextId('a'), at: Date.now(), text: s(it.text), streaming: false }, false);
        }
      }
    }
  }

  send(text: string, images: readonly ImageAttachment[] = []): void {
    if (this.exited || !this.proc) throw new Error(NOT_ACTIVE);
    // a turn is running: the message goes into it (turn/steer), as Claude takes a message mid-turn; refused (the turn
    // just ended) → it waits for the next turn
    if (this.open && this.prompting && this.turnId && !this.stopping && !images.length && this.queue.length === 0) {
      const turnId = this.turnId;
      this.chars += text.length;
      this.request('turn/steer', { threadId: this.sessionId, input: [{ type: 'text', text, text_elements: [] }], expectedTurnId: turnId }, 20000)
        .then(() => log.info('chats', 'codex steer', { chat: this.opts.chatId, data: { engine: this.engine, turnId } }))
        .catch(e => {
          log.info('chats', 'codex steer refused: queued for the next turn', { chat: this.opts.chatId, data: { engine: this.engine, error: errText(e) } });
          if (this.exited) return;
          this.queue.push({ text, images });
          this.drain();
        });
      return;
    }
    this.queue.push({ text, images });
    if (this.state !== 'waiting' && this.state !== 'starting') this.setState('running');
    this.drain();
  }

  private drain(): void {
    if (!this.open || this.prompting || this.exited) return;
    const next = this.queue.shift();
    if (next === undefined) return;
    let input: Obj[];
    try { input = this.inputOf(next.text, next.images); } catch (e) {
      this.sys(`Immagini non inviate a ${this.label}: ${cut(errText(e), 200)}`, 'error');
      input = [{ type: 'text', text: next.text || '(immagini non inviate)', text_elements: [] }];
    }
    this.prompting = true;
    this.turnId = null;
    this.interruptOnId = false;
    this.turnError = null;
    this.turnStart = Date.now();
    this.totalsAtTurnStart = this.totals;
    this.planItemId = null;
    this.chars += next.text.length;
    this.setState(this.asks.size ? 'waiting' : 'running');
    const policy = this.executionPolicy();
    const sandboxPolicy = policy.sandbox === 'workspace-write'
      ? { type: 'workspaceWrite', writableRoots: policy.writableRoots.length ? policy.writableRoots : [this.opts.cwd], networkAccess: false,
        ...(policy.approvalPolicy === 'never' ? { excludeTmpdirEnvVar: true, excludeSlashTmp: true } : {}) }
      : { type: this.rpcSandbox(policy.sandbox) };
    this.sink.changed({ effortSubmitted: this.effort });
    this.request('turn/start', {
      approvalPolicy: policy.approvalPolicy, sandboxPolicy,
      threadId: this.sessionId, input, ...(this.model ? { model: this.model } : {}), ...(this.effort ? { effort: this.effort } : {}),
    }, 60000)
      .then(r => this.gotTurnId(s(o(r.turn).id)))
      .catch(e => this.turnDone('failed', errText(e), null));
  }

  /** Text, and images saved as files for this turn (localImage: Codex reads the file; deleted when the turn ends). */
  private inputOf(text: string, images: readonly ImageAttachment[]): Obj[] {
    const files = images.length ? writeImageFiles(path.join(os.tmpdir(), 'second-brain-images', this.opts.chatId.replace(/[^\w-]/g, '_')), images) : [];
    this.turnFiles = files;
    return [...files.map(f => ({ type: 'localImage', path: f })), ...(text ? [{ type: 'text', text, text_elements: [] }] : [])];
  }

  /** The turn is over (turn/completed, or turn/start refused): result row, tokens, next queued message. */
  private turnDone(status: string, error: string | null, codexError: unknown): void {
    for (const f of this.turnFiles.splice(0)) fs.rm(f, { force: true }, () => {});
    if (this.exited || !this.prompting) return;
    this.flushAll(true);
    // Elicitation can be standalone (turnId null). Only requests correlated to this finished turn expire here.
    for (const [id, ask] of this.asks) if (ask.method === 'mcpServer/elicitation/request' && ask.turnId && ask.turnId === this.turnId) {
      this.asks.delete(id);
      this.sink.resolved(id);
    }
    for (const t of this.tools.values()) if (t.status === 'running') this.sink.item({ ...t, status: 'error', output: t.output ?? 'interrotto' }, true);
    this.tools.clear();
    const stopped = this.stopping;
    this.stopping = null;
    const interrupted = status === 'interrupted' && !!stopped;
    const auth = codexError === 'unauthorized' || /unauthori[sz]ed|401|not logged in|login/i.test(error ?? '');
    if (status === 'failed') this.sys(auth ? codexAuthHelp(this.label, this.loginCommand) : `Errore di ${this.label}: ${cut(stripAnsi(error ?? this.turnError ?? 'turno non riuscito'), 400)}`, 'error');
    else if (interrupted) this.sys(stopped.sendNow ? 'Interrotto da te: riparto col tuo messaggio.' : 'Interrotto da te.', 'info');
    else if (status === 'interrupted') this.sys('Interrotto.', 'info');
    const isError = status === 'failed' || (status === 'interrupted' && !interrupted);
    this.sink.item({ kind: 'result', id: nextId('r'), at: Date.now(), costUsd: 0, durationMs: Date.now() - this.turnStart, turns: 1, isError, ...(interrupted ? { interrupted } : {}) }, false);
    const turnTokens = this.turnTokens();
    this.sink.changed({ turnCostUsd: 0, costKnown: false, liveCostUsd: 0, ...(turnTokens ? { turnTokens } : {}) });
    log.info('chats', 'codex turn done', { chat: this.opts.chatId, data: { engine: this.engine, turnId: this.turnId, status, error: error ? cut(error, 300) : null, codexError: typeof codexError === 'string' ? codexError : codexError ? Object.keys(o(codexError))[0] ?? null : null } });
    this.reportEstimate();
    this.prompting = false;
    this.turnId = null;
    if (this.queue.length) this.drain();
    else this.setState(this.asks.size ? 'waiting' : 'idle');
  }

  /** The turn's tokens: the thread's totals now minus at its start (input = not from the cache). */
  private turnTokens(): TokenUsage | undefined {
    const now = this.totals, was = this.totalsAtTurnStart ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
    if (!now) return undefined;
    return tokenUsage(now.input - was.input, now.cacheRead - was.cacheRead, now.cacheWrite - was.cacheWrite, now.output - was.output);
  }

  answer(requestId: string, answer: Answer): boolean {
    const ask = this.asks.get(requestId);
    if (!ask) return false;
    let result: Obj;
    if (ask.method === 'mcpServer/elicitation/request') {
      if (answer.kind !== 'permission' || typeof answer.allow !== 'boolean') throw new Error('Questa è una conferma MCP: rispondi consenti o rifiuta.');
      if (answer.always) throw new Error('La conferma MCP vale solo per questa richiesta.');
      result = { action: answer.allow ? 'accept' : 'decline', content: answer.allow ? {} : null };
    } else if (ask.method === 'item/tool/requestUserInput') {
      const answers: Obj = {};
      if (answer.kind === 'question') {
        for (const q of ask.questions ?? []) {
          const v = answer.answers[q.text];
          const list = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
          if (list.length) answers[q.id] = { answers: list };
        }
      } else if (answer.allow) throw new Error('Questa è una domanda: rispondi scegliendo le opzioni.');
      result = { answers };
    } else {
      if (answer.kind !== 'permission') throw new Error('Questa è una richiesta di permesso: rispondi consenti o rifiuta.');
      // acceptForSession: Codex remembers it for this session only (no rule written); a rule amendment
      // (acceptWithExecpolicyAmendment) would change the user's Codex rules: never sent
      // a grantRoot approval already grants the whole folder for the session: never widened to acceptForSession
      result = { decision: answer.allow ? (answer.always && !ask.grantRoot ? 'acceptForSession' : 'accept') : 'decline' };
      if (!answer.allow && answer.message?.trim()) log.info('chats', 'codex: the refusal\'s note is not sent (decline has no message)', { chat: this.opts.chatId, data: { engine: this.engine, requestId } });
    }
    this.respond(ask.rpcId, result);
    this.asks.delete(requestId);
    log.info('chats', 'codex request answered', { chat: this.opts.chatId, data: { engine: this.engine, requestId, method: ask.method, decision: result.action ?? result.decision ?? 'answers' } });
    this.sink.resolved(requestId);
    this.setState(this.asks.size ? 'waiting' : this.prompting || this.queue.length ? 'running' : 'idle');
    return true;
  }

  /** Stop: turn/interrupt; open panels answered cancel; queued messages dropped unless keepQueued ("Invia subito"). */
  async interrupt(opts?: { keepQueued?: boolean; byUser?: boolean }): Promise<void> {
    if (this.exited || !this.proc) return;
    log.info('chats', 'codex interrupt', { chat: this.opts.chatId, data: { engine: this.engine, turnId: this.turnId, queued: this.queue.length, open: this.asks.size, keepQueued: !!opts?.keepQueued } });
    if (this.queue.length && !opts?.keepQueued) { this.sys(`Messaggi in coda annullati: ${this.queue.length}.`, 'info'); this.queue = []; }
    if (this.prompting && opts?.byUser) this.stopping = { sendNow: !!opts.keepQueued };
    for (const [id, ask] of [...this.asks]) {
      this.respond(ask.rpcId, ask.method === 'mcpServer/elicitation/request' ? { action: 'cancel', content: null } : ask.method === 'item/tool/requestUserInput' ? { answers: {} } : { decision: 'cancel' });
      this.asks.delete(id);
      this.sink.resolved(id);
    }
    if (this.prompting && this.turnId) await this.sendInterrupt(this.turnId);
    else if (this.prompting) this.interruptOnId = true; // turn/start not answered yet: sent by gotTurnId
    if (!this.prompting) { this.setState(this.queue.length ? 'running' : 'idle'); this.drain(); }
  }

  /** The running turn's id (turn/start's answer or turn/started, whichever comes first); a Stop that came before it
   *  is sent now. */
  private gotTurnId(id: string): void {
    if (!id || !this.prompting || this.turnId) return;
    this.turnId = id;
    if (this.interruptOnId) { this.interruptOnId = false; void this.sendInterrupt(id); }
  }

  private async sendInterrupt(turnId: string): Promise<void> {
    if (!this.sessionId || this.exited) return;
    try { await this.request('turn/interrupt', { threadId: this.sessionId, turnId }, 20000); } catch (e) {
      log.warn('chats', 'codex turn/interrupt refused', { chat: this.opts.chatId, cause: errText(e), hint: 'the turn may have ended meanwhile; if the chat stays running, close and reopen it', data: { engine: this.engine } });
    }
  }

  /** The next turn runs on this model (turn/start model: it stays for the following turns). */
  async setModel(model: string | null): Promise<void> {
    if (model && model.startsWith('-')) throw new Error('Modello non valido.');
    this.model = model;
    if (model) this.sink.changed({ model });
  }

  async setPermissionMode(_mode: PermissionMode): Promise<void> {
    throw new Error(`${this.label} non ha modalità di permesso nell'app: chiede il permesso per i comandi fuori dalla cartella della chat.`);
  }

  async setEffort(effort: Effort | null): Promise<void> {
    this.effort = codexEffort(effort);
    this.sink.changed({ effort });
  }

  async rename(_title: string): Promise<void> { /* the title lives in the app */ }

  async contextUsage(): Promise<ContextUsage | null> { return this.context; }

  async usage(): Promise<unknown> { return null; }

  close(graceMs = CLOSE_GRACE_MS, keepChildren = false): Promise<void> {
    if (this.exited || !this.proc) { this.markExited(); return this.exitPromise; }
    this.keepChildren = this.closing ? this.keepChildren && keepChildren : keepChildren;
    this.closing = true;
    // UNVERIFIED: app-server is expected to exit when its stdin closes; otherwise the grace kill below ends it
    try { this.proc.stdin.end(); } catch { /* gone */ }
    if (this.killed) return this.exitPromise;
    const pid = this.proc.pid, t0 = Date.now();
    const t = setTimeout(() => {
      if (this.exited) return;
      if (this.procExited) return this.releasePipes();
      log.warn('chats', 'codex session did not exit, killing', { chat: this.opts.chatId, data: { engine: this.engine, pid, waitedMs: Date.now() - t0 }, cause: 'no exit within the grace after its stdin closed', hint: 'a turn or a tool still running at close; npm run logs -- --chat <id> shows what it was doing' });
      this.killAfterGrace();
    }, graceMs);
    t.unref();
    return this.exitPromise;
  }

  private killAfterGrace(): void {
    const p = this.proc;
    if (!p || this.exited || this.killed) return;
    if (!jobGuard.has(this.job)) return this.killNow();
    this.killed = true;
    engineKills.count++;
    try { p.kill(); } catch { /* gone */ }
  }

  private releasePipes(): void {
    if (this.exited || !this.proc) return;
    log.info('chats', 'codex engine exited, a leftover still holds its output: closing the pipes', { chat: this.opts.chatId, data: { engine: this.engine, pid: this.proc.pid } });
    closePipes(this.proc);
  }

  killNow(): void {
    const p = this.proc;
    if (this.exited || !p || this.killed) return;
    this.closing = true;
    this.killed = true;
    this.jobKilled = killEngineTree(p.pid, this.job, () => p.kill(), this.opts.chatId);
    setTimeout(() => {
      if (this.exited) return;
      if (this.procExited) return this.releasePipes();
      log.warn('chats', 'tree kill did not land, retrying', { chat: this.opts.chatId, data: { pid: p.pid }, cause: 'still alive 12 s after the kill', hint: 'taskkill is slow on a loaded box; npm run doctor' });
      killTrees([p.pid], { fallback: () => p.kill() });
    }, 12000).unref();
  }

  // ---- JSON-RPC (app-server omits the "jsonrpc" field on the wire, docs; incoming messages are read either way) ----

  private write(obj: Obj): void {
    const p = this.proc;
    if (!p || this.exited || !p.stdin.writable) throw new Error(NOT_ACTIVE);
    p.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  private request(method: string, params: Obj, timeoutMs = 20000): Promise<Obj> {
    if (this.exited || !this.proc) return Promise.reject(new Error(NOT_ACTIVE));
    const id = this.rpcSeq++;
    return new Promise<Obj>((resolve, reject) => {
      const timer = timeoutMs ? setTimeout(() => { this.rpcs.delete(id); reject(new Error(`${method}: nessuna risposta da ${this.label}`)); }, timeoutMs) : null;
      timer?.unref();
      this.rpcs.set(id, { resolve, reject, method, timer });
      try { this.write({ id, method, params }); }
      catch (e) { if (timer) clearTimeout(timer); this.rpcs.delete(id); reject(e as Error); }
      log.debug('chats', 'codex request', { chat: this.opts.chatId, data: { engine: this.engine, id, method } });
    });
  }

  private notify(method: string, params: Obj): void {
    try { this.write({ method, params }); } catch { /* gone */ }
  }

  private respond(id: number | string, result: Obj): void {
    try { this.write({ id, result }); } catch { /* gone: the exit path resolves the panels */ }
  }

  private respondError(id: number | string, code: number, message: string): void {
    try { this.write({ id, error: { code, message } }); } catch { /* gone */ }
  }

  private onStdout(d: string): void {
    this.out += d;
    let i: number;
    while ((i = this.out.indexOf('\n')) >= 0) {
      const line = this.out.slice(0, i).trim();
      this.out = this.out.slice(i + 1);
      if (line) this.line(line);
    }
    if (this.out.length > 50_000_000) { log.warn('chats', 'codex stdout line too long, dropped', { chat: this.opts.chatId, data: { engine: this.engine } }); this.out = ''; }
  }

  /** One stdout line. Never throws (public: the contract replay feeds recorded lines). */
  line(raw: string): void {
    let m: unknown;
    try { m = JSON.parse(raw); } catch {
      this.badLines += 1;
      if (this.badLines <= 20) log.warn('chats', 'non-JSON line from Codex', { chat: this.opts.chatId, data: { engine: this.engine, line: cut(raw, 300) } });
      return;
    }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    if (this.recording) {
      const id = (m as Obj).id;
      record(this.engine, this.cliVersion, codexKey(m as Obj, typeof id === 'number' ? this.rpcs.get(id)?.method : undefined), m);
    }
    try { this.onMessage(m as Obj); } catch (e) {
      log.error('chats', 'Codex message not understood', { chat: this.opts.chatId, cause: errText(e), hint: 'protocol drift? compare with codex-rs/app-server-protocol/schema and update chats/codex.ts', data: { engine: this.engine, line: cut(raw, 500) } });
    }
  }

  private onMessage(m: Obj): void {
    const method = s(m.method);
    const hasId = typeof m.id === 'number' || typeof m.id === 'string';
    if (!method && hasId) {
      const rpc = this.rpcs.get(m.id as number);
      if (!rpc) return;
      this.rpcs.delete(m.id as number);
      if (rpc.timer) clearTimeout(rpc.timer);
      if (m.error !== undefined) {
        const e = o(m.error);
        log.warn('chats', 'codex error response', { chat: this.opts.chatId, data: { engine: this.engine, method: rpc.method, code: e.code, message: e.message } });
        rpc.reject(new RpcError(s(e.message) || `${rpc.method} fallito`, num(e.code) ?? -32603));
      } else rpc.resolve(o(m.result));
      return;
    }
    if (method && hasId) return this.onRequest(m.id as number | string, method, o(m.params));
    if (method) return this.onNotification(method, o(m.params));
  }

  private onRequest(id: number | string, method: string, p: Obj): void {
    const at = Date.now();
    const rid = nextId('ask');
    if (method === 'mcpServer/elicitation/request') return this.elicitation(id, rid, p, at);
    if (method === 'item/commandExecution/requestApproval') {
      const known = this.tools.get(s(p.itemId));
      const command = s(p.command) || s(o(known?.input).command);
      const detail = [command, s(p.cwd) ? `in ${s(p.cwd)}` : '', s(p.reason)].filter(Boolean).join('\n');
      this.asks.set(rid, { rpcId: id, method });
      this.flushAll(true);
      this.pending({
        id: rid, type: 'permission', tool: 'Shell', title: cut(command ? `Shell: ${stripAnsi(command)}` : 'Shell: permesso', 140), detail: cut(detail, 8000),
        input: trimInput({ command, cwd: s(p.cwd) || undefined, reason: s(p.reason) || undefined }), at, alwaysRules: ['questo tipo di comando, per questa sessione'],
      });
      return;
    }
    if (method === 'item/fileChange/requestApproval') {
      const known = this.tools.get(s(p.itemId));
      const files = (known?.diff ?? []).map(d => d.path);
      const grantRoot = s(p.grantRoot);
      const detail = [grantRoot ? `Consentendo, ${this.label} potrà scrivere in ${grantRoot} e nelle sue sottocartelle per tutta la sessione, senza chiedere ancora.` : '', files.join('\n'), s(p.reason)].filter(Boolean).join('\n');
      this.asks.set(rid, { rpcId: id, method, ...(grantRoot ? { grantRoot } : {}) });
      this.flushAll(true);
      // grantRoot = write access under that folder for the rest of the session (security): the title says so and no
      // "sempre" is offered (the grant is already session-wide)
      this.pending({
        id: rid, type: 'permission', tool: 'Edit', title: cut(grantRoot ? `Scrivere in ${grantRoot} per tutta la sessione` : files.length ? `Modifica: ${files.join(', ')}` : 'Modifica di file', 140), detail: cut(detail, 8000),
        input: trimInput({ files, reason: s(p.reason) || undefined, grantRoot: grantRoot || undefined }), at, ...(grantRoot ? {} : { alwaysRules: ['modifiche ai file, per questa sessione'] }),
      });
      return;
    }
    if (method === 'item/tool/requestUserInput') {
      const raw = arr(p.questions).map(o);
      const questions: Question[] = [];
      const ids: { id: string; text: string }[] = [];
      const seen = new Map<string, number>();
      raw.forEach((q, i) => {
        let text = s(q.question) || `Domanda ${i + 1}`;
        const n = (seen.get(text) ?? 0) + 1;
        seen.set(text, n);
        if (n > 1) text = `${text} (${n})`;
        ids.push({ id: s(q.id) || String(i), text });
        questions.push({ question: text, ...(s(q.header) ? { header: cut(s(q.header), 30) } : {}), options: arr(q.options).map(o).filter(x => s(x.label)).map(x => ({ label: s(x.label), ...(s(x.description) ? { description: s(x.description) } : {}) })), multiSelect: false });
      });
      this.asks.set(rid, { rpcId: id, method, questions: ids });
      this.flushAll(true);
      this.pending({ id: rid, type: 'question', tool: 'AskQuestion', title: cut(questions[0]?.question ?? 'Domanda', 140), detail: questions.map(q => q.question).join('\n'), input: trimInput(p), questions, at });
      return;
    }
    // The generated ServerRequest protocol uses item/tool/requestUserInput. The docs also mention tool/...;
    // do not guess an alias and potentially answer a different approval protocol with {answers}.
    if (method === 'tool/requestUserInput') this.sys(`${this.label}: tool/requestUserInput non supportato; il protocollo verificato usa item/tool/requestUserInput. Nessuna risposta utente inviata.`, 'warn');
    // permissions/dynamic tools/legacy approvals: not offered by the app; refused, never auto-approved
    this.drift('server request', method, p);
    log.warn('chats', 'unsupported Codex request refused', { chat: this.opts.chatId, data: { engine: this.engine, method } });
    this.respondError(id, -32601, `Method not supported by this client: ${method}`);
  }

  /** The observed MCP approval is a form with no fields. Accept {} only when it satisfies the whole supported
   *  schema; a mode/constraint we cannot render is a client error, never a fabricated decline from the user.
   *  Metadata is display context only: persist hints never grant session-wide access. No raw values enter logs. */
  private elicitation(id: number | string, rid: string, p: Obj, at: number): void {
    if ([...this.asks.values()].some(ask => ask.rpcId === id)) return;
    const refuse = (reason: string): void => {
      this.respondError(id, -32602, `Unsupported or invalid MCP elicitation: ${reason}`);
      this.sys(`MCP: richiesta non supportata o non valida (${reason}). Nessuna decisione utente inviata.`, 'warn');
      log.warn('chats', 'Codex MCP elicitation unsupported or invalid', { chat: this.opts.chatId, cause: reason,
        hint: 'the client supports only mode=form and an empty-object schema; update the client for other elicitation forms', data: { engine: this.engine } });
    };
    const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
    if (!s(p.threadId) || p.threadId !== this.sessionId) return refuse('threadId non valido');
    if (p.turnId !== undefined && p.turnId !== null && (!s(p.turnId) || p.turnId !== this.turnId)) return refuse('turnId non valido');
    if (!s(p.serverName).trim() || !s(p.message).trim()) return refuse('serverName o message non valido');
    if (p.mode !== 'form') return refuse('modalità diversa da form');
    const schema = p.requestedSchema;
    if (!object(schema) || schema.type !== 'object' || !object(schema.properties) || Object.keys(schema.properties).length) return refuse('schema diverso da oggetto senza campi');
    if (Object.keys(schema).some(k => !['type', 'properties', 'required', 'additionalProperties', 'title', 'description'].includes(k))) return refuse('vincoli dello schema non supportati');
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.length)) return refuse('campi obbligatori non supportati');
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') return refuse('additionalProperties non supportato');
    if ([schema.title, schema.description].some(v => v !== undefined && typeof v !== 'string')) return refuse('titolo o descrizione dello schema non valido');
    if (p._meta !== undefined && p._meta !== null && !object(p._meta)) return refuse('metadati non validi');
    const meta = o(p._meta);
    if (meta.tool_params !== undefined && !object(meta.tool_params)) return refuse('parametri del tool non validi');
    if (meta.tool_description !== undefined && typeof meta.tool_description !== 'string') return refuse('descrizione del tool non valida');
    if (meta.tool_params_display !== undefined && (!Array.isArray(meta.tool_params_display) || meta.tool_params_display.some(v => !object(v) || typeof v.name !== 'string' || typeof v.value !== 'string' || (v.display_name !== undefined && typeof v.display_name !== 'string')))) return refuse('parametri visualizzati non validi');
    if (this.stopping || this.interruptOnId) { this.respond(id, { action: 'cancel', content: null }); return; }
    const server = s(p.serverName);
    const candidates = [...this.tools.values()].filter(t => t.status === 'running' && t.name.startsWith(`mcp__${server}__`));
    const tool = candidates.length === 1 ? candidates[0] : undefined;
    const args = meta.tool_params ?? tool?.input ?? {};
    const display = arr(meta.tool_params_display).map(o).map(v => `${s(v.display_name) || s(v.name)}: ${s(v.value)}`);
    const detail = [s(p.message), `Server: ${server}`, tool ? `Tool: ${tool.name}` : '', s(meta.tool_description), ...display, `Parametri:\n${JSON.stringify(args, null, 2)}`].filter(Boolean).join('\n');
    this.asks.set(rid, { rpcId: id, method: 'mcpServer/elicitation/request', ...(s(p.turnId) ? { turnId: s(p.turnId) } : {}) });
    this.flushAll(true);
    this.pending({ id: rid, type: 'permission', tool: tool?.name ?? `mcp__${server}`, title: cut(stripAnsi(s(p.message)), 140),
      detail: cut(stripAnsi(detail), 8000), input: trimInput({ server, ...(tool ? { tool: tool.name } : {}), arguments: args }), noAlways: true, at });
  }

  private pending(req: Omit<PendingRequest, 'chatId'>): void {
    log.info('chats', 'codex asks', { chat: this.opts.chatId, data: { engine: this.engine, requestId: req.id, type: req.type, tool: req.tool } });
    this.setState('waiting');
    this.sink.pending(req);
  }

  private onNotification(method: string, p: Obj): void {
    switch (method) {
      case 'turn/started': this.gotTurnId(s(o(p.turn).id)); return;
      case 'turn/completed': {
        const t = o(p.turn), status = s(t.status);
        if (!TURN_STATUS.has(status)) this.drift('turn status', status, p);
        if (this.turnId && s(t.id) && s(t.id) !== this.turnId) return; // another turn's end (should not happen)
        const err = o(t.error);
        return this.turnDone(status || 'completed', s(err.message) || null, err.codexErrorInfo);
      }
      case 'item/started': return this.onItem(o(p.item), false);
      case 'item/completed': return this.onItem(o(p.item), true);
      case 'item/agentMessage/delta': return this.delta('assistant', s(p.itemId), s(p.delta));
      case 'item/reasoning/summaryTextDelta': case 'item/reasoning/textDelta': return this.delta('thinking', s(p.itemId), s(p.delta));
      case 'item/commandExecution/outputDelta': {
        const t = this.tools.get(s(p.itemId));
        if (!t) return;
        const output = `${t.output ?? ''}${s(p.delta)}`.slice(-4000);
        const item = { ...t, output };
        this.tools.set(s(p.itemId), item);
        this.sink.item(item, true);
        return;
      }
      case 'turn/plan/updated': {
        const mark = (st: string): string => (st === 'completed' ? '✓' : st === 'inProgress' ? '▸' : '○');
        const lines = arr(p.plan).map(o).map(x => `${mark(s(x.status))} ${s(x.step)}`);
        const text = `Piano:${s(p.explanation) ? ` ${s(p.explanation)}` : ''}\n${lines.join('\n')}`;
        const id = this.planItemId ?? nextId('plan');
        this.sink.item({ kind: 'system', id, at: Date.now(), text, level: 'info' }, !!this.planItemId);
        this.planItemId = id;
        return;
      }
      case 'thread/tokenUsage/updated': return this.onTokens(o(p.tokenUsage));
      case 'thread/compacted': this.sink.changed({ compacted: { pre: null, post: null } }); return;
      case 'serverRequest/resolved': {
        const rpcId = p.requestId;
        for (const [id, ask] of this.asks) if (ask.rpcId === rpcId && (ask.method !== 'mcpServer/elicitation/request' || p.threadId === this.sessionId)) { this.asks.delete(id); this.sink.resolved(id); }
        if (!this.asks.size && this.state === 'waiting') this.setState(this.prompting || this.queue.length ? 'running' : 'idle');
        return;
      }
      case 'error': {
        const e = o(p.error), msg = s(e.message) || 'errore';
        if (p.willRetry === true) { log.warn('chats', 'codex error, it retries by itself', { chat: this.opts.chatId, cause: cut(msg, 300), hint: 'nothing to do unless the turn fails', data: { engine: this.engine } }); return; }
        this.turnError = msg;
        return;
      }
      case 'warning': case 'configWarning': case 'deprecationNotice': {
        const text = s(p.message) || s(p.summary) || s(p.details);
        log.warn('chats', `codex ${method}`, { chat: this.opts.chatId, cause: cut(text || JSON.stringify(p), 300), hint: 'a Codex config or version note; see the user\'s Codex config', data: { engine: this.engine } });
        if (text && method !== 'deprecationNotice') this.sys(`${this.label}: ${cut(text, 300)}`, 'warn');
        return;
      }
      default: if (!QUIET.has(method)) this.drift('notification', method, p);
    }
  }

  private observeChildren(value: unknown, source: 'live' | 'replay'): void {
    for (const row of codexChildren(value, source, Date.now())) this.childTelemetry.observe(row);
  }

  private onTokens(u: Obj): void {
    const last = o(u.last), total = o(u.total), max = num(u.modelContextWindow);
    // OpenAI's inputTokens include the cached ones (UNVERIFIED for app-server: same as the Responses API usage)
    const t = tokenUsage((num(total.inputTokens) ?? 0) - (num(total.cachedInputTokens) ?? 0), total.cachedInputTokens, total.cacheWriteInputTokens, total.outputTokens);
    if (t) this.totals = t;
    const used = (num(last.totalTokens) ?? 0) - (num(last.reasoningOutputTokens) ?? 0);
    if (used > 0) {
      this.context = { totalTokens: used, maxTokens: max ?? 0, percentage: max ? (100 * used) / max : 0 };
      this.sink.changed({ contextTokens: used, ...(max ? { contextMaxTokens: max } : {}), contextEstimated: false });
    }
  }

  private onItem(it: Obj, done: boolean): void {
    const type = s(it.type), id = s(it.id);
    if (!ITEM_TYPES.has(type)) { this.drift('item type', type, it); return; }
    this.observeChildren(it, 'live');
    switch (type) {
      case 'userMessage': return; // our own message, already in the chat
      case 'agentMessage': case 'reasoning': {
        const kind = type === 'agentMessage' ? 'assistant' : 'thinking';
        if (!done) { this.streamOf(kind, id); return; }
        const text = type === 'agentMessage' ? s(it.text) : [...arr(it.summary), ...arr(it.content)].map(s).filter(Boolean).join('\n\n');
        const st = this.streamOf(kind, id);
        if (text) { st.item = { ...st.item, text }; st.dirty = true; }
        this.finish(id);
        return;
      }
      case 'commandExecution': return this.tool(id, done, {
        name: 'Shell', summary: `Shell: ${cut(stripAnsi(s(it.command)), 90)}`, input: { command: s(it.command), cwd: s(it.cwd) || undefined },
        status: s(it.status), output: s(it.aggregatedOutput) || (num(it.exitCode) !== undefined && num(it.exitCode) !== 0 ? `exit ${num(it.exitCode)}` : ''),
        // the exact exit code (the run's receipts, ADR 0130); only on the finished item
        ...(done && Number.isSafeInteger(num(it.exitCode)) ? { exitCode: num(it.exitCode) } : {}),
      });
      case 'fileChange': {
        const changes = arr(it.changes).map(o);
        const diff: FileDiff[] = changes.filter(c => s(c.path)).map(c => ({ path: shortPath(s(c.path), this.opts.cwd), ...diffCounts(s(c.diff)), ...(s(c.diff) ? { patch: cut(s(c.diff), 20000) } : {}) }));
        return this.tool(id, done, { name: 'Edit', summary: `Edit: ${cut(diff.map(d => d.path).join(', ') || 'file', 90)}`, input: { files: diff.map(d => d.path) }, status: s(it.status), diff });
      }
      case 'mcpToolCall': {
        const result = o(it.result), error = s(o(it.error).message);
        const text = arr(result.content).map(o).filter(c => c.type === 'text').map(c => s(c.text)).join('\n');
        return this.tool(id, done, { name: `mcp__${s(it.server)}__${s(it.tool)}`, summary: `${s(it.server)}: ${s(it.tool)}`, input: it.arguments ?? {}, status: s(it.status), output: error || text });
      }
      case 'webSearch': return this.tool(id, done, { name: 'WebSearch', summary: `WebSearch: ${cut(s(it.query), 90)}`, input: { query: s(it.query) }, status: done ? 'completed' : 'inProgress' });
      case 'imageView': if (done) this.sys(`${this.label} ha guardato un'immagine: ${s(it.path)}`, 'info'); return;
      case 'plan': if (done && s(it.text)) this.sys(`Piano:\n${s(it.text)}`, 'info'); return;
      case 'contextCompaction': if (done) { this.sys('Contesto compattato da Codex.', 'info'); this.sink.changed({ compacted: { pre: null, post: null } }); } return;
      case 'enteredReviewMode': case 'exitedReviewMode': if (done) this.sys(type === 'enteredReviewMode' ? 'Revisione avviata.' : 'Revisione finita.', 'info'); return;
      default: return; // known, not shown (collab agents, hooks, sleep, image generation): their effects show elsewhere
    }
  }

  private tool(id: string, done: boolean, t: { name: string; summary: string; input: unknown; status: string; output?: string; diff?: FileDiff[]; exitCode?: number }): void {
    this.flushAll(true);
    const prev = this.tools.get(id);
    const status: ToolItem['status'] = t.status === 'completed' ? 'ok' : t.status === 'failed' || t.status === 'declined' ? 'error' : done ? 'ok' : 'running';
    const output = t.status === 'declined' ? 'rifiutato' : t.output;
    const item: ToolItem = {
      ...(prev ?? { kind: 'tool', id: `t-${id}`, at: Date.now() }),
      name: t.name, summary: t.summary, input: trimInput(t.input), status,
      ...(output ? { output: cut(output, 4000) } : prev?.output ? { output: prev.output } : {}),
      ...(t.diff?.length ? { diff: t.diff } : {}),
      ...(t.exitCode !== undefined ? { exitCode: t.exitCode } : {}),
    } as ToolItem;
    this.chars += (output?.length ?? 0) + JSON.stringify(t.input ?? {}).length;
    if (done) this.tools.delete(id); else this.tools.set(id, item);
    this.sink.item(item, !!prev);
  }

  private streamOf(kind: 'assistant' | 'thinking', id: string): Stream {
    let st = this.streams.get(id);
    if (!st) {
      const item: StreamItem = kind === 'assistant'
        ? { kind: 'assistant', id: `a-${id || nextId('x')}`, at: Date.now(), text: '', streaming: true }
        : { kind: 'thinking', id: `th-${id || nextId('x')}`, at: Date.now(), text: '' };
      st = { item, emitted: false, dirty: false };
      this.streams.set(id, st);
    }
    return st;
  }

  private delta(kind: 'assistant' | 'thinking', id: string, text: string): void {
    if (!text) return;
    const st = this.streamOf(kind, id);
    st.item = { ...st.item, text: st.item.text + text };
    st.dirty = true;
    this.chars += text.length;
    if (!this.flushTimer) { this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flushAll(false); }, 50); this.flushTimer.unref(); }
  }

  private flushOne(st: Stream): void {
    if (!st.dirty || !st.item.text) return;
    this.sink.item(st.item, st.emitted);
    st.emitted = true;
    st.dirty = false;
  }

  /** Closes one stream: last text out, streaming off, last line for the tile. */
  private finish(id: string): void {
    const st = this.streams.get(id);
    if (!st) return;
    this.streams.delete(id);
    this.flushOne(st);
    if (st.item.kind === 'assistant') {
      if (st.emitted) this.sink.item({ ...st.item, streaming: false }, true);
      if (st.item.text.trim()) this.sink.changed({ lastText: lastLine(st.item.text) });
    }
  }

  private flushAll(final: boolean): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    for (const [id, st] of [...this.streams]) { if (final) this.finish(id); else this.flushOne(st); }
  }

  private drift(kind: string, what: string, sample: unknown): void {
    drift(this.engine, this.cliVersion, kind, what, sample, this.opts.chatId);
  }

  private reportEstimate(): void {
    if (this.context || !this.chars) return;
    this.sink.changed({ contextTokens: estimateTokens(this.chars), contextEstimated: true });
  }

  private onClose(code: number | null): void {
    if (this.exited) return;
    this.flushAll(true);
    const clean = this.closing || code === 0;
    const tail = stripAnsi(this.errTail).trim().split(/\r?\n/).slice(-4).join(' · ');
    const error = clean ? null : cut(tail || `${this.label} è uscito con codice ${code ?? '?'}`, 600);
    if (error) log.error('chats', 'codex engine exited with an error', { chat: this.opts.chatId, data: { engine: this.engine }, cause: `exit ${code}: ${tail || 'no stderr'}`, hint: `run \`${this.cliName} --version\` in a terminal; resume with a new message` });
    else log.info('chats', 'codex session exit', { chat: this.opts.chatId, data: { engine: this.engine, code } });
    this.end(clean ? 'closed' : 'error', code, error);
  }

  private fail(error: string, cause: string, hint: string): void {
    if (this.exited) return;
    log.error('chats', 'codex session failed', { chat: this.opts.chatId, data: { engine: this.engine }, cause, hint });
    this.end('error', null, error);
  }

  private stopWith(error: string, cause: string, hint: string): void {
    const p = this.proc;
    this.fail(error, cause, hint);
    if (p) { try { p.stdin.end(); } catch { /* gone */ } killEngineTree(p.pid, this.job, () => p.kill(), this.opts.chatId); }
  }

  private end(state: ChatState, code: number | null, error: string | null): void {
    if (this.exited) return;
    this.markExited();
    for (const r of this.rpcs.values()) { if (r.timer) clearTimeout(r.timer); r.reject(new Error('La sessione è terminata.')); }
    this.rpcs.clear();
    for (const id of [...this.asks.keys()]) { this.asks.delete(id); this.sink.resolved(id); }
    for (const t of this.tools.values()) if (t.status === 'running') this.sink.item({ ...t, status: 'error', output: t.output ?? 'interrotto' }, true);
    this.tools.clear();
    for (const f of this.turnFiles.splice(0)) fs.rm(f, { force: true }, () => {});
    this.queue = [];
    this.prompting = false;
    this.setState(state);
    this.sink.exit({ code, error });
  }

  private markExited(): void {
    if (this.exited) return;
    this.exited = true;
    this.childTelemetry.end();
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.exitDone();
  }

  private setState(st: ChatState): void {
    if (this.state === st) return;
    this.state = st;
    this.sink.changed({ state: st });
  }

  private sys(text: string, level: 'info' | 'warn' | 'error'): void {
    this.sink.item({ kind: 'system', id: nextId('s'), at: Date.now(), text, level }, false);
  }
}

class NotLoggedIn extends Error {
  constructor() { super('not logged in'); }
}
