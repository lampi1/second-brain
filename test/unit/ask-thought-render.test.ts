// The yes/no card's reasoning (the owner, 2026-11-10: only the last reasoning piece, in sight right away; the earlier
// ones are not in the user's language and nobody reads them): AskThought draws the newest piece, and the folded chat
// text under it (AskContext thinking 'none') keeps the chat's messages without any reasoning.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { ChatItem, PendingRequest } from '../../src/shared/contract';

const items: ChatItem[] = [
  { kind: 'user', id: 'u', at: 1, text: 'fai' },
  { kind: 'thinking', id: 't1', at: 2, text: 'Let me check the three caches first.' },
  { kind: 'assistant', id: 'a1', at: 3, text: 'Ho controllato le istanze.' },
  { kind: 'thinking', id: 't2', at: 4, text: 'Ho ricontrollato i tre Redis: la scelta dell’istanza viene dopo.' },
] as ChatItem[];
const state = { items: { c: items }, chats: { c: { id: 'c' } } };
vi.mock('../../src/renderer/store/store', () => ({ useApp: (sel: (s: typeof state) => unknown) => sel(state), loadItems: vi.fn() }));
vi.mock('../../src/renderer/components/CodeBlock', () => ({ CodeBlock: () => null }));
vi.mock('../../src/renderer/actions', () => ({}));
vi.mock('../../src/renderer/components/AskImages', () => ({ AskImages: () => null }));
vi.mock('../../src/renderer/lib/markdown', () => ({ renderMarkdown: (s: string) => s, markdownParts: () => [] }));
vi.mock('../../src/renderer/sb', () => ({ sb: {} }));
vi.mock('../../src/renderer/components/GenUi', () => ({ AskArtifacts: () => null, UiPreview: () => null, openFile: vi.fn() }));
import { AskContext, AskThought } from '../../src/renderer/components/AskContext';
import { askContext, lastThought, lastThoughtOf } from '../../src/renderer/lib/askContext';

const req = { id: 'q', chatId: 'c', type: 'question', tool: 'AskUserQuestion', title: 'Procedo?', detail: '', input: {}, at: 5,
  questions: [{ question: 'Procedo?', multiSelect: false, options: [{ label: 'Sì' }, { label: 'No' }] }] } as unknown as PendingRequest;

it('shows only the newest reasoning piece, and the folded chat text has no reasoning', () => {
  const thought = renderToStaticMarkup(createElement(AskThought, { req, testBase: 'd' }));
  expect(thought).toContain('la scelta dell’istanza viene dopo');
  expect(thought).not.toContain('three caches');
  const rest = renderToStaticMarkup(createElement(AskContext, { req, defaultOpen: true, testBase: 'd', noVisuals: true, thinking: 'none' }));
  expect(rest).toContain('Ho controllato le istanze.');
  expect(rest).not.toContain('three caches');
  expect(rest).not.toContain('Redis');
  // a small card keeps only that last piece in its fold
  const small = renderToStaticMarkup(createElement(AskContext, { req, defaultOpen: true, testBase: 'd', noVisuals: true, thinking: 'last' }));
  expect(small).toContain('Redis');
  expect(small).not.toContain('three caches');
});

it('lastThought is undefined when the chat did not reason', () => {
  expect(lastThought([{ id: 'a', kind: 'text', text: 'x' }])).toBeUndefined();
});

it('hidden reasoning never takes the place of the chat\'s message, and the last piece survives messages after it', () => {
  const many: ChatItem[] = [items[0]!, { kind: 'assistant', id: 'm', at: 2, text: 'Ho controllato X.' } as ChatItem,
    ...[1, 2, 3, 4].map(n => ({ kind: 'thinking', id: `r${n}`, at: 2 + n, text: `step ${n}` } as ChatItem))];
  expect(askContext(many, req, 'none').pieces.map(p => p.id)).toEqual(['m']);
  expect(askContext(many, req, 'last').pieces.map(p => p.id)).toEqual(['m', 'r4']);
  const after: ChatItem[] = [items[0]!, { kind: 'thinking', id: 'r', at: 2, text: 'ultimo' } as ChatItem,
    ...[1, 2, 3, 4].map(n => ({ kind: 'assistant', id: `a${n}`, at: 2 + n, text: `msg ${n}` } as ChatItem))];
  expect(lastThoughtOf(after, req)?.id).toBe('r');
});
