// The CLI channel of the model probes (src/main/engines/model-probe.ts, ADR 0256), on an injected fake spawn (no real
// process): JSON lines are read across chunks and non-JSON lines skipped, a reply already seen is returned at once,
// an exit fails the waiting reply, a missing answer fails after its timeout (fake timers), close kills the process;
// and ACP CLIs are never started only to ask (rule 4); an engine's text listing (cliListText, `agy models`) runs its
// modelsArgs, resolves its stdout on exit 0 and fails on another exit or an engine without modelsArgs.
import { describe, expect, it, vi } from 'vitest';
import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { channel, cliListText, cliProbe } from '../../../src/main/engines/model-probe';
import { engineOf } from '../../../src/main/engines/registry';

function fakeProc() {
  const p = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), pid: undefined as number | undefined, kill: vi.fn() });
  const spawnFn = vi.fn(() => p) as unknown as typeof spawn;
  return { p, spawnFn };
}
const START = { command: 'cli', args: [], env: {}, verbatim: false };

describe('model probe channel', () => {
  it('reads JSON lines across chunks, answers from what it saw, sends one line per message', async () => {
    const { p, spawnFn } = fakeProc();
    const ch = channel(START, '.', spawnFn);
    if ('error' in ch) throw new Error(ch.error);
    const written: string[] = [];
    p.stdin.on('data', (b: Buffer) => written.push(b.toString()));
    ch.send({ id: 1, method: 'x' });
    p.stdout.write('noise\n{"id":1,"res');
    p.stdout.write('ult":{}}\n');
    await new Promise(r => setImmediate(r));
    await expect(ch.reply(m => m.id === 1, 1000)).resolves.toEqual({ id: 1, result: {} });
    expect(written.join('')).toBe('{"id":1,"method":"x"}\n');
    ch.close();
    expect(p.kill).toHaveBeenCalled();
  });

  it('an exit or no answer in time fails the reply', async () => {
    vi.useFakeTimers();
    try {
      const a = fakeProc();
      const ch = channel(START, '.', a.spawnFn);
      if ('error' in ch) throw new Error(ch.error);
      const late = ch.reply(() => true, 5000);
      const check = expect(late).rejects.toThrow(/nessuna risposta in 5 s/);
      await vi.advanceTimersByTimeAsync(5000);
      await check;
      const waiting = ch.reply(() => true, 5000);
      a.p.emit('exit', 1);
      await expect(waiting).rejects.toThrow(/uscita \(1\)/);
    } finally { vi.useRealTimers(); }
  });

  it('runs an engine\'s model listing: its modelsArgs, stdout on exit 0, an error otherwise', async () => {
    const was = process.env.SB_ANTIGRAVITY_PATH;
    process.env.SB_ANTIGRAVITY_PATH = 'C:/fakes/agy-fake.mjs';
    try {
      const ok = fakeProc();
      const run = cliListText('.', ok.spawnFn)(engineOf('antigravity')!);
      await new Promise(r => setImmediate(r));
      ok.p.stdout.write('gemini-4-neon-high\tGemini 4 Neon (High)\n');
      ok.p.emit('close', 0);
      await expect(run).resolves.toBe('gemini-4-neon-high\tGemini 4 Neon (High)\n');
      const call = (ok.spawnFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
      expect((call[1] as string[]).slice(-1)).toEqual(['models']);
      const ko = fakeProc();
      const failed = cliListText('.', ko.spawnFn)(engineOf('antigravity')!);
      await new Promise(r => setImmediate(r));
      ko.p.emit('close', 1);
      await expect(failed).rejects.toThrow(/uscita \(1\)/);
      const none = fakeProc();
      await expect(cliListText('.', none.spawnFn)(engineOf('cursor')!)).rejects.toThrow(/non elenca/);
      expect(none.spawnFn).not.toHaveBeenCalled();
    } finally { if (was === undefined) delete process.env.SB_ANTIGRAVITY_PATH; else process.env.SB_ANTIGRAVITY_PATH = was; }
  });

  it('never starts an ACP CLI only to ask', () => {
    const { spawnFn } = fakeProc();
    expect(cliProbe('.', spawnFn)(engineOf('cursor')!)).toEqual({ error: expect.stringMatching(/non parte/) });
    expect(spawnFn).not.toHaveBeenCalled();
  });
});
