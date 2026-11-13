// DevOps alerts (ADR 0029): which new news interrupt the user (a mention, a change on his items or PRs, a state or
// assignee change on a followed ticket; never a review on someone else's PR or a comment-only followed change), the
// dedupe by key across reads and restarts, the first read as a silent baseline (also for a tasks.json from before the
// alerts), the renderer's policy (task-alert toasts and counts for the bell, plain devops news stay quiet) and when
// the chime plays.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alertEvents, alertsFor, isAlert, MAX_NOTIFIED, type StoredNews } from '../../src/main/tasks/model';
import { TaskService } from '../../src/main/tasks/service';
import type { RunResult } from '../../src/main/brain/node';
import type { FeedInput } from '../../src/main/services';
import { isActionable, sectionOf, tierOf } from '../../src/renderer/lib/notify';
import { toChime } from '../../src/renderer/lib/chime';

const NOW = Date.parse('2026-10-13T10:00:00Z');
const iso = (min: number) => new Date(NOW - min * 60_000).toISOString();
const n = (key: string, kind: StoredNews['kind'], detail?: string): StoredNews =>
  ({ key, at: iso(5), kind, who: 'Giulia', title: `Titolo ${key}`, url: `https://dev.azure.com/x/${key}`, ...(detail ? { detail } : {}) });

describe('isAlert', () => {
  it('mentions and changes on my things interrupt; reviews for others and comment-only followed changes do not', () => {
    for (const k of ['mention', 'touched', 'taken', 'comment', 'vote', 'build'] as const) expect(isAlert(n('k', k))).toBe(true);
    expect(isAlert(n('r', 'review'))).toBe(false);
    expect(isAlert(n('f1', 'followed', 'stato Active → Resolved'))).toBe(true);
    expect(isAlert(n('f2', 'followed', 'assegnato a Marco'))).toBe(true);
    expect(isAlert(n('f3', 'followed', 'commento: "ok, lo guardo"'))).toBe(false);
    expect(isAlert(n('f4', 'followed', 'commento: "il cliente dice: stato pessimo"'))).toBe(false);
    expect(isAlert(n('f5', 'followed', 'commento: "x" · stato New → Active'))).toBe(false); // the script puts state first
    expect(isAlert(n('f6', 'followed', 'stato New → Active · commento: "x"'))).toBe(true);
  });
});

describe('alertsFor', () => {
  it('first read = baseline: nothing interrupts, every key is remembered', () => {
    const r = alertsFor([n('mention:1', 'mention'), n('review:2', 'review')], [], true);
    expect(r.alerts).toEqual([]);
    expect(r.notified).toEqual(['mention:1', 'review:2']);
  });
  it('only alert kinds never seen before; the same key never twice; a new revision of the same item is new', () => {
    const r = alertsFor([n('mention:1', 'mention'), n('touched:7:3', 'touched'), n('touched:7:4', 'touched'), n('review:2', 'review'), n('mention:1', 'mention')], ['mention:1', 'touched:7:3'], false);
    expect(r.alerts.map(a => a.key)).toEqual(['touched:7:4']);
    expect(new Set(r.notified)).toEqual(new Set(['mention:1', 'touched:7:3', 'touched:7:4', 'review:2']));
  });
  it('keeps at most MAX_NOTIFIED keys, dropping the oldest; a key seen again stays', () => {
    const old = Array.from({ length: MAX_NOTIFIED }, (_, i) => `k${i}`);
    const r = alertsFor([n('k0', 'mention'), n('new', 'mention')], old, false);
    expect(r.alerts.map(a => a.key)).toEqual(['new']);
    expect(r.notified).toHaveLength(MAX_NOTIFIED);
    expect(r.notified).toContain('k0');
    expect(r.notified).not.toContain('k1');
  });
});

describe('alertEvents', () => {
  it('one task-alert per news with title and link, a summary above three', () => {
    expect(alertEvents([n('mention:1', 'mention')])).toEqual([{ kind: 'task-alert', title: 'Giulia ti menziona: Titolo mention:1', detail: 'https://dev.azure.com/x/mention:1' }]);
    const many = alertEvents(['a', 'b', 'c', 'd'].map(k => n(k, 'vote', 'approvata')));
    expect(many).toHaveLength(1);
    expect(many[0]).toMatchObject({ kind: 'task-alert', title: '4 novità per te su DevOps' });
    expect(alertEvents([])).toEqual([]);
  });
});

describe('TaskService alerts', () => {
  const ok = (o: unknown): RunResult => ({ stdout: JSON.stringify(o), stderr: '', code: 0 });
  function make(dir: string, reads: StoredNews[][]) {
    const feed: FeedInput[][] = [];
    let i = 0;
    const svc = new TaskService({
      file: path.join(dir, 'tasks.json'), brainRoot: () => dir, settings: () => ({ enabled: false, everyMin: 30, sound: true }), locate: () => 'devops-me.mjs',
      run: async (_s, a) => (a.includes('--prs') ? ok({ prs: [] }) : ok({ news: reads[Math.min(i++, reads.length - 1)], assigned: [] })),
      emit: () => {}, feed: e => feed.push(e), now: () => NOW, repoDir: () => null,
    });
    return { svc, feed, alerts: () => feed.flat().filter(e => e.kind === 'task-alert') };
  }
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-task-alerts-'));

  it('baseline, then only new changes on my things alert, never twice, also after a restart', async () => {
    const dir = tmp();
    const t = make(dir, [[n('mention:1', 'mention')], [n('mention:1', 'mention'), n('mention:2', 'mention'), n('review:9', 'review')]]);
    await t.svc.refresh();
    expect(t.alerts()).toEqual([]);                        // first read: no flood
    await t.svc.refresh();
    expect(t.alerts().map(e => e.title)).toEqual(['Giulia ti menziona: Titolo mention:2']);
    // the review stays quiet (center list only), the alerted mention is not said twice
    expect(t.feed.flat().filter(e => e.kind === 'task').map(e => e.title)).toEqual(['Giulia ti menziona: Titolo mention:1', 'Giulia ti chiede una review: Titolo review:9']);
    t.svc.shutdown();
    // a restart reads tasks.json: the same news again never alert
    const again = make(dir, [[n('mention:1', 'mention'), n('mention:2', 'mention')]]);
    await again.svc.refresh();
    expect(again.alerts()).toEqual([]);
    again.svc.shutdown();
  });

  it('a news that dropped out of the 14 days and comes back never alerts again', async () => {
    const dir = tmp();
    const t = make(dir, [[n('a', 'mention')], [n('vote:1:1:10', 'vote')]]);
    await t.svc.refresh(); await t.svc.refresh();
    expect(t.alerts()).toHaveLength(1);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')) as { news: unknown[]; notified: string[] };
    fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ ...saved, news: [] })); // the list forgot it
    t.svc.shutdown();
    const again = make(dir, [[n('vote:1:1:10', 'vote')]]);
    await again.svc.refresh();
    expect(again.alerts()).toEqual([]);
    again.svc.shutdown();
  });

  it('a tasks.json from before the alerts: what it lists is the baseline', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ lastOk: NOW - 60_000, news: [n('mention:1', 'mention')], read: [] }));
    const t = make(dir, [[n('mention:1', 'mention'), n('mention:3', 'mention')]]);
    await t.svc.refresh();
    expect(t.alerts().map(e => e.title)).toEqual(['Giulia ti menziona: Titolo mention:3']);
    t.svc.shutdown();
  });

  it('repoDirs: the PRs\' repos with a local clone, unsafe names never looked up', async () => {
    const dir = tmp();
    const asked: string[] = [];
    const pr = (id: number, repo: string) => ({ id, title: 'T', repo, project: 'P', author: null, createdAt: iso(60), url: `https://dev.azure.com/x/P/_git/${repo}/pullrequest/${id}`,
      target: 'main', draft: false, autoComplete: false, reviewers: [], build: null, workItems: [] });
    const svc = new TaskService({
      file: path.join(dir, 'tasks.json'), brainRoot: () => dir, settings: () => ({ enabled: false, everyMin: 30, sound: false }), locate: () => 'x',
      run: async (_s, a) => (a.includes('--prs') ? ok({ prs: [pr(1, 'shop-web'), pr(2, 'nope'), pr(3, '..')] }) : ok({ news: [], assigned: [] })),
      emit: () => {}, feed: () => {}, now: () => NOW, repoDir: r => { asked.push(r); return r === 'shop-web' ? 'C:/src/shop-web' : null; },
    });
    const s = await svc.refresh();
    expect(s.repoDirs).toEqual({ 'shop-web': 'C:/src/shop-web' });
    expect(s.sound).toBe(false);
    svc.get(); svc.get();
    expect(asked.sort()).toEqual(['nope', 'shop-web']); // each repo looked up once
    svc.shutdown();
  });
});

describe('renderer policy', () => {
  it('task-alert toasts and counts for the bell; plain devops news stay quiet; both lead to the Task page', () => {
    expect(tierOf('task-alert')).toBe('toast');
    expect(isActionable({ kind: 'task-alert' })).toBe(true);
    expect(tierOf('task')).toBe('quiet');
    expect(isActionable({ kind: 'task' })).toBe(false);
    expect(sectionOf('task-alert')).toBe('task');
  });
  it('the chime plays once per arriving DevOps alert; never with the sound off, the kind muted, do-not-disturb or from while closed', () => {
    const evs = [{ id: 'a', kind: 'task-alert' }, { id: 'b', kind: 'task-alert' }, { id: 'c', kind: 'chat-waiting' }, { id: 'd', kind: 'task-alert', away: true }];
    const on = { soundOn: true, muted: {}, dnd: false };
    expect(toChime(evs, new Set(), on)).toEqual(['a', 'b']);
    expect(toChime(evs, new Set(['a', 'b']), on)).toEqual([]);
    expect(toChime(evs, new Set(), { ...on, soundOn: false })).toEqual([]);
    expect(toChime(evs, new Set(), { ...on, muted: { 'task-alert': true } })).toEqual([]);
    expect(toChime(evs, new Set(), { ...on, dnd: true })).toEqual([]);
  });
});
