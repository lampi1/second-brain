// Code Mode's sandbox (ADR 0331): runs a script the model wrote inside QuickJS compiled to WebAssembly
// (quickjs-emscripten, no native build for Electron), with no fs, net, require or timers. Its only way out is the
// global `tools`: each call goes to the host (code-mode/bridge.ts), which passes it through the app's permission chain
// first. Memory (a fresh instance per run in a bounded WebAssembly memory), stack, CPU and wall-clock limits (held
// during host calls too); the wall clock leaves out the time spent waiting for the user. Freeing the instance never
// replaces a script's result (a WASM abort there, as QuickJS's JS_FreeRuntime leak assertion, is logged).
// Used by code-mode/tool.ts (the run_code MCP tool).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSDeferredPromise, type QuickJSHandle, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import { errText, log } from '../log';

/** Thrown by the host when the script must stop at this call (an action only the user runs, from the Esegui button):
 *  the script gets no chance to go on, its result says why. */
export class StopScript extends Error {}

export interface SandboxHost {
  /** One internal call. Resolves to its result (JSON-able); rejects with an Error the script may catch (a refusal, a
   *  failed tool) or with StopScript (the script ends here). */
  call(tool: string, input: unknown): Promise<unknown>;
  /** ms spent so far waiting for the user (an «ask»): never counted in the wall-clock limit */
  pausedMs?(): number;
}

export interface SandboxLimits {
  memoryBytes: number; stackBytes: number;
  /** time inside the interpreter */
  cpuMs: number;
  /** total time, without the waits for the user */
  wallMs: number;
  maxCalls: number;
  /** characters kept of console output and of the returned value */
  maxOutput: number;
}
export const DEFAULT_LIMITS: SandboxLimits = { memoryBytes: 64 * 1024 * 1024, stackBytes: 512 * 1024, cpuMs: 10_000, wallMs: 280_000, maxCalls: 200, maxOutput: 40_000 };

export interface SandboxResult {
  ok: boolean;
  /** what the script returned (JSON-able), when ok */
  value?: unknown;
  /** why it failed: a thrown error, a limit, an internal call it did not catch */
  error?: string;
  /** set when an internal call stopped the script (StopScript): its message */
  stopped?: string;
  logs: string;
  calls: number;
  cpuMs: number;
}

export interface SandboxOptions {
  limits?: Partial<SandboxLimits>;
  signal?: AbortSignal;
  /** the clock (tests pass their own: no real deadlines) */
  now?: () => number;
  /** wakes the run after ms while it waits on a host call (the wall limit holds there too); returns its cancel.
   *  Default setTimeout; tests pass their own. */
  setTimer?: (fn: () => void, ms: number) => () => void;
}

const realTimer = (fn: () => void, ms: number): (() => void) => { const t = setTimeout(fn, ms); t.unref?.(); return () => clearTimeout(t); };

let modulePromise: Promise<WebAssembly.Module> | null = null;

/** what QuickJS itself needs beside the script's own memory limit (its heap, stack, the bridge's strings) */
const WASM_HEADROOM = 32 * 1024 * 1024;
const PAGE = 65_536;

/** The QuickJS .wasm: next to the main bundle in a build (scripts/build.mjs copies it to out/main/quickjs.wasm), else
 *  the package's own (tests, a run from sources). */
function wasmPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const built = path.join(here, 'quickjs.wasm');
  if (fs.existsSync(built)) return built;
  return createRequire(import.meta.url).resolve('@jitl/quickjs-wasmfile-release-sync/wasm');
}

/** The compiled .wasm, once per process, made on the first script. */
function compiled(): Promise<WebAssembly.Module> {
  modulePromise ??= WebAssembly.compile(fs.readFileSync(wasmPath()));
  modulePromise.catch(() => { modulePromise = null; });
  return modulePromise;
}

/** A fresh QuickJS instance for one run, in a WebAssembly memory that cannot grow past the run's limit plus QuickJS's
 *  own headroom: QuickJS's memory limit does not count every buffer (typed arrays go past it), the bounded memory
 *  does; and the memory goes away with the run. The memory is whole from the start, never grown: a growth during a
 *  host-side allocation (newString of a large tool result, a few MB) corrupted QuickJS's heap, and JS_FreeRuntime
 *  then aborted on objects left in gc_obj_list (the Scout crash, 2026-11-21). Untouched pages cost no RAM. */
/** Settles one host call's promise with h (its value or error) and always frees h. A settle that throws (an
 *  interrupted call into QuickJS) is logged and its promise is left in `open`, so release() still frees it. */
export function settleDeferred<D extends { dispose(): void }>(open: Set<D>, deferred: D, h: { dispose(): void }, fn: () => void): void {
  try { fn(); open.delete(deferred); } catch (e) {
    log.warn('code-mode', 'sandbox: settling a tool call failed', { cause: errText(e), hint: 'the script then waits on nothing and ends with that error; its promise is freed with the instance (release)' });
  } finally { h.dispose(); }
}

export async function quickjs(memoryBytes = DEFAULT_LIMITS.memoryBytes): Promise<QuickJSWASMModule> {
  const maximum = Math.ceil((memoryBytes + WASM_HEADROOM) / PAGE);
  const wasmMemory = new WebAssembly.Memory({ initial: maximum, maximum });
  return newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, { wasmModule: await compiled(), wasmMemory }));
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** The script's world: `tools.<Name>(input)` and `tools.call(name, input)` (each a promise of the result), and
 *  `console.log/info/warn/error`. Nothing else of the host is reachable. */
function prelude(tools: readonly string[]): string {
  const names = JSON.stringify(tools.filter(t => t !== 'call'));
  return `(() => {
  const call = globalThis.__sbCall, log = globalThis.__sbLog;
  delete globalThis.__sbCall; delete globalThis.__sbLog;
  const t = {};
  for (const n of ${names}) t[n] = input => call(n, JSON.stringify(input === undefined ? {} : input)).then(JSON.parse);
  t.call = (name, input) => call(String(name), JSON.stringify(input === undefined ? {} : input)).then(JSON.parse);
  globalThis.tools = Object.freeze(t);
  const show = a => a.map(x => typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(' ');
  globalThis.console = Object.freeze({ log: (...a) => log(show(a)), info: (...a) => log(show(a)), warn: (...a) => log(show(a)), error: (...a) => log(show(a)) });
})();`;
}

const clip = (s: string, max: number): string => s.length > max ? `${s.slice(0, max)}\n… [${s.length - max} more characters cut]` : s;

/** Runs one script to its end, a limit, an uncaught error or a StopScript. Never throws for the script's own faults. */
export async function runSandboxed(code: string, tools: readonly string[], host: SandboxHost, opts: SandboxOptions = {}): Promise<SandboxResult> {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const now = opts.now ?? Date.now;
  const qjs = await quickjs(limits.memoryBytes);
  const runtime = qjs.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  const vm = runtime.newContext();
  const started = now();
  let cpuMs = 0, slice = 0, calls = 0, logs = '', stopped: string | undefined, limit: string | undefined, alive = true;
  const open = new Set<QuickJSDeferredPromise>();
  let wake: (() => void) | null = null;
  const settle = (): void => { const w = wake; wake = null; w?.(); };
  const wall = (): number => now() - started - (host.pausedMs?.() ?? 0);
  const over = (): string | undefined => {
    if (opts.signal?.aborted) return 'the call was cancelled';
    if (cpuMs + (slice ? now() - slice : 0) > limits.cpuMs) return `CPU limit of ${limits.cpuMs} ms reached`;
    if (wall() > limits.wallMs) return `time limit of ${Math.round(limits.wallMs / 1000)} s reached`;
    return undefined;
  };
  runtime.setInterruptHandler(() => { if (stopped) return true; const o = over(); if (o) { limit ??= o; return true; } return false; });
  const inVm = <T>(fn: () => T): T => { slice = now(); try { return fn(); } finally { cpuMs += now() - slice; slice = 0; } };
  const errorText = (h: QuickJSHandle): string => {
    const e = vm.dump(h) as unknown;
    if (e && typeof e === 'object') { const o = e as { name?: unknown; message?: unknown; stack?: unknown }; return `${typeof o.name === 'string' ? o.name : 'Error'}: ${typeof o.message === 'string' ? o.message : JSON.stringify(e)}`; }
    // QuickJS throws a bare null when it cannot even allocate its out-of-memory error
    return e === null ? 'null: thrown by the script, or out of memory' : String(e);
  };

  const callFn = vm.newFunction('__sbCall', (nameH, inputH) => {
    const name = vm.getString(nameH), raw = vm.getString(inputH);
    const deferred = vm.newPromise();
    open.add(deferred);
    // the returned handle belongs to QuickJS from here (newFunction consumes it); settling frees the resolvers
    const settleWith = (h: QuickJSHandle, fn: () => void): void => settleDeferred(open, deferred, h, fn);
    const fail = (message: string): void => { if (!alive) return; const err = vm.newError(message); settleWith(err, () => deferred.reject(err)); };
    if (stopped) { fail(stopped); return deferred.handle; }
    if (++calls > limits.maxCalls) { limit ??= `more than ${limits.maxCalls} tool calls`; fail(limit); return deferred.handle; }
    let input: unknown;
    try { input = JSON.parse(raw); } catch { fail('the input is not JSON'); return deferred.handle; }
    void host.call(name, input).then(value => {
      if (!alive) return;
      const s = vm.newString(JSON.stringify(value === undefined ? null : value));
      settleWith(s, () => deferred.resolve(s));
    }, (e: unknown) => {
      if (e instanceof StopScript) stopped ??= e.message;
      fail(e instanceof Error ? e.message : String(e));
    }).finally(settle);
    return deferred.handle;
  });
  vm.setProp(vm.global, '__sbCall', callFn); callFn.dispose();
  const logFn = vm.newFunction('__sbLog', h => { if (logs.length < limits.maxOutput * 2) logs += `${vm.getString(h)}\n`; });
  vm.setProp(vm.global, '__sbLog', logFn); logFn.dispose();

  // QuickJS's own "out of memory" says nothing of why: most often a tool result too big to parse in the script's memory
  const oom = (e: string | undefined): string | undefined => e && /out of memory/i.test(e)
    ? `${e}: the script's memory (${Math.round(limits.memoryBytes / 1048576)} MB) is full, often a tool result too large to parse: ask for less (filters, offset/limit) and return only what you need` : e;
  const done = (r: Omit<SandboxResult, 'logs' | 'calls' | 'cpuMs'>): SandboxResult => ({ ...r, ...(r.error !== undefined ? { error: oom(r.error) } : {}), logs: clip(logs, limits.maxOutput), calls, cpuMs: Math.round(cpuMs) });
  const abort = (): void => settle();
  opts.signal?.addEventListener('abort', abort);
  try {
    const pre = inVm(() => vm.evalCode(prelude(tools), 'prelude.js'));
    if (pre.error) { const m = errorText(pre.error); pre.error.dispose(); return done({ ok: false, error: `sandbox setup failed: ${m}` }); }
    pre.value.dispose();
    const evaluated = inVm(() => vm.evalCode(`(async () => {\n${code}\n})()`, 'run_code.js'));
    if (evaluated.error) { const m = errorText(evaluated.error); evaluated.error.dispose(); return done({ ok: false, error: limit ?? m }); }
    const promise = evaluated.value;
    try {
      for (;;) {
        const jobs = inVm(() => runtime.executePendingJobs(-1));
        if (jobs.error) { const m = errorText(jobs.error); jobs.error.dispose(); if (stopped) return done({ ok: false, stopped }); return done({ ok: false, error: limit ?? m }); }
        if (stopped) return done({ ok: false, stopped });
        if (limit) return done({ ok: false, error: limit });
        const state = vm.getPromiseState(promise);
        if (state.type === 'fulfilled') {
          const value = vm.dump(state.value) as unknown; state.value.dispose();
          const text = JSON.stringify(value === undefined ? null : value) ?? 'null';
          return done({ ok: true, value: text.length > limits.maxOutput ? clip(text, limits.maxOutput) : value });
        }
        if (state.type === 'rejected') { const m = errorText(state.error); state.error.dispose(); return done({ ok: false, error: m }); }
        const o = over();
        if (o) return done({ ok: false, error: o });
        if (!open.size) return done({ ok: false, error: 'the script waits on something that never comes: await only tools.* calls (no timers, no fetch)' });
        // a host call may never answer (a hung connector): the wall limit wakes the run there too; a wait for the
        // user moves the deadline (pausedMs grows), so the timer is armed again for what is left
        const cancel = (opts.setTimer ?? realTimer)(settle, Math.max(1, limits.wallMs - wall() + 1));
        try { await new Promise<void>(res => { wake = res; }); } finally { cancel(); }
      }
    } finally { promise.dispose(); }
  } finally {
    alive = false;
    opts.signal?.removeEventListener('abort', abort);
    release(open, vm, runtime);
  }
}

/** Frees a run's QuickJS objects. A failure here never replaces the run's result (the script's value is already
 *  computed, or its error already said): the instance and its memory are this run's own (quickjs() makes a fresh one
 *  per run) and go away with it. QuickJS aborts the WASM in JS_FreeRuntime when an object is still alive at that point
 *  (quickjs.c, "list_empty(&rt->gc_obj_list)"): logged, so a leak stays visible. */
export function release(open: Set<QuickJSDeferredPromise>, vm: { dispose(): void }, runtime: { dispose(): void }): void {
  const step = (what: string, fn: () => void): void => {
    try { fn(); } catch (e) { log.warn('code-mode', `sandbox: freeing ${what} failed`, { cause: errText(e), hint: 'the run result is kept; a QuickJS handle was left alive: see sandbox.ts' }); }
  };
  for (const d of open) step('a pending call', () => d.dispose());
  open.clear();
  step('the context', () => vm.dispose());
  step('the runtime', () => runtime.dispose());
}

/** The names a script can call as tools.<name>: valid identifiers; others only through tools.call(name, input). */
export const callableNames = (tools: readonly string[]): string[] => tools.filter(t => IDENT.test(t));
