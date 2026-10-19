// The Task page's local rules (src/renderer/brain/lib/tasks.ts): who a PR waits for (most blocking reason first),
// "fermo" days, the test outcomes in one line, work items in state order, names and avatars from DevOps' name formats.
import { describe, expect, it } from 'vitest';
import type { DevopsItem, DevopsPr } from '../../../src/shared/contract';
import { byState, daysSince, firstName, initials, lastComment, prWait, sinceLabel, stuckDays, testSummary } from '../../../src/renderer/brain/lib/tasks';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 864e5).toISOString();
const pr = (o: Partial<DevopsPr> = {}): DevopsPr => ({ id: 1, title: 'PR', repo: 'r', project: 'p', author: null, createdAt: daysAgo(1), url: 'https://x', target: 'master',
  draft: false, autoComplete: true, reviewers: [{ name: 'Giulia Bianchi', vote: 10, label: 'approvata', required: true }],
  build: { result: 'succeeded', status: 'completed', number: '1', url: 'https://x/b', at: null }, workItems: [], ...o });
const wi = (id: number, state: string, priority: number | null, changedDays: number, type = 'Bug'): DevopsItem =>
  ({ id, type, title: `W${id}`, state, project: 'p', priority, assignedTo: null, iteration: null, changedAt: daysAgo(changedDays), url: 'https://x' });

describe('Task page rules', () => {
  it('says who a PR waits for, the most blocking reason first', () => {
    expect(prWait(pr())).toMatchObject({ who: 'none', tone: 'good', text: 'Pronta: si chiude da sola' });
    expect(prWait(pr({ autoComplete: false })).who).toBe('me');
    expect(prWait(pr({ draft: true })).text).toBe('Bozza: la pubblichi tu');
    expect(prWait(pr({ build: { result: 'failed', status: 'completed', number: '1', url: 'https://x', at: null } }))).toMatchObject({ who: 'me', tone: 'bad', text: 'Aspetta te: build fallita' });
    expect(prWait(pr({ reviewers: [{ name: 'Verdi, Marco <x\\y>', vote: -5, label: '', required: false }] })).text).toBe('Aspetta te: Marco chiede modifiche');
    expect(prWait(pr({ activeThreads: 2 })).text).toBe('Aspetta te: 2 commenti da risolvere');
    expect(prWait(pr({ reviewers: [{ name: 'QA Team', vote: 0, label: '', required: true }, { name: 'Giulia Bianchi', vote: 10, label: '', required: false }] })))
      .toMatchObject({ who: 'others', text: 'Aspetta il voto di QA' });
    expect(prWait(pr({ reviewers: [] })).text).toBe('Aspetta una prima approvazione');
    expect(prWait(pr({ reviewers: [{ name: 'A', vote: -10, label: '', required: true }], build: { result: 'failed', status: 'completed', number: '1', url: 'https://x', at: null } })).text).toBe('Aspetta te: rifiutata da A');
  });

  it('counts days and calls a work item "fermo" from 3 days without changes', () => {
    expect(daysSince(daysAgo(2.5), NOW)).toBe(2);
    expect(daysSince('nope', NOW)).toBeNull();
    expect(sinceLabel(0)).toBe('da oggi');
    expect(sinceLabel(1)).toBe('da ieri');
    expect(sinceLabel(4)).toBe('da 4 giorni');
    expect(stuckDays(wi(1, 'Active', 2, 2), NOW)).toBeNull();
    expect(stuckDays(wi(1, 'Active', 2, 4), NOW)).toBe(4);
  });

  it('sums the test cases with the worst outcome as tone', () => {
    const t = (outcome: string | null) => ({ id: 1, title: 't', outcome, url: 'https://x' });
    expect(testSummary([])).toBeNull();
    expect(testSummary([t('Passed'), t('Passed')])).toMatchObject({ tone: 'good', text: '2 test: 2 passati' });
    expect(testSummary([t('Passed'), t('Failed'), t(null)])).toMatchObject({ tone: 'bad', text: '3 test: 1 passato, 1 fallito, 1 da eseguire' });
    expect(testSummary([t('Blocked')])!.tone).toBe('warn');
  });

  it('orders work items by state (working first), then priority, then the longest still', () => {
    const g = byState([wi(1, 'New', 3, 1), wi(2, 'Active', 3, 1), wi(3, 'Active', 2, 1), wi(4, 'Active', 2, 9), wi(5, 'Weird', 1, 1)]);
    expect(g.map(x => x.state)).toEqual(['Active', 'New', 'Weird']);
    expect(g[0]!.items.map(w => w.id)).toEqual([4, 3, 2]);
  });

  it('reads DevOps names and picks the last comment of someone else', () => {
    expect(firstName('Neri, Anna <guid\\anna@x>')).toBe('Anna');
    expect(firstName('Giulia Bianchi')).toBe('Giulia');
    expect(initials('Neri, Anna <x>')).toBe('AN');
    expect(initials('')).toBe('?');
    const c = (who: string, mine: boolean) => ({ who, mine, at: daysAgo(0), text: who });
    expect(lastComment({ description: null, stateSince: null, createdAt: null, tests: [], comments: [c('me', true), c('Sara', false)] })!.who).toBe('Sara');
    expect(lastComment({ description: null, stateSince: null, createdAt: null, tests: [], comments: [c('me', true)] })!.who).toBe('me');
    expect(lastComment(undefined)).toBeNull();
  });
});
