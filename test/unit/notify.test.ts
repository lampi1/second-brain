// Unit tests of the notification rules (src/renderer/lib/notify.ts): tiers, sections for badges, unread counting
// against read/seen state, toast grouping (mute, do-not-disturb, already-visible questions), internal links.
import { describe, expect, it } from 'vitest';
import type { FeedEvent } from '@shared/contract';
import { badges, emptyRead, isUnread, linkOfEvent, makeLink, markAllRead, markRead, parseLink, sectionOf, tierOf, toastGroups, visitSection } from '../../src/renderer/lib/notify';

const ev = (id: string, kind: string, at: number, extra: Partial<FeedEvent> = {}): FeedEvent => ({ id, at, kind, label: kind, priority: 'normal', title: id, detail: '', ...extra });

describe('notify', () => {
  it('tiers: important kinds toast, the rest stay quiet', () => {
    for (const k of ['chat-waiting', 'chat-done', 'error', 'sync-blocked', 'sync-error', 'budget', 'mail-blocked', 'login']) expect(tierOf(k)).toBe('toast');
    for (const k of ['idea', 'reflection', 'win', 'playbook', 'proposal', 'done', 'now', 'mail']) expect(tierOf(k)).toBe('quiet');
  });

  it('sections of the badges', () => {
    expect(sectionOf('idea')).toBe('idee');
    expect(sectionOf('reflection')).toBe('spunti');
    expect(sectionOf('playbook')).toBe('qualita');
    expect(sectionOf('budget')).toBe('costi');
    expect(sectionOf('chat-done')).toBe('workspace');
    expect(sectionOf('mail-blocked')).toBe('collabora');
    expect(sectionOf('sync-error')).toBe('home');
    expect(sectionOf('now')).toBeNull();
  });

  it('badges count unread events after the last visit; reading or visiting clears them', () => {
    const feed = [ev('a', 'idea', 30), ev('b', 'idea', 20), ev('c', 'error', 10), ev('d', 'idea', 5, { away: true })];
    expect(badges(feed, emptyRead)).toEqual({ idee: 2, qualita: 1 });
    expect(badges(feed, visitSection(emptyRead, 'idee', 25))).toEqual({ idee: 1, qualita: 1 });
    expect(badges(feed, markRead(emptyRead, ['a', 'b']))).toEqual({ qualita: 1 });
    const all = markAllRead(emptyRead, 100);
    expect(feed.some(e => isUnread(e, all))).toBe(false);
  });

  it('toasts: grouped by kind and chat, newest first, max 2; muted kinds, do-not-disturb and visible questions excluded', () => {
    const feed = [ev('e3', 'error', 30), ev('e2', 'error', 20), ev('d1', 'chat-done', 25, { chatId: 'x' }), ev('w1', 'chat-waiting', 22, { chatId: 'q' }), ev('i1', 'idea', 40), ev('old', 'error', 1)];
    const base = { since: 10, dismissed: new Set<string>(), muted: {}, dnd: false };
    const g = toastGroups(feed, base);
    expect(g.map(x => [x.kind, x.count])).toEqual([['error', 2], ['chat-done', 1]]);
    expect(toastGroups(feed, { ...base, muted: { error: true } }).map(x => x.kind)).toEqual(['chat-done', 'chat-waiting']);
    expect(toastGroups(feed, { ...base, muted: { error: true }, skipChats: new Set(['q']) }).map(x => x.kind)).toEqual(['chat-done']);
    expect(toastGroups(feed, { ...base, dnd: true })).toEqual([]);
    // dismissed by event id: those events are gone, a later event of the same kind toasts again
    expect(toastGroups(feed, { ...base, dismissed: new Set(['e3', 'e2']) }).map(x => x.kind)).toEqual(['chat-done', 'chat-waiting']);
    const later = [ev('e4', 'error', 35), ...feed];
    expect(toastGroups(later, { ...base, dismissed: new Set(['e3', 'e2']) }).map(x => [x.kind, x.count, x.ids])).toEqual([['error', 1, ['e4']], ['chat-done', 1, ['d1']]]);
  });

  it('internal links', () => {
    expect(linkOfEvent(ev('1', 'error', 1, { chatId: 'qa' }))).toBe('sb://workspace/chat-qa');
    expect(linkOfEvent(ev('7', 'idea', 1))).toBe('sb://idee');
    expect(linkOfEvent(ev('8', 'idea', 1, { file: 'ideas.md' }))).toBe('sb://esplora/ideas.md');
    expect(parseLink('sb://esplora/ops/runbook/x.md')).toEqual({ page: 'esplora', element: 'ops/runbook/x.md' });
    expect(parseLink('sb://workspace/chat-qa')).toEqual({ page: 'workspace', element: 'chat-qa' });
    expect(parseLink(' sb://costi ')).toEqual({ page: 'costi', element: null });
    expect(parseLink('https://example.com')).toBeNull();
    expect(makeLink('idee', 'feed-1')).toBe('sb://idee/feed-1');
  });
});
