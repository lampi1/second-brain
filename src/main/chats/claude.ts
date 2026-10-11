// One Claude Code chat run by the app through the user's own `claude` CLI (ADR 0002: same login, settings, hooks,
// skills, CLAUDE.md and transcripts as his terminal; no SDK dependency). Protocol = what the Agent SDK speaks:
//   claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages
//          --permission-prompt-tool stdio --permission-mode <explicit> [--model] [--effort] [--resume=|--session-id=] …
//          [--settings <inline JSON>: session-only; the STABLE app adds deny guard rails, ADR 0007]
//   env    CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1 → system/session_state_changed running/idle (authoritative)
//   stdin  ← {"type":"user",…} turns and {"type":"control_request",request_id,request:{subtype}} (initialize,
//            interrupt, set_model, set_permission_mode, apply_flag_settings {effortLevel}, get_context_usage,
//            rename_session)
//   stdout → SDK messages (system/init, stream_event deltas, assistant, user tool results, result with cost) and the
//            CLI's own control requests: can_use_tool (permissions and AskUserQuestion), answered with
//            {"type":"control_response","response":{"subtype":"success",request_id,response:{behavior,…}}}.
// Messages become contract ChatItems (streamed text as replace events, tool rows with a one-line summary, diff counts,
// results with cost). Robust by design: a bad line is logged and skipped, a dead process becomes state closed/error
// with the reason, and nothing here can throw into the app. Used by manager.ts through the HarnessSession interface.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Answer, ChatItem, ChatState, Effort, PendingRequest, PermissionMode } from '../../shared/contract';
import { errText, log } from '../log';
import { commandFor, findCli, killTrees, resolveClaude } from './cli';
import { describeSuggestions, diffFor, diffFromResult, flattenAnswers, permissionText, questionsFrom, resultText, toolSummary } from './claude-map';
import { cut, lastLine, nextId, stripAnsi, trimInput, type ContextUsage, type HarnessSession, type SessionOptions, type SessionSink } from './session';

export interface ClaudeOptions extends SessionOptions {
  /** claude binary or a .mjs fake (tests); default: `claude` resolved on PATH */
  claudePath?: string;
  /** session-only settings for this chat (passed inline with --settings, never written to a file) */
  settings?: Record<string, unknown> | null;
  /** run by the STABLE app (ADR 0007): add the guard rails; default = process.env.SB_RELEASE is set */
  stable?: boolean;
  /** %LOCALAPPDATA% (where the stable releases live); default from the environment */
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

/** Guard rails for chats run by the STABLE app (ADR 0007): they must never stop the app they run in nor change its
 *  releases. Session-only deny rules (deny wins over every allow, at any level). `Edit(path)` covers every file-editing
 *  tool (Write, MultiEdit, NotebookEdit): path rules written for those tools are ignored by Claude Code. */
export function stableGuards(localAppData: string): Record<string, unknown> {
  return {
    permissions: {
      deny: [
        'Bash(taskkill:*)', 'Bash(Stop-Process:*)', 'Bash(kill:*)', 'Bash(pkill:*)', 'Bash(killall:*)',
        'PowerShell(Stop-Process:*)', 'PowerShell(taskkill:*)',
        `Edit(${rulePath(path.join(localAppData, 'second-brain'))}/**)`,
      ],
    },
  };
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

const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'];
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

interface Call { requestId: string; tool: string; input: Obj; toolUseId: string; suggestions: unknown[]; question: boolean; noAlways: boolean }
interface Control { resolve(v: Obj): void; reject(e: Error): void; timer: NodeJS.Timeout; subtype: string }
interface Stream { key: string; item: Extract<ChatItem, { kind: 'assistant' | 'thinking' }>; emitted: boolean; done: boolean }
type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

const API_ERRORS: Record<string, string> = {
  authentication_failed: 'Login di Claude non valido: esegui `claude` nel terminale e fai /login, poi riprova.',
  oauth_org_not_allowed: 'Questo account non può usare Claude Code: controlla il login (`claude /login`).',
  rate_limit: 'Limite di utilizzo raggiunto: aspetta il reset o cambia modello.',
  overloaded: 'API di Anthropic sovraccarica: riprova tra poco.',
  billing_error: 'Problema di fatturazione sull’account Claude.',
  model_not_found: 'Modello non trovato: scegline un altro.',
  max_output_tokens: 'Risposta troncata: raggiunto il limite di token in uscita.',
};

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
  private stateEvents = false;        // the CLI sends session_state_changed (authoritative running/idle)
  private closing = false;
  private killed = false;
  private exited = false;
  private sawInit = false;
  private pendingTitle: string | null = null; // a fork renamed before its own id is known
  private costBase: number;
  private badLines = 0;
  private exitDone!: () => void;
  private readonly exitPromise = new Promise<void>(r => { this.exitDone = r; });

  constructor(private readonly opts: ClaudeOptions, private readonly sink: SessionSink) {
    // a fork gets its own id from the CLI at init: until then nothing may name the original session
    this.sessionId = opts.fork ? null : opts.sessionId ?? null;
    this.costBase = opts.costBaseUsd ?? 0;
  }

  get pid(): number | null { return this.proc?.pid ?? null; }

  /** Working: a turn in flight, a question open or still booting (stopAll counts these). */
  get busy(): boolean {
    return !this.exited && (this.turnOpen || this.calls.size > 0 || this.state === 'starting' || this.state === 'running' || this.state === 'waiting');
  }

  /** The CLI arguments (exported for tests and the log). */
  args(): string[] {
    const op = this.opts;
    const a = ['-p', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--include-partial-messages',
      '--permission-prompt-tool', 'stdio'];
    // no choice = the user's settings.json decides (defaultMode, e.g. auto); the CLI reports the mode at init (ADR 0002)
    if (op.permissionMode) a.push('--permission-mode', op.permissionMode);
    // `--flag=<id>`: an id can never be read as another flag (ids are UUIDs, checked by the manager)
    if (op.resume && op.sessionId) { a.push(`--resume=${op.sessionId}`); if (op.fork) a.push('--fork-session'); }
    else if (op.sessionId) a.push(`--session-id=${op.sessionId}`);
    if (op.model) a.push('--model', op.model);
    if (op.effort) a.push('--effort', op.effort);
    if (op.title && (!op.resume || op.fork)) a.push('--name', op.title);
    if (op.worktree && !op.resume) a.push('--worktree');
    const stable = op.stable ?? !!process.env.SB_RELEASE;
    const settings = mergeSettings(op.settings, stable ? stableGuards(op.localAppData ?? process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')) : null);
    if (settings) a.push('--settings', JSON.stringify(settings)); // inline: session-only, no file is written
    if (op.mcpConfig) a.push('--mcp-config', op.mcpConfig); // variadic flag: keep it after the plain ones
    return [...a, ...(op.extraArgs ?? [])];
  }

  start(): void {
    const chat = this.opts.chatId;
    // embedded engine by default (ADR 0010); an explicit path (tests, SB_CLAUDE_PATH) wins
    const cli = this.opts.claudePath ? findCli(this.opts.claudePath) : resolveClaude()?.path ?? null;
    if (!cli || !fs.existsSync(cli)) return this.fail(`Motore Claude non trovato${cli ? `: ${cli}` : ''}. Reinstalla l’app (il motore è incluso) o imposta SB_CLAUDE_PATH.`, `claude engine not found (${cli ?? 'embedded/PATH'})`, 'run npm ci (embedded engine in node_modules/@anthropic-ai/claude-agent-sdk-win32-x64) or set SB_ENGINE_CLAUDE / SB_CLAUDE_PATH');
    if (!fs.existsSync(this.opts.cwd)) return this.fail(`Cartella non trovata: ${this.opts.cwd}`, `cwd missing: ${this.opts.cwd}`, 'pick an existing folder for the chat');
    const env = { ...process.env, ...this.opts.env };
    env.MCP_TOOL_TIMEOUT = env.MCP_TOOL_TIMEOUT ?? '600000'; // browser tools may wait on a page
    env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS = '1';         // session_state_changed: the authoritative running/idle
    const args = this.args();
    const c = commandFor(cli, args, env);
    try {
      this.proc = spawn(c.command, c.args, { cwd: this.opts.cwd, env: c.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return this.fail(`Avvio di Claude non riuscito: ${errText(e)}`, errText(e), 'check the claude path and the folder');
    }
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
    this.controlRaw({ subtype: 'initialize', hooks: null }, 60000).then(env => {
      const r = o(env.response);
      const v = s(r.claude_code_version);
      if (v) this.sink.changed({ version: v });
      // prompts inherited by a resume ride on the control_response envelope, next to `response` (sdk.d.ts ControlResponse)
      for (const req of [...arr(env.pending_permission_requests), ...arr(r.pending_permission_requests)]) this.onMessage(o(req));
      if (this.state === 'starting') this.setState(this.turnOpen ? 'running' : 'idle');
    }).catch(e => {
      if (this.exited) return;
      log.warn('chats', 'initialize failed', { chat, data: errText(e) });
      if (this.state === 'starting') this.setState(this.turnOpen ? 'running' : 'idle');
    });
  }

  send(text: string): void {
    if (this.exited || !this.proc) throw new Error('La sessione non è attiva.');
    this.write({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null, session_id: this.sessionId ?? '' });
    this.turnOpen = true;
    if (this.state !== 'waiting') this.setState('running');
  }

  answer(requestId: string, answer: Answer): boolean {
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
        response = { behavior: 'allow', updatedInput: call.input, toolUseID: call.toolUseId, ...(rules.length ? { updatedPermissions: rules } : {}) };
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

  async interrupt(): Promise<void> {
    if (this.exited || !this.proc) return;
    log.info('chats', 'interrupt', { chat: this.opts.chatId });
    await this.control({ subtype: 'interrupt' }, 15000);
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

  /** get_usage (experimental in the SDK): session totals + claude.ai plan windows; no transcript scan. */
  async usage(): Promise<unknown> {
    return this.control({ subtype: 'get_usage', skip_behaviors: true });
  }

  close(graceMs = 3000): Promise<void> {
    if (this.exited || !this.proc) { this.markExited(); return this.exitPromise; }
    this.closing = true;
    try { this.proc.stdin.end(); } catch { /* gone */ }
    const pid = this.proc.pid;
    const t = setTimeout(() => { if (!this.exited) { log.warn('chats', 'session did not exit, killing', { chat: this.opts.chatId, data: { pid } }); this.killNow(); } }, graceMs);
    t.unref();
    return this.exitPromise;
  }

  get alive(): boolean { return !!this.proc && !this.exited; }

  /** Kills the process tree without blocking; 'close' reports the exit. App quit uses ChatManager.killAll (sync). */
  killNow(): void {
    const p = this.proc;
    if (this.exited || !p || this.killed) return;
    this.closing = true;
    this.killed = true;
    killTrees([p.pid], { fallback: () => p.kill() });
    // if the app is still alive and the tree kill did not land, terminate the process itself
    // taskkill can take seconds under load: retry the TREE kill (killing only the parent would orphan its children)
    setTimeout(() => { if (!this.exited) { log.warn('chats', 'tree kill did not land, retrying', { chat: this.opts.chatId, data: { pid: p.pid } }); killTrees([p.pid], { fallback: () => p.kill() }); } }, 12000).unref();
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
    this.turnOpen = true;
    this.setState(this.calls.size ? 'waiting' : 'running');
  }

  private sys(text: string, level: 'info' | 'warn' | 'error'): void {
    this.sink.item({ kind: 'system', id: nextId('s'), at: Date.now(), text, level }, false);
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
      case 'assistant': if (m.parent_tool_use_id == null) { this.activity(); this.onAssistant(m); } return;
      case 'user': if (m.parent_tool_use_id == null) this.onUser(m); return;
      case 'result': return this.onResult(m);
      case 'system': return this.onSystem(m);
      case 'rate_limit_event': this.sink.rateLimit?.(m); return;
      default: return; // keep_alive, auth_status, rate limits, prompt suggestions…: nothing to show
    }
  }

  private onControlRequest(m: Obj): void {
    const id = s(m.request_id);
    const r = o(m.request);
    if (r.subtype !== 'can_use_tool') {
      log.warn('chats', 'unsupported control request from CLI', { chat: this.opts.chatId, data: { subtype: r.subtype } });
      try { this.write({ type: 'control_response', response: { subtype: 'error', request_id: id, error: `unsupported by second-brain: ${s(r.subtype)}` } }); } catch { /* gone */ }
      return;
    }
    if (this.calls.has(id)) return; // also listed in an initialize reply
    const tool = s(r.tool_name);
    const input = o(r.input);
    const question = tool === 'AskUserQuestion';
    const noAlways = r.suppress_always_allow_rule === true;
    const call: Call = { requestId: id, tool, input, toolUseId: s(r.tool_use_id), suggestions: arr(r.permission_suggestions), question, noAlways };
    this.calls.set(id, call);
    const sub = s(r.agent_id) ? '(subagente) ' : '';
    let req: Omit<PendingRequest, 'chatId'>;
    if (question) {
      const questions = questionsFrom(input);
      req = { id, type: 'question', tool, title: sub + cut(questions[0]?.question ?? 'Domanda', 140), detail: questions.map(q => q.question).join('\n'), input: trimInput(input), questions, at: Date.now() };
    } else {
      const t = permissionText(tool, input, { title: s(r.title), description: s(r.description), reason: s(r.decision_reason), blockedPath: s(r.blocked_path), cwd: this.opts.cwd });
      const always = noAlways ? [] : describeSuggestions(call.suggestions);
      req = { id, type: 'permission', tool, title: sub + t.title, detail: t.detail, input: trimInput(input), at: Date.now(), ...(always.length ? { alwaysRules: always } : { noAlways: true }) };
    }
    log.info('chats', 'can_use_tool', { chat: this.opts.chatId, data: { requestId: id, tool, type: req.type } });
    this.setState('waiting');
    this.sink.pending(req);
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
      case 'message_start': this.curMessage = s(o(e.message).id) || nextId('m'); return;
      case 'content_block_start': {
        const b = o(e.content_block);
        if (b.type !== 'text' && b.type !== 'thinking') return;
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
        if (d.type === 'text_delta') st.item = { ...st.item, text: st.item.text + s(d.text) };
        else if (d.type === 'thinking_delta') st.item = { ...st.item, text: st.item.text + s(d.thinking) };
        else return;
        this.dirty.add(st);
        if (!this.flushTimer) { this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flushStreams(false); }, 50); this.flushTimer.unref(); }
        return;
      }
      case 'content_block_stop': this.flushStreams(false); return;
      default: return;
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

  private onAssistant(m: Obj): void {
    const msg = o(m.message);
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
    if (err) this.sys(API_ERRORS[err] ?? `Errore dell’API: ${err}`, 'error');
    const ctx = num(o(m.context_usage).total_tokens);
    if (ctx !== undefined) this.sink.changed({ contextTokens: ctx });
  }

  private onUser(m: Obj): void {
    const content = o(m.message).content;
    if (typeof content === 'string') { if (/^\[Request interrupted/.test(content)) this.sys('Interrotto.', 'info'); return; }
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
      } else if (b.type === 'text' && /^\[Request interrupted/.test(s(b.text))) this.sys('Interrotto.', 'info');
    }
  }

  private onResult(m: Obj): void {
    this.flushStreams(true);
    const isError = m.is_error === true || (s(m.subtype) !== '' && s(m.subtype) !== 'success');
    // total_cost_usd is the CLI's running total (restored on resume): a turn costs the difference. A total below the
    // base is a new count (e.g. /clear) — except on an error result (startup failure, expired login report 0), which
    // is ignored so the base, and the persisted total, never drop to 0 and inflate the next resumed turn.
    const reported = num(m.total_cost_usd);
    let total = this.costBase, turn = 0;
    if (reported !== undefined && reported >= this.costBase) { total = reported; turn = reported - this.costBase; }
    else if (reported !== undefined && !isError) { total = reported; turn = reported; }
    else if (reported !== undefined) log.warn('chats', 'error result below the cost base ignored', { chat: this.opts.chatId, data: { reported, base: this.costBase } });
    this.costBase = total;
    const errors = arr(m.errors).map(x => stripAnsi(String(x))).filter(Boolean);
    if (errors.length) this.sys(cut(errors.join(' · '), 600), 'error');
    else if (isError && s(m.result)) this.sys(cut(stripAnsi(s(m.result)), 600), 'error');
    this.sink.item({ kind: 'result', id: nextId('r'), at: Date.now(), costUsd: Math.round(turn * 1e6) / 1e6, durationMs: num(m.duration_ms) ?? 0, turns: num(m.num_turns) ?? 0, isError }, false);
    this.sink.changed({ turnCostUsd: turn, totalCostUsd: total });
    // more sends wait in the CLI's queue: another turn follows on its own, the chat stays running
    const queued = num(m.queued_turn_count) ?? 0;
    if (queued > 0) this.turnOpen = true;
    else {
      this.turnOpen = false;
      // with session state events the CLI says itself when it is idle (after held-back results and background agents)
      if (!this.stateEvents) this.setState(this.calls.size ? 'waiting' : 'idle');
      // live check 2026-10-11 (CLI 2.1.283): the closing session_state_changed 'idle' may come late or not at all after
      // the last result; if nothing reopened the turn within 3 s, the chat is idle (else the tile stays "al lavoro")
      else setTimeout(() => { if (!this.turnOpen && this.state === 'running') this.setState(this.calls.size ? 'waiting' : 'idle'); }, 3000).unref?.();
    }
    log.info('chats', 'turn done', { chat: this.opts.chatId, data: { costUsd: turn, durationMs: m.duration_ms, turns: m.num_turns, isError, queued } });
    this.contextUsage().then(u => { if (u) this.sink.changed({ contextTokens: u.totalTokens, contextMaxTokens: u.maxTokens }); }).catch(() => { /* old CLI or gone */ });
  }

  private onSystem(m: Obj): void {
    switch (m.subtype) {
      case 'init': {
        const sid = s(m.session_id);
        if (sid && sid !== this.sessionId) { this.sessionId = sid; this.sink.changed({ sessionId: sid }); }
        const mode = s(m.permissionMode) as PermissionMode;
        const effort = s(m.effort) as Effort;
        this.sink.changed({
          ...(s(m.model) ? { model: s(m.model) } : {}),
          ...(PERMISSION_MODES.includes(mode) ? { permissionMode: mode } : {}),
          ...(EFFORTS.includes(effort) ? { effort } : {}),
          ...(s(m.claude_code_version) ? { version: s(m.claude_code_version) } : {}),
        });
        if (this.pendingTitle && this.sessionId) {
          const title = this.pendingTitle;
          this.pendingTitle = null;
          this.rename(title).catch(e => log.warn('chats', 'deferred rename failed', { chat: this.opts.chatId, data: errText(e) }));
        }
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
        if (m.status === 'compacting') this.sys('Compattazione del contesto…', 'info');
        return;
      }
      case 'session_state_changed': {
        this.stateEvents = true;
        const st = s(m.state);
        if (st === 'running') { this.turnOpen = true; this.setState(this.calls.size ? 'waiting' : 'running'); }
        else if (st === 'requires_action') this.setState('waiting');
        else if (st === 'idle') { this.turnOpen = false; this.setState(this.calls.size ? 'waiting' : 'idle'); }
        return;
      }
      case 'compact_boundary': {
        const meta = o(m.compact_metadata);
        this.sys(`Contesto compattato (${num(meta.pre_tokens) ?? '?'} → ${num(meta.post_tokens) ?? '?'} token).`, 'info');
        return;
      }
      case 'api_retry': this.sys(`Nuovo tentativo API ${num(m.attempt) ?? '?'}/${num(m.max_retries) ?? '?'} (${s(m.error) || num(m.error_status) || 'errore'}).`, 'warn'); return;
      case 'permission_denied': this.sys(`Permesso negato: ${s(m.tool_name)}${s(m.message) ? ` · ${cut(stripAnsi(s(m.message)), 200)}` : ''}`, 'warn'); return;
      case 'notification': if (s(m.text)) this.sys(cut(stripAnsi(s(m.text)), 400), 'info'); return;
      case 'informational': if (s(m.content)) this.sys(cut(stripAnsi(s(m.content)), 400), s(m.level) === 'warning' ? 'warn' : 'info'); return;
      case 'local_command_output': if (s(m.content)) this.sys(cut(stripAnsi(s(m.content)), 2000), 'info'); return;
      case 'model_refusal_fallback': case 'model_refusal_no_fallback': this.sys(cut(stripAnsi(s(m.content)) || 'Il modello ha rifiutato la richiesta.', 400), 'warn'); return;
      default: return;
    }
  }
}
