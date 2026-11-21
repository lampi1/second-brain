// Code Mode's QuickJS sandbox (src/main/code-mode/sandbox.ts, ADR 0331): a script returns a value through tools.*
// answered by the host, a refused call is an error it may catch, a StopScript ends it even when caught, no host APIs
// leak in, and the limits hold (a fake clock: no real deadlines).
import { describe, expect, it } from 'vitest';
import { runSandboxed, StopScript, type SandboxHost } from '../../../src/main/code-mode/sandbox';

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
});
