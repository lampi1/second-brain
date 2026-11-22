// Code Mode's bridge (ADR 0331): the host side of one run_code script. It lists the tools the script may call (the
// native wrappers, the chat's own app tools, its MCP connectors) and runs each internal call, its required inputs
// checked first (code-mode/types.ts), in three steps: the app's permission chain (ChatManager.decideFor, the same
// one a native call meets), the call itself (code-mode/natives.ts, or the McpTool in-process), and a compact tool row in the chat (name, input, decision, outcome). A refusal becomes an
// Error the script may catch; an Esegui action stops the script (StopScript). Used by code-mode/tool.ts and its tests.
import { randomUUID } from 'node:crypto';
import type { ChatItem } from '../../shared/contract';
import type { CallCtx, McpTool, ToolOutput } from '../mcp/server';
import { errText, log } from '../log';
import type { DecideOpts, InternalVerdict } from '../chats/manager-sink';
import { COMMAND_WRAPPERS, gateName, NATIVE_WRAPPERS, RUN_CODE, type NativeWrapper } from './policy';
import { runNative, type NativeEnv } from './natives';
import { StopScript, type SandboxHost } from './sandbox';
import { missingRequired, NATIVE_TYPES, toolSignature } from './types';

type ToolRow = Extract<ChatItem, { kind: 'tool' }>;

export interface BridgeDeps {
  decideFor(chatId: string, tool: string, input: unknown, opts: DecideOpts): Promise<InternalVerdict>;
  row(chatId: string, item: ToolRow, replace?: boolean): void;
  /** the chat's own endpoint tools (browser, app tools), as its MCP endpoint lists them */
  appTools(chatId: string): McpTool[];
  /** the connectors this chat may use, and one's tools */
  extServers(chatId: string): string[];
  extTools(chatId: string, server: string): Promise<McpTool[]>;
  /** where the wrappers run for this chat (ChatManager.codeModeContext): the folder it really works in, its engine's
   *  environment, a search filter; an error = they cannot run */
  context(chatId: string): { cwd: string; env: NodeJS.ProcessEnv; readable?: (abs: string) => boolean } | { error: string };
  /** tests: the native wrappers (default natives.ts) */
  native?: (tool: NativeWrapper, input: Record<string, unknown>, env: NativeEnv) => Promise<unknown>;
}

/** One callable tool of a script: its script name and how it runs. */
export type Entry =
  | { name: string; kind: 'native'; tool: NativeWrapper; description: string }
  | { name: string; kind: 'app'; tool: McpTool }
  | { name: string; kind: 'ext'; server: string; tool: McpTool };

/** Every tool a script of this chat may call, by script name: natives, app tools (run_code itself left out), then each
 *  connector's as <server>__<tool>. A connector that does not answer is left out (logged), never the whole run. */
export async function catalog(deps: BridgeDeps, chatId: string): Promise<Entry[]> {
  const out: Entry[] = NATIVE_WRAPPERS.map(t => ({ name: t, kind: 'native' as const, tool: t, description: NATIVE_TYPES[t].doc }));
  for (const t of deps.appTools(chatId)) if (t.name !== RUN_CODE) out.push({ name: t.name, kind: 'app', tool: t });
  for (const server of deps.extServers(chatId)) {
    try { for (const t of await deps.extTools(chatId, server)) out.push({ name: `${server}__${t.name}`, kind: 'ext', server, tool: t }); }
    catch (e) { log.warn('code-mode', 'a connector left out of run_code', { chat: chatId, data: { server }, cause: errText(e), hint: 'see the connector card (Impostazioni → Connettori)' }); }
  }
  return out;
}

const clip = (s: string, max = 2000): string => (s.length > max ? `${s.slice(0, max)}…` : s);
const show = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v) ?? '');

/** A tool's output as a script value: its text (images are counted, not passed); an error result throws. */
export function outputValue(o: ToolOutput): unknown {
  if (typeof o === 'string') return o;
  if ('raw' in o) {
    const text = (o.raw.content ?? []).map(c => (c && typeof c === 'object' && (c as { type?: unknown }).type === 'text' ? String((c as { text?: unknown }).text ?? '') : '')).filter(Boolean).join('\n');
    if (o.raw.isError) throw new Error(text || 'the tool failed');
    return o.raw.structuredContent ?? text;
  }
  return o.images?.length ? `${o.text}\n[${o.images.length} image(s) not passed to the script]` : o.text;
}

export interface Bridge extends SandboxHost {
  /** the calls made so far: name, decision, outcome (run_code's result lists them) */
  calls: { tool: string; decision: string; ok: boolean }[];
}

/** The host of one script run of a chat. `ctx` carries the run's own signal (aborted when the script ends: a pending
 *  panel goes away, a running command is killed, an app tool is cancelled) and run_code's progress; `remainingMs` is
 *  the time the run has left (a command never outlives it). */
export function bridge(deps: BridgeDeps, chatId: string, entries: Entry[], ctx: Pick<CallCtx, 'signal' | 'progress' | 'sessionId'>, opts: { remainingMs?: () => number; now?: () => number } = {}): Bridge {
  const byName = new Map(entries.map(e => [e.name, e]));
  const now = opts.now ?? Date.now;
  // the user's waits, counted while they last too (two panels at once count once): never against the wall limit
  let paused = 0, waits = 0, waitFrom = 0;
  const calls: Bridge['calls'] = [];
  return {
    calls,
    pausedMs: () => paused + (waits ? now() - waitFrom : 0),
    async call(name, input) {
      if (ctx.signal.aborted) throw new Error('The run has ended.');
      const e = byName.get(name);
      if (!e) throw new Error(`No tool named ${name} here. The tools are: ${[...byName.keys()].join(', ')}`);
      const args = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
      // a call without its required inputs fails here, before any permission panel, with the signature to fix it
      if (e.kind !== 'native') {
        const missing = missingRequired(e.tool, chatId, args);
        if (missing.length) throw new Error(`${name}: missing required input ${missing.join(', ')}; its signature: ${toolSignature(e.tool, chatId)}`);
      }
      const gate = e.kind === 'native' ? gateName('native', e.tool) : e.kind === 'app' ? gateName('app', e.tool.name) : gateName('ext', e.tool.name, e.server);
      const id = `cm-${randomUUID()}`, at = Date.now();
      const row = (status: ToolRow['status'], summary: string, output?: string, exitCode?: number): ToolRow =>
        ({ kind: 'tool', id, at, name: `run_code · ${name}`, summary, input: args, status, ...(output !== undefined ? { output: clip(output) } : {}), ...(exitCode !== undefined ? { exitCode } : {}) });
      let asked = false;
      let waiting = false;
      const endWait = (): void => { if (!waiting) return; waiting = false; if (--waits === 0) paused += now() - waitFrom; };
      let v: InternalVerdict;
      try {
        v = await deps.decideFor(chatId, gate, args, {
          signal: ctx.signal,
          asking: () => { asked = true; waiting = true; if (waits++ === 0) waitFrom = now(); },
          waited: () => { asked = true; endWait(); },
        });
      } finally { endWait(); }
      if (ctx.signal.aborted) throw new Error('The run has ended.');
      if (v.kind !== 'allow') {
        const esegui = v.kind === 'esegui';
        calls.push({ tool: name, decision: esegui ? 'esegui' : asked ? 'refused by the user' : 'denied', ok: false });
        deps.row(chatId, row('error', esegui ? 'solo con Esegui: script fermato' : asked ? 'rifiutato dall’utente' : 'negato', v.message));
        log.info('code-mode', 'internal call refused', { chat: chatId, data: { tool: gate, decision: v.kind, asked } });
        if (esegui) throw new StopScript(v.message);
        throw new Error(v.message);
      }
      const decision = asked ? 'consentito dall’utente' : 'consentito';
      deps.row(chatId, row('running', decision));
      try {
        let value: unknown;
        if (e.kind === 'native') {
          const where = deps.context(chatId);
          if ('error' in where) throw new Error(where.error);
          const left = opts.remainingMs?.();
          value = await (deps.native ?? runNative)(e.tool, args, { cwd: where.cwd, env: where.env, signal: ctx.signal,
            ...(where.readable ? { readable: where.readable } : {}), ...(left !== undefined ? { maxMs: left } : {}) });
        } else {
          const callCtx: CallCtx = { mount: e.kind === 'app' ? 'chat' : 'ext', params: { chatId, ...(e.kind === 'ext' ? { server: e.server } : {}) }, sessionId: ctx.sessionId, signal: ctx.signal, progress: ctx.progress };
          value = outputValue(await e.tool.run(args, callCtx));
        }
        const exit = e.kind === 'native' && COMMAND_WRAPPERS.includes(e.tool) && value && typeof value === 'object' ? (value as { exitCode?: unknown }).exitCode : undefined;
        const failed = typeof exit === 'number' && exit !== 0;
        calls.push({ tool: name, decision: asked ? 'allowed by the user' : 'allowed', ok: !failed });
        deps.row(chatId, row(failed ? 'error' : 'ok', decision, show(value), typeof exit === 'number' ? exit : undefined), true);
        return value;
      } catch (err) {
        const m = errText(err);
        calls.push({ tool: name, decision: asked ? 'allowed by the user' : 'allowed', ok: false });
        deps.row(chatId, row('error', decision, m), true);
        throw err instanceof Error ? err : new Error(m);
      }
    },
  };
}
