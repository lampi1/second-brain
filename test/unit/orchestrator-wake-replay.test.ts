// Unit tests of scripts/orchestrator-wake-replay.mjs: a day's Orchestrator news replayed through the old and the current
// newsClass (orchestrator-delivery.ts) counts only the deliveries that open a new Orchestrator turn (cloudroom comms
// proposal 1, 2026-11-07: a plain turn end or start no longer does).
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped .mjs script
import { parse, replay } from '../../scripts/orchestrator-wake-replay.mjs';
import { newsClass } from '../../src/main/chats/orchestrator-delivery';

const t = (s: number) => new Date(Date.UTC(2026, 10, 7, 9, 0, s)).toISOString();
const news = (s: number, gate: string, kinds: string[]) => JSON.stringify({ t: t(s), msg: 'news sent to the Orchestrator', data: { chats: 1, kinds, gate } });

describe('orchestrator-wake replay', () => {
  it('a queued plain done or start opened a turn before and no longer does; a failure still does; an injected news never', () => {
    const lines = [
      news(0, 'queue', ['done']),
      news(10, 'queue', ['done', 'started']),
      news(20, 'queue', ['done', 'user-message']),
      news(30, 'queue', ['error']),
      news(40, 'inject', ['done']),
      news(50, 'inject', ['permission']),
      'not json',
      JSON.stringify({ t: t(60), msg: 'something else' }),
    ];
    const r = replay(parse(lines), newsClass);
    expect(r).toMatchObject({ deliveries: 6, queued: 4, injected: 2, before: 4, afterLow: 1, afterHigh: 1 });
  });
  it('a done delivered right after a root chat reported counts in the high bound: it may be a result to route', () => {
    const lines = [JSON.stringify({ t: t(0), msg: 'root chat reported' }), news(5, 'queue', ['done']), news(200, 'queue', ['done'])];
    expect(replay(parse(lines), newsClass)).toMatchObject({ before: 2, afterLow: 0, afterHigh: 1 });
  });
});
