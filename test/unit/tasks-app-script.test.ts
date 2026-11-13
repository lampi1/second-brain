// The Task page's fallback reader (issue #95): a brain without ops/tools/devops-me.mjs is read by the app's own
// src/main/tasks/devops-me.mjs (TaskService appScript / default locate), the brain's script still wins when present,
// each good read is announced (onRead, for the Azure DevOps connector), and the script's pure helpers map Azure DevOps
// API rows into what model.ts accepts. No network, no az.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TaskService, appScript, SCRIPT } from '../../src/main/tasks/service';
import { itemOf, newsOf, prOf, prRefOf } from '../../src/main/tasks/model';
import type { RunResult } from '../../src/main/brain/node';
import type { TasksState } from '../../src/shared/contract';

const SRC = path.resolve(__dirname, '../../src/main/tasks/devops-me.mjs');
const ok = (o: unknown): RunResult => ({ stdout: JSON.stringify(o), stderr: '', code: 0 });
const settings = { enabled: false, everyMin: 30, sound: true };

function make(dir: string, run: (script: string, args: string[]) => Promise<RunResult>) {
  const scripts: string[] = [];
  const svc = new TaskService({ file: path.join(dir, 'tasks.json'), brainRoot: () => dir, settings: () => settings, emit: () => {}, feed: () => {},
    run: async (s, a) => { scripts.push(s); return run(s, a); } });
  return { svc, scripts };
}
const good = async (_s: string, a: string[]) => (a.includes('--prs') ? ok({ prs: [] }) : ok({ news: [], assigned: [], urgent: [], oldReviews: [] }));

describe('Task page fallback reader', () => {
  it('appScript finds the reader beside the service (out/tasks in a build), null elsewhere', () => {
    expect(appScript()).toBe(SRC);
    const fake = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-appscript-')), 'main', 'index.js');
    expect(appScript(pathToFileURL(fake).href)).toBeNull();
    expect(appScript('not a url')).toBeNull();
  });

  it('a fresh brain (no script of its own) is read by the app copy; the brain script wins when present', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-tasks-fresh-'));
    const fresh = make(dir, good);
    const s = await fresh.svc.refresh();
    expect(s.error).toBeNull();
    expect(fresh.scripts).toEqual([SRC, SRC]);
    fresh.svc.shutdown();
    fs.mkdirSync(path.join(dir, 'ops', 'tools'), { recursive: true });
    fs.writeFileSync(path.join(dir, SCRIPT), '// personal');
    const own = make(dir, good);
    await own.svc.refresh();
    expect(own.scripts).toEqual([path.join(dir, SCRIPT), path.join(dir, SCRIPT)]);
    own.svc.shutdown();
  });

  it('onRead hears each good read, never a failed one, and stops after unsubscribe', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-tasks-onread-'));
    let fail = false;
    const t = make(dir, async (s, a) => (fail ? { stdout: '', stderr: 'boom', code: 1 } : good(s, a)));
    const heard: TasksState[] = [];
    const off = t.svc.onRead(st => heard.push(st));
    t.svc.onRead(() => { throw new Error('a broken listener never breaks the read'); });
    expect((await t.svc.refresh()).error).toBeNull();
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ error: null });
    expect(heard[0]!.at).not.toBeNull();
    fail = true;
    expect((await t.svc.refresh()).error?.kind).toBe('failed');
    expect(heard).toHaveLength(1);
    fail = false; off();
    await t.svc.refresh();
    expect(heard).toHaveLength(1);
    t.svc.shutdown();
  });
});

describe('devops-me.mjs helpers', async () => {
  const m = await import(pathToFileURL(SRC).href) as Record<string, (...a: unknown[]) => unknown>;

  it('organizations: flag, env, brain.json, normalized, placeholder and junk dropped', () => {
    expect(m.configuredOrgs!(['--org', 'https://dev.azure.com/Ab/Shop'], { SB_DEVOPS_ORG: 'beta, Ab' }, JSON.stringify({ template: { DEVOPS_ORG: 'your-org' } })))
      .toEqual(['Ab', 'beta']);
    expect(m.configuredOrgs!([], {}, JSON.stringify({ template: { DEVOPS_ORG: 'gamma' } }))).toEqual(['gamma']);
    expect(m.configuredOrgs!([], {}, '{not json')).toEqual([]);
    expect(m.orgOf!('../evil')).toBeNull();
    expect(m.orgOf!('a b')).toBeNull();
  });

  it('days stay within 1..14 (3 by default); HTML descriptions become plain text', () => {
    expect([m.days!([]), m.days!(['--days', '40']), m.days!(['--days', '0']), m.days!(['--days', 'x'])]).toEqual([3, 14, 1, 3]);
    expect(m.plain!('<p>Uno &amp; due</p><div>tre<br>quattro</div>')).toBe('Uno & due\ntre\nquattro');
  });

  it('work items, PRs and news come out in the shape model.ts accepts, with encoded https links', () => {
    const w = { id: 7, rev: 3, fields: { 'System.TeamProject': 'My Shop', 'System.Title': 'Bug', 'System.State': 'Active', 'System.WorkItemType': 'Bug',
      'Microsoft.VSTS.Common.Priority': 1, 'System.AssignedTo': { displayName: 'Me', id: 'me' }, 'System.ChangedDate': '2026-10-19T10:00:00Z', 'System.ChangedBy': { displayName: 'Anna', id: 'a' } } };
    const item = m.itemOf!('o', w) as { url: string };
    expect(item.url).toBe('https://dev.azure.com/o/My%20Shop/_workitems/edit/7');
    expect(itemOf(item)).toMatchObject({ id: 7, priority: 1, assignedTo: 'Me', project: 'My Shop' });
    const n = m.changeNews!('touched', 'o', w);
    expect(newsOf(n)).toMatchObject({ kind: 'touched', who: 'Anna', key: 'touched:o:7:3' });
    const pr = { pullRequestId: 5, title: 'Fix', creationDate: '2026-10-19T09:00:00Z', createdBy: { displayName: 'Bob', id: 'b' }, repository: { name: 'web', project: { name: 'Shop' } }, reviewers: [{ id: 'me', vote: 0 }] };
    expect(prRefOf(m.prRefOf!('o', pr))).toMatchObject({ id: 5, repo: 'web', author: 'Bob', url: 'https://dev.azure.com/o/Shop/_git/web/pullrequest/5' });
    expect(prOf({ ...(m.prRefOf!('o', pr) as object), reviewers: [], workItems: [] })).not.toBeNull();
    const since = Date.parse('2026-10-19T00:00:00Z');
    const voted = { ...pr, pullRequestId: 6, reviewers: [{ id: 'me', vote: 10 }] };
    const old = { ...pr, pullRequestId: 8, creationDate: '2026-10-01T00:00:00Z' };
    const own = { ...pr, pullRequestId: 9, createdBy: { id: 'me' } };
    const split = m.splitReviews!('o', [pr, voted, old, own], 'me', since) as { news: { key: string }[]; oldReviews: { id: number }[] };
    expect(split.news.map(x => x.key)).toEqual(['review:o:5']);
    expect(split.oldReviews.map(x => x.id)).toEqual([8]);
    expect(newsOf(split.news[0])).not.toBeNull();
  });
});
