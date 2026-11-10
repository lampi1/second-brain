// The CLI channel of the model probes (src/main/engines/model-probe.ts, ADR 0256), on an injected fake spawn (no real
// process): JSON lines are read across chunks and non-JSON lines skipped, a reply already seen is returned at once,
// an exit fails the waiting reply, a missing answer fails after its timeout (fake timers), close kills the process;
// and ACP CLIs are never started only to ask (rule 4).
import { describe, expect, it, vi } from 'vitest';
import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { channel, cliProbe } from '../../../src/main/engines/model-probe';
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

  it('never starts an ACP CLI only to ask', () => {
    const { spawnFn } = fakeProc();
    expect(cliProbe('.', spawnFn)(engineOf('cursor')!)).toEqual({ error: expect.stringMatching(/non parte/) });
    expect(spawnFn).not.toHaveBeenCalled();
  });
});
