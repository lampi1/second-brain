// What counts as "the agent added something" under an open question card (src/renderer/lib/askItems.tsx): the current
// turn's text, reasoning and attached visuals; never a tool's status or an older turn.
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../src/shared/contract';
import { turnSignature } from '../../src/renderer/lib/askContext';

const user = (id: string): ChatItem => ({ kind: 'user', id, at: 1, text: 'fai' } as ChatItem);
const say = (id: string, text: string): ChatItem => ({ kind: 'assistant', id, at: 1, text } as ChatItem);
const tool = (id: string, status: 'running' | 'ok'): ChatItem => ({ kind: 'tool', id, at: 1, name: 'Bash', summary: '', input: {}, status } as ChatItem);
const art = (id: string, at: number): ChatItem => ({ kind: 'artifact', id, at, key: id, title: '', summary: '', ui: { component: 'brief', props: {} }, target: 'next-ask', askId: 'q1' } as unknown as ChatItem);

describe('turnSignature', () => {
  const base = [say('old', 'prima'), user('u'), say('a1', 'Ho trovato il bug.'), tool('t1', 'running')];
  it('is the same when only a tool status changes', () => {
    expect(turnSignature([...base.slice(0, 3), tool('t1', 'ok')])).toBe(turnSignature(base));
  });
  it('ignores what came before the last user message', () => {
    expect(turnSignature([say('old', 'diverso'), ...base.slice(1)])).toBe(turnSignature(base));
  });
  it('changes when the turn gets more text or a new message', () => {
    expect(turnSignature([...base, say('a2', 'Nota: altro.')])).not.toBe(turnSignature(base));
    expect(turnSignature([user('u'), say('a1', 'Ho trovato il bug. E altro.')])).not.toBe(turnSignature([user('u'), say('a1', 'Ho trovato il bug.')]));
  });
  it('changes when a visual is replaced', () => {
    expect(turnSignature([user('u'), art('v', 2)])).not.toBe(turnSignature([user('u'), art('v', 1)]));
  });
  it('is empty without items', () => { expect(turnSignature(undefined)).toBe(''); });
});
