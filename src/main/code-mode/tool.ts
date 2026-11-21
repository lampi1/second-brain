// run_code (Code Mode, ADR 0331): the app's MCP tool that runs a JavaScript script the model wrote in the QuickJS
// sandbox (code-mode/sandbox.ts), whose only way out is `tools.*`: each internal call passes the app's permission chain
// (code-mode/bridge.ts → ChatManager.decideFor). Shown only to a chat in Code Mode (ChatManager.chatToolShown); its
// input schema lists that chat's tools in compact form. A long script sends progress so the client's 300 s idle timeout
// never fires; tokens, turns and duration of the turn are logged by the engines (timing: turn, with codeMode).
// Added to the chat endpoint by code-mode/wire.ts; tested in test/unit/code-mode/.
import type { McpTool } from '../mcp/server';
import { log } from '../log';
import { bridge, catalog, type BridgeDeps, type Entry } from './bridge';
import { callableNames, DEFAULT_LIMITS, runSandboxed, type SandboxOptions, type SandboxLimits } from './sandbox';
import { RUN_CODE } from './policy';

export interface RunCodeDeps extends BridgeDeps {
  limits?: Partial<SandboxLimits>;
  /** how often a running script tells the client it is alive (ms; default 20 s) */
  progressEveryMs?: number;
  now?: () => number;
  /** tests: the sandbox's wall timer */
  setTimer?: SandboxOptions['setTimer'];
}

const NATIVE_LINE = 'Bash({command}) → {exitCode, stdout, stderr} · Read({file_path, offset?, limit?}) · Write({file_path, content}) · Edit({file_path, old_string, new_string, replace_all?}) · Grep({pattern, path?, glob?, output_mode?}) · Glob({pattern, path?})';

/** The compact list a chat's model sees in run_code's schema: natives, its app tools by name, its connectors. */
export function toolList(deps: BridgeDeps, chatId: string): string {
  const app = deps.appTools(chatId).map(t => t.name).filter(n => n !== RUN_CODE);
  const ext = deps.extServers(chatId);
  return [
    `Native: ${NATIVE_LINE}.`,
    app.length ? `App: ${app.join(', ')} (same inputs as the MCP tools of the same name).` : '',
    ext.length ? `Connectors: ${ext.join(', ')}: call tools.call('<server>__<tool>', input); await tools.list_tools({server}) lists a connector's tools with their inputs.` : '',
  ].filter(Boolean).join('\n');
}

const DESCRIPTION = 'Runs a JavaScript script (async; use await and return a JSON-able value) in a sandbox with no fs, net, require or timers. ' +
  'Prefer it to the native tools: batch many reads, searches and tool calls in one script, filter in the script, return only what you need. ' +
  'Call tools as `await tools.Name(input)` or `await tools.call(name, input)`; console.log output comes back too. ' +
  'Every call passes the app\'s permission rules: a refused one throws (catch it if you want to go on); an action only the user runs (Esegui) stops the script: then write the exact command in a fenced code block, as usual.';

/** run_code's input schema for one chat: the script, with that chat's tools in its description. */
const schemaFor = (deps: BridgeDeps, chatId: string): Record<string, unknown> => ({
  type: 'object',
  properties: { code: { type: 'string', description: `The script body (top-level await allowed; end with return). Tools:\n${toolList(deps, chatId)}` } },
  required: ['code'],
});

/** list_tools: the metadata of the tools a script may call (no permission needed: it only reads the list). */
const listTools = (entries: Entry[], server?: unknown): unknown => entries
  .filter(e => (typeof server === 'string' && server ? e.kind === 'ext' && e.server === server : true))
  .map(e => (e.kind === 'native' ? { name: e.name, input: e.description } : { name: e.name, description: e.tool.description.slice(0, 300), input: e.tool.inputSchema }));

export function runCodeTool(deps: RunCodeDeps): McpTool {
  return {
    // the literal name, so test/unit/tool-catalog.test.ts finds this definition (RUN_CODE is the same string)
    name: 'run_code', description: DESCRIPTION,
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
      const meta = { call: (name: string, input: unknown) => (name === 'list_tools' ? Promise.resolve(listTools(entries, (input as { server?: unknown } | null)?.server)) : h.call(name, input)) };
      const names = [...callableNames(entries.map(e => e.name)), 'list_tools'];
      const every = deps.progressEveryMs ?? 20_000;
      const timer = setInterval(() => { ctx.progress(`run_code: ${h.calls.length} tool calls so far`); }, every);
      timer.unref?.();
      try {
        const r = await runSandboxed(code, names, { call: meta.call, pausedMs: h.pausedMs }, { ...(deps.limits ? { limits: deps.limits } : {}), signal: run.signal, now, ...(deps.setTimer ? { setTimer: deps.setTimer } : {}) });
        log.info('code-mode', 'run_code finished', { chat: chatId, data: { ok: r.ok, stopped: !!r.stopped, calls: r.calls, cpuMs: r.cpuMs, ms: now() - started, waitedMs: h.pausedMs?.() ?? 0, tools: [...new Set(h.calls.map(c => c.tool))].slice(0, 20) } });
        const body = {
          ok: r.ok,
          ...(r.ok ? { value: r.value } : {}),
          ...(r.stopped ? { stopped: `${r.stopped} (the script stopped here: write the exact command in a fenced code block for the user's Esegui button)` } : {}),
          ...(r.error ? { error: r.error } : {}),
          ...(r.logs ? { logs: r.logs } : {}),
          calls: h.calls,
        };
        return { raw: { content: [{ type: 'text', text: JSON.stringify(body, null, 1) }], isError: !r.ok } };
      } finally {
        clearInterval(timer);
        ctx.signal.removeEventListener('abort', cancel);
        run.abort(); // whatever the script left running ends with it
      }
    },
  };
}
