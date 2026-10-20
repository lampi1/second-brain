// Tests for lib/chat-view.ts: Orchestrator process rows fold into one group; an emoji-only reply sticks to the user's
// own message (WhatsApp style) and stands alone anywhere else.
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../src/shared/contract';
import { chatView } from '../../src/renderer/lib/chat-view';

const user = (id: string, text: string, extra: object = {}) => ({ kind: 'user', id, text, ...extra }) as ChatItem;
const said = (id: string, text: string, streaming = false) => ({ kind: 'assistant', id, text, streaming }) as ChatItem;
const think = (id: string) => ({ kind: 'thinking', id, text: 'hmm' }) as ChatItem;
const tool = (id: string) => ({ kind: 'tool', id, name: 'Read', input: {}, status: 'done' }) as unknown as ChatItem;

describe('chatView', () => {
  it('sticks an emoji-only reply to the user message before it', () => {
    const v = chatView([user('u1', 'grazie'), said('a1', '👍')], { foldProcess: false });
    expect(v).toEqual([{ kind: 'item', item: user('u1', 'grazie'), reaction: '👍' }]);
  });

  it('keeps a reply with words, a streaming emoji and a second emoji as rows', () => {
    expect(chatView([user('u1', 'x'), said('a1', 'Fatto.')], { foldProcess: false })).toHaveLength(2);
    expect(chatView([user('u1', 'x'), said('a1', '👍', true)], { foldProcess: false })).toHaveLength(2);
    const v = chatView([user('u1', 'x'), said('a1', '👍'), said('a2', '🎉')], { foldProcess: false });
    expect(v.map(r => r.kind === 'item' && r.item.id)).toEqual(['u1', 'a2']);
  });

  it('leaves an emoji after app news or another chat\'s message standalone', () => {
    const news = user('u1', 'ciao', { from: 'Scout' });
    expect(chatView([news, said('a1', '👀')], { foldProcess: false })).toHaveLength(2);
    expect(chatView([said('a0', 'ok'), said('a1', '👀')], { foldProcess: false })).toHaveLength(2);
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
