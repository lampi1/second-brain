// One Claude Code chat run by the app through the user's own `claude` CLI (ADR 0002: same login, settings, hooks,
// skills, CLAUDE.md and transcripts as his terminal; no SDK dependency). Protocol = what the Agent SDK speaks:
//   claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages
//          --permission-prompt-tool stdio --permission-mode <explicit> [--model] [--effort] [--resume=|--session-id=] …
//          [--settings <inline JSON>: session-only; the STABLE app adds deny guard rails, ADR 0007]
//   env    CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1 → system/session_state_changed running/idle (authoritative)
//   stdin  ← {"type":"user",…} turns (content: image blocks {type:image,source:{type:base64}} then the text) and {"type":"control_request",request_id,request:{subtype}} (initialize,
//            interrupt, set_model, set_permission_mode, apply_flag_settings {effortLevel}, get_context_usage,
//            rename_session)
//   stdout → SDK messages (system/init, stream_event deltas, assistant, user tool results, result with cost) and the
//            CLI's own control requests: can_use_tool (permissions and AskUserQuestion), answered with
//            {"type":"control_response","response":{"subtype":"success",request_id,response:{behavior,…}}}.
//            With opts.preToolUse, initialize registers one PreToolUse hook callback and the CLI asks it with
//            hook_callback before each tool call (answered with the hook's JSON output: {} or a deny with its reason).
// Messages become contract ChatItems (streamed text as replace events, tool rows with a one-line summary, diff counts,
// results with cost). Robust by design: a bad line is logged and skipped, a dead process becomes state closed/error
// with the reason, and nothing here can throw into the app. Used by manager.ts through the HarnessSession interface.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Answer, ChatItem, ChatState, Effort, ImageAttachment, PendingRequest, PermissionMode } from '../../shared/contract';
import { sysEn, type SysCode, type SysParams } from '../../shared/sys';
import { errText, log } from '../log';
import { CLOSE_GRACE_MS, commandFor, findCli, killTrees, resolveClaude } from './cli';
import { closePipes, engineKills, jobGuard, killEngineTree } from './jobguard';
import { reapEnabled, reapEngine, type Root } from './proctree';
import { LiveCost, priceUsage } from './live-cost';
import { describeSuggestions, diffFor, diffFromResult, flattenAnswers, permissionText, questionsFrom, resultText, resumedAgent, toolSummary } from './claude-map';
import { cut, lastLine, nextId, stripAnsi, tokenUsage, toCommands, trimInput, type AnswerPatch, type ContextUsage, type HarnessSession, type SessionOptions, type SessionSink } from './session';
import { releaseId } from '../release';
import { drift, record } from './drift';
import { ownProcessGroup, sharedDir } from '../platform';
import { AgentChildrenReporter } from './agent-children';
import type { ChildObservation } from '../../shared/agents';
import { claudeMcp, claudeTools, suggestedAbove } from '../agents/tool-policy';

export interface ClaudeOptions extends SessionOptions {
  /** claude binary or a .mjs fake (tests); default: `claude` resolved on PATH */
  claudePath?: string;
  /** session-only settings for this chat (passed inline with --settings, never written to a file) */
  settings?: Record<string, unknown> | null;
  /** run by the STABLE app (ADR 0007): add the guard rails; default = this process is a release (release.ts) */
  stable?: boolean;
  /** a %LOCALAPPDATA%-like parent of second-brain/ (tests); default the app's shared folder, platform.ts */
  localAppData?: string;
}

/** A Windows or POSIX absolute path in Claude Code's absolute rule form: C:\a\b → //c/a/b (docs: permissions,
 *  "On Windows, paths are normalized to POSIX form before matching"). */
export function rulePath(p: string): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  const m = s.match(/^([A-Za-z]):\/?(.*)$/);
  if (m) return `//${(m[1] ?? '').toLowerCase()}/${m[2] ?? ''}`.replace(/\/$/, '');
  return `/${s.startsWith('/') ? s : `/${s}`}`;
}

/** The auto-compact window of one process (ADR 0031). Only an env of the inline flag settings wins over a folder's own
 *  .claude/settings.local.json env (the owner's ops folder set 1000000 there: its chats never compacted at the user's 300000; an
 *  inherited env var and the autoCompactWindow key both lose to it, measured 13/10 with get_context_usage). The CLI
 *  accepts 100000-1000000. */
export function compactSettings(tokens: number | null | undefined): Record<string, unknown> | null {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return null;
  const w = Math.min(1_000_000, Math.max(100_000, Math.round(tokens)));
  return { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(w) } };
}

/** Guard rails for chats run by the STABLE app (ADR 0007): they must never stop the app they run in nor change its
 *  releases. Session-only deny rules (deny wins over every allow, at any level). `Edit(path)` covers every file-editing
 *  tool (Write, MultiEdit, NotebookEdit): path rules written for those tools are ignored by Claude Code. */
export function stableGuards(shared: string): Record<string, unknown> {
  return {
    permissions: {
      deny: [
        'Bash(taskkill:*)', 'Bash(Stop-Process:*)', 'Bash(kill:*)', 'Bash(pkill:*)', 'Bash(killall:*)',
        'PowerShell(Stop-Process:*)', 'PowerShell(taskkill:*)',
        `Edit(${rulePath(shared)}/**)`,
      ],
    },
  };
}

/** The only tools a read-only run has (SessionOptions.readOnly, the comparison's hidden side b): reading and searching
 *  files. Its owner allows a permission only for these (compare/headless.ts). */
export const READ_ONLY_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob'];

/** A read-only run's session-only settings: deny rules for every tool that writes, runs or reaches the network (deny
 *  wins over the user's own allow rules, at any level) and no hooks (the user's hooks would see a chat the user never
 *  opened). */
export const READ_ONLY_SETTINGS: Record<string, unknown> = {
  permissions: { deny: ['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch'] },
  disableAllHooks: true,
};

/** The Claude Code rule that denies reading a folder and everything in it, in its absolute-path form (`//` + the path
 *  with forward slashes; a Windows drive C: becomes /c): Read(//c/a/b/**). A Read rule also covers Grep and Glob. */
export function claudeReadRule(dir: string): string {
  const p = path.resolve(dir).replace(/\\/g, '/').replace(/\/+$/, '').replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`);
  return `Read(/${p}/**)`;
}

/** Merges inline settings objects; permission lists (allow / deny / ask) are concatenated, not replaced. */
export function mergeSettings(...parts: (Record<string, unknown> | null | undefined)[]): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const p of parts) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) {
      if (k !== 'permissions') { out[k] = v; continue; }
      const cur = o(out.permissions), add = o(v);
      const merged: Record<string, unknown> = { ...cur, ...add };
      for (const list of ['allow', 'deny', 'ask']) {
        const all = [...arr(cur[list]), ...arr(add[list])];
        if (all.length) merged[list] = [...new Set(all)];
      }
      out.permissions = merged;
    }
  }
  return Object.keys(out).length ? out : null;
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** The callback id of the app's in-process PreToolUse hook (opts.preToolUse), registered at initialize. */
const PRE_TOOL_HOOK = 'sb_pre_tool_use';

const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'];
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

interface Call { requestId: string; tool: string; input: Obj; toolUseId: string; suggestions: unknown[]; question: boolean; noAlways: boolean }
interface Control { resolve(v: Obj): void; reject(e: Error): void; timer: NodeJS.Timeout; subtype: string }
interface Stream { key: string; item: Extract<ChatItem, { kind: 'assistant' | 'thinking' }>; emitted: boolean; done: boolean }
type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

/** stream-json API error kinds with their own sys.api.<kind> code (src/shared/sys.ts); anything else is sys.api.other */
const API_ERROR_CODES = new Set(['authentication_failed', 'oauth_org_not_allowed', 'rate_limit', 'overloaded', 'billing_error', 'model_not_found', 'max_output_tokens']);
/** A failed result's subtype, when the CLI gives no other words: its own sys.turnFailed.<subtype> code; anything else
 *  is sys.turnFailed.other (subtype present) or sys.turnFailed.none (no subtype at all). */
const RESULT_ERROR_CODES = new Set(['error_max_turns', 'error_max_budget_usd', 'error_during_execution', 'error_max_structured_output_retries']);

/** task statuses that end it (the CLI's terminal ones); any other (pending, running, a workflow's paused) keeps it */
const END_TASK = new Set(['completed', 'failed', 'killed', 'stopped']);
const LIVE_TASK = new Set(['pending', 'running', 'in_progress']);
// What the CLI sends that the app knowingly ignores (drift.ts: anything else outside the handled cases is reported).
// Checked against CLI 2.1.283; a new CLI's first run warns once for each new name (`npm run logs -- --scope drift`).
const QUIET_TYPES = new Set(['keep_alive', 'auth_status', 'tool_progress', 'tool_use_summary', 'prompt_suggestion']);
const QUIET_STREAM = new Set(['message_delta', 'message_stop', 'ping']);
const QUIET_DELTAS = new Set(['input_json_delta', 'signature_delta', 'citations_delta']);
const QUIET_BLOCKS = new Set(['tool_use', 'server_tool_use', 'redacted_thinking', 'mcp_tool_use', 'mcp_tool_result', 'web_search_tool_result', 'web_fetch_tool_result', 'code_execution_tool_result']);
const QUIET_SYSTEM = new Set(['hook_started', 'hook_progress', 'hook_response', 'files_persisted', 'elicitation_complete', 'task_progress']);
const SESSION_STATES = new Set(['running', 'idle', 'requires_action']);

/** The shape a message is recorded under (drift.ts record): type, then the sub-kind that picks the parser branch. */
export function claudeKey(m: Obj): string {
  const t = s(m.type);
  if (t === 'system' || t === 'result') return `${t}/${s(m.subtype)}`;
  if (t === 'control_request') return `${t}/${s(o(m.request).subtype)}`;
  if (t === 'control_response') return `${t}/${s(o(m.response).subtype)}`;
  if (t === 'stream_event') {
    const e = o(m.event);
    const sub = e.type === 'content_block_delta' ? s(o(e.delta).type) : e.type === 'content_block_start' ? s(o(e.content_block).type) : '';
    return `${t}/${s(e.type)}${sub ? `/${sub}` : ''}`;
  }
  if (t === 'assistant' || t === 'user') {
    const c = o(m.message).content;
    return `${t}/${Array.isArray(c) ? s(o(c[0]).type) : typeof c}`;
  }
  return t;
}

export class ClaudeSession implements HarnessSession {
  readonly harness = 'claude' as const;
  state: ChatState = 'starting';
  sessionId: string | null;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private out = '';
  private errTail = '';
  private controls = new Map<string, Control>();
  private calls = new Map<string, Call>();
  private tools = new Map<string, { item: ToolItem; input: unknown }>();
  private streams = new Map<string, Stream>();          // `${messageId}:${index}` → streamed block
  private order = new Map<string, Stream[]>();          // messageId → its streamed blocks, in arrival order
  private dirty = new Set<Stream>();
  private flushTimer: NodeJS.Timeout | null = null;
  private curMessage: string | null = null;
  private turnOpen = false;           // a turn is in flight (ours, a queued one, or one the CLI started itself)
  private selectedEffort: Effort | null;
  /** the user stopped the running turn (Stop, or "Invia subito" = sendNow): its result is an interruption, not an error */
  private stopping: { sendNow: boolean } | null = null;
  private stateEvents = false;        // the CLI sends session_state_changed (authoritative running/idle)
  private closing = false;
  private keepChildren = false;
  private exitedRoot: Root | null = null;
  private killed = false;
  private exited = false;
  private procExited = false;         // 'exit' came ('close' also waits for the pipes, which a leftover may hold)
  private job: number | null = null;  // its Job Object (jobguard.ts)
  private jobKilled = false;          // its tree was terminated through the job
  private sawInit = false;
  private cmdList: unknown[] | null = null;  // the engine's commands (initialize, commands_changed), for the "/" list
  private skillNames = new Set<string>();    // init's `skills`: which of those commands are skills
  private pendingTitle: string | null = null; // a fork renamed before its own id is known
  private costBase: number;
  private readonly live = new LiveCost(); // the running turn's estimate from token usage, until its result
  private readonly counted = new Set<string>(); // response ids already reported as calls (the CLI repeats one per block)
  private badLines = 0;
  private cliVersion: string | null = null; // what the CLI says it is (initialize, system/init): drift reports name it
  private recording = false;          // a real CLI (not a test's .mjs fake): its message shapes go to drift.ts record
  private tasks = new Set<string>();  // background tasks started and not yet ended (task_started / task_notification)
  private readonly childTelemetry: AgentChildrenReporter;
  private readonly childTools = new Map<string, unknown>();
  /** start-up and per-turn timings (logged, scope chats): where a slow first answer spends its time */
  private spawnedAt = 0;
  private readyAt = 0;                // the initialize reply: the engine is up and takes messages
  private turnT: { sent: number; first?: number; text?: number; warm: boolean; n: number } | null = null;
  private turnsSent = 0;
  private readyDone!: () => void;
  /** settles when the engine answered initialize, failed it, or exited: control requests sent after it are not
   *  queued behind the start-up (a warm engine adopted while it still starts, warm.ts) */
  readonly ready = new Promise<void>(r => { this.readyDone = r; });
  private exitDone!: () => void;
  private readonly exitPromise = new Promise<void>(r => { this.exitDone = r; });

  constructor(private readonly opts: ClaudeOptions, private readonly sink: SessionSink) {
    this.selectedEffort = opts.effort ?? null;
    this.childTelemetry = new AgentChildrenReporter(sink);
    // a fork gets its own id from the CLI at init: until then nothing may name the original session
    this.sessionId = opts.fork ? null : opts.sessionId ?? null;
    this.costBase = opts.costBaseUsd ?? 0;
  }

  get pid(): number | null { return this.proc?.pid ?? null; }
  get jobHandle(): number | null { return this.job; }
  /** Nothing left for the quit's last resort: it exited, or its job was terminated. */
  get gone(): boolean { return this.procExited || this.jobKilled; }
  get root(): Root | null { return this.exitedRoot; }
  get startedAt(): number { return this.spawnedAt; }

  /** Working: a turn in flight, a question open or still booting (stopAll counts these). */
  get busy(): boolean {
    return !this.exited && (this.turnOpen || this.calls.size > 0 || this.state === 'starting' || this.state === 'running' || this.state === 'waiting');
  }

  /** The CLI arguments (exported for tests and the log). */
  args(): string[] {
    const op = this.opts;
    const a = ['-p', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--include-partial-messages',
      '--permission-prompt-tool', 'stdio',
      // without it, -p stream-json leaves the display to the server, which streams no thinking text: the Ragionamento
      // block stays empty and "Correggi il pensiero" has nothing to select (ADR 0058, probe 16/10)
      '--thinking-display', 'summarized'];
    // no choice = the user's settings.json decides (defaultMode, e.g. auto); the CLI reports the mode at init (ADR 0002);
    // a read-only run is always in plan mode
    const mode = op.readOnly ? 'plan' : op.permissionMode;
    if (mode) a.push('--permission-mode', mode);
    // a read-only run: only the read tools exist (--tools is variadic: a flag follows it), no MCP server, no transcript
    // (it never shows up among the external chats)
    if (op.readOnly) {
      const tools = op.toolPolicy ? READ_ONLY_TOOLS.filter(t => claudeTools(op.toolPolicy!).includes(t)) : READ_ONLY_TOOLS;
      if (op.toolPolicy) a.push(`--tools=${tools.join(',')}`);
      else a.push('--tools', tools.join(','));
      a.push('--strict-mcp-config', '--no-session-persistence');
    }
    // an agent's tool policy (A2): only its built-in tools exist; without 'mcp' only the app's own servers load
    const agentMcp = !op.readOnly && op.toolPolicy ? claudeMcp(op.toolPolicy) : null;
    // a role chat also gets the Skill tool, asked for at every call: the role gate allows only the skills of its launch
    const roleSkills = !op.readOnly && !!op.toolPolicy && !!op.agentAssets;
    if (!op.readOnly && op.toolPolicy) a.push(`--tools=${[...claudeTools(op.toolPolicy), ...(roleSkills ? ['Skill'] : [])].join(',')}`); // `=`: the variadic flag takes only this list
    if (agentMcp?.strict) a.push('--strict-mcp-config');
    // `--flag=<id>`: an id can never be read as another flag (ids are UUIDs, checked by the manager)
    if (op.resume && op.sessionId) { a.push(`--resume=${op.sessionId}`); if (op.fork) a.push('--fork-session'); }
    else if (op.sessionId) a.push(`--session-id=${op.sessionId}`);
    if (op.model) a.push('--model', op.model);
    if (op.effort) a.push('--effort', op.effort);
    if (op.title && (!op.resume || op.fork)) a.push('--name', op.title);
    if (op.worktree && !op.resume) a.push('--worktree');
    const stable = op.stable ?? !!releaseId();
    const settings = mergeSettings(op.settings, compactSettings(op.compactWindowTokens), op.readOnly ? READ_ONLY_SETTINGS : null, op.readOnly && op.denyRead?.length ? { permissions: { deny: op.denyRead.map(claudeReadRule) } } : null, agentMcp && !agentMcp.connectors ? { disableClaudeAiConnectors: true } : null, roleSkills ? { permissions: { ask: ['Skill'] } } : null, stable ? stableGuards(op.localAppData ? path.join(op.localAppData, 'second-brain') : sharedDir()) : null);
    if (settings) a.push('--settings', JSON.stringify(settings)); // inline: session-only, no file is written
    if (op.mcpConfig && !op.readOnly) a.push('--mcp-config', op.mcpConfig); // variadic flag: keep it after the plain ones
    return [...a, ...(op.extraArgs ?? [])];
  }

  start(): void {
    this.childTelemetry.coverage('partial');
    const chat = this.opts.chatId;
    // embedded engine by default (ADR 0010); an explicit path (tests, SB_CLAUDE_PATH) wins
    const cli = this.opts.claudePath ? findCli(this.opts.claudePath) : resolveClaude()?.path ?? null;
    if (!cli || !fs.existsSync(cli)) return this.fail(`Motore Claude non trovato${cli ? `: ${cli}` : ''}. Reinstalla l’app (il motore è incluso) o imposta SB_CLAUDE_PATH.`, `claude engine not found (${cli ?? 'embedded/PATH'})`, 'run npm ci (embedded engine in node_modules/@anthropic-ai/claude-agent-sdk-<os>-<cpu>) or set SB_ENGINE_CLAUDE / SB_CLAUDE_PATH');
    if (!fs.existsSync(this.opts.cwd)) return this.fail(`Cartella non trovata: ${this.opts.cwd}`, `cwd missing: ${this.opts.cwd}`, 'pick an existing folder for the chat');
    this.recording = !/\.m?js$/i.test(cli);
    const env = { ...process.env, ...this.opts.env };
    env.MCP_TOOL_TIMEOUT = env.MCP_TOOL_TIMEOUT ?? '600000'; // browser tools may wait on a page
    env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS = '1';         // session_state_changed: the authoritative running/idle
    const args = this.args();
    const c = commandFor(cli, args, env);
    const startedAt = Date.now();
    this.spawnedAt = startedAt;
    try {
      this.proc = spawn(c.command, c.args, { cwd: this.opts.cwd, env: c.env, windowsHide: true, detached: ownProcessGroup(), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return this.fail(`Avvio di Claude non riuscito: ${errText(e)}`, errText(e), 'check the claude path and the folder');
    }
    const spawnMs = Date.now();
    const p = this.proc;
    log.info('chats', 'session start', { chat, data: { pid: p.pid, cli, cwd: this.opts.cwd, args } });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d: string) => this.onStdout(d));
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d: string) => {
      this.errTail = (this.errTail + d).slice(-4000);
      log.debug('chats', 'stderr', { chat, data: cut(d, 500) });
    });
    p.stdin.on('error', e => log.warn('chats', 'stdin error', { chat, data: errText(e) }));
    p.on('error', e => this.fail(`Avvio di Claude non riuscito: ${errText(e)}`, errText(e), 'check that the claude binary runs from a terminal'));
    p.on('close', (code: number | null) => this.onClose(code));
    // a clean exit leaves its MCP servers, hooks and shells running: kill what still descends from it ('exit', not 'close': a leftover
    // holding the inherited stdout would delay 'close' until it ends by itself)
    p.once('exit', () => {
      this.procExited = true;
      if (!p.pid) return;
      this.exitedRoot = { pid: p.pid, created: startedAt, exited: Date.now(), job: this.job };
      if (!this.keepChildren && reapEnabled()) void reapEngine(this.exitedRoot, { chatId: chat, what: 'Claude' });
    });
    // its own job before it starts anything (MCP servers come seconds later): later children, orphans too, stay in it
    void jobGuard.add(p.pid, chat).then(job => {
      this.job = job;
      if (this.exitedRoot) { this.exitedRoot.job = job; if (!this.keepChildren) void jobGuard.release(job); } // exited first: the walk reaped it
    });
    this.controlRaw({ subtype: 'initialize', hooks: this.opts.preToolUse ? { PreToolUse: [{ matcher: '*', hookCallbackIds: [PRE_TOOL_HOOK] }] } : null }, 60000).then(env => {
      const r = o(env.response);
      this.readyAt = Date.now();
      this.readyDone();
      log.info('chats', 'timing: engine ready', { chat, data: { readyMs: this.readyAt - startedAt, spawnMs: spawnMs - startedAt } });
      const v = s(r.claude_code_version);
      if (v) { this.cliVersion = v; this.sink.changed({ version: v }); }
      if (Array.isArray(r.commands)) { this.cmdList = r.commands; this.reportCommands(); }
      // prompts inherited by a resume ride on the control_response envelope, next to `response` (sdk.d.ts ControlResponse)
      for (const req of [...arr(env.pending_permission_requests), ...arr(r.pending_permission_requests)]) this.onMessage(o(req));
      if (this.state === 'starting') this.setState(this.turnOpen ? 'running' : 'idle');
    }).catch(e => {
      this.readyDone();
      if (this.exited) return;
      log.warn('chats', 'initialize failed', { chat, data: errText(e) });
      if (this.state === 'starting') this.setState(this.turnOpen ? 'running' : 'idle');
    });
  }

  send(text: string, images: readonly ImageAttachment[] = []): void {
    if (this.exited || !this.proc) throw new Error('La sessione non è attiva.');
    // images first, then the text (the Messages API order recommended for image questions)
    const content: Obj[] = images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.mimeType, data: im.data } }));
    if (text || !content.length) content.push({ type: 'text', text });
    this.write({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: this.sessionId ?? '' });
    // a message queued behind a running turn is not timed (its wait is the other turn's)
    if (!this.turnOpen) this.turnT = { sent: Date.now(), warm: !!this.readyAt, n: ++this.turnsSent };
    if (!this.turnOpen) this.sink.changed({ effortSubmitted: this.selectedEffort });
    this.turnOpen = true;
    if (this.state !== 'waiting') this.setState('running');
  }

  answer(requestId: string, answer: Answer, patch?: AnswerPatch): boolean {
    const call = this.calls.get(requestId);
    if (!call) return false;
    let response: Obj;
    if (call.question) {
      if (answer.kind === 'question') response = { behavior: 'allow', updatedInput: { ...call.input, answers: flattenAnswers(answer.answers) }, toolUseID: call.toolUseId };
      else if (!answer.allow) response = { behavior: 'deny', message: answer.message?.trim() || 'Nessuna risposta dall’utente.', toolUseID: call.toolUseId };
      else throw new Error('Questa è una domanda: rispondi scegliendo le opzioni.');
    } else {
      if (answer.kind !== 'permission') throw new Error('Questa è una richiesta di permesso: rispondi consenti o rifiuta.');
      if (answer.allow) {
        // "always" = the CLI's own suggestions, kept for this session only (the app never writes settings files);
        // never when the CLI forbids a persistent rule for this ask (suppress_always_allow_rule)
        if (answer.always && call.noAlways) log.warn('chats', '"always" ignored: the CLI forbids a rule for this ask', { chat: this.opts.chatId, data: { requestId, tool: call.tool } });
        const rules = answer.always && !call.noAlways ? call.suggestions.map(x => ({ ...o(x), destination: 'session' })) : [];
        response = { behavior: 'allow', updatedInput: patch ? { ...call.input, ...patch } : call.input, toolUseID: call.toolUseId, ...(rules.length ? { updatedPermissions: rules } : {}) };
      } else {
        response = { behavior: 'deny', message: answer.message?.trim() || 'Rifiutato dall’utente.', toolUseID: call.toolUseId };
      }
    }
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
    this.calls.delete(requestId);
    log.info('chats', 'permission answered', { chat: this.opts.chatId, data: { requestId, tool: call.tool, behavior: response.behavior, always: !!response.updatedPermissions } });
    this.sink.resolved(requestId);
    this.setState(this.calls.size ? 'waiting' : this.turnOpen ? 'running' : 'idle');
    return true;
  }

  async interrupt(opts?: { keepQueued?: boolean; byUser?: boolean }): Promise<void> {
    if (this.exited || !this.proc) return;
    log.info('chats', 'interrupt', { chat: this.opts.chatId, data: { sendNow: !!opts?.keepQueued } });
    // only a turn in flight ends with a result: an interrupt on an idle CLI must not mark the next real failure
    if (this.turnOpen && opts?.byUser) this.stopping = { sendNow: !!opts.keepQueued };
    try { await this.control({ subtype: 'interrupt' }, 15000); } catch (e) { this.stopping = null; throw e; }
  }

  async setModel(model: string | null): Promise<void> {
    await this.control({ subtype: 'set_model', model: model ?? 'default' });
    if (model) this.sink.changed({ model });
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.control({ subtype: 'set_permission_mode', mode });
    this.sink.changed({ permissionMode: mode });
  }

  async setEffort(effort: Effort | null): Promise<void> {
    await this.control({ subtype: 'apply_flag_settings', settings: { effortLevel: effort } });
    this.selectedEffort = effort;
    this.sink.changed({ effort });
  }

  async rename(title: string): Promise<void> {
    // a fork before init does not know its own id yet: rename it once init names it (never the original session)
    if (!this.sessionId) { this.pendingTitle = title; return; }
    await this.control({ subtype: 'rename_session', title, source: 'host', session_id: this.sessionId });
  }

  async contextUsage(): Promise<ContextUsage | null> {
    const r = await this.control({ subtype: 'get_context_usage', detail: 'summary' });
    const totalTokens = num(r.totalTokens), maxTokens = num(r.maxTokens);
    if (totalTokens === undefined || maxTokens === undefined) return null;
    return { totalTokens, maxTokens, percentage: num(r.percentage) ?? (maxTokens ? (100 * totalTokens) / maxTokens : 0) };
  }

  /** get_usage (experimental in the SDK): session totals + claude.ai plan windows; no transcript scan. Mid-turn its
   *  session.total_cost_usd (the CLI's tracker, updated at every API response) turns the live estimate into the real cost. */
  async usage(): Promise<unknown> {
    const u = await this.control({ subtype: 'get_usage', skip_behaviors: true });
    const total = num(o(u.session).total_cost_usd);
    if (this.turnOpen && total !== undefined && total >= this.costBase && this.live.settle(total - this.costBase)) this.sink.changed({ liveCostUsd: this.live.usd() });
    return u;
  }

  close(graceMs = CLOSE_GRACE_MS, keepChildren = false): Promise<void> {
    if (this.exited || !this.proc) { this.markExited(); return this.exitPromise; }
    // a real close already asked wins over a later keeping one (a reopen after the turn while ✕ waits)
    this.keepChildren = this.closing ? this.keepChildren && keepChildren : keepChildren;
    this.closing = true;
    try { this.proc.stdin.end(); } catch { /* gone */ }
    if (this.killed) return this.exitPromise; // already being killed (app quit): no grace, no false "did not exit"
    const pid = this.proc.pid, t0 = Date.now();
    const t = setTimeout(() => {
      if (this.exited) return;
      if (this.procExited) return this.releasePipes();
      log.warn('chats', 'session did not exit, killing', { chat: this.opts.chatId, data: { pid, waitedMs: Date.now() - t0 }, cause: 'no exit within the grace after its stdin closed', hint: 'a turn or a tool still running at close; npm run logs -- --chat <id> shows what it was doing' });
      this.killAfterGrace();
    }, graceMs);
    t.unref();
    return this.exitPromise;
  }

  /** A close that took too long: with a job only the engine dies, and its exit reaps the tools from the job (a user's
   *  Excel or browser in the job stays, ADR 0026); without one, the whole tree as before. */
  private killAfterGrace(): void {
    const p = this.proc;
    if (!p || this.exited || this.killed) return;
    if (!jobGuard.has(this.job)) return this.killNow();
    this.killed = true;
    engineKills.count++;
    try { p.kill(); } catch { /* gone */ }
  }

  /** It exited, but a leftover holds the pipes it inherited, so 'close' never comes: let go of our side. */
  private releasePipes(): void {
    if (this.exited || !this.proc) return;
    log.info('chats', 'session exited, a leftover still holds its output: closing the pipes', { chat: this.opts.chatId, data: { pid: this.proc.pid } });
    closePipes(this.proc);
  }

  get alive(): boolean { return !!this.proc && !this.exited; }

  /** Kills the process tree without blocking; 'close' reports the exit. App quit uses ChatManager.killAll (sync). */
  killNow(): void {
    const p = this.proc;
    if (this.exited || !p || this.killed) return;
    this.closing = true;
    this.killed = true;
    this.jobKilled = killEngineTree(p.pid, this.job, () => p.kill(), this.opts.chatId);
    // taskkill can take seconds under load: retry the TREE kill (killing only the parent would orphan its children);
    // gone already but 'close' still waits = a leftover holds the pipes
    setTimeout(() => {
      if (this.exited) return;
      if (this.procExited) return this.releasePipes();
      log.warn('chats', 'tree kill did not land, retrying', { chat: this.opts.chatId, data: { pid: p.pid }, cause: 'still alive 12 s after the kill', hint: 'taskkill is slow on a loaded box; npm run doctor' });
      killTrees([p.pid], { fallback: () => p.kill() });
    }, 12000).unref();
  }

  // ---- process I/O ----

  private write(obj: Obj): void {
    const p = this.proc;
    if (!p || this.exited || !p.stdin.writable) throw new Error('La sessione non è attiva.');
    p.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  /** A control request; resolves with the success payload (`response.response`). */
  private control(request: Obj, timeoutMs = 20000): Promise<Obj> {
    return this.controlRaw(request, timeoutMs).then(env => o(env.response));
  }

  /** A control request; resolves with the whole success envelope ({subtype, request_id, response, pending_…}). */
  private controlRaw(request: Obj, timeoutMs = 20000): Promise<Obj> {
    if (this.exited || !this.proc) return Promise.reject(new Error('La sessione non è attiva.'));
    const id = crypto.randomBytes(6).toString('hex');
    const subtype = s(request.subtype);
    return new Promise<Obj>((resolve, reject) => {
      const timer = setTimeout(() => { this.controls.delete(id); reject(new Error(`${subtype}: nessuna risposta dal CLI`)); }, timeoutMs);
      timer.unref();
      this.controls.set(id, { resolve, reject, timer, subtype });
      try { this.write({ type: 'control_request', request_id: id, request }); }
      catch (e) { clearTimeout(timer); this.controls.delete(id); reject(e as Error); }
      log.debug('chats', 'control request', { chat: this.opts.chatId, data: { id, subtype } });
    });
  }

  private onStdout(d: string): void {
    this.out += d;
    let i: number;
    while ((i = this.out.indexOf('\n')) >= 0) {
      const line = this.out.slice(0, i).trim();
      this.out = this.out.slice(i + 1);
      if (line) this.line(line);
    }
    if (this.out.length > 50_000_000) { log.warn('chats', 'stdout line too long, dropped', { chat: this.opts.chatId }); this.out = ''; }
  }

  /** One stdout line. Never throws. */
  line(raw: string): void {
    let m: unknown;
    try { m = JSON.parse(raw); } catch {
      this.badLines += 1;
      if (this.badLines <= 20) log.warn('chats', 'non-JSON line from CLI', { chat: this.opts.chatId, data: cut(raw, 300) });
      return;
    }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    if (this.recording) record('claude', this.cliVersion, claudeKey(m as Obj), m);
    try { this.onMessage(m as Obj); } catch (e) {
      log.error('chats', 'CLI message not understood', { chat: this.opts.chatId, cause: errText(e), hint: 'protocol drift? compare with the Agent SDK sdk.d.ts and update claude.ts', data: cut(raw, 500) });
    }
  }

  private onClose(code: number | null): void {
    if (this.exited) return;
    this.flushStreams(true);
    const clean = this.closing || code === 0;
    const tail = stripAnsi(this.errTail).trim().split(/\r?\n/).slice(-4).join(' · ');
    const error = clean ? null : cut(tail || `Claude è uscito con codice ${code ?? '?'}`, 600);
    if (error) log.error('chats', 'session exited with an error', { chat: this.opts.chatId, cause: `exit ${code}: ${tail || 'no stderr'}`, hint: 'run the same claude command in a terminal to see the full error; resume with a new message' });
    else log.info('chats', 'session exit', { chat: this.opts.chatId, data: { code } });
    this.finish(clean ? 'closed' : 'error', code, error);
  }

  private fail(error: string, cause: string, hint: string): void {
    if (this.exited) return;
    log.error('chats', 'session failed', { chat: this.opts.chatId, cause, hint });
    this.finish('error', null, error);
  }

  private finish(state: ChatState, code: number | null, error: string | null): void {
    if (this.exited) return;
    this.markExited();
    for (const c of this.controls.values()) { clearTimeout(c.timer); c.reject(new Error('La sessione è terminata.')); }
    this.controls.clear();
    for (const id of [...this.calls.keys()]) { this.calls.delete(id); this.sink.resolved(id); }
    for (const t of this.tools.values()) if (t.item.status === 'running') this.sink.item({ ...t.item, status: 'error', output: t.item.output ?? 'interrotto' }, true);
    this.tools.clear();
    this.turnOpen = false;
    this.setState(state);
    this.sink.exit({ code, error });
  }

  private markExited(): void {
    if (this.exited) return;
    this.exited = true;
    this.childTelemetry.end();
    this.readyDone();
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.exitDone();
  }

  private setState(st: ChatState): void {
    if (this.state === st) return;
    this.state = st;
    this.sink.changed({ state: st });
  }

  /** The model is producing output: a turn is in flight even if we did not start it (a queued message, a task
   *  notification, a background agent), so the chat is running, not idle. */
  private activity(): void {
    if (this.turnOpen) return;
    // The CLI can start its own turn. No per-turn effort parameter was submitted by the app.
    this.sink.changed({ effortSubmitted: null });
    this.turnOpen = true;
    this.setState(this.calls.size ? 'waiting' : 'running');
  }

  private task(id: string, live: boolean): void {
    if (!id) return;
    // SendMessage to a finished agent resumes it under the same task id (CLI 2.1.283): whatever says it runs again
    // (task_started, a task_updated to running, the SendMessage result) revives it. The CLI sends a task's update before
    // its notification, so a live status after the end is a real restart, never a late update (the chats of 2026-10-16
    // closed while a resumed agent worked: its revival came as an update the app ignored)
    const n = this.tasks.size;
    if (live) this.tasks.add(id); else this.tasks.delete(id);
    if (this.tasks.size !== n) this.sink.changed({ background: this.tasks.size });
  }

  private childTask(m: Obj, state: ChildObservation['state']): void {
    const id = s(m.task_id);
    if (!id) return;
    this.childTelemetry.observe({
      key: `claude:task:${id}`, nativeId: id, toolCallId: s(m.tool_use_id) || null, parentNativeId: null,
      kind: m.task_type === 'local_agent' ? 'agent' : m.task_type === 'local_bash' ? 'shell' : 'unknown',
      state, task: s(m.description) || null, observedAt: Date.now(), source: 'live',
    });
  }

  private childTool(id: string, input: unknown, state: ChildObservation['state']): void {
    const raw = o(input);
    this.childTelemetry.observe({
      key: `claude:tool:${id}`, nativeId: null, toolCallId: id, parentNativeId: null,
      kind: 'agent', state, task: s(raw.description) || s(raw.prompt) || null, agentType: s(raw.subagent_type) || null, observedAt: Date.now(), source: 'live',
    });
  }

  /** Child tool telemetry is independent of transcript rendering, including nested assistant/user messages. */
  private childMessage(m: Obj): void {
    for (const raw of arr(o(m.message).content)) {
      const b = o(raw);
      if (m.type === 'assistant' && b.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task') && s(b.id)) {
        this.childTools.set(s(b.id), b.input);
        this.childTool(s(b.id), b.input, 'running');
      } else if (m.type === 'user' && b.type === 'tool_result' && this.childTools.has(s(b.tool_use_id))) {
        const id = s(b.tool_use_id), input = this.childTools.get(id);
        this.childTools.delete(id);
        // A background acknowledgment does not settle the child; native task events do.
        if (b.is_error === true || o(input).run_in_background !== true) {
          this.childTool(id, input, b.is_error === true ? 'failed' : o(input).run_in_background === false ? 'completed' : 'unknown');
        }
      }
    }
  }

  private sys(text: string, level: 'info' | 'warn' | 'error'): void {
    this.sink.item({ kind: 'system', id: nextId('s'), at: Date.now(), text, level }, false);
  }

  private sysCode<C extends SysCode>(code: C, params: SysParams | undefined, level: 'info' | 'warn' | 'error'): void {
    this.sink.item({ kind: 'system', id: nextId('s'), at: Date.now(), text: sysEn(code, params), level, code, params }, false);
  }

  // ---- protocol ----

  private onMessage(m: Obj): void {
    switch (m.type) {
      case 'control_request': return this.onControlRequest(m);
      case 'control_response': return this.onControlResponse(o(m.response));
      case 'control_cancel_request': {
        const id = s(m.request_id);
        if (this.calls.delete(id)) {
          log.info('chats', 'permission withdrawn by CLI', { chat: this.opts.chatId, data: { requestId: id } });
          this.sink.resolved(id);
          this.setState(this.calls.size ? 'waiting' : this.turnOpen ? 'running' : 'idle');
        }
        return;
      }
      case 'stream_event': if (m.parent_tool_use_id == null) { this.activity(); this.onStreamEvent(o(m.event)); } return;
      case 'assistant':
        this.childMessage(m);
        if (this.live.add(m)) this.sink.changed({ liveCostUsd: this.live.usd() });
        if (m.parent_tool_use_id == null) { this.countCall(m); this.activity(); this.onAssistant(m); }
        return;
      case 'user': this.childMessage(m); if (m.parent_tool_use_id == null) this.onUser(m); return;
      case 'result': return this.onResult(m);
      case 'system': return this.onSystem(m);
      case 'rate_limit_event': this.sink.rateLimit?.(m); return;
      default: if (!QUIET_TYPES.has(s(m.type))) this.drift('message type', s(m.type), m); return;
    }
  }

  private drift(kind: string, what: string, sample: unknown): void {
    drift('claude', this.cliVersion, kind, what, sample, this.opts.chatId);
  }

  private onControlRequest(m: Obj): void {
    const id = s(m.request_id);
    const r = o(m.request);
    if (r.subtype === 'hook_callback' && s(r.callback_id) === PRE_TOOL_HOOK && this.opts.preToolUse) return this.onPreToolUse(id, o(r.input));
    if (r.subtype !== 'can_use_tool') {
      this.drift('control request', s(r.subtype), m);
      log.warn('chats', 'unsupported control request from CLI', { chat: this.opts.chatId, data: { subtype: r.subtype } });
      try { this.write({ type: 'control_response', response: { subtype: 'error', request_id: id, error: `unsupported by second-brain: ${s(r.subtype)}` } }); } catch { /* gone */ }
      return;
    }
    if (this.calls.has(id)) return; // also listed in an initialize reply
    const tool = s(r.tool_name);
    const input = o(r.input);
    const question = tool === 'AskUserQuestion';
    const noAlways = r.suppress_always_allow_rule === true;
    // a suggested mode above the agent's ceiling is never offered ("Sempre" would raise it before the manager could react)
    const suggestions = arr(r.permission_suggestions).filter(x => o(x).type !== 'setMode' || !suggestedAbove(o(x).mode, this.opts.ceiling ?? null));
    const call: Call = { requestId: id, tool, input, toolUseId: s(r.tool_use_id), suggestions, question, noAlways };
    this.calls.set(id, call);
    const sub = s(r.agent_id) ? '(subagente) ' : '';
    if (s(r.agent_id)) this.childTask({ task_id: r.agent_id, task_type: 'local_agent' }, 'waiting');
    let req: Omit<PendingRequest, 'chatId'>;
    if (question) {
      const questions = questionsFrom(input);
      req = { id, type: 'question', tool, title: sub + cut(questions[0]?.question ?? 'Domanda', 140), detail: questions.map(q => q.question).join('\n'), input: trimInput(input), questions, at: Date.now() };
    } else {
      const t = permissionText(tool, input, { title: s(r.title), description: s(r.description), reason: s(r.decision_reason), blockedPath: s(r.blocked_path), cwd: this.opts.cwd });
      const always = noAlways ? [] : describeSuggestions(call.suggestions);
      req = { id, type: 'permission', tool, title: sub + t.title, detail: t.detail, input: trimInput(input), at: Date.now(), ...(always.length ? { alwaysRules: always } : { noAlways: true }) };
    }
    if (call.toolUseId) req.toolUseId = call.toolUseId;
    log.info('chats', 'can_use_tool', { chat: this.opts.chatId, data: { requestId: id, tool, type: req.type, toolUseId: call.toolUseId || null } });
    this.setState('waiting');
    this.sink.pending(req);
  }

  /** The app's in-process PreToolUse hook (opts.preToolUse): no say = an empty output (the engine goes on as without
   *  it); a refusal = permissionDecision deny with the reason the model reads. A failing hook never blocks a call. */
  private onPreToolUse(id: string, input: Obj): void {
    let response: Obj = {};
    try {
      const tool = s(input.tool_name);
      const v = input.hook_event_name === 'PreToolUse' && tool ? this.opts.preToolUse!.decide({ tool, input: input.tool_input, ...(s(input.agent_id) ? { agentId: s(input.agent_id) } : {}) }) : null;
      if (v) {
        response = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: v.deny } };
        log.info('chats', 'pre-tool hook refused', { chat: this.opts.chatId, data: { tool } });
      }
    } catch (e) { log.warn('chats', 'pre-tool hook failed: the call goes on', { chat: this.opts.chatId, cause: errText(e), hint: 'see agents/orchestrator-budget.ts' }); }
    try { this.write({ type: 'control_response', response: { subtype: 'success', request_id: id, response } }); } catch { /* gone */ }
  }

  private onControlResponse(r: Obj): void {
    const id = s(r.request_id);
    const c = this.controls.get(id);
    if (!c) return;
    this.controls.delete(id);
    clearTimeout(c.timer);
    if (r.subtype === 'error') { log.warn('chats', 'control request refused', { chat: this.opts.chatId, data: { subtype: c.subtype, error: r.error } }); c.reject(new Error(s(r.error) || `${c.subtype} rifiutato`)); }
    else c.resolve(r);
  }

  private onStreamEvent(e: Obj): void {
    switch (e.type) {
      case 'message_start':
        this.curMessage = s(o(e.message).id) || nextId('m');
        if (this.turnT && this.turnT.first === undefined) this.turnT.first = Date.now();
        return;
      case 'content_block_start': {
        const b = o(e.content_block);
        if (b.type !== 'text' && b.type !== 'thinking') { if (!QUIET_BLOCKS.has(s(b.type))) this.drift('content block', s(b.type), e); return; }
        const msg = this.curMessage ?? 'm';
        const key = `${msg}:${num(e.index) ?? 0}`;
        const item = b.type === 'text'
          ? { kind: 'assistant' as const, id: nextId('a'), at: Date.now(), text: s(b.text), streaming: true }
          : { kind: 'thinking' as const, id: nextId('th'), at: Date.now(), text: s(b.thinking) };
        const st: Stream = { key, item, emitted: false, done: false };
        this.streams.set(key, st);
        const list = this.order.get(msg) ?? [];
        list.push(st);
        this.order.set(msg, list);
        return;
      }
      case 'content_block_delta': {
        const st = this.streams.get(`${this.curMessage ?? 'm'}:${num(e.index) ?? 0}`);
        const d = o(e.delta);
        if (!st || st.done) return;
        if (d.type === 'text_delta') {
          st.item = { ...st.item, text: st.item.text + s(d.text) };
          if (this.turnT && this.turnT.text === undefined) this.turnT.text = Date.now();
        }
        else if (d.type === 'thinking_delta') st.item = { ...st.item, text: st.item.text + s(d.thinking) };
        else { if (!QUIET_DELTAS.has(s(d.type))) this.drift('stream delta', s(d.type), e); return; }
        this.dirty.add(st);
        if (!this.flushTimer) { this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flushStreams(false); }, 16); this.flushTimer.unref(); }
        return;
      }
      case 'content_block_stop': this.flushStreams(false); return;
      default: if (!QUIET_STREAM.has(s(e.type))) this.drift('stream event', s(e.type), e); return;
    }
  }

  /** Sends streamed text that changed; final = also close every open block (turn over or process gone). */
  private flushStreams(final: boolean): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    for (const st of this.dirty) {
      if (st.done || !st.item.text) continue;
      this.sink.item(st.item, st.emitted);
      st.emitted = true;
    }
    this.dirty.clear();
    if (!final) return;
    for (const st of this.streams.values()) {
      if (st.done) continue;
      st.done = true;
      if (st.emitted && st.item.kind === 'assistant') this.sink.item({ ...st.item, streaming: false }, true);
    }
    this.streams.clear();
    this.order.clear();
  }

  /** The final version of a streamed block of this message, if one is still open. */
  private takeStream(messageId: string, kind: 'assistant' | 'thinking'): Stream | null {
    const st = (this.order.get(messageId) ?? []).find(x => !x.done && x.item.kind === kind);
    if (!st) return null;
    st.done = true;
    this.dirty.delete(st);
    return st;
  }

  /** One API call of the main thread, reported once per response id (its input side is the same in every block). */
  private countCall(m: Obj): void {
    const msg = o(m.message), u = o(msg.usage), id = s(msg.id);
    if (!id || !msg.usage || this.counted.has(id)) return;
    if (this.counted.size > 5000) this.counted.clear();
    this.counted.add(id);
    const write = num(u.cache_creation_input_tokens) ?? 0;
    const context = (num(u.input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0) + write;
    this.sink.changed({ call: { context, cacheWrite: write, usd: priceUsage(s(msg.model), u) } });
  }

  private onAssistant(m: Obj): void {
    const msg = o(m.message);
    if (s(msg.model)) this.sink.changed({ modelObserved: s(msg.model) });
    const mid = s(msg.id);
    const at = Date.now();
    for (const raw of arr(msg.content)) {
      const b = o(raw);
      if (b.type === 'text') {
        const text = s(b.text);
        const st = mid ? this.takeStream(mid, 'assistant') : null;
        if (st) this.sink.item({ ...st.item, kind: 'assistant', text: text || st.item.text, streaming: false }, st.emitted);
        else if (text) this.sink.item({ kind: 'assistant', id: nextId('a'), at, text, streaming: false }, false);
        if (text.trim()) this.sink.changed({ lastText: lastLine(text) });
      } else if (b.type === 'thinking') {
        const st = mid ? this.takeStream(mid, 'thinking') : null;
        const text = s(b.thinking) || st?.item.text || '';
        if (text) this.sink.item({ kind: 'thinking', id: st?.item.id ?? nextId('th'), at: st?.item.at ?? at, text }, !!st?.emitted);
      } else if (b.type === 'tool_use') {
        const id = s(b.id) || nextId('tu');
        const name = s(b.name) || 'tool';
        const diff = diffFor(name, b.input, this.opts.cwd);
        const item: ToolItem = { kind: 'tool', id: `t-${id}`, at, name, summary: toolSummary(name, b.input, this.opts.cwd), input: trimInput(b.input), status: 'running', ...(diff ? { diff } : {}) };
        this.tools.set(id, { item, input: b.input });
        this.sink.item(item, false);
      }
    }
    const err = s(m.error);
    if (err) {
      if (API_ERROR_CODES.has(err)) this.sysCode(`api.${err}` as SysCode, undefined, 'error');
      else this.sysCode('api.other', { err }, 'error');
    }
    const ctx = num(o(m.context_usage).total_tokens);
    if (ctx !== undefined) this.sink.changed({ contextTokens: ctx });
  }

  private onUser(m: Obj): void {
    const content = o(m.message).content;
    // the user's own interrupt is told once, by its result (onResult); one the CLI reports by itself shows here
    if (typeof content === 'string') { if (/^\[Request interrupted/.test(content) && !this.stopping) this.sysCode('interrupted', undefined, 'info'); return; }
    for (const raw of arr(content)) {
      const b = o(raw);
      if (b.type === 'tool_result') {
        const tid = s(b.tool_use_id);
        const t = this.tools.get(tid);
        if (!t) continue;
        this.tools.delete(tid);
        const diff = diffFromResult(t.item.name, t.input, m.tool_use_result, this.opts.cwd);
        const item: ToolItem = { ...t.item, status: b.is_error === true ? 'error' : 'ok', output: resultText(b.content), ...(diff ? { diff } : {}) };
        this.sink.item(item, true);
        // a finished background agent resumed by SendMessage works again: counted from its result too, so the chat is
        // never closed while it runs even if the CLI's task events say nothing (its task_notification ends it)
        if (t.item.name === 'SendMessage' && b.is_error !== true) {
          const id = resumedAgent(m.tool_use_result, item.output ?? '');
          if (id) { this.task(id, true); this.childTask({ task_id: id, task_type: 'local_agent' }, 'running'); }
        }
      } else if (b.type === 'text' && /^\[Request interrupted/.test(s(b.text)) && !this.stopping) this.sysCode('interrupted', undefined, 'info');
    }
  }

  private onResult(m: Obj): void {
    this.flushStreams(true);
    this.opts.preToolUse?.turnEnded();
    const failed = m.is_error === true || (s(m.subtype) !== '' && s(m.subtype) !== 'success');
    // the turn the user stopped ends as error_during_execution: an interruption he asked for, not an error (12/10:
    // "quando faccio Invia subito vedo sempre un errore")
    const stopped = this.stopping;
    this.stopping = null;
    const interrupted = !!stopped && failed;
    const isError = failed && !interrupted;
    // total_cost_usd is the CLI's running total (restored on resume): a turn costs the difference. A total below the
    // base is a new count (e.g. /clear) — except on an error result (startup failure, expired login report 0), which
    // is ignored so the base, and the persisted total, never drop to 0 and inflate the next resumed turn.
    const reported = num(m.total_cost_usd);
    // a turn that ran says what it cost (an error result, e.g. a startup failure, may leave them out)
    if (!failed && reported === undefined) this.drift('result field', 'total_cost_usd', m);
    if (!failed && m.usage === undefined) this.drift('result field', 'usage', m);
    let total = this.costBase, turn = 0;
    if (reported !== undefined && reported >= this.costBase) { total = reported; turn = reported - this.costBase; }
    else if (reported !== undefined && !isError) { total = reported; turn = reported; }
    else if (reported !== undefined) log.warn('chats', 'error result below the cost base ignored', { chat: this.opts.chatId, data: { reported, base: this.costBase } });
    this.costBase = total;
    this.live.reset();
    const errors = arr(m.errors).map(x => stripAnsi(String(x))).filter(Boolean);
    if (interrupted) {
      if (errors.length) log.info('chats', 'interrupted turn: abort errors not shown', { chat: this.opts.chatId, data: { errors: errors.slice(0, 3) } });
      this.sysCode(stopped.sendNow ? 'stoppedByYouResend' : 'stoppedByYou', undefined, 'info');
    } else if (errors.length) this.sys(cut(errors.join(' · '), 600), 'error');
    else if (isError && s(m.result)) this.sys(cut(stripAnsi(s(m.result)), 600), 'error');
    // a failure with no words from the CLI still says why: its subtype (max turns, budget…)
    else if (isError) {
      const subtype = s(m.subtype);
      if (RESULT_ERROR_CODES.has(subtype)) this.sysCode(`turnFailed.${subtype}` as SysCode, undefined, 'error');
      else if (subtype) this.sysCode('turnFailed.other', { subtype }, 'error');
      else this.sysCode('turnFailed.none', undefined, 'error');
    }
    this.sink.item({ kind: 'result', id: nextId('r'), at: Date.now(), costUsd: Math.round(turn * 1e6) / 1e6, durationMs: num(m.duration_ms) ?? 0, turns: num(m.num_turns) ?? 0, isError, ...(interrupted ? { interrupted } : {}) }, false);
    const u = o(m.usage);
    const turnTokens = tokenUsage(u.input_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens, u.output_tokens);
    this.sink.changed({ turnCostUsd: turn, totalCostUsd: total, liveCostUsd: 0, ...(turnTokens ? { turnTokens } : {}) });
    // more sends wait in the CLI's queue: another turn follows on its own, the chat stays running
    const queued = num(m.queued_turn_count) ?? 0;
    if (queued > 0) { this.sink.changed({ effortSubmitted: null }); this.turnOpen = true; }
    else {
      this.turnOpen = false;
      // with session state events the CLI says itself when it is idle (after held-back results and background agents)
      if (!this.stateEvents) this.setState(this.calls.size ? 'waiting' : 'idle');
      // live check 2026-10-11 (CLI 2.1.283): the closing session_state_changed 'idle' may come late or not at all after
      // the last result; if nothing reopened the turn within 3 s, the chat is idle (else the tile stays "al lavoro")
      else setTimeout(() => { if (!this.turnOpen && this.state === 'running') this.setState(this.calls.size ? 'waiting' : 'idle'); }, 3000).unref?.();
    }
    log.info('chats', 'turn done', { chat: this.opts.chatId, data: { costUsd: turn, durationMs: m.duration_ms, turns: m.num_turns, isError, interrupted, queued } });
    this.logTiming(m);
    this.contextUsage().then(u => { if (u) this.sink.changed({ contextTokens: u.totalTokens, contextMaxTokens: u.maxTokens }); }).catch(() => { /* old CLI or gone */ });
  }

  /** One line per timed turn: sent → first stream event → first text → result, next to the CLI's own API time, so
   *  app overhead, engine start-up and model latency can be told apart later (`npm run logs -- --scope chats --grep timing`). */
  private logTiming(m: Obj): void {
    const t = this.turnT;
    this.turnT = null;
    if (!t) return;
    const now = Date.now();
    const rel = (x: number | undefined): number | null => (x === undefined ? null : x - t.sent);
    log.info('chats', 'timing: turn', { chat: this.opts.chatId, data: {
      turn: t.n, firstEventMs: rel(t.first), firstTextMs: rel(t.text), resultMs: now - t.sent, apiMs: num(m.duration_api_ms) ?? null,
      // the first turn of a process: was the engine already up when it was sent (warm), and how long since the spawn
      ...(t.n === 1 ? { warm: t.warm, sentAfterSpawnMs: t.sent - this.spawnedAt, readyMs: this.readyAt ? this.readyAt - this.spawnedAt : null } : {}),
    } });
  }

  private reportCommands(): void {
    if (this.cmdList) this.sink.commands?.(toCommands(this.cmdList, this.skillNames));
  }

  private onSystem(m: Obj): void {
    switch (m.subtype) {
      case 'init': {
        const sid = s(m.session_id);
        if (s(m.claude_code_version)) this.cliVersion = s(m.claude_code_version);
        if (!sid) this.drift('init field', 'session_id', m);
        // Init confirms the native id even when it matches the UUID requested at launch.
        if (sid) { this.sessionId = sid; this.sink.changed({ sessionId: sid }); }
        const mode = s(m.permissionMode) as PermissionMode;
        const effort = s(m.effort) as Effort;
        this.sink.changed({
          ...(s(m.model) ? { model: s(m.model), modelObserved: s(m.model) } : {}),
          ...(PERMISSION_MODES.includes(mode) ? { permissionMode: mode } : {}),
          ...(EFFORTS.includes(effort) ? { effort, effortObserved: effort } : {}),
          ...(s(m.claude_code_version) ? { version: s(m.claude_code_version) } : {}),
        });
        if (this.pendingTitle && this.sessionId) {
          const title = this.pendingTitle;
          this.pendingTitle = null;
          this.rename(title).catch(e => log.warn('chats', 'deferred rename failed', { chat: this.opts.chatId, data: errText(e) }));
        }
        const skills = arr(m.skills).map(s).filter(Boolean);
        if (skills.length) this.skillNames = new Set(skills);
        if (!this.cmdList && Array.isArray(m.slash_commands)) this.cmdList = m.slash_commands.map(n => ({ name: s(n) }));
        if (this.cmdList) this.reportCommands();
        if (!this.sawInit) {
          this.sawInit = true;
          for (const srv of arr(m.mcp_servers).map(o)) {
            if (s(srv.status) && !['connected', 'pending', 'needs-auth', 'disabled'].includes(s(srv.status))) this.sys(`MCP ${s(srv.name)}: ${s(srv.status)}`, 'warn');
          }
        }
        if (this.state === 'starting') this.setState('running');
        return;
      }
      case 'status': {
        const mode = s(m.permissionMode) as PermissionMode;
        if (PERMISSION_MODES.includes(mode)) this.sink.changed({ permissionMode: mode });
        if (m.status === 'compacting') this.sysCode('compacting', undefined, 'info');
        return;
      }
      case 'commands_changed': if (Array.isArray(m.commands)) { this.cmdList = m.commands; this.reportCommands(); } return;
      case 'session_state_changed': {
        this.stateEvents = true;
        const st = s(m.state);
        if (st === 'running') { this.activity(); this.setState(this.calls.size ? 'waiting' : 'running'); }
        else if (st === 'requires_action') this.setState('waiting');
        else if (st === 'idle') { this.turnOpen = false; this.setState(this.calls.size ? 'waiting' : 'idle'); }
        if (!SESSION_STATES.has(st)) this.drift('session state', st, m);
        return;
      }
      // background agents and shell commands (CLI 2.1.28x: task_started, task_updated with a status, task_notification
      // at the end): counted so the app never auto-closes a chat whose work still runs behind an idle prompt
      case 'task_started': this.childTask(m, 'running'); return this.task(s(m.task_id), true);
      case 'task_updated': {
        const st = s(o(m.patch).status);
        this.taskStatus(st, m);
        if (st) { this.task(s(m.task_id), !END_TASK.has(st)); this.childTask(m, this.childTaskState(st)); }
        return;
      }
      case 'task_notification': {
        const st = s(m.status);
        this.taskStatus(st, m);
        this.childTask(m, this.childTaskState(st));
        if (!st || END_TASK.has(st)) this.task(s(m.task_id), false);
        return;
      }
      case 'compact_boundary': {
        const meta = o(m.compact_metadata);
        this.sink.changed({ compacted: { pre: num(meta.pre_tokens) ?? null, post: num(meta.post_tokens) ?? null } });
        this.sysCode('compacted', { pre: num(meta.pre_tokens) ?? '?', post: num(meta.post_tokens) ?? '?' }, 'info');
        return;
      }
      case 'api_retry': this.sysCode('apiRetry', { attempt: num(m.attempt) ?? '?', max: num(m.max_retries) ?? '?', error: s(m.error) || num(m.error_status) || '' }, 'warn'); return;
      case 'permission_denied': this.sysCode('permissionDenied', { tool: s(m.tool_name), message: s(m.message) ? cut(stripAnsi(s(m.message)), 200) : '' }, 'warn'); return;
      case 'notification': if (s(m.text)) this.sys(cut(stripAnsi(s(m.text)), 400), 'info'); return;
      case 'informational': if (s(m.content)) this.sys(cut(stripAnsi(s(m.content)), 400), s(m.level) === 'warning' ? 'warn' : 'info'); return;
      case 'local_command_output': if (s(m.content)) this.sys(cut(stripAnsi(s(m.content)), 2000), 'info'); return;
      case 'model_refusal_fallback': case 'model_refusal_no_fallback': {
        const content = cut(stripAnsi(s(m.content)), 400);
        if (content) this.sys(content, 'warn'); else this.sysCode('modelRefusal', undefined, 'warn');
        return;
      }
      default: if (!QUIET_SYSTEM.has(s(m.subtype))) this.drift('system subtype', s(m.subtype), m); return;
    }
  }

  /** A task status outside the known ones: a new end state would keep the task (and the chat) open for ever. */
  private taskStatus(st: string, m: Obj): void {
    if (st && !END_TASK.has(st) && !LIVE_TASK.has(st)) this.drift('task status', st, m);
  }

  private childTaskState(status: string): ChildObservation['state'] {
    if (status === 'completed' || status === 'failed') return status;
    if (status === 'killed' || status === 'stopped') return 'stopped';
    if (status === 'running' || status === 'in_progress') return 'running';
    return status === 'pending' || status === 'paused' ? 'waiting' : 'unknown';
  }
}
