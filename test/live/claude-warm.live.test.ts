// Live check of the warm Claude engine (chats/warm.ts) against the real embedded CLI (spends real tokens, 2 tiny haiku
// turns, ~0.02 $): runs only with SB_LIVE=1.   SB_LIVE=1 npx vitest run test/live/claude-warm.live.test.ts
// A first chat starts cold; the next one in the same folder adopts the engine that waited meanwhile. Measures, from
// create() to the first assistant text and to the result, both ways, into test-results/live-warm.json. Also proves that
// an adopted engine takes the chat's model through set_model. User hooks are off (they write to the user's chat feed);
// no transcript is kept (--no-session-persistence). Never runs Cursor.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChatManager } from '../../src/main/chats/manager';
import { recEmitter, tmp, waitFor } from '../unit/chats/helpers';

describe.skipIf(process.env.SB_LIVE !== '1')('live: warm Claude engine', () => {
  it('the second chat answers sooner on the engine that waited', async () => {
    const cwd = tmp('live-warm');
    const m = new ChatManager({
      emitter: recEmitter(), userData: tmp('live-warm-ud'), prewarm: true, prewarmDelayMs: 0,
      extraArgs: ['--no-session-persistence', '--settings', JSON.stringify({ disableAllHooks: true })],
    });
    const PROMPT = 'Reply with the single word: ok';
    const timed = async (): Promise<{ firstTextMs: number; resultMs: number; id: string }> => {
      const t0 = Date.now();
      const c = await m.create({ harness: 'claude', cwd, prompt: PROMPT, model: 'haiku' });
      await waitFor(() => m.items(c.id).some(i => i.kind === 'assistant'), 'first text', 180000);
      const firstTextMs = Date.now() - t0;
      await waitFor(() => m.items(c.id).some(i => i.kind === 'result'), 'result', 180000);
      return { firstTextMs, resultMs: Date.now() - t0, id: c.id };
    };
    try {
      const cold = await timed();
      // the waiting engine is up (its initialize answered) before the "user" opens the next chat
      await new Promise(r => setTimeout(r, 25000));
      const warm = await timed();
      const facts = { at: new Date().toISOString(), cold, warm, model: m.list().find(c => c.id === warm.id)?.model };
      fs.mkdirSync(path.resolve(import.meta.dirname, '..', '..', 'test-results'), { recursive: true });
      fs.writeFileSync(path.resolve(import.meta.dirname, '..', '..', 'test-results', 'live-warm.json'), `${JSON.stringify(facts, null, 2)}\n`);
      expect(m.items(warm.id).find(i => i.kind === 'result')).toMatchObject({ isError: false });
      expect(facts.model).toMatch(/haiku/);
      expect(warm.firstTextMs).toBeLessThan(cold.firstTextMs);
    } finally {
      await m.shutdown();
    }
  }, 420000);
});
