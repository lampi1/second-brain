// CLI format drift: the app reads other programs' output (Claude Code's stream-json, every ACP engine's JSON-RPC), and a
// CLI update can rename a field or add an event the parsers do not know. Nothing breaks loudly then: a switch falls to
// its default and the chat silently shows less. This module makes that visible and testable (ADR 0055):
//   - drift(): one warn per CLI, version and unknown shape per process (scope `drift`), with the sanitized message, so
//     `npm run logs -- --scope drift` and `npm run doctor` show it the day it happens;
//   - record(): in the dev instance, up to RECORD_PER_KEY sanitized samples of every message shape a real CLI sends,
//     per CLI and version, in <userData>/cli-records/<cli>.jsonl; `node scripts/cli-fixtures.mjs` turns them into
//     test/fixtures/cli/<cli>/<version>.jsonl, which test/unit/chats/cli-contract.test.ts replays through the real
//     parsers without spending a token;
//   - sanitize(): every string becomes a placeholder except the protocol's own enum values (type, subtype, kind…), so
//     no prompt, answer, path or id of the user ever reaches a log or a fixture.
// Used by chats/claude.ts and chats/acp.ts; the recorder is turned on by wiring.ts (dev instance only).
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../log';

/** Keys whose string values are protocol vocabulary, kept as they are (everything else is the user's content). */
const KEEP = new Set([
  'type', 'subtype', 'sessionUpdate', 'kind', 'status', 'stopReason', 'stop_reason', 'state', 'method', 'jsonrpc', 'role',
  'permissionMode', 'currentModeId', 'modeId', 'mimeType', 'level', 'category', 'currency', 'protocolVersion', 'behavior',
  'claude_code_version', 'version', 'model', 'effort', 'apiKeySource', 'media_type', 'priority',
]);
/** `name` / `tool_name` also carry the user's own words (MCP servers, project slash commands, output styles): only
 *  Claude Code's built-in tool names stay, the ones the parser branches on (AskUserQuestion…). */
const NAME_KEYS = new Set(['name', 'tool_name']);
const BUILTIN_TOOLS = new Set([
  'AskUserQuestion', 'Agent', 'Task', 'Bash', 'BashOutput', 'KillShell', 'PowerShell', 'Read', 'Write', 'Edit', 'MultiEdit',
  'NotebookEdit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite', 'ExitPlanMode', 'EnterPlanMode', 'Skill', 'SlashCommand',
]);
/** Kept strings longer than this are content after all (a "type" that is a sentence): placeholder. */
const KEEP_MAX = 64;
export const RECORD_PER_KEY = 3;
const DEPTH = 12;

/** The message with every string replaced by a placeholder (`s:<length>`) except KEEP keys' short values; numbers,
 *  booleans, nulls, keys and the nesting stay, so a replay walks the same parser branches. Arrays keep at most 5 items. */
export function sanitize(v: unknown, key = '', depth = 0): unknown {
  if (typeof v === 'string') {
    const keep = (KEEP.has(key) && v.length <= KEEP_MAX && !/[\\/\s]/.test(v)) || (NAME_KEYS.has(key) && BUILTIN_TOOLS.has(v));
    return keep ? v : `s:${v.length}`;
  }
  if (v === null || typeof v !== 'object') return v;
  if (depth >= DEPTH) return '…';
  if (Array.isArray(v)) return v.slice(0, 5).map(x => sanitize(x, key, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = sanitize(x, k, depth + 1);
  return out;
}

const seen = new Set<string>();
const found: { cli: string; version: string; kind: string; what: string }[] = [];

/** One CLI message the parser did not understand: an unknown type/subtype/update, a known one without a field it
 *  needs, a value outside the known set. Logged once per (cli, version, kind, what) per process. */
export function drift(cli: string, version: string | null | undefined, kind: string, what: string, sample?: unknown, chat?: string): void {
  const v = version || '?';
  const key = `${cli}|${v}|${kind}|${what}`;
  if (seen.has(key)) return;
  seen.add(key);
  found.push({ cli, version: v, kind, what });
  log.warn('drift', 'CLI format changed', {
    ...(chat ? { chat } : {}),
    cause: `${cli} ${v}: ${kind} "${what}"`,
    hint: `the ${cli} CLI sends something the app does not know: update chats/${cli === 'claude' ? 'claude' : 'acp'}.ts (or its known list), record the version (scripts/cli-fixtures.mjs) and run test/unit/chats/cli-contract.test.ts`,
    data: { cli, version: v, kind, what, ...(sample === undefined ? {} : { sample: sanitize(sample) }) },
  });
}

/** What drift() reported in this process (tests, the contract replay). */
export function drifts(): readonly { cli: string; version: string; kind: string; what: string }[] { return found; }
export function resetDrift(): void { seen.clear(); found.length = 0; }

// ---- recorder ----

let dir: string | null = null;
const counts = new Map<string, number>(); // `${cli}|${version}|${key}` → samples on file

/** Turns the recorder on (a folder) or off (null). Reads what is already on file so restarts keep the per-key cap. */
export function setRecorder(folder: string | null): void {
  dir = folder;
  counts.clear();
  if (!folder) return;
  try {
    for (const f of fs.readdirSync(folder).filter(n => n.endsWith('.jsonl'))) {
      const cli = f.slice(0, -'.jsonl'.length);
      for (const l of fs.readFileSync(path.join(folder, f), 'utf8').split('\n')) {
        if (!l.trim()) continue;
        try { const r = JSON.parse(l) as { version?: string; key?: string }; const k = `${cli}|${r.version}|${r.key}`; counts.set(k, (counts.get(k) ?? 0) + 1); } catch { /* a torn line */ }
      }
    }
  } catch { /* first run: no folder yet */ }
}

/** The message shape `key` (e.g. "system/init", "session/update/tool_call") of a real CLI: kept sanitized when fewer
 *  than RECORD_PER_KEY samples of it are on file for this version. Never throws. */
export function record(cli: string, version: string | null | undefined, key: string, msg: unknown): void {
  if (!dir) return;
  const v = version || '?';
  const k = `${cli}|${v}|${key}`;
  const n = counts.get(k) ?? 0;
  if (n >= RECORD_PER_KEY) return;
  counts.set(k, n + 1);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${cli.replace(/[^\w-]/g, '_')}.jsonl`), `${JSON.stringify({ version: v, key, msg: sanitize(msg) })}\n`);
  } catch (e) {
    log.warn('drift', 'CLI record not written', { data: { cli, key, error: String(e) } });
  }
}
