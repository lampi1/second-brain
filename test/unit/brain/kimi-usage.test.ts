// Kimi's tokens today (src/main/brain/kimi-usage.ts) on fake session folders shaped like Kimi Code CLI 0.27's
// (sessions/<workdir>/<session>/agents/<agent>/wire.jsonl): only usage.record lines of today count, across sessions,
// subagents and models; prompts and broken lines are skipped; a file that grows is read from where it stopped (a
// half-written last line waits); no folder = null; and composeUsage carries it to the strip.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { KIMI_PLAN_NOTE, KimiReader, kimiHome, parseWire } from '../../../src/main/brain/kimi-usage';
import { romeDay } from '../../../src/main/brain/live';
import { composeUsage } from '../../../src/main/brain/usage';
import { tmpDir } from './helpers';

const rec = (time: number, model: string, inputOther: number, output: number, inputCacheRead = 0, inputCacheCreation = 0) =>
  JSON.stringify({ type: 'usage.record', model, usage: { inputOther, output, inputCacheRead, inputCacheCreation }, usageScope: 'turn', time }) + '\n';

function wire(home: string, wd: string, session: string, agent: string, text: string): string {
  const dir = path.join(home, 'sessions', wd, session, 'agents', agent);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'wire.jsonl');
  fs.writeFileSync(f, text);
  return f;
}

describe('kimi usage', () => {
  const now = Date.now();
  const yesterday = now - 30 * 36e5;

  it('parseWire: today\'s usage.record only, summed per model; other records and broken lines skipped', () => {
    const text = [
      JSON.stringify({ type: 'metadata', protocol_version: '1.4', created_at: now }) + '\n',
      JSON.stringify({ type: 'message.created', text: 'secret "usage.record" in a prompt' }) + '\n',
      rec(now, 'k3', 100, 10, 1000),
      rec(now, 'k3', 50, 5),
      rec(now, 'k3-256k', 7, 3, 0, 20),
      rec(yesterday, 'k3', 9999, 9999),
      '{"type":"usage.record", broken\n',
    ].join('');
    const s = parseWire(text, romeDay(now));
    expect(s.calls).toBe(3);
    expect(s.byModel.k3).toEqual({ input: 150, cacheRead: 1000, cacheWrite: 0, output: 15 });
    expect(s.byModel['k3-256k']).toEqual({ input: 7, cacheRead: 0, cacheWrite: 20, output: 3 });
    expect(s.last).toBe(now);
  });

  it('KimiReader: sums sessions and subagents, models most first; null without the folder', () => {
    const home = tmpDir();
    expect(new KimiReader(path.join(home, 'none')).today(now)).toBeNull();
    wire(home, 'wd_a', 'session_1', 'main', rec(now - 60e3, 'k3', 1000, 200, 5000));
    wire(home, 'wd_a', 'session_1', 'sub_1', rec(now - 30e3, 'k3-256k', 100, 20));
    wire(home, 'wd_b', 'session_2', 'main', rec(yesterday, 'k3', 1e6, 1e6));
    const k = new KimiReader(home).today(now)!;
    expect(k.tokens).toBe(6320);
    expect(k).toMatchObject({ input: 1100, cacheRead: 5000, cacheWrite: 0, output: 220, calls: 2, lastAt: now - 30e3, planNote: KIMI_PLAN_NOTE });
    expect(k.models).toEqual([{ model: 'k3', tokens: 6200 }, { model: 'k3-256k', tokens: 120 }]);
  });

  it('a growing file is read from where it stopped; a half-written line waits for its end', () => {
    const home = tmpDir();
    const f = wire(home, 'wd', 's', 'main', rec(now, 'k3', 10, 1));
    const r = new KimiReader(home);
    expect(r.today(now)!.tokens).toBe(11);
    const next = rec(now, 'k3', 20, 2);
    fs.appendFileSync(f, next.slice(0, 30));
    expect(r.today(now)!.tokens).toBe(11);
    fs.appendFileSync(f, next.slice(30));
    expect(r.today(now)!.tokens).toBe(33);
    fs.writeFileSync(f, rec(now, 'k3', 1, 1)); // rewritten shorter: counted again from the start
    expect(r.today(now)!.tokens).toBe(2);
  });

  it('kimiHome: KIMI_CODE_HOME, else ~/.kimi-code', () => {
    expect(kimiHome({ KIMI_CODE_HOME: 'X:\\k' })).toBe('X:\\k');
    expect(kimiHome({})).toMatch(/\.kimi-code$/);
  });

  it('composeUsage carries Kimi to the strip only when there is a Kimi folder', () => {
    expect(composeUsage(null, null, now).kimi).toBeUndefined();
    const kimi = { tokens: 5, input: 5, cacheRead: 0, cacheWrite: 0, output: 0, calls: 1, lastAt: now, models: [{ model: 'k3', tokens: 5 }], planNote: KIMI_PLAN_NOTE };
    expect(composeUsage(null, null, now, null, kimi).kimi).toEqual(kimi);
  });
});
