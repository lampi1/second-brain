// One Cursor chat run by the app through the user's installed Cursor CLI over ACP (ADR 0010: the only external
// engine; its chats spend only Cursor credits). Protocol: Agent Client Protocol, JSON-RPC 2.0, one JSON per line on
// stdio (https://agentclientprotocol.com, https://cursor.com/docs/cli/acp; shapes checked against the bundled ACP code
// of CLI 2026.07.23):
//   → initialize {protocolVersion:1, clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}}
//   → session/new {cwd, mcpServers} | session/load {sessionId, cwd, mcpServers} (resume, when loadSession is advertised)
//   → session/prompt {sessionId, prompt:[{type:'text'}]} → {stopReason, usage?} · session/cancel (stop, a notification)
//   → session/set_model {sessionId, modelId} · session/set_mode {sessionId, modeId: agent|plan}
//   ← session/update: agent_message_chunk (streamed text, replace events), agent_thought_chunk (thinking), tool_call /
//     tool_call_update (tool rows, diff counts), plan, current_mode_update, usage_update
//   ← session/request_permission → a permission panel answered allow-once / reject-once only: Cursor's allow-always
//     would write a permanent rule into the user's Cursor config, which the app never changes
//   ← cursor/ask_question → a question panel (ids ↔ labels) · cursor/create_plan → "Approvi il piano?"
//   ← cursor/update_todos, cursor/task (requests in practice) → shown and acknowledged
//   A chat restored after an app restart shows the past that session/load replays (showReplay).
// Login: the CLI's own `agent login` (cli:login). No login → session/new fails with auth required (-32000) and the
// chat shows "Accedi a Cursor"; the app never calls `authenticate` (it would start a browser login from a hidden
// process). Never auto-answers anything. Under tests only a .mjs fake may start (cli.ts cursorAllowed).
// Used by manager.ts through the HarnessSession interface.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import type { Answer, ChatItem, ChatState, Effort, PendingRequest, PermissionMode, Question } from '../../shared/contract';
import { errText, log } from '../log';
import { lineDiff, resultText, shortPath } from './claude-map';
import { cursorAllowed, cursorArgv, killTrees, resolveCursor, type CursorCommand } from './cli';
import { costOf, type AcpUsage } from './cursor-prices';
import { cut, lastLine, nextId, stripAnsi, trimInput, type ContextUsage, type HarnessSession, type SessionOptions, type SessionSink } from './session';

export interface CursorOptions extends SessionOptions {
  /** Cursor engine override (tests: a .mjs fake); default: the installed CLI (cli.ts resolveCursor) */
  cursorPath?: string;
  /** the chat's own browser MCP endpoint (passed when the agent supports http MCP) */
  mcpUrl?: string | null;
  /** app version for clientInfo */
  appVersion?: string;
  /** show the past that session/load replays (a chat restored after an app restart has no items yet) */
  showReplay?: boolean;
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const AUTH_HELP = 'Accedi a Cursor: premi “Accedi a Cursor” (apre `agent login` in un terminale), completa il login e riprova.';
const NOT_ACTIVE = 'La sessione non è attiva.';

class RpcError extends Error {
  constructor(message: string, readonly code: number) { super(message); }
}
interface Rpc { resolve(v: Obj): void; reject(e: Error): void; method: string; timer: NodeJS.Timeout | null }
type ToolItem = Extract<ChatItem, { kind: 'tool' }>;
type StreamItem = Extract<ChatItem, { kind: 'assistant' | 'thinking' }>;
interface Stream { item: StreamItem; emitted: boolean; dirty: boolean }
interface AcpOption { optionId: string; name: string; kind: string }
interface AcpQuestion { text: string; id: string; byLabel: Map<string, string> }
interface Ask {
  rpcId: number | string;
  method: 'session/request_permission' | 'cursor/ask_question' | 'cursor/create_plan';
  options?: AcpOption[];
  questions?: AcpQuestion[];
}

const KIND_NAME: Record<string, string> = {
  execute: 'Shell', read: 'Read', edit: 'Edit', delete: 'Delete', move: 'Move', search: 'Search', fetch: 'Fetch', think: 'Think', switch_mode: 'Mode', other: 'Tool',
};
const PLAN_Q = 'Approvi il piano?';
const PLAN_YES = 'Approva', PLAN_NO = 'Rifiuta';

/** Text of ACP tool call content: text blocks; diffs and terminals are summarised. */
function contentText(content: unknown): string {
  const parts: string[] = [];
  for (const raw of arr(content)) {
    const c = o(raw);
    if (c.type === 'content') parts.push(resultText([o(c.content)], 4000));
    else if (c.type === 'terminal') parts.push(`[terminale ${s(c.terminalId)}]`);
  }
  return parts.filter(Boolean).join('\n');
}

/** Unique strings: a repeated one gets " (2)", " (3)"… so labels and question texts stay keys. */
function uniq(list: string[]): string[] {
  const seen = new Map<string, number>();
  return list.map(x => { const n = (seen.get(x) ?? 0) + 1; seen.set(x, n); return n === 1 ? x : `${x} (${n})`; });
}

export class CursorSession implements HarnessSession {
  readonly harness = 'cursor' as const;
  state: ChatState = 'starting';
  sessionId: string | null;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private out = '';
  private errTail = '';
  private rpcSeq = 1;
  private rpcs = new Map<number, Rpc>();
  private asks = new Map<string, Ask>();
  private queue: string[] = [];
  private open = false;          // session/new or session/load done
  private prompting = false;
  private loading = false;
  private caps: Obj = {};
  private models: { current: string | null; available: string[] } | null = null;
  private modes: string[] = [];
  private msg: Stream | null = null;
  private thought: Stream | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private tools = new Map<string, ToolItem>();
  private planItemId: string | null = null;
  private todosItemId: string | null = null;
  private context: ContextUsage | null = null;
  private turnStart = 0;
  private closing = false;
  private killed = false;
  private exited = false;
  private badLines = 0;
  private replayUser: Extract<ChatItem, { kind: 'user' }> | null = null;
  private exitDone!: () => void;
  private readonly exitPromise = new Promise<void>(r => { this.exitDone = r; });
  private readyDone!: () => void;
  /** resolves when the session is open (or failed): the manager waits for it before adding a message to a resumed chat */
  readonly ready = new Promise<void>(r => { this.readyDone = r; });

  constructor(private readonly opts: CursorOptions, private readonly sink: SessionSink, private readonly command?: CursorCommand | null) {
    this.sessionId = opts.resume ? opts.sessionId ?? null : null;
  }

  get pid(): number | null { return this.proc?.pid ?? null; }
  get alive(): boolean { return !!this.proc && !this.exited; }
  get busy(): boolean { return !this.exited && (this.prompting || this.queue.length > 0 || this.asks.size > 0 || this.state === 'starting'); }

  /** Root flags before the `acp` command (`agent --model X acp`). */
  args(): string[] {
    return [...(this.opts.model ? ['--model', this.opts.model] : []), ...(this.opts.extraArgs ?? []), 'acp'];
  }

  start(): void {
    const chat = this.opts.chatId;
    const cmd = this.command ?? resolveCursor(this.opts.cursorPath ?? null);
    if (!cmd) return this.fail('Cursor CLI non trovato: installa la CLI di Cursor (agent) e fai login.', 'cursor CLI not found (%LOCALAPPDATA%/cursor-agent, PATH)', 'install the Cursor CLI, run `agent login`, or set SB_CURSOR_PATH');
    if (!cursorAllowed(cmd)) return this.fail('Nei test il motore Cursor reale non parte mai: serve il fake (SB_CURSOR_PATH=…/fake-cursor-acp.mjs).', `refused to start the real Cursor engine under tests (${cmd.display})`, 'point SB_CURSOR_PATH to test/fixtures/fake-cursor-acp.mjs');
    if (!fs.existsSync(this.opts.cwd)) return this.fail(`Cartella non trovata: ${this.opts.cwd}`, `cwd missing: ${this.opts.cwd}`, 'pick an existing folder for the chat');
    let argv: ReturnType<typeof cursorArgv>;
    try { argv = cursorArgv(cmd, this.args()); } catch (e) { return this.fail(`Avvio di Cursor non riuscito: ${errText(e)}`, errText(e), 'use a plain model id'); }
    try {
      this.proc = spawn(argv.command, argv.args, { cwd: this.opts.cwd, env: { ...argv.env, ...this.opts.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], windowsVerbatimArguments: argv.verbatim });
    } catch (e) {
      return this.fail(`Avvio di Cursor non riuscito: ${errText(e)}`, errText(e), 'check the Cursor CLI install');
    }
    const p = this.proc;
    log.info('chats', 'cursor session start', { chat, data: { pid: p.pid, kind: cmd.kind, engine: cmd.display, cwd: this.opts.cwd, args: this.args() } });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d: string) => this.onStdout(d));
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d: string) => { this.errTail = (this.errTail + d).slice(-4000); log.debug('chats', 'cursor stderr', { chat, data: cut(d, 500) }); });
    p.stdin.on('error', e => log.warn('chats', 'cursor stdin error', { chat, data: errText(e) }));
    p.on('error', e => this.fail(`Avvio di Cursor non riuscito: ${errText(e)}`, errText(e), 'check that `agent --version` works in a terminal'));
    p.on('close', (code: number | null) => this.onClose(code));
    void this.boot();
  }

  private async boot(): Promise<void> {
    try {
      const init = await this.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'second-brain', version: this.opts.appVersion ?? '0' },
      }, 60000);
      this.caps = o(init.agentCapabilities);
      log.info('chats', 'cursor initialized', { chat: this.opts.chatId, data: { protocolVersion: init.protocolVersion, loadSession: this.caps.loadSession === true, mcp: this.caps.mcpCapabilities, agent: init.agentInfo } });
      await this.openSession();
      await this.applyChoices();
      this.open = true;
      if (this.state === 'starting') this.setState(this.queue.length ? 'running' : 'idle');
      this.drain();
    } catch (e) {
      if (this.exited) return;
      const auth = e instanceof RpcError && (e.code === -32000 || /auth/i.test(e.message));
      if (auth) this.stopWith(AUTH_HELP, `cursor not logged in: ${errText(e)}`, 'the user runs `agent login` (cli:login), then sends again');
      else this.stopWith(`Cursor non è partito: ${errText(e)}`, errText(e), 'see the stderr lines in the log; run `agent --version` in a terminal');
    } finally { this.readyDone(); }
  }

  private mcpServers(): Obj[] {
    const url = this.opts.mcpUrl;
    return url && o(this.caps.mcpCapabilities).http === true ? [{ type: 'http', name: 'second-brain', url, headers: [] }] : [];
  }

  private async openSession(): Promise<void> {
    const base = { cwd: this.opts.cwd, mcpServers: this.mcpServers() };
    if (this.opts.resume && this.opts.sessionId) {
      if (this.caps.loadSession === true) {
        // the agent replays the past as updates before it answers: shown only when the chat has no items yet (restored
        // after an app restart); otherwise they are already on screen
        this.loading = true;
        try {
          const r = await this.request('session/load', { sessionId: this.opts.sessionId, ...base }, 120000);
          this.sessionId = this.opts.sessionId;
          this.readState(r);
          return;
        } catch (e) {
          if (e instanceof RpcError && (e.code === -32000 || /auth/i.test(e.message))) throw e;
          this.sys(`Cursor non ha ripreso la sessione precedente (${cut(errText(e), 120)}): ne apro una nuova.`, 'warn');
        } finally {
          this.loading = false;
          this.flushAll(true);
          this.replayUser = null;
          this.tools.clear(); // replayed tool rows keep the status they were replayed with
        }
      } else this.sys('Questa versione di Cursor non riprende le sessioni: ne apro una nuova.', 'warn');
    }
    const r = await this.request('session/new', base, 120000);
    const id = s(r.sessionId);
    if (!id) throw new Error('session/new senza sessionId');
    this.sessionId = id;
    this.sink.changed({ sessionId: id });
    this.readState(r);
  }

  /** Models and modes from session/new or session/load. */
  private readState(r: Obj): void {
    const m = o(r.models);
    if (Object.keys(m).length) {
      this.models = { current: s(m.currentModelId) || null, available: arr(m.availableModels).map(x => s(o(x).modelId)).filter(Boolean) };
      if (this.models.current) this.sink.changed({ model: this.models.current });
    }
    const md = o(r.modes);
    this.modes = arr(md.availableModes).map(x => s(o(x).id)).filter(Boolean);
    if (s(md.currentModeId) === 'plan') this.sink.changed({ permissionMode: 'plan' });
  }

  /** The user's model and mode for this chat, when the session started with others. */
  private async applyChoices(): Promise<void> {
    const want = this.opts.model;
    if (want && this.models && this.models.current !== want) {
      try { await this.setModel(want); } catch (e) { this.sys(`Modello ${want} non applicato: ${cut(errText(e), 160)}`, 'warn'); }
    }
    if (this.opts.permissionMode === 'plan' && this.modes.includes('plan')) {
      try { await this.setPermissionMode('plan'); } catch (e) { log.warn('chats', 'cursor plan mode not applied', { chat: this.opts.chatId, data: errText(e) }); }
    }
  }

  send(text: string): void {
    if (this.exited || !this.proc) throw new Error(NOT_ACTIVE);
    this.queue.push(text);
    if (this.state !== 'waiting' && this.state !== 'starting') this.setState('running');
    this.drain();
  }

  /** One prompt at a time per session: the next queued message goes when the previous turn ends. */
  private drain(): void {
    if (!this.open || this.prompting || this.exited) return;
    const text = this.queue.shift();
    if (text === undefined) return;
    this.prompting = true;
    this.turnStart = Date.now();
    this.planItemId = null;
    this.setState(this.asks.size ? 'waiting' : 'running');
    this.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text }] }, 0)
      .then(r => this.turnDone(r, null))
      .catch(e => this.turnDone({}, e as Error));
  }

  private turnDone(r: Obj, err: Error | null): void {
    if (this.exited) return;
    this.flushAll(true);
    for (const t of this.tools.values()) if (t.status === 'running') this.sink.item({ ...t, status: 'error', output: t.output ?? 'interrotto' }, true);
    this.tools.clear();
    const stop = s(r.stopReason);
    if (err) this.sys(`Errore di Cursor: ${cut(stripAnsi(errText(err)), 400)}`, 'error');
    else if (stop === 'refusal') this.sys('Il modello ha rifiutato la richiesta.', 'warn');
    else if (stop === 'max_tokens' || stop === 'max_turn_requests') this.sys(`Turno interrotto da Cursor (${stop}).`, 'warn');
    else if (stop === 'cancelled') this.sys('Interrotto.', 'info');
    const usage = Object.keys(o(r.usage)).length ? (o(r.usage) as AcpUsage) : null;
    const cost = costOf(this.models?.current ?? this.opts.model ?? null, usage);
    const isError = !!err || stop === 'cancelled' || stop === 'refusal';
    this.sink.item({ kind: 'result', id: nextId('r'), at: Date.now(), costUsd: cost ?? 0, durationMs: Date.now() - this.turnStart, turns: 1, isError }, false);
    this.sink.changed({ turnCostUsd: cost ?? 0, costKnown: cost !== null });
    log.info('chats', 'cursor turn done', { chat: this.opts.chatId, data: { stopReason: stop || null, error: err ? errText(err) : null, costUsd: cost, usage: !!usage } });
    this.prompting = false;
    if (this.queue.length) this.drain();
    else this.setState(this.asks.size ? 'waiting' : 'idle');
  }

  answer(requestId: string, answer: Answer): boolean {
    const ask = this.asks.get(requestId);
    if (!ask) return false;
    let result: Obj;
    if (ask.method === 'session/request_permission') {
      if (answer.kind !== 'permission') throw new Error('Questa è una richiesta di permesso: rispondi consenti o rifiuta.');
      const opts = ask.options ?? [];
      const pick = (kinds: string[]): AcpOption | undefined => kinds.map(k => opts.find(x => x.kind === k)).find(Boolean);
      // allow-always / reject-always would be written into the user's Cursor config: only the once options are used
      if (answer.allow && answer.always) log.warn('chats', '"always" ignored for Cursor: it would change Cursor\'s own config', { chat: this.opts.chatId, data: { requestId } });
      const chosen = answer.allow ? pick(['allow_once']) : pick(['reject_once']);
      result = chosen ? { outcome: { outcome: 'selected', optionId: chosen.optionId } } : { outcome: { outcome: 'cancelled' } };
    } else if (ask.method === 'cursor/ask_question') {
      if (answer.kind === 'question') {
        const answers = (ask.questions ?? []).map(q => {
          const v = answer.answers[q.text];
          const labels = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
          return { questionId: q.id, selectedOptionIds: labels.map(l => q.byLabel.get(l)).filter((x): x is string => !!x) };
        }).filter(a => a.selectedOptionIds.length);
        result = { outcome: { outcome: 'answered', answers } };
      } else if (!answer.allow) result = { outcome: { outcome: 'skipped', reason: answer.message?.trim() || 'L’utente ha saltato la domanda.' } };
      else throw new Error('Questa è una domanda: rispondi scegliendo le opzioni.');
    } else {
      const yes = answer.kind === 'question' ? [answer.answers[PLAN_Q]].flat().includes(PLAN_YES) : answer.allow;
      result = yes ? { outcome: { outcome: 'accepted' } } : { outcome: { outcome: 'rejected', ...(answer.kind === 'permission' && answer.message ? { reason: answer.message } : {}) } };
    }
    this.respond(ask.rpcId, result);
    this.asks.delete(requestId);
    log.info('chats', 'cursor request answered', { chat: this.opts.chatId, data: { requestId, method: ask.method, outcome: o(result.outcome).outcome, optionId: o(result.outcome).optionId } });
    this.sink.resolved(requestId);
    this.setState(this.asks.size ? 'waiting' : this.prompting || this.queue.length ? 'running' : 'idle');
    return true;
  }

  /** Stop: session/cancel; every open panel is answered "cancelled" (ACP requires it) and queued messages are dropped. */
  async interrupt(): Promise<void> {
    if (this.exited || !this.proc) return;
    log.info('chats', 'cursor cancel', { chat: this.opts.chatId, data: { queued: this.queue.length, open: this.asks.size } });
    if (this.queue.length) { this.sys(`Messaggi in coda annullati: ${this.queue.length}.`, 'info'); this.queue = []; }
    // cancel first, so the agent knows its turn is over when its waits resolve
    if (this.sessionId) this.notify('session/cancel', { sessionId: this.sessionId });
    for (const [id, ask] of [...this.asks]) {
      this.respond(ask.rpcId, { outcome: { outcome: 'cancelled' } });
      this.asks.delete(id);
      this.sink.resolved(id);
    }
    if (!this.prompting) this.setState('idle');
  }

  async setModel(model: string | null): Promise<void> {
    if (!this.open && !this.sessionId) throw new Error(NOT_ACTIVE);
    if (!this.models) throw new Error('Questa versione di Cursor non cambia modello durante la sessione.');
    const id = model ?? 'auto';
    await this.request('session/set_model', { sessionId: this.sessionId, modelId: id });
    this.models.current = id;
    this.sink.changed({ model: id });
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    const modeId = mode === 'plan' ? 'plan' : 'agent';
    if (!this.modes.includes(modeId)) throw new Error(`Cursor non ha la modalità ${modeId}.`);
    await this.request('session/set_mode', { sessionId: this.sessionId, modeId });
    this.sink.changed({ permissionMode: mode });
  }

  async setEffort(_effort: Effort | null): Promise<void> {
    throw new Error('L’effort non si imposta con Cursor: scegli un modello (es. con [effort=high]).');
  }

  async rename(_title: string): Promise<void> { /* the title lives in the app */ }

  async contextUsage(): Promise<ContextUsage | null> { return this.context; }

  async usage(): Promise<unknown> { return null; }

  close(graceMs = 3000): Promise<void> {
    if (this.exited || !this.proc) { this.markExited(); return this.exitPromise; }
    this.closing = true;
    try { this.proc.stdin.end(); } catch { /* gone */ }
    const t = setTimeout(() => { if (!this.exited) { log.warn('chats', 'cursor did not exit, killing', { chat: this.opts.chatId, data: { pid: this.proc?.pid } }); this.killNow(); } }, graceMs);
    t.unref();
    return this.exitPromise;
  }

  killNow(): void {
    const p = this.proc;
    if (this.exited || !p || this.killed) return;
    this.closing = true;
    this.killed = true;
    killTrees([p.pid], { fallback: () => p.kill() });
    // taskkill can take seconds under load: retry the TREE kill (killing only the parent would orphan its children)
    setTimeout(() => { if (!this.exited) killTrees([p.pid], { fallback: () => p.kill() }); }, 12000).unref();
  }

  // ---- JSON-RPC ----

  private write(obj: Obj): void {
    const p = this.proc;
    if (!p || this.exited || !p.stdin.writable) throw new Error(NOT_ACTIVE);
    p.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  /** A request to the agent; timeoutMs 0 = none (a prompt turn may last as long as it needs). */
  private request(method: string, params: Obj, timeoutMs = 20000): Promise<Obj> {
    if (this.exited || !this.proc) return Promise.reject(new Error(NOT_ACTIVE));
    const id = this.rpcSeq++;
    return new Promise<Obj>((resolve, reject) => {
      const timer = timeoutMs ? setTimeout(() => { this.rpcs.delete(id); reject(new Error(`${method}: nessuna risposta da Cursor`)); }, timeoutMs) : null;
      timer?.unref();
      this.rpcs.set(id, { resolve, reject, method, timer });
      try { this.write({ jsonrpc: '2.0', id, method, params }); }
      catch (e) { if (timer) clearTimeout(timer); this.rpcs.delete(id); reject(e as Error); }
      log.debug('chats', 'acp request', { chat: this.opts.chatId, data: { id, method } });
    });
  }

  private notify(method: string, params: Obj): void {
    try { this.write({ jsonrpc: '2.0', method, params }); } catch { /* gone */ }
  }

  private respond(id: number | string, result: Obj): void {
    try { this.write({ jsonrpc: '2.0', id, result }); } catch { /* gone: the exit path resolves the panels */ }
  }

  private respondError(id: number | string, code: number, message: string): void {
    try { this.write({ jsonrpc: '2.0', id, error: { code, message } }); } catch { /* gone */ }
  }

  private onStdout(d: string): void {
    this.out += d;
    let i: number;
    while ((i = this.out.indexOf('\n')) >= 0) {
      const line = this.out.slice(0, i).trim();
      this.out = this.out.slice(i + 1);
      if (line) this.line(line);
    }
    if (this.out.length > 50_000_000) { log.warn('chats', 'cursor stdout line too long, dropped', { chat: this.opts.chatId }); this.out = ''; }
  }

  /** One stdout line. Never throws. */
  line(raw: string): void {
    let m: unknown;
    try { m = JSON.parse(raw); } catch {
      this.badLines += 1;
      if (this.badLines <= 20) log.warn('chats', 'non-JSON line from Cursor', { chat: this.opts.chatId, data: cut(raw, 300) });
      return;
    }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    try { this.onMessage(m as Obj); } catch (e) {
      log.error('chats', 'ACP message not understood', { chat: this.opts.chatId, cause: errText(e), hint: 'protocol drift? compare with agentclientprotocol.com schema and the Cursor CLI ACP docs, update cursor.ts', data: cut(raw, 500) });
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
        log.warn('chats', 'acp error response', { chat: this.opts.chatId, data: { method: rpc.method, code: e.code, message: e.message } });
        rpc.reject(new RpcError(s(e.message) || `${rpc.method} fallito`, num(e.code) ?? -32603));
      } else rpc.resolve(o(m.result));
      return;
    }
    if (method && hasId) return this.onAgentRequest(m.id as number | string, method, o(m.params));
    if (method) return this.onNotification(method, o(m.params));
  }

  private onAgentRequest(id: number | string, method: string, p: Obj): void {
    const at = Date.now();
    const rid = nextId('ask');
    if (method === 'session/request_permission') {
      const tc = o(p.toolCall);
      const options: AcpOption[] = arr(p.options).map(x => ({ optionId: s(o(x).optionId), name: s(o(x).name), kind: s(o(x).kind) })).filter(x => x.optionId);
      const known = this.tools.get(s(tc.toolCallId)); // the tool_call that came first carries the input (command, path)
      const kindName = KIND_NAME[s(tc.kind)] ?? known?.name ?? 'Tool';
      const raw = o(tc.rawInput ?? known?.input);
      const detail = [s(raw.command), contentText(tc.content), ...arr(tc.locations).map(l => s(o(l).path))].map(x => x.trim()).filter(Boolean).join('\n');
      this.asks.set(rid, { rpcId: id, method, options });
      this.pending({
        id: rid, type: 'permission', tool: kindName, title: cut(stripAnsi(s(tc.title)) || known?.summary || `${kindName}: permesso`, 140), detail: cut(detail, 8000),
        // never "always": Cursor's allow-always writes a permanent rule into the user's Cursor config (permissions.allow),
        // valid for every Cursor session outside the app too; the app never changes another tool's config (AGENTS.md)
        input: trimInput(tc.rawInput ?? known?.input ?? tc), at, noAlways: true,
      });
      return;
    }
    if (method === 'cursor/ask_question') {
      const raw = arr(p.questions).map(x => o(x));
      const texts = uniq(raw.map(q => s(q.prompt) || 'Domanda'));
      const questions: Question[] = [];
      const acp: AcpQuestion[] = [];
      raw.forEach((q, i) => {
        const opts = arr(q.options).map(x => o(x)).filter(x => s(x.id));
        const labels = uniq(opts.map(x => s(x.label) || s(x.id)));
        const text = texts[i] ?? `Domanda ${i + 1}`;
        acp.push({ text, id: s(q.id), byLabel: new Map(labels.map((l, j) => [l, s(opts[j]?.id)])) });
        questions.push({ question: text, ...(s(p.title) ? { header: cut(s(p.title), 30) } : {}), options: labels.map(label => ({ label })), multiSelect: q.allowMultiple === true });
      });
      this.asks.set(rid, { rpcId: id, method, questions: acp });
      this.pending({ id: rid, type: 'question', tool: 'AskQuestion', title: cut(s(p.title) || questions[0]?.question || 'Domanda', 140), detail: questions.map(q => q.question).join('\n'), input: trimInput(p), questions, at });
      return;
    }
    if (method === 'cursor/create_plan') {
      const detail = [s(p.name), s(p.overview), s(p.plan)].map(x => x.trim()).filter(Boolean).join('\n\n');
      this.asks.set(rid, { rpcId: id, method });
      this.pending({
        id: rid, type: 'question', tool: 'CreatePlan', title: PLAN_Q, detail: cut(detail, 8000), input: trimInput(p), at,
        questions: [{ question: PLAN_Q, header: 'Piano', options: [{ label: PLAN_YES, description: 'Cursor procede con il piano' }, { label: PLAN_NO, description: 'Cursor non lo esegue' }], multiSelect: false }],
      });
      return;
    }
    // Cursor sends these "non-blocking" extensions as requests (extMethod): show them and acknowledge
    if (method === 'cursor/update_todos' || method === 'cursor/task') { this.showExt(method, p); this.respond(id, {}); return; }
    // fs/* and terminal/* are not offered in our capabilities; anything else is unknown
    log.warn('chats', 'unsupported ACP request from Cursor', { chat: this.opts.chatId, data: { method } });
    this.respondError(id, -32601, `Method not found: ${method}`);
  }

  /** cursor/update_todos → one "Attività" item kept up to date; cursor/task → a "Subagente" line. */
  private showExt(method: string, p: Obj): void {
    if (method === 'cursor/update_todos') {
      const todos = arr(p.todos).map(x => o(x));
      const mark = (st: string): string => (st === 'completed' ? '✓' : st === 'in_progress' ? '▸' : st === 'cancelled' ? '✗' : '○');
      const text = `Attività:\n${todos.map(t => `${mark(s(t.status))} ${s(t.content)}`).join('\n')}`;
      const id = this.todosItemId ?? nextId('todo');
      this.sink.item({ kind: 'system', id, at: Date.now(), text, level: 'info' }, !!this.todosItemId);
      this.todosItemId = id;
    } else if (method === 'cursor/task') this.sys(`Subagente: ${cut(s(p.description) || s(p.prompt), 200)}`, 'info');
  }

  private pending(req: Omit<PendingRequest, 'chatId'>): void {
    log.info('chats', 'cursor asks', { chat: this.opts.chatId, data: { requestId: req.id, type: req.type, tool: req.tool } });
    this.setState('waiting');
    this.sink.pending(req);
  }

  private onNotification(method: string, p: Obj): void {
    if (method === 'session/update') return this.onUpdate(o(p.update));
    if (method === 'cursor/update_todos' || method === 'cursor/task') this.showExt(method, p); // older CLIs: as notifications
  }

  private onUpdate(u: Obj): void {
    if (this.loading && !this.opts.showReplay) return; // replay of a session whose past is already on screen
    if (u.sessionUpdate !== 'user_message_chunk') this.replayUser = null;
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': return this.chunk('assistant', u);
      case 'agent_thought_chunk': return this.chunk('thinking', u);
      case 'user_message_chunk': {
        if (!this.loading) return; // our own message, already in the chat
        const text = s(o(u.content).text);
        if (!text) return;
        this.flushAll(true);
        const prev = this.replayUser;
        this.replayUser = prev ? { ...prev, text: prev.text + text } : { kind: 'user', id: nextId('u'), at: Date.now(), text };
        this.sink.item(this.replayUser, !!prev);
        return;
      }
      case 'tool_call': return this.toolCall(u, true);
      case 'tool_call_update': return this.toolCall(u, false);
      case 'plan': {
        const mark = (st: string): string => (st === 'completed' ? '✓' : st === 'in_progress' ? '▸' : '○');
        const text = `Piano:\n${arr(u.entries).map(x => o(x)).map(e => `${mark(s(e.status))} ${s(e.content)}`).join('\n')}`;
        const id = this.planItemId ?? nextId('plan');
        this.sink.item({ kind: 'system', id, at: Date.now(), text, level: 'info' }, !!this.planItemId);
        this.planItemId = id;
        return;
      }
      case 'current_mode_update': this.sink.changed({ permissionMode: s(u.currentModeId) === 'plan' ? 'plan' : 'default' }); return;
      case 'usage_update': {
        const used = num(u.used), size = num(u.size);
        if (used !== undefined && size) {
          this.context = { totalTokens: used, maxTokens: size, percentage: (100 * used) / size };
          this.sink.changed({ contextTokens: used, contextMaxTokens: size });
        }
        return;
      }
      default: return; // available_commands_update, session_info_update, config_option_update, notice…
    }
  }

  private chunk(kind: 'assistant' | 'thinking', u: Obj): void {
    const c = o(u.content);
    const text = c.type === 'text' ? s(c.text) : c.type === 'image' ? '[immagine]' : '';
    if (!text) return;
    const other = kind === 'assistant' ? this.thought : this.msg;
    if (other) this.finish(other);
    let st = kind === 'assistant' ? this.msg : this.thought;
    if (!st) {
      const item: StreamItem = kind === 'assistant'
        ? { kind: 'assistant', id: nextId('a'), at: Date.now(), text: '', streaming: true }
        : { kind: 'thinking', id: nextId('th'), at: Date.now(), text: '' };
      st = { item, emitted: false, dirty: false };
      if (kind === 'assistant') this.msg = st; else this.thought = st;
    }
    st.item = { ...st.item, text: st.item.text + text };
    st.dirty = true;
    if (!this.flushTimer) { this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flushAll(false); }, 50); this.flushTimer.unref(); }
  }

  private flushOne(st: Stream): void {
    if (!st.dirty) return;
    this.sink.item(st.item, st.emitted);
    st.emitted = true;
    st.dirty = false;
  }

  /** Closes a stream: last text out, streaming off, last line for the tile. */
  private finish(st: Stream): void {
    this.flushOne(st);
    if (st.item.kind === 'assistant') {
      if (st.emitted) this.sink.item({ ...st.item, streaming: false }, true);
      if (st.item.text.trim()) this.sink.changed({ lastText: lastLine(st.item.text) });
      this.msg = null;
    } else this.thought = null;
  }

  private flushAll(final: boolean): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    for (const st of [this.msg, this.thought]) if (st) { if (final) this.finish(st); else this.flushOne(st); }
  }

  private toolCall(u: Obj, isNew: boolean): void {
    const id = s(u.toolCallId);
    if (!id) return;
    this.flushAll(true);
    const prev = this.tools.get(id);
    const kind = s(u.kind) || (prev ? '' : 'other');
    const name = kind ? KIND_NAME[kind] ?? 'Tool' : prev?.name ?? 'Tool';
    const title = s(u.title) ? stripAnsi(s(u.title)).replace(/`/g, '') : '';
    const status = s(u.status);
    const diffs = arr(u.content).map(x => o(x)).filter(c => c.type === 'diff' && s(c.path)).map(c => ({ path: shortPath(s(c.path), this.opts.cwd), ...lineDiff(s(c.oldText), s(c.newText)) }));
    const text = [contentText(u.content), typeof u.rawOutput === 'string' ? u.rawOutput : s(o(u.rawOutput).output) || s(o(u.rawOutput).stdout)].filter(Boolean).join('\n');
    const base: ToolItem = prev ?? { kind: 'tool', id: `t-${id}`, at: Date.now(), name, summary: name, input: trimInput(u.rawInput ?? {}), status: 'running' };
    const item: ToolItem = {
      ...base,
      name,
      summary: title ? cut(title.toLowerCase().startsWith(name.toLowerCase()) ? title : `${name}: ${title}`, 100) : base.summary,
      ...(u.rawInput !== undefined ? { input: trimInput(u.rawInput) } : {}),
      status: status === 'completed' ? 'ok' : status === 'failed' ? 'error' : status ? 'running' : base.status,
      ...(text ? { output: cut(text, 4000) } : {}),
      ...(diffs.length ? { diff: diffs } : {}),
    };
    this.tools.set(id, item);
    this.sink.item(item, !isNew || !!prev);
  }

  private onClose(code: number | null): void {
    if (this.exited) return;
    this.flushAll(true);
    const clean = this.closing || code === 0;
    const tail = stripAnsi(this.errTail).trim().split(/\r?\n/).slice(-4).join(' · ');
    const error = clean ? null : cut(tail || `Cursor è uscito con codice ${code ?? '?'}`, 600);
    if (error) log.error('chats', 'cursor exited with an error', { chat: this.opts.chatId, cause: `exit ${code}: ${tail || 'no stderr'}`, hint: 'run `agent --version` and `agent status` in a terminal; resume with a new message' });
    else log.info('chats', 'cursor session exit', { chat: this.opts.chatId, data: { code } });
    this.end(clean ? 'closed' : 'error', code, error);
  }

  private fail(error: string, cause: string, hint: string): void {
    if (this.exited) return;
    log.error('chats', 'cursor session failed', { chat: this.opts.chatId, cause, hint });
    this.end('error', null, error);
  }

  /** A fatal boot error with the process still running: report it and stop the process. */
  private stopWith(error: string, cause: string, hint: string): void {
    const p = this.proc;
    this.fail(error, cause, hint);
    if (p) { try { p.stdin.end(); } catch { /* gone */ } killTrees([p.pid], { fallback: () => p.kill() }); }
  }

  private end(state: ChatState, code: number | null, error: string | null): void {
    if (this.exited) return;
    this.markExited();
    for (const r of this.rpcs.values()) { if (r.timer) clearTimeout(r.timer); r.reject(new Error('La sessione è terminata.')); }
    this.rpcs.clear();
    for (const id of [...this.asks.keys()]) { this.asks.delete(id); this.sink.resolved(id); }
    for (const t of this.tools.values()) if (t.status === 'running') this.sink.item({ ...t, status: 'error', output: t.output ?? 'interrotto' }, true);
    this.tools.clear();
    this.queue = [];
    this.prompting = false;
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

  private sys(text: string, level: 'info' | 'warn' | 'error'): void {
    this.sink.item({ kind: 'system', id: nextId('s'), at: Date.now(), text, level }, false);
  }
}
