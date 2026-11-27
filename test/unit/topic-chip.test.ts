// The topic chip of an Orchestrator message (ADR 0369, TopicChip.tsx): the plain label it always was, or, in a live
// Orchestrator with other open topics, the one-click list that moves the message to another topic.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { OrchestratorTopic } from '../../src/shared/contract';

let stored: OrchestratorTopic[] = [];
vi.mock('../../src/renderer/lib/orchestrator-topics', () => ({ useStoredTopics: () => stored, moveToTopic: vi.fn() }));
vi.mock('../../src/renderer/i18n', () => ({ t: (k: string) => k }));
import { TopicChip } from '../../src/renderer/components/TopicChip';

const topic = (label: string, open = true): OrchestratorTopic => ({ label, createdAt: 0, lastAt: 0, chatIds: [], open });
const render = (chatId: string | null, itemId = 'u1') => renderToStaticMarkup(createElement(TopicChip, { chatId, itemId, topic: 'Air 401', testid: 'item-u1-topic' }));

describe('the topic chip', () => {
  it('is the plain label without a chat, without other open topics, or on a message not sent yet', () => {
    stored = [topic('Air 401'), topic('Vecchio', false)];
    expect(render('o')).toBe('<span class="msg-topic" data-testid="item-u1-topic">Air 401</span>');
    stored = [topic('Air 401'), topic('Restyle UI')];
    expect(render(null)).toContain('<span class="msg-topic"');
    expect(render('o', 'local:1')).toContain('<span class="msg-topic"');
  });

  it('lists the other open topics to move the message in one click', () => {
    stored = [topic('Air 401'), topic('Restyle UI'), topic('Chiuso', false)];
    const html = render('o');
    expect(html).toContain('<select class="msg-topic msg-topic-pick"');
    expect(html).toContain('aria-label="chat.orch.topicMove"');
    expect(html).toContain('<option value="Air 401" selected="">Air 401</option>');
    expect(html).toContain('<option value="Restyle UI">Restyle UI</option>');
    expect(html).not.toContain('Chiuso');
  });
});
