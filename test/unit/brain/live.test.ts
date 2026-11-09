// Live feed (src/main/brain/live.ts) on temporary brain folders: baseline, new rows, updates, away diff, chat
// transitions, no parsers. Uses the brain's own parsers (fixture copy) and a fake chats.mjs run by plain Node.
import { afterEach, describe, expect, it } from 'vitest';
import type { Live } from '../../../src/main/brain/live';
import { diffChats, parseChatList, stamp } from '../../../src/main/brain/live';

const lives: Live[] = [];
afterEach(() => { for (const l of lives.splice(0)) l.stop(); });

describe('live feed', () => {
  it('chat transitions: running → waiting is urgent, running → done is quiet (center only, 2026-10-13), waiting → waiting is nothing', () => {
    const list = (s: string) => parseChatList(`- Claude · OS · Prova · brain · 11/10, 09:00 · ${s} · id abc123`);
    expect(diffChats(null, list('aspetta te (domanda)'))).toEqual([]);
    const before = new Map(list('in corso').map(c => [c.id, c]));
    const w = diffChats(before, list('aspetta te (domanda)'));
    expect(w[0]!.kind).toBe('chat-waiting');
    expect(stamp(w[0]!).priority).toBe('urgent');
    const d = diffChats(before, list('finito'));
    expect(d[0]!.kind).toBe('chat-done');
    expect(stamp(d[0]!).priority).toBe('quiet');
    expect(diffChats(new Map(list('aspetta te (domanda)').map(c => [c.id, c])), list('aspetta te (domanda)'))).toEqual([]);
  });

  it('stamp gives Italian labels and kind priorities; overrides win; unknown kinds are quiet', () => {
    expect(stamp({ kind: 'idea', title: 't' })).toMatchObject({ label: 'Idea aggiunta', priority: 'normal', detail: '' });
    expect(stamp({ kind: 'budget', title: 't', priority: 'urgent' }).priority).toBe('urgent');
    expect(stamp({ kind: 'mystery', title: 't' })).toMatchObject({ label: 'mystery', priority: 'quiet' });
  });
});
