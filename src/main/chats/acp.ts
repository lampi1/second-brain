// One chat run by the app through an ACP CLI the user installed (ADR 0010, ADR 0046: one adapter for every ACP engine,
// Cursor `agent acp`, Kimi `kimi acp`…; each chat spends only that engine's credits). The engine
// comes in the options (engineId, label, args, modelFlag); what only Cursor has (its CURSOR_CONFIG_DIR snapshot, the
// subagent hooks, the list-price fallback, the model options from Settings) runs only when the Cursor entry passes its
// option (engines/sessions.ts), never by the engine's name. The cursor/* extension requests below are answered for any
// engine (others simply never send them). Protocol: Agent Client Protocol, JSON-RPC 2.0, one JSON per line on stdio
// (https://agentclientprotocol.com, https://cursor.com/docs/cli/acp; shapes checked against the bundled ACP code of the
// Cursor CLI 2026.07.23):
//   → initialize {protocolVersion:1, clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}}
//   → session/new {cwd, mcpServers} | session/load {sessionId, cwd, mcpServers} (resume, when loadSession is advertised)
//   → session/prompt {sessionId, prompt:[{type:'image',mimeType,data}…, {type:'text'}]} → {stopReason, usage?} (images as
//     blocks only when promptCapabilities.image; otherwise saved as files whose paths go in the text) · session/cancel
//   → session/set_config_option {sessionId, configId, value}: the model's reasoning (option of category thought_level,
//     e.g. reasoning_effort: the chat's effort, else the user's settings, Chat aperte dall'Orchestrator; mid-chat by
//     setEffort, mapped onto the values the parameter offers) and fast, from the user's settings. Offered because initialize
//     sends clientCapabilities._meta.parameterizedModelPicker (CLI 2026.07.23 acp/cursor-acp-agent): session/new|load
//     then answer configOptions with each model parameter; without it the CLI keeps its own variant (high, fast) whatever
//     --model or cli-config.json say (seen 2026-10-12 with grok-4.7). It writes only the app's own CURSOR_CONFIG_DIR.
//   → session/set_mode {sessionId, modeId: agent|plan} (session-only). NEVER session/set_model: it writes the user's
//     global Cursor CLI config. The model is `--model X` at spawn, and even that is written by the CLI into its config
//     folder (handleInitialModel → updateConfig), so the app runs Cursor with its own CURSOR_CONFIG_DIR (configDir).
//     A model change = the manager closes the session and reopens it with the new --model + session/load.
//   ← session/update: agent_message_chunk (streamed text, replace events), agent_thought_chunk (thinking), tool_call /
//     tool_call_update (tool rows, diff counts), plan, current_mode_update, usage_update
//   ← session/request_permission → allow-once / reject-once only: remembered upstream grants skip later app gates;
//     Cursor's allow-always also writes permanent global CLI rules.
//   ← cursor/ask_question → a question panel (ids ↔ labels); a free-text "Altro…" answer goes back as outcome skipped;
//     a question that is not yes/no goes back skipped with how to ask (shared/yes-no.ts, ADR 0135)
//     with the text as its reason (the CLI's answered outcome keeps only option ids: acp ask-question-handler)
//   ← cursor/create_plan → "Approvi il piano?" ("Altro…" = rejected with the user's words as the reason)
//   ← cursor/update_todos, cursor/task (requests in practice) → shown and acknowledged
//   A chat restored after an app restart shows the past that session/load replays (showReplay).
// Network drops: Cursor ends the turn normally (end_turn, no JSON-RPC error) with its transport error as the last
// assistant text ("Error: RetriableError: [aborted] read ECONNRESET", "[unavailable] PING timed out"; seen 2026-10-12 on
// every Cursor chat at once, hourly). The session sends "continue" by itself, at most twice per user message (5 s,
// then 20 s), with a visible line; still failing → it stops with a clear warning (isNetError, retryNet).
// OpenCode (`opencode acp`, checked against 1.19.5): session/new|load answer no `models` and no `modes`, only configOptions
// (category model with every provider/model id, mode build|plan, thought_level "effort" once a model has one); a load
// goes back to the default model. With modelOption the chat's model is set there after every open (session-only: its
// global config is not written), and the mode goes through the mode option. A provider refusal (free limit reached, no
// credits) reaches nothing over ACP and leaves session/prompt open: OpenCode runs with --print-logs, its stderr log line
// "stream error" ends the turn as failed with the error (streamErrorOf, onStderr).
// Login: the CLI's own login (cli:login; loginCommand, e.g. `agent login`). No login → session/new fails with auth
// required (-32000) and the chat shows "Accedi a <label>"; the app never calls `authenticate` (it would start a browser
// login from a hidden process). Never auto-answers anything. Under tests only a .mjs fake may start (cli.ts
// engineAllowed). Used by manager.ts through the HarnessSession interface (built by engines/sessions.ts).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import { APP_UI_TOOLS, cursorAppPermissions } from './app-tool-approval';
import os from 'node:os';
import path from 'node:path';
import type { Answer, ChatItem, ChatState, CursorReasoning, Effort, ImageAttachment, PendingRequest, PermissionMode, Question } from '../../shared/contract';
import { missFragment, sysEn, type SysCode, type SysParams } from '../../shared/sys';
import { errText, log } from '../log';
import { timedStep } from '../perf';
import { lineDiff, resultText, shortPath } from './claude-map';
import { CLOSE_GRACE_MS, cliArgv, engineAllowed, killTrees, resolveAcp, type CliCommand } from './cli';
import { drift, record } from './drift';
import { ownProcessGroup } from '../platform';
import { closePipes, engineKills, jobGuard, killEngineTree, lowerEnginePriority } from './jobguard';
import { runSubagentHooks, userHooksFile } from './cursor-hooks';
import { reapEnabled, reapEngine, type Root } from './proctree';
import { costOf, type AcpUsage } from './cursor-prices';
import { estimateTokens } from './handoff';
import { writeImageFiles } from './images';
import { STREAM_FLUSH_MS, cut, lastLine, nextId, stripAnsi, tokenUsage, toCommands, trimInput, type AppAsk, type ContextUsage, type HarnessSession, type SessionOptions, type SessionSink } from './session';
import { AgentChildrenReporter } from './agent-children';
import type { ChildObservation } from '../../shared/agents';
import { BRIEF_GRACE_MS, BRIEF_REFUSAL, YESNO_REFUSAL, YESNO_RETRIES, yesNoGateOn, yesNoShape } from '../../shared/yes-no';

export interface AcpOptions extends SessionOptions {
  /** send a question that is not yes/no back to the agent (shared/yes-no.ts, ADR 0135); default: yesNoGateOn(env) */
  yesNo?: boolean;
  /** App-owned launch rules, sent once as a separate context block, never persisted to global engine config. */
  brainInstructions?: string | null;
  /** the engine's id (registry): the session's harness, SB_<ID>_PATH, the logs' `engine` */
  engineId: string;
  /** the engine's short name in every text the user reads ("Cursor", "Kimi") */
  label: string;
  /** the ACP command and its flags, after the model flag and extraArgs (Cursor and Kimi ['acp']) */
  args: string[];
  /** the flag that passes the chat's model at spawn, before everything else (Cursor '--model'); absent or null = the
   *  model is not passed on the command line */
  modelFlag?: string | null;
  /** the CLI's name on PATH (resolveAcp; default: the engine id) and in hints ("agent", "kimi") */
  acpCommand?: string;
  /** the engine's own login, named in the login help (Cursor 'agent login'); default: `<acpCommand> login`; null = none */
  loginCommand?: string | null;
  /** command override (tests: a .mjs fake); default: the installed CLI (cli.ts resolveAcp) */
  pathOverride?: string;
  /** the chat's own browser MCP endpoint (passed when the agent supports http MCP) */
  mcpUrl?: string | null;
  /** the Orchestrator only: the app-control MCP endpoint (/mcp/app: app_create_chat, app_state…), passed as second-brain-app */
  appMcpUrl?: string | null;
  /** the app-managed MCP servers (ADR 0086): gateway endpoints on the app's own MCP, given in session/new like ours */
  extMcp?: { name: string; url: string }[];
  /** app version for clientInfo */
  appVersion?: string;
  /** show the past that session/load replays (a chat restored after an app restart has no items yet) */
  showReplay?: boolean;
  /** Cursor only: the app's own Cursor config folder (CURSOR_CONFIG_DIR): a fresh copy of the user's cli-config.json
   *  and permissions.json at every start, so whatever Cursor writes (the --model choice, its startup defaults) never
   *  reaches the user's global config. Login is unaffected (auth.json lives in %APPDATA%/Cursor). */
  configDir?: string | null;
  /** Cursor only: run the subagentStart/subagentStop hooks of hooksFile (ACP never fires them). Default false: none */
  subagentHooks?: boolean;
  /** with subagentHooks, the hooks file those commands come from: default ~/.cursor/hooks.json, none under tests
   *  unless given */
  hooksFile?: string | null;
  /** Cursor only: the user's reasoning and fast for every Cursor chat (settings orchestratorChats.cursorReasoning/cursorFast);
   *  params the chat's own model id pins in brackets ("gpt-5.6-sol[reasoning=high]") win */
  modelConfig?: { reasoning: CursorReasoning | ''; fast: boolean } | null;
  /** Cursor only: price the prompt's token usage with Cursor's list prices (cursor-prices.ts). Default false: the
   *  cost is only what the engine reports (usage_update.cost) */
  priceFallback?: boolean;
  /** waits before each automatic retry after a network error (default 5 s, 20 s: two retries); tests: short */
  netRetryDelaysMs?: readonly number[];
  /** how long a user's stop waits for session/prompt to end before the engine is restarted (tests: shorter) */
  cancelGraceMs?: number;
  /** after the engine logs a provider stream error on stderr (streamErrorOf), how long the turn waits for any sign of
   *  life before it is stopped as failed (default 10 s; an out-of-credits error stops it at once) */
  streamErrorGraceMs?: number;
  /** the model is the session's configOptions entry of category "model" (OpenCode `opencode acp`): its options are the
   *  models offered and the chat's model is set there (session/set_config_option, session-only) once the session is
   *  open. Only for an engine whose session/new answers no `models` and keeps the choice in the session (never for
   *  Cursor, whose model change writes its global config) */
  modelOption?: boolean;
  /** the engine has no question tool that reaches the app (engines/registry.ts appAsks: OpenCode): the app's ask_user
   *  MCP tool asks for it (askUser), the answer goes back as the user's next message */
  appAsk?: boolean;
}

/** The prompt that resumes a turn the engine's network error cut. */
export const netRetryPrompt = (label: string): string =>
  `Il turno si è interrotto per un errore di rete di ${label}: continua da dove eri, senza rifare quello già fatto.`;
const NET_RETRY_DELAYS = [5000, 20000];
/** a user's stop waits this long for the engine to end its prompt, then the engine is restarted (watchCancel) */
const CANCEL_GRACE_MS = 5000;

const STREAM_ERROR_GRACE_MS = 10000;

/** A provider error the engine wrote only to its log on stderr. OpenCode 1.19.5 (`opencode acp --print-logs`, real run
 *  2026-11-01: free model over its limit, OpenAI credits gone) logs `level=ERROR … message="stream error" …
 *  session.id=<id> small=false … error.error="AI_APICallError: Free usage limit reached. …"` and sends nothing over
 *  ACP: session/prompt stays open until session/cancel. small=true is its title agent, not the turn. A retryable error
 *  is logged again at each of its retries (backoff 2-37 s, real log 2026-11-01), then `level=ERROR message=process
 *  session.id=<id> … error="…"` once it gives up: final. credits only for wording that is sure (a free limit, a used-up
 *  plan, insufficient_quota): "exceeded your current quota… billing" is also a per-minute rate limit (Gemini free) that
 *  OpenCode retries. Null: not one, or another session's. */
export function streamErrorOf(line: string, sessionId: string | null): { error: string; credits: boolean; final: boolean } | null {
  if (!sessionId || !/\blevel=ERROR\b/.test(line) || !line.includes(` session.id=${sessionId} `)) return null;
  const final = /\bmessage=process\b/.test(line);
  if (!final && (!line.includes('message="stream error"') || /\bsmall=true\b/.test(line))) return null;
  const raw = (final ? / error="((?:[^"\\]|\\.)*)"/ : /\berror\.error="((?:[^"\\]|\\.)*)"/).exec(line)?.[1]?.replace(/\\(.)/g, '$1');
  if (raw === undefined && final) return null;
  const error = (raw ?? 'stream error').replace(/^(?:AI_\w+|\w*Error): /, '').trim() || raw || 'stream error';
  return { error, credits: /free usage limit reached|usage limit has been reached|insufficient_quota|insufficient.?balance|credit balance is too low|out of credits/i.test(error), final };
}

/** OpenCode starts another attempt at the running session's main stream (`level=INFO message=stream … session.id=<id>
 *  small=false`): after a stream error, a retry. */
export function streamRetryOf(line: string, sessionId: string | null): boolean {
  return !!sessionId && /\blevel=INFO\b/.test(line) && /\bmessage=stream\b/.test(line) && /\bsmall=false\b/.test(line) && line.includes(` session.id=${sessionId} `);
}

/** An engine's own routine log line on stderr (OpenCode --print-logs: `timestamp=… level=INFO|DEBUG|WARN …`, e.g. its
 *  "duplicate skill name" warnings): kept out of the stderr tail a failed exit shows, which is for the real error. */
const engineLogNoise = (line: string): boolean => /^timestamp=\S+ level=(?:INFO|DEBUG|WARN)\b/.test(line);

/** Whether a turn's last assistant text is the engine's transport error, not the model's words. Cursor's ACP handler
 *  appends "\n\nError: " + String(error) (CLI 2026.07.23): the text ends with its own paragraph "Error: RetriableError: …"
 *  ("[aborted] read ECONNRESET", "[unavailable] PING timed out", "Connection stalled"…) or "Error: [unavailable] …". The
 *  error quoted inside a sentence or a longer paragraph is not one. */
export function isNetError(text: string): boolean {
  return /(?:^|\n[ \t]*\n)[ \t]*Error: (?:RetriableError: |\[(?:aborted|unavailable|deadline_exceeded)\])[^\n]*$/.test(text.trimEnd());
}

/** One model parameter the session offers (ACP configOptions of category thought_level or model_config). */
interface ModelParam { id: string; name: string; category: string; value: string; values: string[] }

/** The model parameters in an ACP configOptions list (the model and mode pickers are not parameters). */
export function modelParams(list: unknown): ModelParam[] {
  return arr(list).map(o).filter(c => (c.category === 'thought_level' || c.category === 'model_config') && s(c.id))
    .map(c => ({ id: s(c.id), name: s(c.name) || s(c.id), category: s(c.category), value: String(c.currentValue ?? ''), values: arr(c.options).map(x => s(o(x).value)).filter(Boolean) }));
}

/** The variant as Cursor writes it: "grok-4.7[context=256k,reasoning_effort=medium,fast=false]". */
export function variantOf(model: string, params: readonly ModelParam[]): string {
  return params.length ? `${model}[${params.map(p => `${p.id}=${p.value}`).join(',')}]` : model;
}

const EFFORT_LADDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
/** The app's effort as one of the values a thought_level parameter offers: the same value (any case), else the nearest
 *  offered step of the ladder (below first: max → xhigh on a model that stops there); null when it offers none of them. */
export function acpEffortValue(effort: Effort, values: readonly string[]): string | null {
  const exact = values.find(v => v.toLowerCase() === effort);
  if (exact) return exact;
  const at = EFFORT_LADDER.indexOf(effort);
  const ranked = values.map(v => ({ v, i: EFFORT_LADDER.indexOf(v.toLowerCase()) })).filter(x => x.i >= 0)
    .sort((a, b) => Math.abs(a.i - at) - Math.abs(b.i - at) || a.i - b.i);
  return ranked[0]?.v ?? null;
}

/** The effort a thought_level value is, as the engine reports it (lower case), or null when it is not a plain level. */
export function acpEffortObserved(params: readonly ModelParam[]): string | null {
  const v = params.find(p => p.category === 'thought_level')?.value.toLowerCase() ?? '';
  return /^[a-z][a-z0-9_-]{0,39}$/.test(v) ? v : null;
}

/** The parameter ids a model id pins in brackets: "gpt-5.6-sol[reasoning=high,fast=false]" → reasoning, fast. */
export function pinnedParams(model: string | null | undefined): Set<string> {
  const m = /\[(.*)\]$/.exec(model ?? '');
  return new Set((m?.[1] ?? '').split(',').map(x => x.split('=')[0]!.trim()).filter(Boolean));
}

/** The message a model change gives: the manager restarts the session with the new model (session/load). */
export const modelRestart = (label: string): string => `${label} cambia modello riaprendo la sessione.`;

/** The user's Cursor CLI config folder, with the CLI's own rule: CURSOR_CONFIG_DIR → XDG_CONFIG_HOME/cursor → ~/.cursor. */
export function cursorConfigDir(env: NodeJS.ProcessEnv): string {
  const own = env.CURSOR_CONFIG_DIR?.trim();
  if (own) return own;
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return xdg ? path.join(xdg, 'cursor') : path.join(os.homedir(), '.cursor');
}

/** Copies the user's Cursor CLI settings into the app's private folder (read-only for the user's side). withoutAllow: a
 *  read-only run's copy keeps no allow rule (permissions.allow emptied), so every tool beyond the engine's own reads asks
 *  first and its owner refuses it; a file that is not JSON is left out. denyRead (read-only only): folders the run may
 *  never read, added to cli-config.json's permissions.deny as Read(<folder>/**) (a minimal cli-config.json is written
 *  when the user has none, so the rule is there anyway). appAllow: the app's own MCP rules, added to the private copy
 *  in both modes (a read-only run gets only the question surfaces, see cursorAppPermissions). */
export function snapshotCursorConfig(from: string, to: string, withoutAllow = false, denyRead: readonly string[] = [], appAllow: readonly string[] = []): void {
  fs.mkdirSync(to, { recursive: true });
  for (const f of ['cli-config.json', 'permissions.json']) {
    const src = path.join(from, f), dst = path.join(to, f);
    if (path.resolve(src) === path.resolve(dst)) continue;
    const deny = f === 'cli-config.json' ? denyRead : [];
    if (!fs.existsSync(src)) {
      if (withoutAllow && deny.length) fs.writeFileSync(dst, noAllowRules('{}', deny)!);
      else if (fs.existsSync(dst)) fs.rmSync(dst, { force: true });
      continue;
    }
    if (!withoutAllow) { fs.copyFileSync(src, dst); continue; }
    const cfg = noAllowRules(fs.readFileSync(src, 'utf8'), deny);
    if (cfg === null) fs.rmSync(dst, { force: true });
    else fs.writeFileSync(dst, cfg);
  }
  // a read-only run never gets more than the question surfaces, whatever list the caller passed
  const granted = withoutAllow ? appAllow.filter(rule => APP_UI_TOOLS.some(t => rule === `Mcp(second-brain:${t})`)) : appAllow;
  if (granted.length && path.resolve(from) !== path.resolve(to)) {
    const dst = path.join(to, 'cli-config.json');
    const cfg = fs.existsSync(dst) ? JSON.parse(fs.readFileSync(dst, 'utf8')) as unknown : {};
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('Invalid Cursor CLI configuration');
    const out = cfg as Obj, permissions = o(out.permissions);
    out.permissions = { ...permissions, allow: [...new Set([...arr(permissions.allow), ...granted])] };
    fs.writeFileSync(dst, JSON.stringify(out, null, 2));
  }
}

/** The Cursor CLI rule that denies reading a folder and everything in it: Read(C:/a/b/**). */
export const cursorReadRule = (dir: string): string => `Read(${path.resolve(dir).replace(/\\/g, '/').replace(/\/+$/, '')}/**)`;

/** A Cursor config file's JSON without allow rules (top-level allow and permissions.allow emptied), plus a deny rule for
 *  each folder in denyRead; null = not JSON. */
export function noAllowRules(text: string, denyRead: readonly string[] = []): string | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = { ...(v as Obj) };
  if (Array.isArray(out.allow)) out.allow = [];
  const hasPerms = out.permissions && typeof out.permissions === 'object' && !Array.isArray(out.permissions);
  if (hasPerms || denyRead.length) {
    const perms = { ...(hasPerms ? (out.permissions as Obj) : {}) };
    if (Array.isArray(perms.allow) || denyRead.length) perms.allow = [];
    if (denyRead.length) perms.deny = [...new Set([...(Array.isArray(perms.deny) ? perms.deny : []), ...denyRead.map(cursorReadRule)])];
    out.permissions = perms;
  }
  return JSON.stringify(out, null, 2);
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The help a chat shows when the engine says it is not logged in. */
export const authHelp = (label: string, loginCommand: string | null): string => (loginCommand
  ? `Accedi a ${label}: premi “Accedi a ${label}” (apre \`${loginCommand}\` in un terminale), completa il login e riprova.`
  : `Accedi a ${label}: salva la sua chiave API in Impostazioni → Motori, oppure accedi dentro la sua CLI, e riprova.`);
const NOT_ACTIVE = 'La sessione non è attiva.';

class RpcError extends Error {
  constructor(message: string, readonly code: number) { super(message); }
}
/** A read-only session the engine cannot put in a read-only mode: it is stopped before any prompt (fail closed). */
class ReadOnlyModeMissing extends Error {
  constructor(message: string, readonly why: string) { super(message); }
}
interface Rpc { resolve(v: Obj): void; reject(e: Error): void; method: string; timer: NodeJS.Timeout | null }
type ToolItem = Extract<ChatItem, { kind: 'tool' }>;
type StreamItem = Extract<ChatItem, { kind: 'assistant' | 'thinking' }>;
interface Stream { item: StreamItem; emitted: boolean; dirty: boolean }
interface AcpOption { optionId: string; name: string; kind: string }
interface AcpQuestion { text: string; id: string; byLabel: Map<string, string> }
interface Ask {
  rpcId: number | string;
  method: 'session/request_permission' | 'cursor/ask_question' | 'cursor/create_plan' | 'app/ask_user';
  options?: AcpOption[];
  questions?: AcpQuestion[];
}
/** the yes/no labels of an app question (askUser), the recommended one marked as QUESTION_RULE asks */
const ASK_YES = 'Sì', ASK_NO = 'No', ASK_MARK = ' (consigliato)';

/** ACP tool kinds → the tool name a row and a permission panel show (PendingRequest.tool). */
export const KIND_NAME: Record<string, string> = {
  execute: 'Shell', read: 'Read', edit: 'Edit', delete: 'Delete', move: 'Move', search: 'Search', fetch: 'Fetch', think: 'Think', switch_mode: 'Mode', other: 'Tool',
};
/** An execute call's exit code (the run's receipts, ADR 0130), only when its rawOutput carries one: ACP itself defines
 *  no exit code (a terminal's exitStatus is only reachable through client terminals, which the app does not offer), so
 *  a Cursor command whose rawOutput says nothing stays unknown; its completed/failed status is never read as one. */
export function acpExitCode(rawOutput: unknown): { exitCode?: number } {
  const out = rawOutput && typeof rawOutput === 'object' && !Array.isArray(rawOutput) ? rawOutput as Obj : {};
  const v = out.exitCode ?? out.exit_code ?? (out.exitStatus && typeof out.exitStatus === 'object' ? (out.exitStatus as Obj).exitCode : undefined);
  return Number.isSafeInteger(v) && (v as number) >= 0 ? { exitCode: v as number } : {};
}
const PLAN_Q = 'Approvi il piano?';
// The ACP vocabulary the app knows (drift.ts reports anything else): stop reasons of session/prompt, updates it
// knowingly ignores, the protocol version it speaks. Checked against Cursor CLI 2026.07.23 and agentclientprotocol.com.
const STOP_REASONS = new Set(['end_turn', 'cancelled', 'refusal', 'max_tokens', 'max_turn_requests']);
const QUIET_UPDATES = new Set(['session_info_update', 'notice']);
const ACP_VERSION = 1;

/** The shape an ACP message is recorded under (drift.ts record): `result/<method>` for an answer to one of ours,
 *  `request/<method>`, `update/<sessionUpdate>` or `notify/<method>` for what the engine sends. */
export function acpKey(m: Obj, answered?: string): string {
  const method = s(m.method);
  if (!method) return `result/${answered ?? '?'}`;
  if (m.id !== undefined) return `request/${method}`;
  if (method === 'session/update') return `update/${s(o(o(m.params).update).sessionUpdate)}`;
  return `notify/${method}`;
}
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

// OpenCode permission names (its tool call has kind "other" and the bare name as title) → what the panel says
const PERMISSION_LABEL: Record<string, string> = {
  external_directory: 'Accesso fuori dalla cartella', websearch: 'Ricerca web', codesearch: 'Ricerca codice', skill: 'Skill',
  todowrite: 'Lista attività', todoread: 'Lista attività', list: 'Elenco cartella', task: 'Sottoagente',
  doom_loop: 'Stesso strumento ripetuto', question: 'Domanda',
};
const argLine = (k: string, v: unknown): string => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`;
/** An argument as panel lines: a multi-line string keeps one line each (key on the first), never one flattened line. */
const argLines = (k: string, v: unknown): string[] => argLine(k, v).split(/\r?\n/);

/** A code fence: 3+ backticks (an outer ```` may hold ``` blocks), a language tag only when a newline follows it (an
 *  inline «```rm -rf x```» keeps its first word), up to the same run of backticks. */
const FENCE = /(`{3,})(?:([\w+-]*)[^\S\n]*\r?\n)?([\s\S]*?)\r?\n?\1(?!`)/g;
/** the language tags a block's first line is read as (anything else there is shown: it may be what runs) */
const LANGS = new Set(['', 'json', 'jsonc', 'bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1', 'pwsh', 'cmd', 'bat', 'console',
  'js', 'javascript', 'ts', 'typescript', 'tsx', 'jsx', 'py', 'python', 'md', 'markdown', 'text', 'txt', 'plaintext', 'diff',
  'yaml', 'yml', 'xml', 'html', 'css', 'sql', 'toml', 'ini', 'csharp', 'cs', 'go', 'rust', 'java']);
/** a fence line left over (an unclosed block): its backticks dropped, a word after them kept (it may be a command) */
const FENCE_OPEN = /^\s*`{3,}/;

/** A permission's content as panel lines, its markdown code blocks unwrapped (Cursor sends an MCP tool's arguments as
 *  "```json {…} ```", real run 2026-10-31): a JSON object one argument per line (empty: nothing), other JSON on one
 *  line, any other block its own lines (nested blocks unwrapped too); never the fences, never a word of what runs. */
export function contentLines(text: string): string[] {
  const out: string[] = [];
  // a language word is dropped only when lines follow it: «```python» alone is a command (a REPL), shown
  const plain = (t: string) => out.push(...t.split(/\r?\n/).map((l, i, all) => {
    if (!FENCE_OPEN.test(l)) return l;
    const rest = l.replace(FENCE_OPEN, '').trim();
    return LANGS.has(rest.toLowerCase()) && all.slice(i + 1).some(x => x.trim()) ? '' : rest;
  }));
  let at = 0;
  for (const m of text.matchAll(FENCE)) {
    plain(text.slice(at, m.index));
    at = m.index + m[0].length;
    const tag = m[2] ?? '';
    const inner = m[3]!.trim();
    let parsed: unknown;
    try { parsed = JSON.parse(inner); } catch {
      // «```whoami\nrm -rf /\n```»: a first line that is no language is part of what runs
      if (!LANGS.has(tag.toLowerCase())) out.push(tag);
      out.push(...contentLines(inner));
      continue;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) out.push(...Object.entries(parsed as Obj).filter(([, v]) => v !== undefined && v !== '').flatMap(([k, v]) => argLines(k, v)));
    else out.push(JSON.stringify(parsed));
  }
  plain(text.slice(at));
  return out;
}

/** Title and detail of a permission panel from what the engine sent (display only: the gates read the input). OpenCode
 *  sends kind "other", its permission name as title and an often empty rawInput for MCP tools, skills and outside
 *  folders; the tool_call that came first with the same id carries the real arguments, so both are shown. */
export function permissionView(tc: Obj, known: { name?: string; summary?: string; input?: unknown } | undefined, kindName: string): { title: string; detail: string } {
  const raw = o(tc.rawInput), prior = o(known?.input);
  const args: Obj = { ...prior, ...raw };
  const title = stripAnsi(s(tc.title)).trim();
  const bare = kindName === 'Tool' && /^[\w.:-]+$/.test(title);
  const first = Object.entries(args).find(([k, v]) => k !== 'command' && typeof v === 'string' && v.trim());
  const label = bare ? PERMISSION_LABEL[title] ?? `Strumento ${title}` : '';
  // external_directory titles itself with the folder (or the command) instead of its name
  const outside = kindName === 'Tool' && !bare && typeof args.parentDir === 'string';
  const shown = bare ? (first ? `${label}: ${s(first[1])}` : label)
    : outside ? `${PERMISSION_LABEL.external_directory}: ${title || s(args.parentDir)}`
    : title || known?.summary || `${kindName}: permesso`;
  const lines = [
    // a multi-line command keeps one line each: flattened, «git status» + «git push --force» would read as one
    ...s(args.command).split(/\r?\n/),
    ...contentLines(contentText(tc.content)),
    ...Object.entries(args).filter(([k, v]) => k !== 'command' && v !== undefined && v !== '').flatMap(([k, v]) => argLines(k, v)),
    ...arr(tc.locations).map(l => s(o(l).path)),
  ];
  // one line per argument (the panel splits the detail on newlines), each one flattened
  const detail = lines.map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return { title: cut(shown, 140), detail: detail.length > 8000 ? `${detail.slice(0, 7999)}…` : detail };
}

/** The skip reason that carries a free-text answer to cursor/ask_question: every question with what the user chose or
 *  wrote, so the model reads the whole answer even though ACP's "answered" outcome has room only for option ids. */
export function freeTextReason(answers: { question: string; answers: string[] }[]): string {
  const lines = answers.filter(a => a.answers.length).map(a => `«${a.question}» → ${a.answers.join(', ')}`);
  return `L’utente ha risposto con parole sue invece di scegliere solo le opzioni: ${lines.join('; ')}`;
}

/** Unique strings: a repeated one gets " (2)", " (3)"… so labels and question texts stay keys. */
function uniq(list: string[]): string[] {
  const seen = new Map<string, number>();
  return list.map(x => { const n = (seen.get(x) ?? 0) + 1; seen.set(x, n); return n === 1 ? x : `${x} (${n})`; });
}

export class AcpSession implements HarnessSession {
  readonly harness: string;
  state: ChatState = 'starting';
  sessionId: string | null;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private out = '';
  private errTail = '';
  private errLine = '';          // stderr's unfinished last line
  /** the provider error the engine logged during this turn (streamErrorOf); failed = the turn was stopped for it */
  private streamError: { error: string; credits: boolean; failed: boolean; retrying: boolean } | null = null;
  private streamErrorTimer: NodeJS.Timeout | null = null;
  private rpcSeq = 1;
  private rpcs = new Map<number, Rpc>();
  private asks = new Map<string, Ask>();
  private queue: { text: string; images: readonly ImageAttachment[]; retry?: boolean }[] = [];
  /** the user stopped the running turn (Stop, or "Invia subito" = sendNow): "cancelled" is then no error */
  private stopping: { sendNow: boolean } | null = null;
  private cancelWatch: NodeJS.Timeout | null = null;
  private cancelAt = 0;          // when the user's stop sent session/cancel (its answer time goes to the log)
  private turnSeq = 0;           // the prompt in flight: an answer to an abandoned one is ignored
  private wedged = false;        // the engine ignored a stop: it is being restarted, nothing more goes to it
  private turnFiles: string[] = [];   // screenshots saved for this turn (no image support): deleted when it ends
  private open = false;          // session/new or session/load done
  private yesNoRefused = 0;      // questions sent back in a row for not being yes/no (ADR 0135)
  // questions given BRIEF_GRACE_MS for their brief (ADR 0150), with their timer; briefOff = this chat sent none twice in a
  // row: it is not asked for again in this session (a chat without show_ui never pays the refusals on every question)
  private briefWaited = new Map<string | number, { rpcId: string | number; timer: NodeJS.Timeout | null }>();
  private briefOff = false;
  private prompting = false;
  private loading = false;
  private caps: Obj = {};
  private models: { current: string | null; available: string[] } | null = null;
  /** the configOptions id of the model picker (modelOption engines) and of the mode picker (an engine that answers no
   *  `modes`): set through session/set_config_option */
  private modelOption: string | null = null;
  private modeOption: string | null = null;
  private params: ModelParam[] = [];
  /** the chat's effort (start option, then setEffort): wins over the settings' reasoning */
  private effort: Effort | null;
  private modes: string[] = [];
  private msg: Stream | null = null;
  private lastAnswer = '';       // the turn's last assistant message (a network error shows up there)
  private netRetries = 0;        // automatic retries of the current user message after a network error
  private retryTimer: NodeJS.Timeout | null = null;
  private retryItemId: string | null = null;
  private retryOff = false;      // this turn is not retried (noRetry: a failed hand-off)
  private thought: Stream | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private tools = new Map<string, ToolItem>();
  /** running subagents (Task tool calls) by toolCallId, for the subagent hooks */
  private subagents = new Map<string, { at: number; type: string; task: string; description: string; model: string | null }>();
  private readonly childTelemetry: AgentChildrenReporter;
  private childTasks = new Map<string, { task: string | null; state: ChildObservation['state']; source: ChildObservation['source'] }>();
  /** pending subagent hook runs (tests wait on them) */
  readonly hookRuns: Promise<void>[] = [];
  private planItemId: string | null = null;
  private todosItemId: string | null = null;
  private context: ContextUsage | null = null;
  /** characters of the conversation seen on the wire (prompts, answers, thoughts, tool input/output, a load's replay):
   *  the context estimate while the engine sends no usage_update (cursor-cost research note: Cursor's CLI 2026.07 never does) */
  private chars = 0;
  private turnStart = 0;
  private sessionCost: number | null = null;   // ACP usage_update.cost (cumulative USD), when the engine sends it
  private costAtTurnStart: number | null = null;
  private closing = false;
  private keepChildren = false;
  private exitedRoot: Root | null = null;
  private spawnedAt = 0;
  private killed = false;
  private exited = false;
  private procExited = false;         // 'exit' came ('close' also waits for the pipes, which a leftover may hold)
  private job: number | null = null;  // its Job Object (jobguard.ts)
  private jobKilled = false;          // its tree was terminated through the job
  private badLines = 0;
  private cliVersion: string | null = null; // initialize's agentInfo.version, else Cursor's version folder: drift reports name it
  private recording = false;          // a real CLI (not a test's fake): its message shapes go to drift.ts record
  private replayUser: Extract<ChatItem, { kind: 'user' }> | null = null;
  private exitDone!: () => void;
  private readonly exitPromise = new Promise<void>(r => { this.exitDone = r; });
  private readyDone!: () => void;
  /** resolves when the session is open (or failed): the manager waits for it before adding a message to a resumed chat */
  readonly ready = new Promise<void>(r => { this.readyDone = r; });

  constructor(private readonly opts: AcpOptions, private readonly sink: SessionSink, private readonly command?: CliCommand | null) {
    this.childTelemetry = new AgentChildrenReporter(sink);
    this.harness = opts.engineId;
    this.sessionId = opts.resume ? opts.sessionId ?? null : null;
    this.effort = opts.effort ?? null;
  }

  /** The variant running and the effort its thought_level parameter reports go to the chat's info. */
  private variantChanged(current: string): string {
    const variant = variantOf(current, this.params);
    this.sink.changed({ model: variant, effortObserved: acpEffortObserved(this.params) });
    return variant;
  }

  private get label(): string { return this.opts.label; }
  private get cliName(): string { return this.opts.acpCommand ?? this.opts.engineId; }
  /** null = the engine has no login command (a key in Settings, or a login inside its CLI) */
  private get loginCommand(): string | null { return this.opts.loginCommand === undefined ? `${this.cliName} login` : this.opts.loginCommand; }
  /** the engine id every log line of this session carries in its data */
  private get engine(): string { return this.opts.engineId; }

  get pid(): number | null { return this.proc?.pid ?? null; }
  get jobHandle(): number | null { return this.job; }
  /** Nothing left for the quit's last resort: it exited, or its job was terminated. */
  get gone(): boolean { return this.procExited || this.jobKilled; }
  get root(): Root | null { return this.exitedRoot; }
  get startedAt(): number { return this.spawnedAt; }
  get alive(): boolean { return !!this.proc && !this.exited; }
  get busy(): boolean { return !this.exited && (this.prompting || !!this.retryTimer || this.queue.length > 0 || this.asks.size > 0 || this.state === 'starting'); }

  /** The command line after the CLI itself: the model flag first, then extraArgs, then the ACP command
   *  (`agent --model X acp`, `kimi acp`). */
  args(): string[] {
    const flag = this.opts.modelFlag, model = this.opts.model;
    // a model starting with '-' would be read as a flag of the CLI (manager.ts refuses it too)
    return [...(flag && model && !model.startsWith('-') ? [flag, model] : []), ...(this.opts.extraArgs ?? []), ...this.opts.args];
  }

  start(): void {
    this.childTelemetry.coverage('partial');
    const chat = this.opts.chatId, label = this.label, engine = this.engine;
    const envName = `SB_${engine.toUpperCase().replace(/-/g, '_')}_PATH`;
    const cmd = this.command ?? resolveAcp(engine, this.cliName, this.opts.pathOverride ?? null);
    if (!cmd) return this.fail(`${label} CLI non trovato: installa la CLI di ${label} (${this.cliName}) e fai login.`, `${engine} CLI not found (${engine === 'cursor' ? '%LOCALAPPDATA%/cursor-agent, ' : ''}PATH)`, `install the ${label} CLI, log in (${this.loginCommand ?? 'its own login or an API key'}), or set ${envName}`);
    if (!engineAllowed(cmd)) return this.fail(`Nei test il motore ${label} reale non parte mai: serve il fake (${envName}=…/fake-cursor-acp.mjs).`, `refused to start the real ${label} engine under tests (${cmd.display})`, `point ${envName} to test/fixtures/fake-cursor-acp.mjs`);
    if (!fs.existsSync(this.opts.cwd)) return this.fail(`Cartella non trovata: ${this.opts.cwd}`, `cwd missing: ${this.opts.cwd}`, 'pick an existing folder for the chat');
    this.recording = cmd.kind !== 'fake';
    if (cmd.kind === 'node') this.cliVersion = path.basename(cmd.display);
    let argv: ReturnType<typeof cliArgv>;
    try { argv = cliArgv(cmd, this.args()); } catch (e) { return this.fail(`Avvio di ${label} non riuscito: ${errText(e)}`, errText(e), 'use a plain model id'); }
    const env: NodeJS.ProcessEnv = { ...argv.env, ...this.opts.env };
    if (this.opts.configDir) {
      try { snapshotCursorConfig(cursorConfigDir(env), this.opts.configDir, !!this.opts.readOnly, this.opts.readOnly ? this.opts.denyRead ?? [] : [], cursorAppPermissions(this.opts.mcpUrl, this.opts.appMcpUrl, !!this.opts.readOnly)); } catch (e) {
        return this.fail(`Impostazioni di ${label} non copiate: ${errText(e)}`, errText(e), 'check that the app data folder is writable');
      }
      env.CURSOR_CONFIG_DIR = this.opts.configDir;
    }
    const startedAt = Date.now();
    this.spawnedAt = startedAt;
    try {
      this.proc = spawn(argv.command, argv.args, { cwd: this.opts.cwd, env, windowsHide: true, detached: ownProcessGroup(), stdio: ['pipe', 'pipe', 'pipe'], windowsVerbatimArguments: argv.verbatim });
    } catch (e) {
      return this.fail(`Avvio di ${label} non riuscito: ${errText(e)}`, errText(e), `check the ${label} CLI install`);
    }
    const p = this.proc;
    lowerEnginePriority(p.pid); // below the app's window: a busy PC slows agents, not the app (jobguard.ts)
    log.info('chats', 'acp session start', { chat, data: { engine, pid: p.pid, kind: cmd.kind, command: cmd.display, cwd: this.opts.cwd, args: this.args() } });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d: string) => timedStep('engine acp output', () => this.onStdout(d)));
    p.stderr.setEncoding('utf8');
    // 16000: room for a whole model refusal (Cursor lists 190 ids, onClose refusal)
    p.stderr.on('data', (d: string) => { this.onStderr(d); log.debug('chats', 'acp stderr', { chat, data: { engine, text: cut(d, 500) } }); });
    p.stdin.on('error', e => log.warn('chats', 'acp stdin error', { chat, data: { engine, error: errText(e) } }));
    p.on('error', e => this.fail(`Avvio di ${label} non riuscito: ${errText(e)}`, errText(e), `check that \`${this.cliName} --version\` works in a terminal`));
    p.on('close', (code: number | null) => this.onClose(code));
    // a clean exit leaves its MCP servers and shells running: kill what still descends from it ('exit', not 'close': a leftover
    // holding the inherited stdout would delay 'close' until it ends by itself)
    p.once('exit', () => {
      this.procExited = true;
      if (!p.pid) return;
      this.exitedRoot = { pid: p.pid, created: startedAt, exited: Date.now(), job: this.job };
      if (!this.keepChildren && reapEnabled()) void reapEngine(this.exitedRoot, { chatId: chat, what: label });
    });
    // its own job before it starts anything (MCP servers come seconds later): later children, orphans too, stay in it
    void jobGuard.add(p.pid, chat).then(job => {
      this.job = job;
      if (this.exitedRoot) { this.exitedRoot.job = job; if (!this.keepChildren) void jobGuard.release(job); } // exited first: the walk reaped it
    });
    void this.boot();
  }

  private async boot(): Promise<void> {
    try {
      const init = await this.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, _meta: { parameterizedModelPicker: true } },
        clientInfo: { name: 'second-brain', version: this.opts.appVersion ?? '0' },
      }, 60000);
      this.caps = o(init.agentCapabilities);
      const v = s(o(init.agentInfo).version);
      if (v && !this.cliVersion) this.cliVersion = v; // Cursor: its version folder, the name doctor checks
      if (init.protocolVersion !== ACP_VERSION) this.drift('protocol version', String(init.protocolVersion), init);
      log.info('chats', 'acp initialized', { chat: this.opts.chatId, data: { engine: this.engine, protocolVersion: init.protocolVersion, loadSession: this.caps.loadSession === true, mcp: this.caps.mcpCapabilities, agent: init.agentInfo } });
      await this.openSession();
      await this.applyChoices();
      this.open = true;
      if (this.state === 'starting') this.setState(this.queue.length ? 'running' : 'idle');
      this.drain();
    } catch (e) {
      if (this.exited) return;
      if (e instanceof ReadOnlyModeMissing) return this.stopWith(e.message, e.why, 'a read-only run needs an engine with an ask or plan mode; pick another engine for side b');
      const auth = e instanceof RpcError && (e.code === -32000 || /auth/i.test(e.message));
      if (auth) this.stopWith(authHelp(this.label, this.loginCommand), `${this.engine} not logged in: ${errText(e)}`, `the user logs in (${this.loginCommand ?? 'API key in Settings → Motori'}), then sends again`);
      else this.stopWith(`${this.label} non è partito: ${errText(e)}`, errText(e), `see the stderr lines in the log; run \`${this.cliName} --version\` in a terminal`);
    } finally { this.readyDone(); }
  }

  private mcpServers(): Obj[] {
    if (o(this.caps.mcpCapabilities).http !== true) return [];
    const list: Obj[] = [];
    if (this.opts.mcpUrl) list.push({ type: 'http', name: 'second-brain', url: this.opts.mcpUrl, headers: [] });
    if (this.opts.appMcpUrl) list.push({ type: 'http', name: 'second-brain-app', url: this.opts.appMcpUrl, headers: [] });
    for (const ext of this.opts.extMcp ?? []) if (!list.some(x => x.name === ext.name)) list.push({ type: 'http', name: ext.name, url: ext.url, headers: [] });
    return list;
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
          this.sysCode('resumeFailed', { label: this.label, error: cut(errText(e), 120) }, 'warn');
        } finally {
          this.loading = false;
          this.reportEstimate();
          this.flushAll(true);
          this.replayUser = null;
          this.tools.clear(); // replayed tool rows keep the status they were replayed with
        }
      } else this.sysCode('noResume', { label: this.label }, 'warn');
    }
    const r = await this.request('session/new', base, 120000);
    const id = s(r.sessionId);
    if (!id) throw new Error('session/new senza sessionId');
    this.sessionId = id;
    this.sink.changed({ sessionId: id });
    this.readState(r);
  }

  /** Models and modes from session/new or session/load: the `models` and `modes` fields, else (OpenCode) the
   *  configOptions entries of category model (modelOption engines only) and mode. */
  private readState(r: Obj): void {
    const m = o(r.models), cfg = arr(r.configOptions).map(o);
    const picker = this.opts.modelOption ? cfg.find(c => c.category === 'model' && s(c.id)) : undefined;
    let list: { id: string; name: string }[] = [];
    if (Object.keys(m).length) {
      list = arr(m.availableModels).map(x => ({ id: s(o(x).modelId), name: s(o(x).name) })).filter(x => x.id);
      this.models = { current: s(m.currentModelId) || null, available: list.map(x => x.id) };
    } else if (picker) {
      list = arr(picker.options).map(x => ({ id: s(o(x).value), name: s(o(x).name) || s(o(x).value) })).filter(x => x.id);
      this.modelOption = s(picker.id);
      this.models = { current: s(picker.currentValue) || null, available: list.map(x => x.id) };
    }
    if (this.models) {
      this.params = modelParams(r.configOptions);
      if (this.models.current) this.variantChanged(this.models.current);
      if (list.length) this.sink.models?.(list);
    }
    const md = o(r.modes), modeCfg = cfg.find(c => c.category === 'mode' && s(c.id));
    if (!Object.keys(md).length && modeCfg) {
      this.modeOption = s(modeCfg.id);
      this.modes = arr(modeCfg.options).map(x => s(o(x).value)).filter(Boolean);
      if (s(modeCfg.currentValue) === 'plan') this.sink.changed({ permissionMode: 'plan' });
      return;
    }
    this.modes = arr(md.availableModes).map(x => s(o(x).id)).filter(Boolean);
    if (s(md.currentModeId) === 'plan') this.sink.changed({ permissionMode: 'plan' });
  }

  /** A session mode: session/set_mode, or its configOptions entry for an engine that offers modes only there. */
  private async setModeId(modeId: string): Promise<void> {
    if (this.modeOption) await this.request('session/set_config_option', { sessionId: this.sessionId, configId: this.modeOption, value: modeId });
    else await this.request('session/set_mode', { sessionId: this.sessionId, modeId });
  }

  /** modelOption engines: the chat's model, set on the session's model option (session-only); a model the engine does
   *  not offer, or one it refuses, is a miss the user reads. The model parameters follow the new model. */
  private async applyModel(misses: string[]): Promise<void> {
    const asked = this.opts.model?.replace(/\[.*\]$/, '');
    if (!this.modelOption || !this.models || !asked || asked === this.models.current) return;
    if (!this.models.available.includes(asked)) { misses.push(missFragment.askedModel(asked)); return; }
    try {
      const r = await this.request('session/set_config_option', { sessionId: this.sessionId, configId: this.modelOption, value: asked });
      this.readModelOption(r.configOptions);
      if (this.models.current !== asked) misses.push(missFragment.askedModel(asked));
    } catch (e) {
      misses.push(missFragment.askedModel(asked));
      log.warn('chats', 'acp model refused', { chat: this.opts.chatId, data: { engine: this.engine, model: asked, error: errText(e) } });
    }
  }

  /** modelOption engines: the model running and its parameters from a configOptions list (a set_config_option answer, a
   *  config_option_update); a list without the model picker changes nothing. */
  private readModelOption(list: unknown): void {
    const picker = arr(list).map(o).find(c => c.category === 'model' && s(c.id) === this.modelOption);
    if (!picker || !this.models) return;
    this.models.current = s(picker.currentValue) || this.models.current;
    this.params = modelParams(list);
  }

  /** The user's mode for this chat (session-only in ACP). The model came with the model flag at spawn. A read-only run
   *  takes the engine's read-only mode (Cursor's "ask", else "plan"); an engine without one, or one that refuses it,
   *  never gets the prompt (ReadOnlyModeMissing: boot stops the session). Its permissions are answered by its owner
   *  either way. */
  private async applyChoices(): Promise<void> {
    await this.applyModelConfig();
    // an agent capped at 'plan' (A2) takes the same read-only mode: Cursor's own allow rules would bypass any other limit
    if (this.opts.readOnly || this.opts.ceiling === 'plan') {
      const who = this.opts.readOnly ? 'il confronto' : 'l’Agente (limite «plan»)';
      const modeId = ['ask', 'plan'].find(m => this.modes.includes(m));
      if (!modeId) throw new ReadOnlyModeMissing(`${this.label} non offre una modalità in sola lettura (ask o plan): ${who} non la avvia`, `modes offered: ${this.modes.join(', ') || 'none'}`);
      try {
        await this.setModeId(modeId);
      } catch (e) {
        throw new ReadOnlyModeMissing(`${this.label} non ha accettato la modalità in sola lettura (${modeId}): ${who} non la avvia`, `session mode ${modeId} failed: ${errText(e)}`);
      }
      if (modeId === 'plan') this.sink.changed({ permissionMode: 'plan' });
      return;
    }
    if (this.opts.permissionMode === 'plan' && this.modes.includes('plan')) {
      try { await this.setPermissionMode('plan'); } catch (e) { log.warn('chats', 'acp plan mode not applied', { chat: this.opts.chatId, data: { engine: this.engine, error: errText(e) } }); }
    }
  }

  /** The user's reasoning and fast (session/set_config_option), then the variant really running goes to the chat's
   *  info; anything not as asked (another model, a value the model lacks, a refused option) is a visible warning. */
  private async applyModelConfig(): Promise<void> {
    const misses: string[] = [];
    await this.applyModel(misses);
    const chat = this.opts.chatId, current = this.models?.current;
    if (!current) return;
    // the model asked at spawn (no model flag: the engine was not told, so a different model is no surprise; a model
    // option engine reported its own miss in applyModel)
    const asked = this.opts.modelFlag ? this.opts.model?.replace(/\[.*\]$/, '') : undefined;
    if (asked && asked !== current) misses.push(missFragment.askedModel(asked));
    const mc = this.opts.modelConfig, pinned = pinnedParams(this.opts.model);
    const want: [ModelParam, string][] = [];
    const thought = this.params.find(p => p.category === 'thought_level'), fast = this.params.find(p => p.id === 'fast');
    // the chat's (or its role's) effort first, mapped onto what the model offers; else the settings' reasoning
    const reasoning = this.effort && thought ? acpEffortValue(this.effort, thought.values) ?? this.effort : mc?.reasoning;
    if (reasoning && thought && !pinned.has(thought.id)) want.push([thought, reasoning]);
    else if (this.effort && !thought) log.info('chats', 'acp effort not applied: the model has no reasoning option', { chat, data: { engine: this.engine, model: current, effort: this.effort } });
    if (mc && fast && !pinned.has('fast')) want.push([fast, String(mc.fast)]);
    for (const [p, value] of want) {
      if (p.value === value) continue;
      if (!p.values.includes(value)) { misses.push(missFragment.notOffered(p.name, value)); continue; }
      try {
        const r = await this.request('session/set_config_option', { sessionId: this.sessionId, configId: p.id, value });
        const next = modelParams(r.configOptions);
        if (next.length) this.params = next; else p.value = value;
        if (this.params.find(x => x.id === p.id)?.value !== value) misses.push(missFragment.notApplied(p.name, value));
      } catch (e) {
        misses.push(missFragment.refused(p.name, value));
        log.warn('chats', 'acp model option refused', { chat, data: { engine: this.engine, option: p.id, value, error: errText(e) } });
      }
    }
    const variant = this.variantChanged(current);
    log.info('chats', 'acp model variant', { chat, data: { engine: this.engine, asked: this.opts.model ?? null, effort: this.effort, config: mc ?? null, running: variant } });
    if (misses.length) {
      log.warn('chats', 'acp runs another model than asked', { chat, data: { engine: this.engine, asked: this.opts.model ?? null, config: mc ?? null, running: variant, misses } });
      this.sysCode('runningOther', { label: this.label, variant, misses: misses.join(';;') }, 'warn');
    }
  }

  send(text: string, images: readonly ImageAttachment[] = []): void {
    if (this.exited || !this.proc) throw new Error(NOT_ACTIVE);
    this.queue.push({ text, images });
    if (this.state !== 'waiting' && this.state !== 'starting') this.setState('running');
    this.drain();
  }

  /** One prompt at a time per session: the next queued message goes when the previous turn ends. */
  private drain(): void {
    if (!this.open || this.prompting || this.exited || this.retryTimer || this.wedged) return;
    const next = this.queue.shift();
    if (next === undefined) return;
    if (!next.retry) { this.netRetries = 0; this.retryOff = false; }
    this.lastAnswer = '';
    let prompt: Obj[];
    try { prompt = this.promptOf(next.text, next.images); } catch (e) {
      this.sysCode('imagesNotSent', { label: this.label, error: cut(errText(e), 200) }, 'error');
      prompt = [{ type: 'text', text: next.text || '(immagini non inviate)' }];
    }
    this.prompting = true;
    this.turnStart = Date.now();
    this.costAtTurnStart = this.sessionCost;
    this.planItemId = null;
    this.chars += next.text.length;
    this.setState(this.asks.size ? 'waiting' : 'running');
    const turn = ++this.turnSeq;
    this.request('session/prompt', { sessionId: this.sessionId, prompt }, 0)
      .then(r => { if (turn === this.turnSeq) this.turnDone(r, null); })
      .catch(e => { if (turn === this.turnSeq) this.turnDone({}, e as Error); });
  }

  /** ACP prompt blocks: images as image blocks when the agent takes them, else saved in the app's temp folder for this
   *  chat and named in the text (the agent reads files itself). */
  private promptOf(text: string, images: readonly ImageAttachment[]): Obj[] {
    const context = this.brainContext();
    if (!images.length) return [...context, { type: 'text', text }];
    if (o(this.caps.promptCapabilities).image === true) {
      return [...context, ...images.map(im => ({ type: 'image', mimeType: im.mimeType, data: im.data })), ...(text ? [{ type: 'text', text }] : [])];
    }
    const files = writeImageFiles(path.join(os.tmpdir(), 'second-brain-images', this.opts.chatId.replace(/[^\w-]/g, '_')), images);
    this.turnFiles = files;
    log.info('chats', 'acp: images saved as files (no image prompt support)', { chat: this.opts.chatId, data: { engine: this.engine, files } });
    const list = files.map(f => `- ${f}`).join('\n');
    return [...context, { type: 'text', text: `${text ? `${text}\n\n` : ''}Immagini allegate (aprile dai file):\n${list}` }];
  }

  private brainContextSent = false;
  private brainContext(): Obj[] {
    if (this.brainContextSent || !this.opts.brainInstructions) return [];
    this.brainContextSent = true;
    return [{ type: 'text', text: `[App-supplied brain context; not a user message or authorization]\n${this.opts.brainInstructions}` }];
  }

  /** stderr by lines: the engine's routine log lines stay out of errTail; a provider stream error of this session's
   *  running turn (streamErrorOf) ends the turn as failed when the engine shows no sign of life (it sends nothing over
   *  ACP for it: OpenCode 1.19.5): at once for out-of-credits or its give-up; once it retries, only its give-up does
   *  (its backoff outlasts the grace). */
  private onStderr(d: string): void {
    const lines = (this.errLine + d).split(/\r?\n/);
    this.errLine = lines.pop() ?? '';
    for (const line of lines) {
      if (!engineLogNoise(line)) this.errTail = (this.errTail + line + '\n').slice(-16000); // 16000: a whole model refusal (onClose)
      const was = this.streamError;
      if (!this.prompting || this.stopping || was?.failed) continue;
      if (was && streamRetryOf(line, this.sessionId)) {
        if (this.streamErrorTimer) { clearTimeout(this.streamErrorTimer); this.streamErrorTimer = null; }
        was.retrying = true;
        continue;
      }
      const found = streamErrorOf(line, this.sessionId);
      if (!found || (found.final && !was)) continue;
      const retrying = was?.retrying ?? false;
      this.streamError = { error: found.error, credits: found.credits, failed: false, retrying };
      log.warn('chats', 'acp provider stream error', { chat: this.opts.chatId, data: { engine: this.engine, error: cut(found.error, 300), credits: found.credits, final: found.final, retrying } });
      if (this.streamErrorTimer) { clearTimeout(this.streamErrorTimer); this.streamErrorTimer = null; }
      if (retrying && !found.credits && !found.final) continue;
      const turn = this.turnSeq;
      const wait = found.credits || found.final ? 0 : this.opts.streamErrorGraceMs ?? STREAM_ERROR_GRACE_MS;
      this.streamErrorTimer = setTimeout(() => { this.streamErrorTimer = null; if (turn === this.turnSeq) this.failStreamTurn(); }, wait);
      this.streamErrorTimer.unref();
    }
  }

  /** The engine shows life after its stream error (a retry that worked): the turn goes on. */
  private streamRecovered(): void {
    if (!this.streamError || this.streamError.failed) return;
    if (this.streamErrorTimer) { clearTimeout(this.streamErrorTimer); this.streamErrorTimer = null; }
    log.info('chats', 'acp provider stream error recovered', { chat: this.opts.chatId, data: { engine: this.engine } });
    this.streamError = null;
  }

  /** The turn the provider refused: session/cancel ends the open session/prompt (OpenCode answers end_turn), and
   *  turnDone shows the error; an engine that ignores the cancel is restarted as after a user's stop (watchCancel). */
  private failStreamTurn(): void {
    // the user's own stop came first: its outcome is a stop (turnDone), never the provider's error
    if (this.exited || !this.prompting || this.stopping || !this.streamError || this.streamError.failed) return;
    this.streamError.failed = true;
    log.warn('chats', 'acp turn stopped after a provider stream error', { chat: this.opts.chatId, data: { engine: this.engine, error: cut(this.streamError.error, 300) } });
    if (this.sessionId) this.notify('session/cancel', { sessionId: this.sessionId });
    if (!this.cancelWatch) this.watchCancel();
  }

  private turnDone(r: Obj, err: Error | null): void {
    if (this.streamErrorTimer) { clearTimeout(this.streamErrorTimer); this.streamErrorTimer = null; }
    // a provider error the turn was stopped for, or that ended it without a word from the model
    const provider = this.streamError && (this.streamError.failed || (!err && !this.stopping && !this.lastAnswer.trim())) ? this.streamError : null;
    // OpenCode answers a cancel during its stream error with end_turn: a stop by the user there is still a stop
    const stalled = !!this.streamError && !this.streamError.failed;
    this.streamError = null;
    // the turn that read them is over: screenshots may hold private data, they do not stay in the temp folder
    for (const f of this.turnFiles.splice(0)) fs.rm(f, { force: true }, () => {});
    if (this.cancelWatch) { clearTimeout(this.cancelWatch); this.cancelWatch = null; }
    if (this.exited) return;
    if (this.cancelAt) {
      log.info('chats', 'acp cancel settled', { chat: this.opts.chatId, data: { engine: this.engine, ms: Date.now() - this.cancelAt, stopReason: s(r.stopReason) || null, restarted: this.wedged } });
      this.cancelAt = 0;
    }
    this.flushAll(true);
    for (const t of this.tools.values()) if (t.status === 'running') this.sink.item({ ...t, status: 'error', output: t.output ?? 'interrotto' }, true);
    for (const id of [...this.subagents.keys()]) this.subagentHooks(id, {}, 'error'); // interrupted: its stop hook too
    this.tools.clear();
    const stop = s(r.stopReason);
    if (!err && !STOP_REASONS.has(stop)) this.drift('stop reason', stop, r);
    const net = (!err && stop === 'end_turn' && isNetError(this.lastAnswer)) || (!!err && isNetError(errText(err)));
    const stopped = this.stopping;
    this.stopping = null;
    const interrupted = !err && !!stopped && (stop === 'cancelled' || (stalled && stop === 'end_turn'));
    if (provider) this.sysCode(provider.credits ? 'outOfCredits' : 'engineError', { label: this.label, error: cut(stripAnsi(provider.error), 400) }, 'error');
    else if (err) this.sysCode('engineError', { label: this.label, error: cut(stripAnsi(errText(err)), 400) }, 'error');
    else if (stop === 'refusal') this.sysCode('modelRefusal', undefined, 'warn');
    else if (stop === 'max_tokens' || stop === 'max_turn_requests') this.sysCode('turnCut', { label: this.label, stop }, 'warn');
    else if (interrupted) this.sysCode(stopped.sendNow ? 'stoppedByYouResend' : 'stoppedByYou', undefined, 'info');
    else if (stop === 'cancelled') this.sysCode('interrupted', undefined, 'info');
    const usage = Object.keys(o(r.usage)).length ? (o(r.usage) as AcpUsage) : null;
    // tokens in the prompt response (priced at Cursor's list price, priceFallback); else the session cost ACP's
    // usage_update reported, if any
    const live = this.sessionCost !== null ? Math.max(0, this.sessionCost - (this.costAtTurnStart ?? 0)) : null;
    const listed = this.opts.priceFallback ? costOf(this.models?.current ?? this.opts.model ?? null, usage) : null;
    const cost = listed ?? live;
    // the user's own interrupt (12/10: "quando faccio Invia subito vedo sempre un errore") is no error
    const isError = !!provider || !!err || net || (stop === 'cancelled' && !interrupted) || stop === 'refusal';
    this.sink.item({ kind: 'result', id: nextId('r'), at: Date.now(), costUsd: cost ?? 0, durationMs: Date.now() - this.turnStart, turns: 1, isError, ...(interrupted ? { interrupted } : {}) }, false);
    const turnTokens = usage ? tokenUsage(usage.inputTokens, usage.cachedReadTokens, usage.cachedWriteTokens, usage.outputTokens) : undefined;
    this.sink.changed({ turnCostUsd: cost ?? 0, costKnown: cost !== null, liveCostUsd: 0, ...(turnTokens ? { turnTokens } : {}) });
    log.info('chats', 'acp turn done', { chat: this.opts.chatId, op: 'invoke_agent', data: { engine: this.engine, stopReason: stop || null, error: err ? errText(err) : null, costUsd: cost, usage: !!usage, netError: net } });
    this.reportEstimate();
    this.prompting = false;
    if (net && !this.retryOff && this.retryNet(err ? errText(err) : this.lastAnswer)) return;
    if (this.queue.length) this.drain();
    else this.setState(this.asks.size ? 'waiting' : 'idle');
  }

  /** A turn cut by the engine's network error: "continue" goes by itself after a growing wait (the chat stays running,
   *  queued messages wait behind it); false when the retries are used up (a clear warning, the chat stops as usual). */
  private retryNet(errorText: string): boolean {
    const chat = this.opts.chatId, engine = this.engine, label = this.label, delays = this.opts.netRetryDelaysMs ?? NET_RETRY_DELAYS, n = this.netRetries;
    const error = cut(stripAnsi(lastLine(errorText)), 200);
    if (n >= delays.length) {
      log.warn('chats', 'acp network error: retries used up', { chat, data: { engine, retries: n, error } });
      this.sysCode('netRetriesExhausted', { label, error, n }, 'error');
      return false;
    }
    this.netRetries = n + 1;
    const wait = delays[n]!, attempt = `${n + 1}/${delays.length}`;
    log.warn('chats', 'acp network error: retrying', { chat, data: { engine, attempt: n + 1, waitMs: wait, error } });
    const id = nextId('s');
    this.retryItemId = id;
    this.sink.item({ kind: 'system', id, at: Date.now(), ...sysPayload('netRetryScheduled', { label, seconds: Math.round(wait / 1000), attempt }), level: 'warn' }, false);
    this.setState(this.asks.size ? 'waiting' : 'running');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryItemId = null;
      if (this.exited) return;
      this.sink.item({ kind: 'system', id, at: Date.now(), ...sysPayload('netRetried', { label, attempt }), level: 'info' }, true);
      this.queue.unshift({ text: netRetryPrompt(label), images: [], retry: true });
      this.drain();
    }, wait);
    this.retryTimer.unref();
    return true;
  }

  /** The running turn (and a retry already planned) is not retried after a network error. */
  noRetry(): void {
    this.retryOff = true;
    if (this.retryTimer) { this.cancelRetry('netRetryCancelledHandoff'); if (!this.prompting) this.setState(this.queue.length ? 'running' : this.asks.size ? 'waiting' : 'idle'); this.drain(); }
  }

  /** Drops a planned automatic retry (stop, exit); its line says so. */
  private cancelRetry(why: 'netRetryCancelledStopped' | 'netRetryCancelledHandoff' | 'netRetryCancelledClosed'): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.retryItemId) this.sink.item({ kind: 'system', id: this.retryItemId, at: Date.now(), ...sysPayload(why, undefined), level: 'info' }, true);
    this.retryItemId = null;
  }

  answer(requestId: string, answer: Answer): boolean {
    const ask = this.asks.get(requestId);
    if (!ask) return false;
    if (ask.method === 'app/ask_user') return this.answerAppAsk(requestId, ask, answer);
    let result: Obj;
    if (ask.method === 'session/request_permission') {
      if (answer.kind !== 'permission') throw new Error('Questa è una richiesta di permesso: rispondi consenti o rifiuta.');
      const opts = ask.options ?? [];
      const pick = (kinds: string[]): AcpOption | undefined => kinds.map(k => opts.find(x => x.kind === k)).find(Boolean);
      // Even session-scoped upstream grants can cover later operations without asking the app again.
      // ACP does not expose their patterns or a per-execution veto, so keep every answer once-only.
      if (answer.allow && answer.always) log.warn('chats', '"always" ignored for an ACP engine: remembered upstream grants can bypass later app permission checks', { chat: this.opts.chatId, data: { engine: this.engine, requestId } });
      const chosen = answer.allow ? pick(['allow_once']) : pick(['reject_once']);
      result = chosen ? { outcome: { outcome: 'selected', optionId: chosen.optionId } } : { outcome: { outcome: 'cancelled' } };
    } else if (ask.method === 'cursor/ask_question') {
      if (answer.kind === 'question') {
        const picked = (ask.questions ?? []).map(q => {
          const v = answer.answers[q.text];
          const labels = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
          return { q, labels, ids: labels.map(l => q.byLabel.get(l)).filter((x): x is string => !!x) };
        });
        const free = picked.some(p => p.labels.some(l => !p.q.byLabel.has(l)));
        // "Altro…": ACP's answered outcome carries only option ids (the CLI drops anything else), so a free-text
        // answer travels as a skip whose reason the model reads ("rejected: <reason>")
        if (free) result = { outcome: { outcome: 'skipped', reason: freeTextReason(picked.map(p => ({ question: p.q.text, answers: p.labels }))) } };
        else result = { outcome: { outcome: 'answered', answers: picked.map(p => ({ questionId: p.q.id, selectedOptionIds: p.ids })).filter(a => a.selectedOptionIds.length) } };
      } else if (!answer.allow) result = { outcome: { outcome: 'skipped', reason: answer.message?.trim() || 'L’utente ha saltato la domanda.' } };
      else throw new Error('Questa è una domanda: rispondi scegliendo le opzioni.');
    } else {
      const said = answer.kind === 'question' ? [answer.answers[PLAN_Q]].flat().filter((x): x is string => typeof x === 'string') : [];
      const own = said.find(x => x !== PLAN_YES && x !== PLAN_NO)?.trim(); // "Altro…" on the plan: rejected with the user's words
      const yes = answer.kind === 'question' ? !own && said.includes(PLAN_YES) : answer.allow;
      const reason = own ? `L’utente non approva il piano così com’è e ha scritto: «${own}»` : answer.kind === 'permission' ? answer.message : undefined;
      result = yes ? { outcome: { outcome: 'accepted' } } : { outcome: { outcome: 'rejected', ...(reason ? { reason } : {}) } };
    }
    this.respond(ask.rpcId, result);
    this.asks.delete(requestId);
    log.info('chats', 'acp request answered', { chat: this.opts.chatId, data: { engine: this.engine, requestId, method: ask.method, outcome: o(result.outcome).outcome, optionId: o(result.outcome).optionId } });
    this.sink.resolved(requestId);
    this.setState(this.asks.size ? 'waiting' : this.prompting || this.queue.length ? 'running' : 'idle');
    return true;
  }

  /** The app's ask_user tool (appAsk engines: OpenCode has no question tool over ACP): one yes/no question panel, with
   *  the same brief gate as cursor/ask_question (ADR 0150: a moment for a show_ui sent in parallel, then sent back at
   *  most YESNO_RETRIES times in a row). null = shown; a string = refused, with how to ask. */
  async askUser(q: AppAsk): Promise<string | null> {
    if (!this.opts.appAsk) return 'ask_user: this engine has its own question tool; use it.';
    // an engine being restarted (it ignored a stop) or closed asks nothing: its answer would go nowhere
    const gone = () => this.exited || !this.proc || this.wedged || this.closing;
    if (gone()) throw new Error(NOT_ACTIVE);
    const text = q.question.trim().slice(0, 1000);
    if (!text) return 'ask_user: write the question.';
    const gate = this.opts.yesNo ?? yesNoGateOn(process.env);
    const briefMissing = () => gate && !this.briefOff && !!this.opts.briefReady && !this.opts.briefReady();
    if (briefMissing() && this.yesNoRefused < YESNO_RETRIES) await new Promise(r => setTimeout(r, BRIEF_GRACE_MS));
    if (gone()) throw new Error(NOT_ACTIVE);
    const noBrief = briefMissing();
    if (noBrief && this.yesNoRefused >= YESNO_RETRIES) this.briefOff = true;
    if (noBrief && this.yesNoRefused < YESNO_RETRIES) {
      this.yesNoRefused++;
      log.info('chats', 'question sent back: no brief', { chat: this.opts.chatId, data: { engine: this.engine, attempt: this.yesNoRefused, via: 'ask_user' } });
      return BRIEF_REFUSAL.replace('ask the same yes/no question again', 'call ask_user again');
    }
    this.yesNoRefused = 0;
    const yes = q.recommended === 'no' ? ASK_YES : ASK_YES + ASK_MARK, no = q.recommended === 'no' ? ASK_NO + ASK_MARK : ASK_NO;
    const header = q.header?.trim() ? cut(q.header.trim(), 30) : undefined;
    const questions: Question[] = [{ question: text, ...(header ? { header } : {}), options: [{ label: yes }, { label: no }], multiSelect: false }];
    const rid = nextId('ask');
    this.asks.set(rid, { rpcId: '', method: 'app/ask_user', questions: [{ text, id: rid, byLabel: new Map([[yes, ASK_YES], [no, ASK_NO]]) }] });
    this.flushAll(true);
    this.pending({ id: rid, type: 'question', tool: 'AskUser', title: cut(text, 140), detail: text, input: { question: text, recommended: q.recommended }, questions, at: Date.now() });
    log.info('chats', 'acp app question shown', { chat: this.opts.chatId, data: { engine: this.engine, requestId: rid } });
    return null;
  }

  /** The user's answer to an app question: no engine request to answer, it goes to the model as the user's next message
   *  (queued after a turn still running). "Altro…" carries the user's own words; «Ci penso dopo» / a refusal says skipped. */
  private answerAppAsk(requestId: string, ask: Ask, answer: Answer): boolean {
    const q = ask.questions?.[0];
    let said: string;
    if (answer.kind === 'question') {
      const v = q ? answer.answers[q.text] : undefined;
      const labels = (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map(l => q?.byLabel.get(l) ?? l.trim()).filter(Boolean);
      said = labels.length ? labels.join(', ') : '(nessuna risposta)';
    } else if (!answer.allow) said = answer.message?.trim() ? `nessuna scelta; ha scritto: «${answer.message.trim()}»` : 'saltata, nessuna scelta';
    else throw new Error('Questa è una domanda: rispondi scegliendo le opzioni.');
    // an engine being restarted or closed would drop the answer in a queue nobody drains: say so, never a lost answer
    if (this.exited || !this.proc || this.wedged || this.closing) throw new Error(NOT_ACTIVE);
    this.asks.delete(requestId);
    log.info('chats', 'acp app question answered', { chat: this.opts.chatId, data: { engine: this.engine, requestId } });
    this.sink.resolved(requestId);
    this.setState(this.asks.size ? 'waiting' : 'running');
    this.send(`Risposta dell'utente alla tua domanda «${cut(q?.text ?? '', 300)}»: ${said}`);
    return true;
  }

  /** Stop: session/cancel; every open panel is answered "cancelled" (ACP requires it) and queued messages are dropped,
   *  unless keepQueued ("Invia subito"): then they were already sent by the user and run next, as drain goes on. */
  async interrupt(opts?: { keepQueued?: boolean; byUser?: boolean }): Promise<void> {
    if (this.exited || !this.proc) return;
    log.info('chats', 'acp cancel', { chat: this.opts.chatId, data: { engine: this.engine, queued: this.queue.length, open: this.asks.size, keepQueued: !!opts?.keepQueued } });
    this.cancelRetry('netRetryCancelledStopped');
    if (this.queue.length && !opts?.keepQueued) { this.sysCode('queueCancelled', { n: this.queue.length }, 'info'); this.queue = []; }
    if (this.prompting && opts?.byUser) this.stopping = { sendNow: !!opts.keepQueued }; // only a prompt in flight ends with a result
    // cancel first, so the agent knows its turn is over when its waits resolve
    if (this.sessionId) this.notify('session/cancel', { sessionId: this.sessionId });
    if (this.prompting && opts?.byUser && !this.cancelWatch) this.watchCancel();
    // a question still waiting for its brief was never shown: it is answered cancelled too
    for (const [id, w] of [...this.briefWaited]) { if (w.timer) clearTimeout(w.timer); this.briefWaited.delete(id); this.respond(w.rpcId, { outcome: { outcome: 'cancelled' } }); }
    for (const [id, ask] of [...this.asks]) {
      // an app question (askUser) has no engine request to answer: the stop only takes it away
      if (ask.method !== 'app/ask_user') this.respond(ask.rpcId, { outcome: { outcome: 'cancelled' } });
      this.asks.delete(id);
      this.sink.resolved(id);
    }
    // "Invia subito" during a retry wait: no turn runs, so the kept messages go now (drain waited for the retry)
    if (!this.prompting) { this.setState(this.queue.length ? 'running' : 'idle'); this.drain(); }
  }

  /** A stop the engine does not answer (OpenCode took 55 s to end a cancelled prompt, 2026-10-31): after the grace the
   *  turn ends here as stopped, the engine is left behind and the manager resumes the same session on a new one, where
   *  the messages still queued go (SessionPatch.restart). The old prompt's late answer is ignored (turnSeq). */
  private watchCancel(): void {
    const turn = this.turnSeq, ms = this.opts.cancelGraceMs ?? CANCEL_GRACE_MS;
    this.cancelAt = Date.now();
    this.cancelWatch = setTimeout(() => {
      this.cancelWatch = null;
      if (this.exited || !this.prompting || turn !== this.turnSeq) return;
      log.warn('chats', 'acp cancel unanswered: restarting the engine', { chat: this.opts.chatId, cause: `session/prompt still open ${ms} ms after session/cancel`, hint: 'the engine ignores or delays cancel; the chat resumes its session on a new engine', data: { engine: this.engine, waitedMs: Date.now() - this.cancelAt } });
      this.wedged = true;
      this.turnSeq++;
      const carry = this.queue.splice(0).filter(q => !q.retry).map(q => ({ text: q.text, images: q.images }));
      this.sink.changed({ restart: carry });
      this.turnDone({ stopReason: 'cancelled' }, null);
    }, ms);
    this.cancelWatch.unref();
  }

  /** Never live: in Cursor, ACP session/set_model writes the user's global CLI config (cli-config.json: model,
   *  selectedModel, hasChangedDefaultModel). The manager reopens the session with the new model instead (modelRestart). */
  async setModel(_model: string | null): Promise<void> {
    throw new Error(modelRestart(this.label));
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    // the working mode: Cursor's "agent", else the first one that is not read-only (OpenCode's "build")
    const modeId = mode === 'plan' ? 'plan' : this.modes.includes('agent') ? 'agent' : this.modes.find(m => m !== 'plan' && m !== 'ask') ?? 'agent';
    if (!this.modes.includes(modeId)) throw new Error(`${this.label} non ha la modalità ${modeId}.`);
    await this.setModeId(modeId);
    this.sink.changed({ permissionMode: mode });
  }

  /** The model's reasoning (session/set_config_option on its thought_level parameter), mapped onto the values it
   *  offers. Before the session is open it is only kept: applyModelConfig sends it. null = keep what runs now. */
  async setEffort(effort: Effort | null): Promise<void> {
    this.effort = effort;
    const current = this.models?.current;
    if (!effort || !this.open || !current) { this.sink.changed({ effort }); return; }
    const thought = this.params.find(p => p.category === 'thought_level');
    if (!thought) throw new Error(`Il modello ${current} di ${this.label} non offre una scelta dell’effort.`);
    const value = acpEffortValue(effort, thought.values);
    if (!value) throw new Error(`Il modello ${current} di ${this.label} non offre l’effort ${effort} (offre: ${thought.values.join(', ') || 'nessun valore'}).`);
    if (thought.value !== value) {
      const r = await this.request('session/set_config_option', { sessionId: this.sessionId, configId: thought.id, value });
      const next = modelParams(r.configOptions);
      if (next.length) this.params = next; else thought.value = value;
    }
    const variant = this.variantChanged(current);
    this.sink.changed({ effort });
    log.info('chats', 'acp effort', { chat: this.opts.chatId, data: { engine: this.engine, effort, value, running: variant } });
  }

  async rename(_title: string): Promise<void> { /* the title lives in the app */ }

  async contextUsage(): Promise<ContextUsage | null> { return this.context; }

  async usage(): Promise<unknown> { return null; }

  close(graceMs = CLOSE_GRACE_MS, keepChildren = false): Promise<void> {
    if (this.exited || !this.proc) { this.markExited(); return this.exitPromise; }
    // a real close already asked wins over a later keeping one (a reopen after the turn while ✕ waits)
    this.keepChildren = this.closing ? this.keepChildren && keepChildren : keepChildren;
    this.closing = true;
    if (this.wedged) graceMs = 0; // it already ignored a stop: no grace to finish a turn it will not end
    try { this.proc.stdin.end(); } catch { /* gone */ }
    if (this.killed) return this.exitPromise; // already being killed (app quit): no grace, no false "did not exit"
    const pid = this.proc.pid, t0 = Date.now();
    const t = setTimeout(() => {
      if (this.exited) return;
      if (this.procExited) return this.releasePipes();
      log.warn('chats', 'acp session did not exit, killing', { chat: this.opts.chatId, data: { engine: this.engine, pid, waitedMs: Date.now() - t0 }, cause: 'no exit within the grace after its stdin closed', hint: 'a turn or a tool still running at close; npm run logs -- --chat <id> shows what it was doing' });
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
    log.info('chats', 'acp engine exited, a leftover still holds its output: closing the pipes', { chat: this.opts.chatId, data: { engine: this.engine, pid: this.proc.pid } });
    closePipes(this.proc);
  }

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
      const timer = timeoutMs ? setTimeout(() => { this.rpcs.delete(id); reject(new Error(`${method}: nessuna risposta da ${this.label}`)); }, timeoutMs) : null;
      timer?.unref();
      this.rpcs.set(id, { resolve, reject, method, timer });
      try { this.write({ jsonrpc: '2.0', id, method, params }); }
      catch (e) { if (timer) clearTimeout(timer); this.rpcs.delete(id); reject(e as Error); }
      log.debug('chats', 'acp request', { chat: this.opts.chatId, data: { engine: this.engine, id, method } });
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
    if (this.out.length > 50_000_000) { log.warn('chats', 'acp stdout line too long, dropped', { chat: this.opts.chatId, data: { engine: this.engine } }); this.out = ''; }
  }

  /** One stdout line. Never throws. */
  line(raw: string): void {
    let m: unknown;
    try { m = JSON.parse(raw); } catch {
      this.badLines += 1;
      if (this.badLines <= 20) log.warn('chats', 'non-JSON line from an ACP engine', { chat: this.opts.chatId, data: { engine: this.engine, line: cut(raw, 300) } });
      return;
    }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    if (this.recording) {
      const id = (m as Obj).id;
      record(this.engine, this.cliVersion, acpKey(m as Obj, typeof id === 'number' ? this.rpcs.get(id)?.method : undefined), m);
    }
    try { this.onMessage(m as Obj); } catch (e) {
      log.error('chats', 'ACP message not understood', { chat: this.opts.chatId, cause: errText(e), hint: `protocol drift? compare with the agentclientprotocol.com schema and the ${this.label} CLI's ACP docs, update chats/acp.ts`, data: { engine: this.engine, line: cut(raw, 500) } });
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
        log.warn('chats', 'acp error response', { chat: this.opts.chatId, data: { engine: this.engine, method: rpc.method, code: e.code, message: e.message } });
        rpc.reject(new RpcError(s(e.message) || `${rpc.method} fallito`, num(e.code) ?? -32603));
      } else rpc.resolve(o(m.result));
      return;
    }
    if (method && hasId) return this.onAgentRequest(m.id as number | string, method, o(m.params));
    if (method) return this.onNotification(method, o(m.params));
  }

  private onAgentRequest(id: number | string, method: string, p: Obj): void {
    // an engine being restarted after an ignored stop asks nobody: its turn is already over on screen
    if (this.wedged) return this.respond(id, { outcome: { outcome: 'cancelled' } });
    const at = Date.now();
    const rid = nextId('ask');
    if (method === 'session/request_permission') {
      const tc = o(p.toolCall);
      const options: AcpOption[] = arr(p.options).map(x => ({ optionId: s(o(x).optionId), name: s(o(x).name), kind: s(o(x).kind) })).filter(x => x.optionId);
      const known = this.tools.get(s(tc.toolCallId)); // the tool_call that came first carries the input (command, path)
      const kindName = KIND_NAME[s(tc.kind)] ?? known?.name ?? 'Tool';
      const view = permissionView(tc, known, kindName);
      this.asks.set(rid, { rpcId: id, method, options });
      this.pending({
        id: rid, type: 'permission', tool: kindName, title: view.title, detail: view.detail,
        // Never grant opaque upstream patterns: even unrestricted roles still have app hard-deny gates.
        // An earlier tool update may have no rawInput (stored as {}): its empty input must not hide
        // the permission's locations from the path/role gates. Keep all locations even with raw input.
        input: trimInput({ ...o(tc.rawInput ?? known?.input ?? tc), ...(tc.locations !== undefined ? { locations: tc.locations } : {}) }), at, noAlways: true,
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
      // not yes/no (ADR 0135), or yes/no without its brief (ADR 0150, after a moment for a show_ui sent in parallel):
      // skipped with how to ask, at most YESNO_RETRIES times in a row, then shown as it is
      const gate = (this.opts.yesNo ?? yesNoGateOn(process.env)) && questions.length > 0;
      const yesNo = yesNoShape(questions);
      const noBrief = gate && yesNo && !this.briefOff && !!this.opts.briefReady && !this.opts.briefReady();
      if (noBrief && !this.briefWaited.has(id) && this.yesNoRefused < YESNO_RETRIES) {
        const timer = setTimeout(() => {
          const w = this.briefWaited.get(id);
          if (!w) return;
          w.timer = null;
          if (!this.exited && !this.procExited) this.onAgentRequest(id, method, p);
          this.briefWaited.delete(id);
        }, BRIEF_GRACE_MS);
        timer.unref?.();
        this.briefWaited.set(id, { rpcId: id, timer });
        return;
      }
      if (noBrief && this.yesNoRefused >= YESNO_RETRIES) this.briefOff = true;
      if (gate && (!yesNo || noBrief) && this.yesNoRefused < YESNO_RETRIES) {
        this.yesNoRefused++;
        log.info('chats', noBrief ? 'question sent back: no brief' : 'question sent back: not yes/no', { chat: this.opts.chatId, data: { engine: this.engine, attempt: this.yesNoRefused } });
        this.respond(id, { outcome: { outcome: 'skipped', reason: noBrief ? BRIEF_REFUSAL : YESNO_REFUSAL } });
        return;
      }
      this.yesNoRefused = 0;
      this.asks.set(rid, { rpcId: id, method, questions: acp });
      // the text streamed before the question is finished now (no tool call closes it): the Orchestrator's card reads its
      // commands from finished messages only (lib/orchestrator-route.ts commandsOfTurn)
      this.flushAll(true);
      this.pending({ id: rid, type: 'question', tool: 'AskQuestion', title: cut(s(p.title) || questions[0]?.question || 'Domanda', 140), detail: questions.map(q => q.question).join('\n'), input: trimInput(p), questions, at });
      return;
    }
    if (method === 'cursor/create_plan') {
      const detail = [s(p.name), s(p.overview), s(p.plan)].map(x => x.trim()).filter(Boolean).join('\n\n');
      this.asks.set(rid, { rpcId: id, method });
      this.flushAll(true);
      this.pending({
        id: rid, type: 'question', tool: 'CreatePlan', title: PLAN_Q, detail: cut(detail, 8000), input: trimInput(p), at,
        questions: [{ question: PLAN_Q, header: 'Piano', options: [{ label: PLAN_YES, description: `${this.label} procede con il piano` }, { label: PLAN_NO, description: `${this.label} non lo esegue` }], multiSelect: false }],
      });
      return;
    }
    // Cursor sends these "non-blocking" extensions as requests (extMethod): show them and acknowledge
    if (method === 'cursor/update_todos' || method === 'cursor/task') { this.showExt(method, p); this.respond(id, {}); return; }
    // fs/* and terminal/* are not offered in our capabilities; anything else is unknown
    this.drift('agent request', method, p);
    log.warn('chats', 'unsupported ACP request', { chat: this.opts.chatId, data: { engine: this.engine, method } });
    this.respondError(id, -32601, `Method not found: ${method}`);
  }

  /** cursor/update_todos → one "Attività" item kept up to date; cursor/task → a "Subagente" line. */
  private showExt(method: string, p: Obj): void {
    if (method === 'cursor/update_todos') {
      const todos = arr(p.todos).map(x => o(x));
      const mark = (st: string): string => (st === 'completed' ? '✓' : st === 'in_progress' ? '▸' : st === 'cancelled' ? '✗' : '○');
      const list = todos.map(t => `${mark(s(t.status))} ${s(t.content)}`).join('\n');
      const id = this.todosItemId ?? nextId('todo');
      this.sink.item({ kind: 'system', id, at: Date.now(), ...sysPayload('todos', { list }), level: 'info' }, !!this.todosItemId);
      this.todosItemId = id;
    } else if (method === 'cursor/task') {
      this.childTask(p, true);
      const sub = this.subagents.get(s(p.toolCallId));
      if (sub && s(p.model)) sub.model = s(p.model);
      this.sysCode('subagent', { description: cut(s(p.description) || s(p.prompt), 200) }, 'info');
    }
  }

  private pending(req: Omit<PendingRequest, 'chatId'>): void {
    log.info('chats', 'acp asks', { chat: this.opts.chatId, op: 'execute_tool', data: { engine: this.engine, requestId: req.id, type: req.type, tool: req.tool } });
    this.setState('waiting');
    this.sink.pending(req);
  }

  private onNotification(method: string, p: Obj): void {
    if (this.wedged) return; // the abandoned turn's late updates

    if (method === 'session/update') return this.onUpdate(o(p.update));
    if (method === 'cursor/update_todos' || method === 'cursor/task') this.showExt(method, p); // older CLIs: as notifications
    else this.drift('notification', method, p);
  }

  private drift(kind: string, what: string, sample: unknown): void {
    drift(this.engine, this.cliVersion, kind, what, sample, this.opts.chatId);
  }

  /** The estimate (characters / 4), until the engine reports a real usage_update. */
  private reportEstimate(): void {
    if (this.context || !this.chars) return;
    this.sink.changed({ contextTokens: estimateTokens(this.chars), contextEstimated: true });
  }

  /** Characters an update adds to the conversation (for the estimate). */
  private count(u: Obj): void {
    const kind = s(u.sessionUpdate);
    if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk' || kind === 'user_message_chunk') this.chars += s(o(u.content).text).length;
    else if (kind === 'tool_call' || kind === 'tool_call_update') {
      for (const c of arr(u.content).map(o)) this.chars += s(o(c.content).text).length + s(c.newText).length;
      if (u.rawInput !== undefined) this.chars += JSON.stringify(u.rawInput).length;
      if (u.rawOutput !== undefined) this.chars += typeof u.rawOutput === 'string' ? u.rawOutput.length : JSON.stringify(u.rawOutput).length;
    }
  }

  private onUpdate(u: Obj): void {
    this.count(u);
    // words or tools after a provider stream error: the engine retried and goes on (usage_update also follows a cancel)
    if (this.streamError && u.sessionUpdate !== 'usage_update' && u.sessionUpdate !== 'available_commands_update' && u.sessionUpdate !== 'config_option_update') this.streamRecovered();
    // Child observations must survive a hidden replay and must never depend on external subagent hooks.
    if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') this.childTask(u);
    // the input's "/" list, also while a resumed session loads
    if (u.sessionUpdate === 'available_commands_update') { this.sink.commands?.(toCommands(u.availableCommands)); return; }
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
        const list = arr(u.entries).map(x => o(x)).map(e => `${mark(s(e.status))} ${s(e.content)}`).join('\n');
        const id = this.planItemId ?? nextId('plan');
        this.sink.item({ kind: 'system', id, at: Date.now(), ...sysPayload('plan', { list }), level: 'info' }, !!this.planItemId);
        this.planItemId = id;
        return;
      }
      // Cursor's read-only "ask" is shown as plan where it was asked for as one (read-only run, agent capped at plan)
      case 'current_mode_update': this.sink.changed({ permissionMode: s(u.currentModeId) === 'plan' || (s(u.currentModeId) === 'ask' && (this.opts.readOnly || this.opts.ceiling === 'plan')) ? 'plan' : 'default' }); return;
      case 'config_option_update': { // the CLI changed a model parameter by itself: the chat's info follows it
        if (this.modelOption) { this.readModelOption(u.configOptions); if (this.models?.current) this.variantChanged(this.models.current); return; }
        const next = modelParams(u.configOptions);
        if (next.length && this.models?.current) { this.params = next; this.variantChanged(this.models.current); }
        return;
      }
      case 'usage_update': {
        const used = num(u.used), size = num(u.size);
        if (used !== undefined && size) {
          this.context = { totalTokens: used, maxTokens: size, percentage: (100 * used) / size };
          this.sink.changed({ contextTokens: used, contextMaxTokens: size, contextEstimated: false });
        }
        // ACP: cost = the session's cumulative {amount, currency}; Cursor's CLI does not send it yet (cursor-cost research note)
        const c = o(u.cost), amount = num(c.amount);
        if (amount !== undefined && (!c.currency || s(c.currency) === 'USD')) {
          // a loaded session's first figure includes its past turns: it becomes the base (undercount, never a jump)
          if (this.sessionCost === null && this.opts.resume) this.costAtTurnStart = amount;
          this.sessionCost = amount;
          if (this.prompting) this.sink.changed({ liveCostUsd: Math.max(0, amount - (this.costAtTurnStart ?? 0)), costKnown: true });
        }
        return;
      }
      default: if (!QUIET_UPDATES.has(s(u.sessionUpdate))) this.drift('session update', s(u.sessionUpdate), u); return;
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
    if (!this.flushTimer) { this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flushAll(false); }, STREAM_FLUSH_MS); this.flushTimer.unref(); }
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
      if (st.item.text.trim()) { this.lastAnswer = st.item.text; this.sink.changed({ lastText: lastLine(st.item.text) }); }
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
    if (kind && !KIND_NAME[kind]) this.drift('tool kind', kind, u);
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
      ...(name === 'Shell' ? acpExitCode(u.rawOutput) : {}),
    };
    this.tools.set(id, item);
    this.sink.item(item, !isNew || !!prev);
    this.subagentHooks(id, u, item.status);
  }

  private childTask(u: Obj, extension = false): void {
    const id = s(u.toolCallId), raw = o(u.rawInput), prev = this.childTasks.get(id);
    if (!id || (!extension && raw._toolName !== 'task' && !prev)) return;
    const st = s(u.status);
    let state: ChildObservation['state'] = !st ? prev?.state ?? 'unknown'
      : st === 'completed' ? 'completed' : st === 'failed' ? 'failed' : st === 'cancelled' ? 'stopped'
        : st === 'in_progress' ? 'running' : st === 'pending' ? 'waiting' : 'unknown';
    const task = s(raw.description) || s(raw.prompt) || (extension ? s(u.description) || s(u.prompt) : '') || prev?.task || null;
    const agentType = typeof raw.subagentType === 'string' ? raw.subagentType : s(o(raw.subagentType).custom) || null;
    // Descriptive metadata alone does not make a replayed running state current again after a resume.
    const source = this.loading ? 'replay' : !st && prev ? prev.source : 'live';
    if (source === 'replay' && prev && (prev.source === 'live' || ['completed', 'failed', 'stopped'].includes(prev.state))) state = prev.state;
    this.childTasks.set(id, { task, state, source: prev?.source === 'live' ? 'live' : source });
    this.childTelemetry.observe({
      key: `acp:tool:${id}`, nativeId: null, toolCallId: id, parentNativeId: null, kind: 'agent', state, task,
      agentType: agentType || null, observedAt: Date.now(), source,
    });
  }

  /** subagentStart when a Task tool call shows up, subagentStop when it ends (ACP never fires these hooks). Cursor only
   *  (subagentHooks). */
  private subagentHooks(id: string, u: Obj, status: ToolItem['status']): void {
    if (!this.opts.subagentHooks) return;
    const file = this.opts.hooksFile !== undefined ? this.opts.hooksFile : process.env.SB_TEST || process.env.VITEST ? null : userHooksFile();
    if (!file || this.loading) return;
    const sid = this.sessionId ?? '';
    const base = { conversation_id: sid, parent_conversation_id: sid, tool_call_id: id, subagent_id: id, workspace_roots: [this.opts.cwd], cursor_version: 'acp (second-brain)' };
    const raw = o(u.rawInput);
    let sub = this.subagents.get(id);
    if (!sub && raw._toolName === 'task') {
      const t = raw.subagentType;
      sub = { at: Date.now(), type: typeof t === 'string' ? t : s(o(t).custom) || 'unspecified', task: s(raw.prompt), description: s(raw.description), model: null };
      this.subagents.set(id, sub);
      this.hookRuns.push(runSubagentHooks(file, 'subagentStart', { ...base, subagent_type: sub.type, task: sub.task, description: sub.description }, this.opts.cwd));
    }
    if (!sub || status === 'running') return;
    this.subagents.delete(id);
    const out = o(u.rawOutput);
    this.hookRuns.push(runSubagentHooks(file, 'subagentStop', {
      ...base, subagent_type: sub.type, task: sub.task, description: sub.description, subagent_model: sub.model,
      status: status === 'ok' ? 'completed' : 'error', duration_ms: num(out.durationMs) ?? Date.now() - sub.at,
    }, this.opts.cwd));
  }

  private onClose(code: number | null): void {
    if (this.exited) return;
    this.flushAll(true);
    const clean = this.closing || code === 0;
    if (this.errLine) { this.errTail = (this.errTail + this.errLine).slice(-16000); this.errLine = ''; } // a last line with no newline
    const tail =stripAnsi(this.errTail).trim().split(/\r?\n/).slice(-4).join(' · ');
    const error = clean ? null : cut(tail || `${this.label} è uscito con codice ${code ?? '?'}`, 600);
    if (error) log.error('chats', 'acp engine exited with an error', { chat: this.opts.chatId, data: { engine: this.engine }, cause: `exit ${code}: ${cut(tail, 2000) || 'no stderr'}`, hint: `run \`${this.cliName} --version\` in a terminal; resume with a new message` });
    else log.info('chats', 'acp session exit', { chat: this.opts.chatId, data: { engine: this.engine, code } });
    // the CLI refused the model: its whole list goes on beside the cut error (SessionSink.exit refusal)
    const refusal = error ? /Cannot use this model: [^\r\n]+/.exec(stripAnsi(this.errTail))?.[0] : undefined;
    this.end(clean ? 'closed' : 'error', code, error, refusal);
  }

  private fail(error: string, cause: string, hint: string): void {
    if (this.exited) return;
    log.error('chats', 'acp session failed', { chat: this.opts.chatId, data: { engine: this.engine }, cause, hint });
    this.end('error', null, error);
  }

  /** A fatal boot error with the process still running: report it and stop the process. */
  private stopWith(error: string, cause: string, hint: string): void {
    const p = this.proc;
    this.fail(error, cause, hint);
    if (p) { try { p.stdin.end(); } catch { /* gone */ } killEngineTree(p.pid, this.job, () => p.kill(), this.opts.chatId); }
  }

  private end(state: ChatState, code: number | null, error: string | null, refusal?: string): void {
    if (this.exited) return;
    this.markExited();
    for (const r of this.rpcs.values()) { if (r.timer) clearTimeout(r.timer); r.reject(new Error('La sessione è terminata.')); }
    this.rpcs.clear();
    for (const id of [...this.asks.keys()]) { this.asks.delete(id); this.sink.resolved(id); }
    for (const t of this.tools.values()) if (t.status === 'running') this.sink.item({ ...t, status: 'error', output: t.output ?? 'interrotto' }, true);
    for (const id of [...this.subagents.keys()]) this.subagentHooks(id, {}, 'error'); // interrupted: its stop hook too
    this.tools.clear();
    this.queue = [];
    this.prompting = false;
    this.setState(state);
    this.sink.exit({ code, error, ...(refusal ? { refusal } : {}) });
  }

  private markExited(): void {
    if (this.exited) return;
    this.exited = true;
    for (const w of this.briefWaited.values()) if (w.timer) clearTimeout(w.timer);
    this.briefWaited.clear();
    this.childTelemetry.end();
    this.cancelRetry('netRetryCancelledClosed');
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.streamErrorTimer) { clearTimeout(this.streamErrorTimer); this.streamErrorTimer = null; }
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

  private sysCode<C extends SysCode>(code: C, params: SysParams | undefined, level: 'info' | 'warn' | 'error'): void {
    this.sink.item({ kind: 'system', id: nextId('s'), at: Date.now(), ...sysPayload(code, params), level }, false);
  }
}

/** text + code + params for a system item built with a stable id (sink.item called directly, not through sysCode). */
function sysPayload<C extends SysCode>(code: C, params: SysParams | undefined): { text: string; code: C; params: SysParams | undefined } {
  return { text: sysEn(code, params), code, params };
}
