// run_code (Code Mode, ADR 0331): the app's MCP tool that runs a JavaScript script the model wrote in the QuickJS
// sandbox (code-mode/sandbox.ts), whose only way out is `tools.*`: each internal call passes the app's permission chain
// (code-mode/bridge.ts → ChatManager.decideFor). Its result is plain text cut to what a model should re-read (the
// value at VALUE_MAX, only the failed calls), and a chat that keeps sending one-call scripts is told to batch. Shown only to a chat in Code Mode (ChatManager.chatToolShown); its
// input schema lists that chat's tools in compact form. A long script sends progress so the client's 300 s idle timeout
// never fires; tokens, turns and duration of the turn are logged by the engines (timing: turn, with codeMode).
// Added to the chat endpoint by code-mode/wire.ts; tested in test/unit/code-mode/.
import type { McpTool } from '../mcp/server';
import { log } from '../log';
import { bridge, catalog, type Bridge, type BridgeDeps, type Entry } from './bridge';
import { callableNames, DEFAULT_LIMITS, runSandboxed, type SandboxOptions, type SandboxLimits, type SandboxResult } from './sandbox';
import { NATIVE_WRAPPERS, RUN_CODE } from './policy';
import { declarations, NATIVE_TYPES, toolSignature } from './types';

export interface RunCodeDeps extends BridgeDeps {
  limits?: Partial<SandboxLimits>;
  /** how often a running script tells the client it is alive (ms; default 20 s) */
  progressEveryMs?: number;
  now?: () => number;
  /** tests: the sandbox's wall timer */
  setTimer?: SandboxOptions['setTimer'];
  /** tests: each run's structured result and every call's decision (the model reads only resultText) */
  onResult?: (r: SandboxResult, calls: Bridge['calls']) => void;
}

/** The typed API a chat's model sees in run_code's schema (after Cloudflare's Code Mode, code-mode/types.ts): the
 *  natives with input and output types, its app tools with input types, its connectors by server (list_tools types
 *  them). Inputs without ? are required. */
export function toolList(deps: BridgeDeps, chatId: string): string {
  const app = deps.appTools(chatId).filter(t => t.name !== RUN_CODE);
  return declarations(NATIVE_WRAPPERS, app, chatId, deps.extServers(chatId));
}

/** characters of a script's returned value sent back to the model; more is cut with a hint to filter in the script */
export const VALUE_MAX = 6_000;
/** characters of its console output sent back */
export const LOGS_MAX = 2_000;
/** consecutive scripts of one chat with at most one tool call each before run_code reminds the model to batch */
export const NUDGE_AFTER = 3;

// its first words carry what a model looks for when its natives are hidden: a ToolSearch by keyword must find it
const DESCRIPTION = 'Read files, run shell (Bash) commands, grep and glob search, edit and write files, call app tools and connectors: all through one script. ' +
  'Runs a JavaScript script (async; use await and return a JSON-able value) in a sandbox with no fs, net, require or timers. ' +
  'Prefer it to the native tools, and put a whole step in ONE script: batch every read, search and command you need ' +
  '(Promise.all for independent ones), filter inside the script and return only what you need: a returned value over ' +
  `${VALUE_MAX} characters is cut, a string comes back as plain text. Example: ` +
  '`const [a, hits, log] = await Promise.all([tools.Read({file_path: "src/a.ts", limit: 80}), ' +
  'tools.Grep({pattern: "TODO", path: "src", output_mode: "content", "-i": true}), tools.Bash({command: "git log --oneline -5"})]); ' +
  'return {a: a.split("\\n").filter(l => l.includes("export")).join("\\n"), todos: hits.split("\\n").slice(0, 20), log: log.stdout};` ' +
  'Call tools as `await tools.Name(input)` or `await tools.call(name, input)`; console.log output comes back too. ' +
  'PowerShell commands go to tools.PowerShell({command}), never `powershell -Command` inside Bash (bash eats $_ and $var). ' +
  'Every call passes the app\'s permission rules: a refused one throws (catch it if you want to go on); an action only the user runs (Esegui) stops the script: then write the exact command in a fenced code block, as usual.';

/** run_code's input schema for one chat: the script, with that chat's tools in its description. */
const schemaFor = (deps: BridgeDeps, chatId: string): Record<string, unknown> => ({
  type: 'object',
  properties: { code: { type: 'string', description: `The body of an async function in plain JavaScript (no TypeScript syntax; top-level await; end with return). The API it calls:\n${toolList(deps, chatId)}` } },
  required: ['code'],
});

/** list_tools: the tools a script may call with their typed signatures (no permission needed: it only reads the list). */
const listTools = (entries: Entry[], chatId: string, server?: unknown): unknown => entries
  .filter(e => (typeof server === 'string' && server ? e.kind === 'ext' && e.server === server : true))
  .map(e => (e.kind === 'native'
    ? { name: e.name, description: NATIVE_TYPES[e.tool].doc, signature: NATIVE_TYPES[e.tool].sig }
    : { name: e.name, description: e.tool.description.slice(0, 300), signature: toolSignature(e.tool, chatId, e.kind === 'ext' ? 'unknown' : 'string') }));

const MARK = '--- TRUNCATED ---';
const STR_MARK = /\s--- TRUNCATED --- \((\d+) more characters\)$/;
const ARR_MARK = /^--- TRUNCATED --- \((\d+) more items\)$/;
const json = (v: unknown): string => JSON.stringify(v, null, 1) ?? 'null';

/** A returned value made to fit max characters of JSON keeping its shape (after Cloudflare's truncateResult): the
 *  largest string or array is halved first (an object's keys only when none is left), again and again, each cut one marked with MARK and what it
 *  dropped (an object's under the key MARK), so the result stays valid JSON; the caller's text cut is only a last net. */
export function shrinkValue(value: unknown, max: number): { value: unknown; cut: boolean } {
  const box: { v: unknown } = { v: JSON.parse(json(value === undefined ? null : value)) as unknown };
  let cut = false;
  for (let round = 0; round < 4_000 && json(box.v).length > max; round++) {
    type Pick = { parent: Record<string | number, unknown>; key: string | number; size: number };
    // strings and arrays first; an object loses keys only when nothing else is left to halve
    let best: Pick | null = null, bestObj: Pick | null = null;
    const walk = (node: unknown, parent: Record<string | number, unknown>, key: string | number): void => {
      if (typeof node === 'string' && node.length > 80) { if (!best || node.length > best.size) best = { parent, key, size: node.length }; return; }
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        const marked = typeof node[node.length - 1] === 'string' && ARR_MARK.test(node[node.length - 1] as string);
        if (node.length - (marked ? 1 : 0) > 1) { const size = json(node).length; if (!best || size > best.size) best = { parent, key, size }; }
        node.forEach((x, i) => { walk(x, node as unknown as Record<number, unknown>, i); });
        return;
      }
      const keys = Object.keys(node).filter(k => k !== MARK);
      if (keys.length > 1) { const size = json(node).length; if (!bestObj || size > bestObj.size) bestObj = { parent, key, size }; }
      for (const [k, x] of Object.entries(node)) if (k !== MARK) walk(x, node as Record<string, unknown>, k);
    };
    walk(box.v, box as unknown as Record<string, unknown>, 'v');
    const chosen = (best ?? bestObj) as Pick | null;
    if (!chosen) break;
    const { parent, key } = chosen;
    const node = parent[key];
    cut = true;
    if (typeof node === 'string') {
      const prev = STR_MARK.exec(node), body = prev ? node.slice(0, prev.index) : node, dropped = Number(prev?.[1] ?? 0);
      const keep = Math.floor(body.length / 2);
      parent[key] = `${body.slice(0, keep)} ${MARK} (${dropped + body.length - keep} more characters)`;
    } else if (!Array.isArray(node)) {
      const o = node as Record<string, unknown>, keys = Object.keys(o).filter(k => k !== MARK);
      const dropped = Number(/^(\d+) more keys$/.exec(String(o[MARK] ?? ''))?.[1] ?? 0), keep = Math.max(1, Math.floor(keys.length / 2));
      parent[key] = { ...Object.fromEntries(keys.slice(0, keep).map(k => [k, o[k]])), [MARK]: `${dropped + keys.length - keep} more keys` };
    } else {
      const arr = node as unknown[];
      const last = arr[arr.length - 1], prev = typeof last === 'string' ? ARR_MARK.exec(last) : null;
      const items = prev ? arr.slice(0, -1) : arr, dropped = Number(prev?.[1] ?? 0);
      const keep = Math.max(1, Math.floor(items.length / 2));
      parent[key] = [...items.slice(0, keep), `${MARK} (${dropped + items.length - keep} more items)`];
    }
  }
  return { value: box.v, cut };
}

const cut = (s: string, max: number, what: string): string => (s.length > max
  ? `${s.slice(0, max)}\n… [${s.length - max} more characters of the ${what} cut: filter inside the script and return only what you need]` : s);

/** What the model reads of one run, as plain text: the value (a string as it is, anything else as JSON shrunk
 *  keeping its shape) cut at VALUE_MAX, the error or the Esegui stop, the console output, only the calls that failed, and the batching hint. */
export function resultText(r: SandboxResult, calls: Bridge['calls'], nudge = false): string {
  const parts: string[] = [];
  if (r.ok && typeof r.value === 'string') parts.push(cut(r.value, VALUE_MAX, 'value'));
  else if (r.ok) {
    const s = shrinkValue(r.value, VALUE_MAX);
    parts.push(cut(json(s.value), VALUE_MAX, 'value'));
    if (s.cut) parts.push(`[value cut to about ${VALUE_MAX} characters where ${MARK} shows: filter inside the script and return only what you need]`);
  }
  if (r.stopped) parts.push(`Stopped: ${r.stopped} (the script stopped here: write the exact command in a fenced code block for the user's Esegui button)`);
  if (r.error) parts.push(`Error: ${r.error}`);
  if (r.logs) parts.push(`[console]\n${cut(r.logs.replace(/\n$/, ''), LOGS_MAX, 'console output')}`);
  const failed = calls.filter(c => !c.ok);
  if (failed.length) parts.push(`[failed calls] ${failed.map(c => `${c.tool} (${c.decision})`).join(', ')}`);
  if (nudge) parts.push(`[hint] Your last ${NUDGE_AFTER} scripts made at most one tool call each: put the next step's reads, searches and commands in one script (Promise.all), filter there and return only the result.`);
  return parts.join('\n\n') || 'null';
}

export function runCodeTool(deps: RunCodeDeps): McpTool {
  // per chat: how many scripts in a row made at most one tool call (the batching hint)
  const streaks = new Map<string, number>();
  return {
    // the literal name, so test/unit/tool-catalog.test.ts finds this definition (RUN_CODE is the same string)
    name: 'run_code', description: DESCRIPTION,
    // Claude Code defers MCP tools behind ToolSearch; this documented per-tool flag loads run_code upfront, so a chat
    // whose natives are hidden sees it at once (https://code.claude.com/docs/en/mcp#per-tool-alwaysload). Others ignore it.
    meta: { 'anthropic/alwaysLoad': true },
    inputSchema: schemaFor({ ...deps, appTools: () => [], extServers: () => [] }, ''),
    inputSchemaFor: params => schemaFor(deps, params.chatId ?? ''),
    async run(args, ctx) {
      const chatId = ctx.params.chatId ?? '';
      const code = typeof args.code === 'string' ? args.code : '';
      if (!code.trim()) return { raw: { content: [{ type: 'text', text: 'code is required: the script body.' }], isError: true } };
      const now = deps.now ?? Date.now;
      const started = now();
      const entries = await catalog(deps, chatId);
      // the run's own signal: aborted when the script ends however it ends, so nothing it started outlives it (a panel
      // still open, a running command, an app tool); run_code's cancel aborts it too
      const run = new AbortController();
      const cancel = (): void => run.abort();
      if (ctx.signal.aborted) run.abort(); else ctx.signal.addEventListener('abort', cancel);
      const wallMs = deps.limits?.wallMs ?? DEFAULT_LIMITS.wallMs;
      let host: ReturnType<typeof bridge> | null = null;
      const remainingMs = (): number => wallMs - (now() - started - (host?.pausedMs?.() ?? 0));
      host = bridge(deps, chatId, entries, { ...ctx, signal: run.signal }, { remainingMs, now });
      const h = host;
      const meta = { call: (name: string, input: unknown) => (name === 'list_tools' ? Promise.resolve(listTools(entries, chatId, (input as { server?: unknown } | null)?.server)) : h.call(name, input)) };
      const names = [...callableNames(entries.map(e => e.name)), 'list_tools'];
      const every = deps.progressEveryMs ?? 20_000;
      const timer = setInterval(() => { ctx.progress(`run_code: ${h.calls.length} tool calls so far`); }, every);
      timer.unref?.();
      try {
        const r = await runSandboxed(code, names, { call: meta.call, pausedMs: h.pausedMs }, { ...(deps.limits ? { limits: deps.limits } : {}), signal: run.signal, now, ...(deps.setTimer ? { setTimer: deps.setTimer } : {}) });
        log.info('code-mode', 'run_code finished', { chat: chatId, data: { ok: r.ok, stopped: !!r.stopped, calls: r.calls, cpuMs: r.cpuMs, ms: now() - started, waitedMs: h.pausedMs?.() ?? 0, tools: [...new Set(h.calls.map(c => c.tool))].slice(0, 20) } });
        deps.onResult?.(r, h.calls);
        const single = h.calls.length <= 1 ? (streaks.get(chatId) ?? 0) + 1 : 0;
        const nudge = single >= NUDGE_AFTER;
        if (nudge || !single) streaks.delete(chatId); else streaks.set(chatId, single);
        return { raw: { content: [{ type: 'text', text: resultText(r, h.calls, nudge) }], isError: !r.ok } };
      } finally {
        clearInterval(timer);
        ctx.signal.removeEventListener('abort', cancel);
        run.abort(); // whatever the script left running ends with it
      }
    },
  };
}
