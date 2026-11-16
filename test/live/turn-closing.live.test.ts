// Live check of the end of a turn (ADR 0317) against the real Claude CLI (spends real tokens, 1 tiny haiku turn,
// ~0.01 $): runs only with SB_LIVE=1.   SB_LIVE=1 npx vitest run test/live/turn-closing.live.test.ts
// A Stop hook that sleeps 3 s holds the CLI's result back, as a brain's own hooks do. Measured from the reply's last
// text, into test-results/live-turn-closing.json: when the chat stops showing work (turnClosing), when the result with
// its cost comes, when the chat is idle. No transcript is kept (--no-session-persistence). Never runs Cursor.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChatManager } from '../../src/main/chats/manager';
import type { ChatItem, ChatSummary, EventChannel } from '../../src/shared/contract';
import { tmp, waitFor } from '../unit/chats/helpers';

const HOOK_MS = 3000;

describe.skipIf(process.env.SB_LIVE !== '1')('live: the end of a turn', () => {
  it('the chat stops showing work with the last text, seconds before the result a Stop hook holds back', async () => {
    const at: { text?: number; closing?: number; result?: number; idle?: number } = {};
    let cost = -1;
    const emitter = { emit(channel: EventChannel, payload: unknown): void {
      const now = Date.now();
      if (channel === 'chat:item') {
        const { item } = payload as { item: ChatItem };
        if (item.kind === 'assistant' && !item.streaming) at.text = now;
        if (item.kind === 'result') { at.result = now; cost = item.costUsd; }
      } else if (channel === 'chat:updated') {
        const c = payload as ChatSummary;
        if (c.turnClosing && at.text !== undefined) at.closing ??= now;
        if (c.state === 'idle' && at.result !== undefined) at.idle ??= now;
      }
    } };
    const m = new ChatManager({
      emitter, userData: tmp('live-closing-ud'),
      extraArgs: ['--no-session-persistence', '--strict-mcp-config', '--settings', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `node -e "setTimeout(()=>{}, ${HOOK_MS})"`, timeout: 20 }] }] } })],
    });
    try {
      await m.create({ harness: 'claude', cwd: tmp('live-closing'), prompt: 'Reply with the single word: ok', model: 'haiku' });
      await waitFor(() => at.idle, 'the idle after the result', 180000);
      const facts = { at: new Date().toISOString(), hookMs: HOOK_MS, textToClosingMs: at.closing! - at.text!, textToResultMs: at.result! - at.text!, resultToIdleMs: at.idle! - at.result!, costUsd: cost };
      fs.mkdirSync(path.resolve(import.meta.dirname, '..', '..', 'test-results'), { recursive: true });
      fs.writeFileSync(path.resolve(import.meta.dirname, '..', '..', 'test-results', 'live-turn-closing.json'), `${JSON.stringify(facts, null, 2)}\n`);
      expect(at.closing).toBeDefined();
      expect(at.closing!).toBeLessThan(at.result!); // the indicator went before the result, not with it
      expect(cost).toBeGreaterThan(0);              // and the «Turno finito» line still has its cost
    } finally { await m.shutdown(); }
  }, 240000);
});
