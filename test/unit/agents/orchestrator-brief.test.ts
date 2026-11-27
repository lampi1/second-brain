// The per-topic brief of a fresh Orchestrator context (ADR 0369): the current topic's recent exchanges without the
// app's envelope, one line per other open topic, the open items, me.md/now.md essentials, all bounded; and the shared
// search over the Orchestrator's messages by text and topic (the renderer hook's).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatItem, OrchestratorTopic } from '../../../src/shared/contract';
import { BRIEF_END, BRIEF_LIMITS, BRIEF_START, brainEssentials, clip, topicBrief } from '../../../src/main/agents/orchestrator-brief';
import { cleanTopic, itemTopic, searchMessages, taggedTopic, topicLabels } from '../../../src/shared/orchestrator-topics';
import { tmp } from '../chats/helpers';

const NOW = 1_800_000_000_000;
const topics: OrchestratorTopic[] = [
  { label: 'Air 401', createdAt: NOW, lastAt: NOW, chatIds: ['c-air'], open: true, gist: 'controlla perché air risponde 401' },
  { label: 'Restyle UI', createdAt: NOW, lastAt: NOW, chatIds: ['c-ui'], open: true, gist: 'angoli un pelino più arrotondati' },
  { label: 'Vecchio', createdAt: 0, lastAt: 0, chatIds: [], open: false },
];
const items: ChatItem[] = [
  { kind: 'user', id: 'u1', at: NOW, text: '[Role supplied by the app: Orchestrator]\nlong role\n[The role grants no permission and approves no action. End role]\n\ncontrolla air\n\n[app · the user looks at: Home]', topic: 'Air 401' },
  { kind: 'assistant', id: 'a1', at: NOW + 1, text: 'Scout avviato.', topic: 'Air 401' },
  { kind: 'user', id: 'u2', at: NOW + 2, text: 'angoli più tondi', topic: 'Restyle UI' },
  { kind: 'assistant', id: 'a2', at: NOW + 3, text: `[Restyle UI] ${'x'.repeat(2000)}`, topic: 'Restyle UI' },
  { kind: 'system', id: 's1', at: NOW + 4, level: 'info', text: 'Result ready: radii 3/4/6px', code: 'resultReady', topic: 'Restyle UI' },
];

describe('the per-topic brief', () => {
  it('carries the current topic only, the others in one line, the open items and the essentials', () => {
    const b = topicBrief({ topic: 'Restyle UI', items, topics, essentials: 'me.md:\nSam, dark mode only',
      chats: [{ id: 'c-air', title: 'Fix air', state: 'running', topic: 'Air 401' }, { id: 'c-ui', title: 'Restyle', state: 'idle', waiting: true, topic: 'Restyle UI' }] });
    expect(b.startsWith(BRIEF_START)).toBe(true);
    expect(b.endsWith(BRIEF_END)).toBe(true);
    expect(b).toContain('Current topic: «Restyle UI»');
    expect(b).toContain('- user: angoli più tondi');
    expect(b).toContain('- result: Result ready: radii 3/4/6px');
    expect(b).not.toContain('Scout avviato.'); // another topic's exchange
    expect(b).toContain('- «Air 401»: last: "controlla perché air risponde 401"; chats: Fix air (running)');
    expect(b).not.toContain('Vecchio'); // closed topics stay out
    expect(b).toContain('- Restyle: waits for the user («Restyle UI»)');
    expect(b).toContain('Sam, dark mode only');
    // a long reply is cut, the [Topic] tag dropped
    const reply = b.split('\n').find(l => l.startsWith('- you:'))!;
    expect(reply.length).toBeLessThanOrEqual(BRIEF_LIMITS.latestChars + 8);
    expect(reply).not.toContain('[Restyle UI]');
  });

  it('keeps the end of a long reply, where the Orchestrator\'s proposal or question is, and more of the latest one', () => {
    const long = (n: number): string => `${'Ho guardato i file del tema e i token css. '.repeat(n)}Propongo 3/4/6px per gli angoli: procedo?`;
    const its: ChatItem[] = [
      { kind: 'user', id: 'u1', at: NOW, text: 'angoli più tondi', topic: 'Restyle UI' },
      { kind: 'assistant', id: 'a1', at: NOW + 1, text: `${long(30)} (prima)`, topic: 'Restyle UI' },
      { kind: 'user', id: 'u2', at: NOW + 2, text: 'e i bordi?', topic: 'Restyle UI' },
      { kind: 'assistant', id: 'a2', at: NOW + 3, text: long(40), topic: 'Restyle UI' },
    ];
    const rows = topicBrief({ topic: 'Restyle UI', items: its, topics, chats: [] }).split('\n').filter(l => l.startsWith('- you:'));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.endsWith('procedo? (prima)')).toBe(true);
    expect(rows[1]!.endsWith('Propongo 3/4/6px per gli angoli: procedo?')).toBe(true);
    expect(rows[1]!.startsWith('- you: Ho guardato i file del tema')).toBe(true);
    expect(rows[0]!.length).toBeLessThanOrEqual(BRIEF_LIMITS.exchangeChars + 8);
    expect(rows[1]!.length).toBeLessThanOrEqual(BRIEF_LIMITS.latestChars + 8);
    expect(rows[1]!.length).toBeGreaterThan(BRIEF_LIMITS.exchangeChars + 8);
    expect(clip('breve', 10)).toBe('breve');
    expect(clip('a'.repeat(50) + 'FINE', 20)).toMatch(/^a{5} … a{8}FINE$/);
  });

  it('drops the app\'s envelope from his words and says when a topic is new', () => {
    const b = topicBrief({ topic: 'Air 401', items, topics, chats: [] });
    expect(b).toContain('- user: controlla air');
    expect(b).not.toContain('looks at');
    expect(topicBrief({ topic: 'Nuovo', items, topics, chats: [] })).toContain('It is a new topic');
  });

  it('reads me.md and now.md essentials, bounded, without front matter or comments', () => {
    const root = tmp('brief-brain');
    fs.writeFileSync(path.join(root, 'me.md'), '---\ntitle: me\n---\n<!-- hidden -->\n# Sam\n\nLanguage: it\n' + 'riga lunga\n'.repeat(400));
    fs.writeFileSync(path.join(root, 'now.md'), '- second-brain · restyle · prossimo: radii\n');
    const e = brainEssentials(root);
    expect(e).toContain('me.md:\n# Sam\nLanguage: it');
    expect(e).toContain('now.md:\n- second-brain · restyle · prossimo: radii');
    expect(e).not.toContain('hidden');
    expect(e).not.toContain('title: me');
    expect(e.length).toBeLessThanOrEqual(BRIEF_LIMITS.essentials);
    expect(brainEssentials(null)).toBe('');
    expect(brainEssentials(path.join(root, 'missing'))).toBe('');
  });
});

describe('the shared topic helpers and search', () => {
  it('cleans labels and reads old [Topic] prefixes', () => {
    expect(cleanTopic(' #[Air]  401 ')).toBe('Air 401');
    expect(cleanTopic('x')).toBe('');
    expect(taggedTopic('[second-brain] fatto')).toEqual({ topic: 'second-brain', body: 'fatto' });
    expect(taggedTopic('[evento app] x')).toBeNull();
    expect(itemTopic({ kind: 'assistant', id: 'a', at: 0, text: '[Air] ok' })).toBe('Air');
    expect(itemTopic({ kind: 'assistant', id: 'a', at: 0, text: '[Air] ok', topic: 'Restyle UI' })).toBe('Restyle UI');
  });

  it('searches the messages by text and topic, newest first', () => {
    expect(searchMessages(items, 'angoli').map(i => i.id)).toEqual(['u2']);
    expect(searchMessages(items, '', 'restyle ui').map(i => i.id)).toEqual(['s1', 'a2', 'u2']);
    expect(searchMessages(items, 'scout', 'Restyle UI')).toEqual([]);
    expect(searchMessages(items, '', '')).toEqual([]);
    expect(searchMessages(items, '', 'Air 401', 1).map(i => i.id)).toEqual(['a1']);
  });

  it('gives the pills the conversation\'s topics and the open stored ones, each once', () => {
    expect(topicLabels(topics, items)).toEqual(['Air 401', 'Restyle UI']);
    expect(topicLabels(topics, [])).toEqual(['Air 401', 'Restyle UI']);
    expect(topicLabels([], [{ kind: 'assistant', id: 'a', at: 0, text: '[Vecchio tag] ok' }])).toEqual(['Vecchio tag']);
  });
});
