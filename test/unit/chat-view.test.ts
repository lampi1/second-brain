// Tests for lib/chat-view.ts: Orchestrator process rows fold into one group; an emoji-only reply sticks to the user's
// own message (WhatsApp style) and stands alone anywhere else; a long transcript draws only its tail, from a turn's start.
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../src/shared/contract';
import { chatView, tailStart, TAIL_ITEMS } from '../../src/renderer/lib/chat-view';

const user = (id: string, text: string, extra: object = {}) => ({ kind: 'user', id, text, ...extra }) as ChatItem;
const said = (id: string, text: string, streaming = false) => ({ kind: 'assistant', id, text, streaming }) as ChatItem;
const think = (id: string) => ({ kind: 'thinking', id, text: 'hmm' }) as ChatItem;
const tool = (id: string) => ({ kind: 'tool', id, name: 'Read', input: {}, status: 'done' }) as unknown as ChatItem;

describe('chatView', () => {
  it('sticks an emoji-only reply to the user message before it', () => {
    const v = chatView([user('u1', 'grazie'), said('a1', '👍')], { foldProcess: false });
    expect(v).toEqual([{ kind: 'item', item: user('u1', 'grazie'), reaction: '👍' }]);
  });

  it('keeps a reply with words as a row; a second emoji is not drawn', () => {
    expect(chatView([user('u1', 'x'), said('a1', 'Fatto.')], { foldProcess: false })).toHaveLength(2);
    const v = chatView([user('u1', 'x'), said('a1', '👍'), said('a2', '🎉')], { foldProcess: false });
    expect(v.map(r => r.kind === 'item' && r.item.id)).toEqual(['u1']);
  });

  it('waits for emoji finalization without flashing a bubble or losing its user target', () => {
    const prefix = [user('u1', 'grazie'), think('t1'), tool('k1')];
    for (const text of ['🙏', '🙏 ']) {
      const pending = chatView([...prefix, said('a1', text, true)], { foldProcess: true });
      expect(pending.map(r => r.kind === 'item' && r.item.id)).toEqual(['u1', false]);
      expect(pending[0]).not.toHaveProperty('reaction');
    }
    const final = chatView([...prefix, said('a1', '🙏')], { foldProcess: true });
    expect(final[0]).toMatchObject({ item: { id: 'u1' }, reaction: '🙏' });
    expect(final).toHaveLength(2);
    const words = chatView([...prefix, said('a1', '🙏 Grazie!', true)], { foldProcess: true });
    expect(words[2]).toMatchObject({ item: { id: 'a1', text: '🙏 Grazie!' } });
  });

  it('never flashes event acknowledgements or attaches them to an earlier user', () => {
    for (const news of [
      user('n1', '[evento app] Novità dalle chat di lavoro: ha finito il turno.'),
      user('n1', 'Task complete', { from: 'another-chat' }),
    ]) {
      for (const streaming of [true, false]) {
        const view = chatView([user('u1', 'grazie'), news, said('a1', '🙏', streaming)], { foldProcess: true });
        expect(view.some(r => r.kind === 'item' && r.item.id === 'a1')).toBe(false);
        expect(view.every(r => r.kind !== 'item' || !r.reaction)).toBe(true);
      }
    }
  });

  it('draws no emoji that is not a reaction to the user', () => {
    const v = chatView([user('u0', 'ciao'), said('a0', 'Ciao.'), said('a1', '👀')], { foldProcess: false });
    expect(v.map(r => r.kind === 'item' && r.item.id)).toEqual(['u0', 'a0']);
  });

  it('drops a turn on app news that had nothing for the user: the news, its work and its result line', () => {
    const news = user('n1', '[evento app] Novità dalle chat di lavoro: ha finito il turno.');
    const done = { kind: 'result', id: 'r1', isError: false, costUsd: 0.01, durationMs: 3000, turns: 1 } as unknown as ChatItem;
    const v = chatView([user('u0', 'ciao'), said('a0', 'Ciao.'), news, think('t1'), tool('k1'), said('a1', '👍'), done], { foldProcess: true });
    expect(v.map(r => r.kind === 'item' && r.item.id)).toEqual(['u0', 'a0']);
  });

  it('keeps app news the Orchestrator answered in words', () => {
    const news = user('n1', '[evento app] Novità dalle chat di lavoro: ha finito il turno.');
    const v = chatView([news, said('a1', 'Export pronto.')], { foldProcess: true });
    expect(v).toHaveLength(2);
  });

  it.each([
    { isError: true },
    { isError: false, interrupted: true },
  ])('keeps an unsuccessful result after a silent acknowledgement: %j', flags => {
    for (const foldProcess of [true, false]) {
      const news = user('n1', '[evento app] Novità dalle chat di lavoro: ha finito il turno.');
      const result: ChatItem = { kind: 'result', id: 'r1', at: 0, costUsd: 0, durationMs: 1000, turns: 1, ...flags };
      const view = chatView([news, think('t1'), said('a1', '✅'), result], { foldProcess });
      expect(view).toContainEqual({ kind: 'item', item: result });
      expect(view.some(row => row.kind === 'item' && row.item.id === 'a1')).toBe(false);
    }
  });

  it('folds an Orchestrator\'s thinking and tool runs into one group and still attaches across it', () => {
    const v = chatView([user('u1', 'ok'), think('t1'), tool('k1'), said('a1', '👍'), think('t2')], { foldProcess: true });
    expect(v.map(r => r.kind)).toEqual(['item', 'process']); // the absorbed reaction leaves one run
    expect(v[0]).toMatchObject({ reaction: '👍' });
    expect(v[1]).toMatchObject({ id: 'process-t1', items: [think('t1'), tool('k1'), think('t2')] });
  });

  it('does not fold outside an Orchestrator', () => {
    expect(chatView([think('t1'), tool('k1')], { foldProcess: false }).map(r => r.kind)).toEqual(['item', 'item']);
  });
});

describe('tailStart: only the tail of a long transcript is drawn', () => {
  const many = (n: number, userEvery = 0) => Array.from({ length: n }, (_, i) => (userEvery && i % userEvery === 0 ? user(`u${i}`, 'q') : said(`a${i}`, 'r')));
  it('draws everything up to the limit', () => {
    expect(tailStart(many(TAIL_ITEMS), TAIL_ITEMS)).toBe(0);
    expect(tailStart([], TAIL_ITEMS)).toBe(0);
    expect(tailStart(many(600), Infinity)).toBe(0);
  });
  it('starts at the plain cut when no turn starts nearby', () => {
    expect(tailStart(many(600), TAIL_ITEMS)).toBe(600 - TAIL_ITEMS);
  });
  it('starts at the next user message after the cut, so a turn is not cut in half', () => {
    const items = many(600, 7);
    const at = tailStart(items, TAIL_ITEMS);
    expect(at).toBeGreaterThanOrEqual(600 - TAIL_ITEMS);
    expect(at).toBeLessThan(600 - TAIL_ITEMS + 7);
    expect(items[at]!.kind).toBe('user');
  });
});
