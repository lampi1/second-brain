// The "Stato" view's aggregation (src/renderer/lib/stato.ts) and the git branch read behind it (src/main/chats/branch.ts):
// open chats only, the ones waiting for the user first, their questions/permissions/commands by text, branches by
// folder; PRs named after their bug, QA-blocked first (failed or blocked test cases), then those waiting for the user;
// the one-line headline; HEAD parsed for a branch, a worktree's .git file followed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatSummary, DevopsPr, TasksState, PendingRequest } from '../../src/shared/contract';
import { askText, buildStato, headline, prName, qaBlock, statoChats, statoPrs, type StatoInput } from '../../src/renderer/lib/stato';
import { gitBranch, gitBranches, headOf } from '../../src/main/chats/branch';

const chat = (id: string, o: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: `Chat ${id}`, cwd: `C:\\repo\\${id}`, sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: 1000, browserTabIds: [], ...o,
});
const req = (chatId: string, id: string, o: Partial<PendingRequest> = {}): PendingRequest =>
  ({ id, chatId, type: 'permission', tool: 'Bash', title: 'Eseguire npm test?', detail: 'npm test', input: {}, at: 1, ...o }) as PendingRequest;
const input = (chats: ChatSummary[], o: Partial<StatoInput> = {}): StatoInput => ({
  chats: Object.fromEntries(chats.map(c => [c.id, c])), order: chats.map(c => c.id), pending: [], branches: {}, tasks: null, ...o,
});
const wi = (id: number, type: string, title: string) => ({ id, type, title, state: 'Active', project: 'P', priority: 2, assignedTo: null, iteration: null, changedAt: null, url: `https://x/${id}` });
const pr = (id: number, o: Partial<DevopsPr> = {}): DevopsPr => ({
  id, title: `feat: PR ${id}`, repo: 'shop', project: 'P', author: 'Me', createdAt: '2026-10-01T00:00:00Z', url: `https://x/pr/${id}`,
  target: 'main', draft: false, autoComplete: false, reviewers: [], build: null, workItems: [], ...o,
});
const devops = (prs: DevopsPr[], details: TasksState['details'] = {}): TasksState => ({
  enabled: false, everyMin: 30, sound: true, running: false, at: 5000, nextAt: null, error: null, news: [], assigned: [], urgent: [], oldReviews: [], reviews: [], prs, details, unread: 0, qa: [], qaError: null, repoDirs: {},
});

describe('statoChats', () => {
  it('keeps only open chats, the waiting ones first, then errors, working, finished; the Regia last among equals', () => {
    const rows = statoChats(input([
      chat('done', { updatedAt: 9 }), chat('run', { state: 'running' }), chat('wait', { state: 'waiting', pending: 1 }),
      chat('err', { state: 'error', lastError: 'crash', lastText: 'old' }), chat('closed', { closedAt: 5 }), chat('gone', { state: 'closed' }),
      chat('regia', { isRegia: true, regiaName: 'Lavoro', updatedAt: 99 }), chat('hidden'),
    ], { hidden: ['hidden'] }));
    expect(rows.map(r => r.id)).toEqual(['wait', 'err', 'run', 'done', 'regia']);
    expect(rows.find(r => r.id === 'err')!.lastLine).toBe('crash');
    expect(rows.find(r => r.id === 'regia')!.name).toBe('Orchestrator · Lavoro');
  });
  it('lists what waits for the user by text (the question itself) and counts a command to run as waiting', () => {
    const q = req('a', 'q1', { type: 'question', title: 'Domanda', questions: [{ question: 'Quale ramo uso?', options: [], multiSelect: false }] });
    const cmd = req('b', 'c1', { type: 'command', title: 'Esegui npm run check' });
    const rows = statoChats(input([chat('a', { pending: 1, state: 'waiting' }), chat('b')], { pending: [q, cmd] }));
    expect(rows.find(r => r.id === 'a')!.asks.map(a => a.text)).toEqual(['Quale ramo uso?']);
    const b = rows.find(r => r.id === 'b')!;
    expect(b.asks.map(a => [a.kind, a.text])).toEqual([['command', 'Esegui npm run check']]);
    expect(b.state.tone).toBe('wait');
  });
  it('shows the folder name and its branch', () => {
    const [r] = statoChats(input([chat('a', { cwd: 'C:\\wt\\stato\\' })], { branches: { 'C:\\wt\\stato\\': 'feat/stato' } }));
    expect([r!.folder, r!.branch]).toEqual(['stato', 'feat/stato']);
  });
  it('askText falls back to the title and cuts long text to one line', () => {
    expect(askText(req('a', '1', { title: 'Scrivere\nfile.ts?' }))).toBe('Scrivere file.ts?');
    expect(askText(req('a', '1', { title: 'x'.repeat(300) })).length).toBe(160);
  });
});

describe('PRs', () => {
  it('a PR is named after its bug, else after its cleaned title', () => {
    expect(prName(pr(1, { workItems: [wi(7, 'Task', 'Task'), wi(8, 'Bug', '[Resi] - Rimborso sbagliato')] }))).toBe('Rimborso sbagliato');
    expect(prName(pr(2))).toBe('PR 2');
  });
  it('QA-blocked = a linked work item with failed or blocked test cases', () => {
    const p = pr(1, { workItems: [wi(8, 'Bug', 'Rimborso sbagliato'), wi(9, 'Bug', 'SMS doppio')] });
    const t = (id: number, outcome: string | null) => ({ id, title: 't', outcome, url: 'https://x' });
    const details = { 8: { description: null, stateSince: null, createdAt: null, comments: [], tests: [t(1, 'Failed'), t(2, 'Passed'), t(3, 'Blocked')] },
      9: { description: null, stateSince: null, createdAt: null, comments: [], tests: [t(4, 'Passed')] } };
    expect(qaBlock(p, details)).toBe('Rimborso sbagliato: 1 test fallito, 1 test bloccato');
    expect(qaBlock(p, details, 'Rimborso sbagliato')).toBe('1 test fallito, 1 test bloccato');
    expect(qaBlock(p, {})).toBeNull();
  });
  it('QA-blocked first, then the ones waiting for the user; build and votes in words', () => {
    const t = { id: 1, title: 't', outcome: 'Failed', url: 'https://x' };
    const d = devops([
      pr(1, { reviewers: [{ name: 'Rossi, Giulia <g@x>', vote: 0, label: '', required: true }] }),
      pr(2, { build: { result: 'failed', status: 'completed', number: '1', url: 'https://x/b', at: null } }),
      pr(3, { workItems: [wi(8, 'Bug', 'Rimborso')], reviewers: [{ name: 'Sara Neri', vote: 10, label: '', required: false }] }),
    ], { 8: { description: null, stateSince: null, createdAt: null, comments: [], tests: [t] } });
    const rows = statoPrs(d);
    expect(rows.map(r => r.id)).toEqual([3, 2, 1]);
    expect(rows[1]!.build).toMatchObject({ label: 'build fallita', tone: 'bad' });
    expect(rows[2]!.reviewers).toEqual([{ name: 'Giulia', vote: 'non ha votato', tone: 'outline', required: true }]);
    expect(rows[0]!.reviewers[0]).toMatchObject({ name: 'Sara', vote: 'approvata' });
    expect(statoPrs(null)).toEqual([]);
  });
});

describe('headline', () => {
  it('says chats and PRs in one sentence', () => {
    const t = { id: 1, title: 't', outcome: 'Failed', url: 'https://x' };
    const s = buildStato(input([chat('a', { state: 'waiting', pending: 1 }), chat('b', { state: 'running' })], {
      tasks: devops([pr(1, { workItems: [wi(8, 'Bug', 'x')] }), pr(2)], { 8: { description: null, stateSince: null, createdAt: null, comments: [], tests: [t] } }),
    }));
    expect(headline(s)).toBe('1 chat ti aspetta, 1 al lavoro · 2 PR aperte: 1 bloccata dalla QA');
    expect(s.counts).toMatchObject({ waiting: 1, running: 1, prs: 2, qa: 1 });
  });
  it('without a DevOps read it speaks only of the chats', () => {
    expect(headline(buildStato(input([chat('a')])))).toBe('nessuna chat ti aspetta');
    expect(headline(buildStato(input([])))).toBe('nessuna chat aperta');
  });
});

describe('git branch from disk', () => {
  it('reads HEAD: a branch, a detached sha, nothing', () => {
    expect(headOf('ref: refs/heads/feat/stato\n')).toBe('feat/stato');
    expect(headOf('9a4bd30c1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b')).toBe('9a4bd30');
    expect(headOf('')).toBeNull();
    expect(headOf(null)).toBeNull();
  });
  it('walks up to .git and follows a worktree .git file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-branch-'));
    try {
      fs.mkdirSync(path.join(root, 'main', '.git', 'worktrees', 'wt'), { recursive: true });
      fs.writeFileSync(path.join(root, 'main', '.git', 'HEAD'), 'ref: refs/heads/main\n');
      fs.writeFileSync(path.join(root, 'main', '.git', 'worktrees', 'wt', 'HEAD'), 'ref: refs/heads/feat/x\n');
      fs.mkdirSync(path.join(root, 'main', 'src', 'deep'), { recursive: true });
      fs.mkdirSync(path.join(root, 'wt'));
      fs.writeFileSync(path.join(root, 'wt', '.git'), `gitdir: ${path.join(root, 'main', '.git', 'worktrees', 'wt')}\n`);
      expect(gitBranch(path.join(root, 'main', 'src', 'deep'))).toBe('main');
      expect(gitBranch(path.join(root, 'wt'))).toBe('feat/x');
      expect(gitBranch('relative/path')).toBeNull();
      expect(gitBranch('\\\\host\\share\\repo')).toBeNull();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('many folders: deduplicated, strings only, prototype names safe', () => {
    expect(gitBranches(['a', 'a', 3, 'constructor'], c => `b-${c}`)).toEqual({ a: 'b-a', constructor: 'b-constructor' });
    expect(gitBranches('nope')).toEqual({});
  });
});
