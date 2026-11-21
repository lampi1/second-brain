// Code Mode's QuickJS sandbox (src/main/code-mode/sandbox.ts, ADR 0331): a script returns a value through tools.*
// answered by the host, a refused call is an error it may catch, a StopScript ends it even when caught, no host APIs
// leak in, and the limits hold (a fake clock: no real deadlines).
import { describe, expect, it, vi } from 'vitest';
import { log } from '../../../src/main/log';
import { release, runSandboxed, settleDeferred, StopScript, type SandboxHost } from '../../../src/main/code-mode/sandbox';

const host = (answer: (tool: string, input: unknown) => unknown): SandboxHost & { seen: string[] } => {
  const seen: string[] = [];
  return { seen, call: async (tool, input) => { seen.push(tool); return answer(tool, input); } };
};

describe('runSandboxed', () => {
  it('returns what the script returns, through the host tools', async () => {
    const h = host((tool, input) => tool === 'Read' ? { text: `read ${(input as { file_path: string }).file_path}` } : null);
    const r = await runSandboxed('const a = await tools.Read({ file_path: "x.txt" }); console.log("got", a.text); return { len: a.text.length };', ['Read'], h);
    expect(r).toMatchObject({ ok: true, value: { len: 10 }, calls: 1 });
    expect(r.logs).toBe('got read x.txt\n');
    expect(h.seen).toEqual(['Read']);
  });

  it('reaches any tool by name with tools.call', async () => {
    const h = host(tool => ({ tool }));
    const r = await runSandboxed('return (await tools.call("mcp__x__do-it", {})).tool;', [], h);
    expect(r).toMatchObject({ ok: true, value: 'mcp__x__do-it' });
  });

  it('a refused call throws in the script, which may catch it and go on', async () => {
    const h: SandboxHost = { call: async tool => { if (tool === 'Bash') throw new Error('denied: not for this role'); return 'ok'; } };
    const r = await runSandboxed('let why = ""; try { await tools.Bash({ command: "rm -rf x" }); } catch (e) { why = e.message; } return [why, await tools.Read({})];', ['Bash', 'Read'], h);
    expect(r).toMatchObject({ ok: true, value: ['denied: not for this role', 'ok'] });
  });

  it('an uncaught refusal fails the script with its message', async () => {
    const h: SandboxHost = { call: async () => { throw new Error('denied'); } };
    const r = await runSandboxed('await tools.Bash({ command: "x" }); return 1;', ['Bash'], h);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('denied');
  });

  it('a StopScript ends the script there, even when the script catches it', async () => {
    const h = host(tool => { if (tool === 'Bash') throw new StopScript('Only the user runs this, by pressing Esegui.'); return 'later'; });
    const r = await runSandboxed('try { await tools.Bash({ command: "deploy" }); } catch {} await tools.Read({}); return "went on";', ['Bash', 'Read'], h);
    expect(r).toMatchObject({ ok: false, stopped: 'Only the user runs this, by pressing Esegui.' });
    expect(h.seen).toEqual(['Bash']);
  });

  it('has no require, process, fetch or timers', async () => {
    const r = await runSandboxed('return [typeof require, typeof process, typeof fetch, typeof setTimeout, typeof globalThis.__sbCall];', [], host(() => null));
    expect(r).toMatchObject({ ok: true, value: ['undefined', 'undefined', 'undefined', 'undefined', 'undefined'] });
  });

  it('a script that waits on nothing ends with a clear error', async () => {
    const r = await runSandboxed('await new Promise(() => {}); return 1;', [], host(() => null));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/waits on something that never comes/);
  });

  it('stops an endless loop at the CPU limit', async () => {
    let t = 0;
    const r = await runSandboxed('for (;;) {}', [], host(() => null), { limits: { cpuMs: 50 }, now: () => (t += 1) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/CPU limit/);
  });

  it('the wall-clock limit leaves out the time spent waiting for the user', async () => {
    let t = 0, paused = 0;
    const h: SandboxHost = { pausedMs: () => paused, call: async () => { t += 10_000; paused += 10_000; return 'yes'; } };
    const r = await runSandboxed('return await tools.Ask({});', ['Ask'], h, { limits: { wallMs: 1_000 }, now: () => t });
    expect(r).toMatchObject({ ok: true, value: 'yes' });
    const late: SandboxHost = { call: async () => { t += 10_000; return 'yes'; } };
    const r2 = await runSandboxed('await tools.Ask({}); return 1;', ['Ask'], late, { limits: { wallMs: 1_000 }, now: () => t });
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/time limit/);
  });

  it('typed arrays and ArrayBuffers cannot grow past the memory limit', async () => {
    const r = await runSandboxed('const a = []; for (let i = 0; i < 10; i++) a.push(new Uint8Array(30 * 1024 * 1024)); return a.length;', [], host(() => null));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/out of memory/);
    const big = await runSandboxed('return new ArrayBuffer(200 * 1024 * 1024).byteLength;', [], host(() => null));
    expect(big.ok).toBe(false);
    // the next run starts clean: a fresh instance per run
    expect(await runSandboxed('return new Uint8Array(8 * 1024 * 1024).length;', [], host(() => null))).toMatchObject({ ok: true, value: 8 * 1024 * 1024 });
  });

  it('the wall limit holds while a host call never answers', async () => {
    let t = 0;
    const r = await runSandboxed('await tools.Hang({}); return 1;', ['Hang'], { call: () => new Promise(() => {}) },
      { limits: { wallMs: 2_000 }, now: () => t, setTimer: (fn, ms) => { queueMicrotask(() => { t += ms; fn(); }); return () => {}; } });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/time limit of 2 s/) });
  });

  it('caps the number of internal calls', async () => {
    const r = await runSandboxed('for (let i = 0; i < 10; i++) await tools.Read({}); return 1;', ['Read'], host(() => 'x'), { limits: { maxCalls: 3 } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/more than 3 tool calls/);
  });

  it('a syntax error is reported, not thrown', async () => {
    const r = await runSandboxed('return (', [], host(() => null));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/SyntaxError/);
  });

  it('a large tool result (MBs) comes back whole, and the instance frees clean (the Scout crash)', async () => {
    // before: the WASM memory grew while the host copied the result in, QuickJS's heap broke and JS_FreeRuntime
    // aborted (list_empty(&rt->gc_obj_list)): that abort replaced the run's result
    const warn = vi.spyOn(log, 'warn');
    try {
      const str = await runSandboxed('const a = await tools.Read({}); return a.length;', ['Read'], host(() => 'x'.repeat(8_000_000)));
      expect(str).toMatchObject({ ok: true, value: 8_000_000 });
      const rows = await runSandboxed('const a = await tools.Read({}); return a.rows.length;', ['Read'], host(() => ({ rows: Array.from({ length: 300_000 }, (_, i) => ({ i, s: `abc${i}` })) })));
      expect(rows).toMatchObject({ ok: true, value: 300_000 });
      expect(warn.mock.calls.filter(c => String(c[1]).startsWith('sandbox: freeing'))).toEqual([]);
    } finally { warn.mockRestore(); }
  }, 60_000);

  it('a script out of memory says so, with what to do', async () => {
    const r = await runSandboxed('const k = []; for (;;) k.push({ a: [1, 2, 3], s: "x" + k.length });', [], host(() => null), { limits: { memoryBytes: 8 * 1024 * 1024 } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/out of memory.*ask for less/s);
  }, 60_000);

  it('objects, closures and promises held across host calls, calls left pending at the end: the run ends clean', async () => {
    // the shape of the Scout script that crashed in JS_FreeRuntime: state kept in closures and maps across awaits,
    // a Promise.all that rejects while its other calls are still out, a call never awaited, answers after the end
    const late: Array<() => void> = [];
    const h: SandboxHost = { call: (tool, input) => {
      if (tool === 'Slow') return new Promise(res => { late.push(() => res({ big: 'x'.repeat(10_000) })); });
      if (tool === 'Bad') return Promise.reject(new Error('refused'));
      return Promise.resolve({ tool, input, rows: Array.from({ length: 50 }, (_, i) => ({ i, tags: ['a', 'b'] })) });
    } };
    const code = `
      const seen = new Map(); const keep = [];
      const remember = name => value => { seen.set(name, value); keep.push(() => value.rows.length); return value; };
      for (let i = 0; i < 5; i++) await tools.Read({ i }).then(remember('r' + i));
      tools.Slow({});
      const pending = tools.Slow({}).then(v => v.big.length);
      let why = '';
      try { await Promise.all([tools.Slow({}), tools.Bad({}), tools.Read({})]); } catch (e) { why = e.message; }
      return { n: seen.size, sum: keep.reduce((a, f) => a + f(), 0), why, hasPending: typeof pending.then };`;
    for (let run = 0; run < 3; run++) {
      const r = await runSandboxed(code, ['Read', 'Slow', 'Bad'], h);
      expect(r).toMatchObject({ ok: true, value: { n: 5, sum: 250, why: 'refused', hasPending: 'function' } });
    }
    for (const f of late) f();
    await new Promise(res => setImmediate(res));
    expect(await runSandboxed('return 1;', [], h)).toMatchObject({ ok: true, value: 1 });
  });

  it('a tool result that cannot reach the script ends the run at once with that error, not at the time limit', async () => {
    const warn = vi.spyOn(log, 'warn');
    try {
      let t = 0;
      // the wall timer, if armed and left to fire, moves the fake clock to the limit: "at once" = the clock never moved
      const setTimer = (fn: () => void, ms: number): (() => void) => { let on = true; setImmediate(() => setImmediate(() => setImmediate(() => { if (on) { t += ms; fn(); } }))); return () => { on = false; }; };
      const r = await runSandboxed('return await tools.Read({});', ['Read'], { call: async () => ({ n: 1n }) }, { now: () => t, setTimer });
      expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/could not be passed to the script.*BigInt/) });
      expect(t).toBe(0);
    } finally { warn.mockRestore(); }
  });

  it('a settle that throws keeps its promise for release() and logs it; a settle that works frees both', () => {
    const warn = vi.spyOn(log, 'warn');
    try {
      const freed: string[] = [];
      const d = { dispose: () => freed.push('deferred') }, h = { dispose: () => freed.push('value') };
      const open = new Set([d]);
      expect(settleDeferred(open, d, () => h, () => { throw new Error('interrupted'); })).toMatch(/interrupted/);
      expect(freed).toEqual(['value']);
      expect(open.has(d)).toBe(true); // release() frees it at the end, never a live handle left behind
      expect(warn).toHaveBeenCalledWith('code-mode', expect.stringMatching(/settl/), expect.objectContaining({ cause: expect.stringMatching(/interrupted/) }));
      expect(settleDeferred(open, d, () => h, () => {})).toBeUndefined();
      expect(open.has(d)).toBe(false);
    } finally { warn.mockRestore(); }
  });

  it('a failure while freeing the instance never throws past the result (a WASM abort there is logged)', () => {
    const boom = (): never => { throw new Error('Aborted(Assertion failed: list_empty(&rt->gc_obj_list))'); };
    const open = new Set([{ dispose: boom }]) as unknown as Parameters<typeof release>[0];
    let runtimeFreed = false;
    expect(() => release(open, { dispose: boom }, { dispose: () => { runtimeFreed = true; } })).not.toThrow();
    expect(runtimeFreed).toBe(true);
    expect(open.size).toBe(0);
  });
});
