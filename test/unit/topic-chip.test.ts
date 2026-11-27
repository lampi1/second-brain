// The topic chip of an Orchestrator message (ADR 0369, TopicChip.tsx): the plain label it always was, or, in a live
// Orchestrator with other open topics, the app's Select (a button and a listbox popover, never a native select element,
// whose bare arrow keys would move the message) that moves the message to another topic only on a pick.
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrchestratorTopic } from '../../src/shared/contract';

let stored: OrchestratorTopic[] = [];
const { moveToTopic } = vi.hoisted(() => ({ moveToTopic: vi.fn(async () => ({ chatId: 'o', topics: [] })) }));
vi.mock('../../src/renderer/lib/orchestrator-topics', () => ({ useStoredTopics: () => stored, moveToTopic }));
vi.mock('../../src/renderer/i18n', () => ({ t: (k: string) => k }));
import { TopicChip } from '../../src/renderer/components/TopicChip';
import { Select, optionsOf, type SelectChange } from '../../src/renderer/components/Select';

const topic = (label: string, open = true): OrchestratorTopic => ({ label, createdAt: 0, lastAt: 0, chatIds: [], open });
const props = (chatId: string | null, itemId = 'u1') => ({ chatId, itemId, topic: 'Air 401', testid: 'item-u1-topic' });
const render = (chatId: string | null, itemId = 'u1') => renderToStaticMarkup(createElement(TopicChip, props(chatId, itemId)));
/** The chip's element (its memo'd function called as React would, without a DOM). */
const tree = (chatId: string | null) => (TopicChip as unknown as { type: (p: ReturnType<typeof props>) => ReactElement<{ children: ReactNode; onChange: (e: SelectChange) => void; className: string }> }).type(props(chatId));
const change = (value: string): SelectChange => ({ target: { value }, currentTarget: { value } });

beforeEach(() => { moveToTopic.mockClear(); });

describe('the topic chip', () => {
  it('is the plain label without a chat, without other open topics, or on a message not sent yet', () => {
    stored = [topic('Air 401'), topic('Vecchio', false)];
    expect(render('o')).toBe('<span class="msg-topic" data-testid="item-u1-topic">Air 401</span>');
    stored = [topic('Air 401'), topic('Restyle UI')];
    expect(render(null)).toContain('<span class="msg-topic"');
    expect(render('o', 'local:1')).toContain('<span class="msg-topic"');
  });

  it('is the app\'s Select in the chip\'s look, closed, never a native select', () => {
    stored = [topic('Air 401'), topic('Restyle UI'), topic('Chiuso', false)];
    const html = render('o');
    expect(html).not.toContain('<select');
    expect(html).toMatch(/^<button[^>]*type="button"[^>]*class="ui-select  msg-topic msg-topic-movable"/);
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="chat.orch.topicMove"');
    expect(html).toContain('data-testid="item-u1-topic"');
    expect(html).toContain('>Air 401</span>');
    expect(html).not.toContain('role="listbox"'); // the list exists only once opened
  });

  it('offers the other open topics, and only a pick of another one moves the message', () => {
    stored = [topic('Air 401'), topic('Restyle UI'), topic('Chiuso', false)];
    const el = tree('o');
    expect(el.type).toBe(Select);
    expect(optionsOf(el.props.children).map(o => o.value)).toEqual(['Air 401', 'Restyle UI']);
    el.props.onChange(change('air 401'));
    expect(moveToTopic).not.toHaveBeenCalled();
    el.props.onChange(change('Restyle UI'));
    expect(moveToTopic).toHaveBeenCalledWith('o', 'u1', 'Restyle UI');
  });
});
