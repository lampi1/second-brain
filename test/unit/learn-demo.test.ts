// The Impara demo teacher (src/main/learn/demo.ts) used by `npm run demo` and the e2e: its files check reads each fact
// back from the prompt's JSON lines, so a Windows path must come back decoded, or the fixed fact lands on a «second»
// file in the lesson's sources (impara.spec.ts counts the files).
import { describe, expect, it, vi } from 'vitest';
import { demoTeach } from '../../src/main/learn/demo';
import type { TeachRun } from '../../src/main/learn/service';

const verify = async (prompt: string) => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  const run: TeachRun = { cwd: '.', prompt, effort: null, round: 'impara-verify-files', timeoutMs: 1000, teacher: null };
  const p = demoTeach(run);
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return (JSON.parse(r.text) as { verdicts: { id: string; verdict: string; ref?: string }[] }).verdicts;
};

describe('demo files check', () => {
  it('keeps a Windows source path as the file it names when it fixes a fact', async () => {
    const file = ['C:', 'Users', 'u', 'app', 'src', 'renderer', 'store', 'store.ts'].join(String.fromCharCode(92));
    const line = (id: string, claim: string, source: string) => JSON.stringify({ id, claim, source });
    const prompt = [line('f1', 'Lo store aspetta 250 ms.', `${file}:29`), line('f2', 'STREAM_MS passa da 100 a 10 ms.', `${file}:27`), line('f3', 'Un fotogramma dura 16,7 ms.', 'model knowledge')].join('\n');
    const verdicts = await verify(prompt);
    expect(verdicts.map(v => v.verdict)).toEqual(['ok', 'wrong', 'unsure']);
    expect(verdicts[1]!.ref).toBe(`${file}:27`);
  });
});
