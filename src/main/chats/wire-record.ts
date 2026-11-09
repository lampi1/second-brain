// Record mode of the engines' wire (ADR 0221): when SB_WIRE_RECORD_DIR names a folder, every line an adapter writes to
// its engine's stdin and every line the engine prints on stdout goes, redacted, into one NDJSON file per session:
// <dir>/<engine>/<chatId>-<run>.ndjson, one entry per line { ts, run, seq, dir: 'app>engine' | 'engine>app', line }.
// Why: a recording is the script of a fake engine (test/fixtures/replay-engine.mjs), so the adapters (claude.ts,
// codex.ts, acp.ts) are tested against a real protocol shape without spending tokens (test/unit/chats/wire-replay.test.ts,
// the parity harness). The idea, not the code, comes from cloudroom's record mode (gui/docs/provider-bridge-protocol.md).
// Safety (rule 2): off unless the variable is set (tests, or the user's own dev run); secrets are never written: keys
// whose name says token/key/secret/password/authorization/cookie, bearer/API-key/JWT-shaped strings and the app's MCP
// urls (their path carries a token) are replaced; the user's own words (prompt text), sent to the engine or echoed back
// by it (a resume, a session/load replay), are replaced by their length unless SB_WIRE_RECORD_PROMPTS=1 says the user chose to keep them. Used by the three adapters right after
// spawn().
import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { log } from '../log';
import { maskArgs, typingTool, type Typing } from './typed-text';

export type WireDir = 'app>engine' | 'engine>app';
export interface WireEntry { ts: number; run: string; seq: number; dir: WireDir; line: string }

/** a key whose name ends like a credential (apiKey, access_token, idToken, clientSecret, Authorization, Cookie…) */
const SECRET_KEY = /(?:api_?key|private_?key|token|secret|password|passwd|authorization|cookie)$/i;
const SECRET_VALUE: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,                     // Anthropic / OpenAI style keys
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{12,}/g,
];
/** the app's MCP endpoints carry their token in the path (/mcp/<mount>/<token>): keep the host, drop the path */
const MCP_URL = /(https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?)\/mcp\/[^\s"'\\]*/g;
/** where the user's words go in each protocol's outgoing lines: Claude's message.content[].text, ACP's
 *  session/prompt params.prompt[].text, Codex's turn/start params.input[].text */
const PROMPT_PARENTS = new Set(['content', 'prompt', 'input']);

/** A string with every secret-shaped part replaced. */
export function redactText(s: string): string {
  let out = s.replace(MCP_URL, '$1/mcp/<redacted>');
  for (const re of SECRET_VALUE) out = out.replace(re, '<redacted>');
  return out;
}

/** an object that echoes the user's words back from the engine: Codex's userMessage item (live and in thread/resume),
 *  ACP's user_message_chunk (session/load replay), Claude's user message; a tool result inside one is not the user's */
const isUserEcho = (o: Record<string, unknown>): boolean =>
  o.type === 'userMessage' || o.sessionUpdate === 'user_message_chunk' || o.role === 'user' || o.type === 'user';

/** where each engine puts a tool call's arguments: Claude's tool_use input, can_use_tool input and hook tool_input,
 *  ACP's rawInput, Codex's mcpToolCall arguments */
const TOOL_INPUTS = ['input', 'rawInput', 'arguments', 'tool_input'] as const;
const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const rec = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});

/** A tool call of the app's browser that types into a page (type, fill_form, key) with what it types masked
 *  (chats/typed-text.ts): a password typed by an agent never lands in a recording. ACP's later tool_call_update may
 *  carry only the call id, so the kinds of the typing calls seen in this recording are kept in `typing` by id. */
function maskTyping(o: Record<string, unknown>, typing?: Map<string, Typing>): Record<string, unknown> {
  // Claude streams a tool's input in nameless input_json_delta fragments: never kept (claude.ts ignores them anyway)
  if (typeof o.partial_json === 'string' && o.partial_json) return { ...o, partial_json: '' };
  // Claude's can_use_tool names the call; the app's answer carries only its request_id, with the input as updatedInput
  const rid = str(o.request_id), request = rec(o.request), response = rec(o.response);
  if (rid && request.subtype === 'can_use_tool') { const k = typingTool(str(request.tool_name)); if (k) typing?.set(`request:${rid}`, k); }
  const answered = rid ? typing?.get(`request:${rid}`) : undefined;
  if (answered && response.updatedInput && typeof response.updatedInput === 'object') return { ...o, response: { ...response, updatedInput: maskArgs(answered, response.updatedInput) } };
  // Codex's MCP elicitation (codex.ts) shows the call's parameters in _meta: all masked for the app's browser server
  const meta = rec(o._meta);
  if (str(o.serverName) && typingTool(`mcp__${str(o.serverName)}`) && (meta.tool_params || meta.tool_params_display)) {
    return { ...o, _meta: { ...meta,
      ...(meta.tool_params && typeof meta.tool_params === 'object' ? { tool_params: maskArgs('any', meta.tool_params) } : {}),
      ...(Array.isArray(meta.tool_params_display) ? { tool_params_display: meta.tool_params_display.map(d => ({ ...rec(d), value: '•••' })) } : {}) } };
  }
  const name = str(o.name) || str(o.tool_name) || (str(o.server) && str(o.tool) ? `mcp__${str(o.server)}__${str(o.tool)}` : '');
  const id = str(o.toolCallId);
  const kind = typingTool(name, str(o.title)) || (id ? typing?.get(id) : undefined);
  const inputKey = TOOL_INPUTS.find(k => o[k] && typeof o[k] === 'object');
  if (!kind) return o;
  if (id) typing?.set(id, kind);
  return inputKey ? { ...o, [inputKey]: maskArgs(kind, o[inputKey]) } : o;
}

/** A parsed wire message, redacted: secret keys and values; prompt text unless kept, in every app>engine line and in
 *  what the engine echoes of the user's words; what an agent types into a page through the browser tools. */
export function redactValue(v: unknown, opts: { prompts: boolean; dir: WireDir; typing?: Map<string, Typing> }, key = '', user = false): unknown {
  if (typeof v === 'string') return redactText(v);
  if (Array.isArray(v)) return v.map(x => redactValue(x, opts, key, user)); // an array's items keep the array's key
  if (!v || typeof v !== 'object') return v;
  const o = maskTyping(v as Record<string, unknown>, opts.typing);
  const inUser = o.type === 'tool_result' ? false : user || isUserEcho(o);
  const hidePrompt = !opts.prompts && (opts.dir === 'app>engine' || inUser);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    if (SECRET_KEY.test(k) && typeof x === 'string' && x) out[k] = '<redacted>';
    else if (hidePrompt && typeof x === 'string' && ((k === 'text' && PROMPT_PARENTS.has(key)) || (k === 'content' && key === 'message'))) out[k] = `<prompt ${x.length} chars>`;
    // Codex's Thread object (thread/start, thread/resume, thread/started) carries the user's first message as its preview
    else if (!opts.prompts && k === 'preview' && key === 'thread' && typeof x === 'string' && x) out[k] = `<prompt ${x.length} chars>`;
    else out[k] = redactValue(x, opts, k, inUser);
  }
  return out;
}

/** One line as it is written: JSON is parsed, redacted and written again; anything else is redacted as text. */
export function redactLine(line: string, opts: { prompts: boolean; dir: WireDir; typing?: Map<string, Typing> }): string {
  try { return JSON.stringify(redactValue(JSON.parse(line), opts)); } catch { return redactText(line); }
}

/** The folder of record mode, or null when it is off (the default). */
export function wireRecordDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const d = env.SB_WIRE_RECORD_DIR?.trim();
  return d ? path.resolve(d) : null;
}

let runSeq = 0;

/** Tees a session's stdin and stdout into its NDJSON file; a no-op (returns null) when record mode is off. */
export function recordWire(p: Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout'>, at: { engine: string; chatId: string }, env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = wireRecordDir(env);
  if (!dir) return null;
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'x';
  const run = `${Date.now().toString(36)}${(runSeq++).toString(36)}`;
  const file = path.join(dir, safe(at.engine), `${safe(at.chatId)}-${run}.ndjson`);
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (e) {
    log.warn('chats', 'wire record folder not writable: this session is not recorded', { chat: at.chatId, cause: (e as Error).message, hint: 'point SB_WIRE_RECORD_DIR to a writable folder' });
    return null;
  }
  const prompts = env.SB_WIRE_RECORD_PROMPTS === '1';
  const typing = new Map<string, Typing>();   // ACP typing tool calls by id, for their later updates (maskTyping)
  let seq = 0;
  const put = (dirn: WireDir, line: string) => {
    if (!line.trim()) return;
    const e: WireEntry = { ts: Date.now(), run, seq: seq++, dir: dirn, line: redactLine(line, { prompts, dir: dirn, typing }) };
    try { fs.appendFileSync(file, `${JSON.stringify(e)}\n`); } catch { /* a full disk loses the recording, never the session */ }
  };
  const lines = (dirn: WireDir) => {
    let buf = '';
    return (chunk: unknown) => {
      buf += typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '';
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) { put(dirn, buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
    };
  };
  const toEngine = lines('app>engine');
  const write = p.stdin.write.bind(p.stdin) as (...a: unknown[]) => boolean;
  (p.stdin as unknown as { write: (...a: unknown[]) => boolean }).write = (chunk: unknown, ...rest: unknown[]) => { toEngine(chunk); return write(chunk, ...rest); };
  // first in line: a chunk is recorded before the adapter reads it, so what the adapter writes back in answer (Claude's
  // get_context_usage on a result) is recorded after the lines that caused it, as the replay must play them
  p.stdout.prependListener('data', lines('engine>app'));
  log.info('chats', 'wire record on: this session is recorded, redacted', { chat: at.chatId, data: { engine: at.engine, file, prompts } });
  return file;
}

/** A recording's entries, in order (tests, the replay engine). */
export function readWire(file: string): WireEntry[] {
  return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as WireEntry).sort((a, b) => a.seq - b.seq);
}
