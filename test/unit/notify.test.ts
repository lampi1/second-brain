// Unit tests of the notification rules (src/renderer/lib/notify.ts): tiers, sections for badges, unread counting
// against read/seen state, toast grouping (mute, do-not-disturb, already-visible questions), internal links.
import { describe, expect, it } from 'vitest';
import type { FeedEvent } from '@shared/contract';
import { badges, bellCount, emptyRead, isActionable, isUnread, linkOfEvent, makeLink, markAllRead, markRead, parseLink, sectionOf, tierOf, toastGroups, visitSection } from '../../src/renderer/lib/notify';

const ev = (id: string, kind: string, at: number, extra: Partial<FeedEvent> = {}): FeedEvent => ({ id, at, kind, label: kind, priority: 'normal', title: id, detail: '', ...extra });

describe('notify', () => {
  it('tiers: only what needs the user now toasts (policy 2026-10-13), the rest stays quiet', () => {
    for (const k of ['chat-waiting', 'chat-failed', 'login', 'sync-blocked', 'sync-error']) expect(tierOf(k)).toBe('toast');
    for (const k of ['chat-done', 'error', 'win', 'idea', 'sync-ok', 'mail-blocked', 'reflection', 'playbook', 'proposal', 'done', 'decision', 'now', 'mail']) expect(tierOf(k)).toBe('quiet');
    // budget: a toast only at 100 % (priority urgent)
    expect(tierOf(ev('b1', 'budget', 1, { priority: 'urgent' }))).toBe('toast');
    expect(tierOf(ev('b2', 'budget', 1, { priority: 'normal' }))).toBe('quiet');
  });

  it('bell: counts unread actionable events only', () => {
    const feed = [
      ev('q', 'question', 9), ev('w', 'chat-waiting', 8), ev('f', 'chat-failed', 7), ev('sb', 'sync-blocked', 6), ev('b100', 'budget', 5, { priority: 'urgent' }),
      ev('b80', 'budget', 4), ev('d', 'chat-done', 3), ev('e', 'error', 2), ev('i', 'idea', 1), ev('p', 'playbook', 1), ev('n', 'now', 1), ev('ok', 'sync-ok', 1),
    ];
    expect(feed.filter(e => isActionable(e)).map(e => e.id)).toEqual(['q', 'w', 'f', 'sb', 'b100']);
    expect(bellCount(feed, emptyRead)).toBe(5);
    expect(bellCount(feed, markRead(emptyRead, ['q', 'w']))).toBe(3);
    expect(bellCount(feed, markAllRead(emptyRead, 100))).toBe(0);
    // a question counts only while its chat still has an open request: answered in the layer = no longer to do
    const q = [ev('q1', 'question', 9, { chatId: 'a' }), ev('q2', 'question', 8, { chatId: 'b' })];
    expect(bellCount(q, emptyRead, new Set(['a']))).toBe(1);
    expect(bellCount(q, emptyRead, new Set())).toBe(0);
  });

  it('badges: silent kinds and error/win/idea/chat-done never badge', () => {
    const feed = ['error', 'win', 'idea', 'reflection', 'chat-done', 'playbook', 'proposal', 'now', 'done', 'decision', 'mail', 'sync-ok'].map((k, i) => ev(`x${i}`, k, i + 1));
    expect(badges(feed, emptyRead)).toEqual({});
  });

  it('sections of the badges', () => {
    expect(sectionOf('idea')).toBe('idee');
    expect(sectionOf('reflection')).toBe('idee');
    expect(sectionOf('playbook')).toBe('qualita');
    expect(sectionOf('budget')).toBe('costi');
    expect(sectionOf('chat-done')).toBe('workspace');
    expect(sectionOf('mail-blocked')).toBeNull(); // Comunicazione is gone: center (and bell) only
    expect(sectionOf('sync-error')).toBeNull(); // Oggi (its badge) is gone: toast + center only
    expect(sectionOf('now')).toBeNull();
  });

  it('badges count unread events after the last visit; reading or visiting clears them', () => {
    const feed = [ev('a', 'budget', 30), ev('b', 'budget', 20), ev('c', 'chat-failed', 10), ev('d', 'budget', 5, { away: true }), ev('e', 'mail-blocked', 40)];
    expect(badges(feed, emptyRead)).toEqual({ costi: 2, workspace: 1 });
    expect(badges(feed, visitSection(emptyRead, 'costi', 25))).toEqual({ costi: 1, workspace: 1 });
    expect(badges(feed, markRead(emptyRead, ['a', 'b']))).toEqual({ workspace: 1 });
    const all = markAllRead(emptyRead, 100);
    expect(feed.some(e => isUnread(e, all))).toBe(false);
  });

  it('toasts: grouped by kind and chat, newest first, max 2; muted kinds, do-not-disturb and visible questions excluded', () => {
    const feed = [ev('e3', 'chat-failed', 30), ev('e2', 'chat-failed', 20), ev('d1', 'login', 25, { chatId: 'x' }), ev('w1', 'chat-waiting', 22, { chatId: 'q' }), ev('i1', 'idea', 40), ev('c1', 'chat-done', 41, { chatId: 'x' }), ev('r1', 'error', 42), ev('old', 'chat-failed', 1)];
    const base = { since: 10, dismissed: new Set<string>(), muted: {}, dnd: false };
    const g = toastGroups(feed, base);
    expect(g.map(x => [x.kind, x.count])).toEqual([['chat-failed', 2], ['login', 1]]);
    expect(toastGroups(feed, { ...base, muted: { 'chat-failed': true } }).map(x => x.kind)).toEqual(['login', 'chat-waiting']);
    expect(toastGroups(feed, { ...base, muted: { 'chat-failed': true }, skipChats: new Set(['q']) }).map(x => x.kind)).toEqual(['login']);
    expect(toastGroups(feed, { ...base, dnd: true })).toEqual([]);
    // dismissed by event id: those events are gone, a later event of the same kind toasts again
    expect(toastGroups(feed, { ...base, dismissed: new Set(['e3', 'e2']) }).map(x => x.kind)).toEqual(['login', 'chat-waiting']);
    const later = [ev('e4', 'chat-failed', 35), ...feed];
    expect(toastGroups(later, { ...base, dismissed: new Set(['e3', 'e2']) }).map(x => [x.kind, x.count, x.ids])).toEqual([['chat-failed', 1, ['e4']], ['login', 1, ['d1']]]);
  });

  it('internal links', () => {
    expect(linkOfEvent(ev('1', 'error', 1, { chatId: 'qa' }))).toBe('sb://workspace/chat-qa');
    // ideas and reflections open Idee filtered by author (the AI's: "Dall'IA"), not the raw file
    expect(linkOfEvent(ev('7', 'idea', 1, { file: 'ideas.md', who: "dell'IA" }))).toBe('sb://idee/ia');
    expect(linkOfEvent(ev('8', 'idea', 1, { file: 'ideas.md', who: 'tua' }))).toBe('sb://idee/mie');
    expect(linkOfEvent(ev('9', 'reflection', 1, { file: 'ai-reflections.md', who: 'Regia' }))).toBe('sb://idee/ia');
    expect(linkOfEvent(ev('10', 'playbook', 1, { file: 'playbooks/x.md' }))).toBe('sb://esplora/playbooks/x.md');
    expect(parseLink('sb://esplora/ops/runbook/x.md')).toEqual({ page: 'esplora', element: 'ops/runbook/x.md' });
    expect(parseLink('sb://workspace/chat-qa')).toEqual({ page: 'workspace', element: 'chat-qa' });
    expect(parseLink(' sb://costi ')).toEqual({ page: 'costi', element: null });
    expect(parseLink('https://example.com')).toBeNull();
    expect(makeLink('idee', 'feed-1')).toBe('sb://idee/feed-1');
  });
});
