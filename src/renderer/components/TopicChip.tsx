// The topic chip above a message of the Orchestrator (ADR 0369): the label the app gave it, and the one-click move to
// another open topic. The chip keeps its look (.msg-topic) and is the app's own Select (Select.tsx: a button and a
// listbox popover), never a native select element: a native one changes its value on a bare arrow key or letter while
// closed (Windows Chromium), which would move the message as the user tabs through. Here a click, Enter, Space or an
// arrow only opens the list, and only a pick in the open list moves the message. Without a chat or other topics it is
// the plain label. Used by ChatItems.tsx (Item); the data comes from lib/orchestrator-topics.ts.
import { memo } from 'react';
import { sameTopic } from '@shared/orchestrator-topics';
import { moveToTopic, useStoredTopics } from '../lib/orchestrator-topics';
import { Select } from './Select';
import { t } from '../i18n';

export const TopicChip = memo(function TopicChip({ chatId, itemId, topic, testid }: { chatId: string | null; itemId: string; topic: string; testid: string }) {
  const stored = useStoredTopics(chatId);
  const others = stored.filter(x => x.open && !sameTopic(x.label, topic)).slice(0, 12);
  if (!chatId || !others.length || itemId.startsWith('local:')) return <span className="msg-topic" data-testid={testid}>{topic}</span>;
  return (
    <Select className="msg-topic msg-topic-movable" value={topic} aria-label={t('chat.orch.topicMove')} data-tip={t('chat.orch.topicMove')} data-testid={testid}
      onChange={e => { const next = e.target.value; if (next && !sameTopic(next, topic)) void moveToTopic(chatId, itemId, next).catch(() => { /* the chip keeps its topic */ }); }}>
      <option value={topic}>{topic}</option>
      {others.map(x => <option key={x.label} value={x.label}>{x.label}</option>)}
    </Select>
  );
});
