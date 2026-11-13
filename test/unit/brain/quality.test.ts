// The app's half of the Qualità page (src/main/brain/quality.ts): finished turns per Rome day from the app's JSONL
// logs, why a PR is held (build, QA test case, reviewer vote), the bug-reopen.mjs result (parsed defensively, cached,
// refreshed in the background at most every 12 h and only while DevOps reading is on), and its login error.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseReopen, prBlocks, prReasons, Quality, reopenError, REOPEN_RETRY_MS, REOPEN_SCRIPT, REOPEN_TTL_MS, turnsByDay, type QualityDeps } from '../../../src/main/brain/quality';
import type { DevopsDetail, DevopsPr } from '../../../src/shared/contract';
import type { RunResult } from '../../../src/main/brain/node';
import { tmpDir } from './helpers';

const line = (t: string, msg: string, data: object = {}) => JSON.stringify({ t, lvl: 'info', scope: 'chats', msg, chat: 'c_1', data });

describe('turnsByDay', () => {
  it('counts Claude and Cursor finished turns per Rome day, skipping other lines and broken JSON', () => {
    const rows = turnsByDay([
      line('2026-10-11T09:00:00Z', 'turn done'),
      line('2026-10-11T21:59:00Z', 'turn done'),          // 23:59 in Rome: still the 11th
      line('2026-10-11T22:30:00Z', 'cursor turn done'),   // 00:30 in Rome: the 12th (the line before ADR 0046)
      line('2026-10-12T09:00:00Z', 'acp turn done', { engine: 'cursor' }),
      line('2026-10-12T09:30:00Z', 'acp turn done', { engine: 'kimi' }), // another ACP engine: not Cursor's
      line('2026-10-12T08:00:00Z', 'session started'),
      '{"msg":"turn done", broken',
      line('nope', 'turn done'),
      '',
    ]);
    expect(rows).toEqual([{ date: '2026-10-11', claude: 2, cursor: 0 }, { date: '2026-10-12', claude: 0, cursor: 2 }]);
  });
});

const pr = (over: Partial<DevopsPr> = {}): DevopsPr => ({
  id: 1, title: 'Fix', repo: 'app', project: 'p', author: 'Mario', createdAt: '', url: 'https://dev.azure.com/x/pr/1', target: 'master', draft: false, autoComplete: false,
  reviewers: [], build: null, workItems: [], ...over,
});
const item = (id: number) => ({ id, type: 'Bug', title: 'b', state: 'Active', project: 'p', priority: 2, assignedTo: null, iteration: null, changedAt: null, url: `https://dev.azure.com/x/${id}` });
const detail = (tests: DevopsDetail['tests']): DevopsDetail => ({ description: null, stateSince: null, createdAt: null, comments: [], tests });

describe('PRs held by QA or a build', () => {
  it('names every reason once: failed build, failed/blocked test case, a rejecting or waiting reviewer (not the author)', () => {
    const p = pr({
      build: { result: 'failed', status: 'completed', number: '1', url: '', at: null },
      workItems: [item(10), item(11)],
      reviewers: [{ name: 'Paolo', vote: -10, label: '', required: false }, { name: 'Anna', vote: -5, label: '', required: false }, { name: 'Mario', vote: -10, label: '', required: false }, { name: 'Bruno', vote: 10, label: '', required: false }],
    });
    const details = { 10: detail([{ id: 1, title: 'Sconto', outcome: 'Failed', url: '' }, { id: 2, title: 'Ok', outcome: 'Passed', url: '' }]), 11: detail([{ id: 3, title: 'Stampa', outcome: 'Blocked', url: '' }, { id: 1, title: 'Sconto', outcome: 'Failed', url: '' }]) };
    expect(prReasons(p, details)).toEqual(['build fallita', 'test case fallito: Sconto', 'test case bloccato: Stampa', 'rifiutata da Paolo', 'Anna aspetta tue modifiche']);
    expect(prReasons(pr({ build: { result: 'partiallySucceeded', status: 'completed', number: '1', url: '', at: null } }), {})).toEqual(['build parzialmente fallita']);
  });

  it('keeps only the held ones', () => {
    const ok = pr({ id: 2, build: { result: 'succeeded', status: 'completed', number: '1', url: '', at: null }, reviewers: [{ name: 'Bruno', vote: 5, label: '', required: false }] });
    const held = pr({ id: 3, build: { result: 'failed', status: 'completed', number: '1', url: '', at: null } });
    expect(prBlocks([ok, held, pr({ id: 4 })], {}).map(p => p.id)).toEqual([3]);
  });
});

describe('bug-reopen result', () => {
  it('parses defensively: numbers, strings, https links only', () => {
    const r = parseReopen(JSON.stringify({ at: '2026-10-13T08:00:00Z', days: 90, resolved: 10, reopened: 1, bugs: [
      { id: 7, title: 'Bug', state: 'Active', url: 'javascript:alert(1)', reopened: [{ resolvedAt: 'a', reopenedAt: 'b', by: 'QA', to: 'Active' }, 'junk'] }, 'junk'] }));
    expect(r).toEqual({ at: '2026-10-13T08:00:00Z', days: 90, resolved: 10, reopened: 1, bugs: [{ id: 7, title: 'Bug', state: 'Active', url: '', reopened: [{ resolvedAt: 'a', reopenedAt: 'b', by: 'QA', to: 'Active' }] }] });
    expect(parseReopen('{}')).toMatchObject({ at: null, days: 90, resolved: 0, bugs: [] });
    expect(() => parseReopen('not json')).toThrow();
  });

  it('a login failure says to run az login; anything else shows its stderr', () => {
    expect(reopenError({ stdout: '', stderr: 'Accesso scaduto', code: 2 })).toMatch(/az login/);
    expect(reopenError({ stdout: '', stderr: 'boom 500', code: 1 })).toMatch(/fallita: boom 500/);
  });
});

describe('Quality service', () => {
  const NOW = Date.parse('2026-10-13T10:00:00Z');
  function setup(over: Partial<QualityDeps> = {}, opts: { script?: boolean; enabled?: boolean } = {}) {
    const dir = tmpDir(), root = tmpDir();
    const logDir = path.join(dir, 'logs');
    fs.mkdirSync(logDir);
    fs.writeFileSync(path.join(logDir, 'app-2026-10-12.jsonl'), [line('2026-10-12T09:00:00Z', 'turn done'), line('2026-10-12T10:00:00Z', 'cursor turn done')].join('\n'));
    fs.writeFileSync(path.join(logDir, 'app-2026-10-13.jsonl'), line('2026-10-13T08:00:00Z', 'session started'));
    fs.writeFileSync(path.join(logDir, 'other.txt'), 'x');
    if (opts.script !== false) { fs.mkdirSync(path.join(root, 'ops', 'tools'), { recursive: true }); fs.writeFileSync(path.join(root, REOPEN_SCRIPT), '// fake'); }
    const calls: string[][] = [];
    let answer: RunResult = { stdout: JSON.stringify({ at: new Date(NOW).toISOString(), days: 90, resolved: 4, reopened: 1, bugs: [] }), stderr: '', code: 0 };
    const held = pr({ build: { result: 'failed', status: 'completed', number: '1', url: '', at: null } });
    const deps: QualityDeps = {
      logDir, cacheFile: path.join(dir, 'quality-reopen.json'), brainRoot: () => root, now: () => NOW,
      tasks: () => ({ at: NOW - 6e4, prs: [held, pr({ id: 9 })], details: {}, error: null, enabled: opts.enabled !== false }),
      run: async (script, args) => { calls.push([script, ...args]); return answer; },
      ...over,
    };
    return { q: new Quality(deps), deps, calls, setAnswer: (r: RunResult) => { answer = r; } };
  }

  it('turns from the log files (covered range = the files\' days in Rome time), PRs from the DevOps read', () => {
    const { q, deps } = setup();
    // the oldest file misses its first Rome hours (they were in a deleted file): the range starts the day after
    fs.writeFileSync(path.join(deps.logDir, 'app-2026-10-11.jsonl'), line('2026-10-11T08:00:00Z', 'turn done'));
    const r = q.get();
    expect(r.turns).toEqual({ from: '2026-10-12', to: '2026-10-13', byDay: [{ date: '2026-10-12', claude: 1, cursor: 1 }] });
    // a turn after 22:00 UTC in the newest file is the next Rome day: the range ends there
    fs.appendFileSync(path.join(deps.logDir, 'app-2026-10-13.jsonl'), '\n' + line('2026-10-13T22:30:00Z', 'turn done'));
    expect(q.get().turns).toMatchObject({ from: '2026-10-12', to: '2026-10-14' });
    expect(r.prs).toMatchObject({ total: 2, error: null, at: NOW - 6e4 });
    expect(r.prs.blocked.map(b => b.reasons)).toEqual([['build fallita']]);
  });

  it('no cache: starts one background read (refreshing), caches it, then serves the cache without reading again', async () => {
    const { q, calls, deps } = setup();
    expect(q.get().reopen).toMatchObject({ at: null, refreshing: true });
    expect(q.get().reopen.refreshing).toBe(true);
    await q.idle();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.slice(1)).toEqual(['--json', '--days', '90']);
    expect(q.get().reopen).toMatchObject({ resolved: 4, reopened: 1, refreshing: false, error: null });
    expect(fs.existsSync(deps.cacheFile)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('an old cache is shown while a new read runs', async () => {
    const { q, deps, calls } = setup();
    fs.writeFileSync(deps.cacheFile, JSON.stringify({ at: new Date(NOW - REOPEN_TTL_MS - 1).toISOString(), resolved: 2, reopened: 2, bugs: [] }));
    expect(q.get().reopen).toMatchObject({ resolved: 2, refreshing: true });
    await q.idle();
    expect(calls).toHaveLength(1);
    expect(q.get().reopen.resolved).toBe(4);
  });

  it('a failed read keeps the cache and says why (az login expired → the command), and waits before trying again', async () => {
    let now = NOW;
    const { q, deps, setAnswer, calls } = setup({ now: () => now });
    fs.writeFileSync(deps.cacheFile, JSON.stringify({ at: '2026-01-01T00:00:00Z', resolved: 2, reopened: 0, bugs: [] }));
    setAnswer({ stdout: '', stderr: 'Accesso ad Azure DevOps scaduto', code: 2 });
    q.get();
    await q.idle();
    expect(q.get().reopen).toMatchObject({ resolved: 2, refreshing: false, error: expect.stringMatching(/az login/) });
    expect(calls).toHaveLength(1); // no new read right after a failure
    q.get({ fresh: true }); // Aggiorna after az login: reads now
    await q.idle();
    expect(calls).toHaveLength(2);
    setAnswer({ stdout: 'not json', stderr: '', code: 0 });
    now += REOPEN_RETRY_MS + 1;
    q.get();
    await q.idle();
    expect(calls).toHaveLength(3); // non-JSON never reaches the cache
    expect(JSON.parse(fs.readFileSync(deps.cacheFile, 'utf8')).resolved).toBe(2);
    expect(q.get().reopen.error).toMatch(/fallita/);
  });

  it('never reads DevOps while DevOps reading is off, nor without the script', async () => {
    const off = setup({}, { enabled: false });
    expect(off.q.get().reopen).toMatchObject({ refreshing: false, error: expect.stringMatching(/spenta/) });
    expect(off.calls).toHaveLength(0);
    const noScript = setup({}, { script: false });
    expect(noScript.q.get().reopen.error).toMatch(/manca ops\/tools\/bug-reopen\.mjs/);
    expect(noScript.calls).toHaveLength(0);
  });

  it('no log folder: no turns, no range', () => {
    const { q } = setup({ logDir: path.join(tmpDir(), 'missing') });
    expect(q.get().turns).toEqual({ from: null, to: null, byDay: [] });
  });
});
