// The cloud agents' providers (src/main/cloud/{cursor,codex,claude,repo,exec}.ts, ADR 0080) on recorded vendor
// answers (test/fixtures/cloud): Cursor's REST v1 objects, SSE stream and usage; `codex cloud list --json`, `codex
// cloud exec` and `codex login status`; `claude --cloud`, its follow-up JSON and `claude auth status`. No real CLI, no
// network, no token: a fake Http / Exec answers from the fixtures and records what would have been sent.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CursorCloud, SseParser, cursorStatus, fromCursor, streamMessage, usageUsd } from '../../../src/main/cloud/cursor';
import { CodexCloud, codexLogin, codexStatus, parseCodexList, parseCodexStart } from '../../../src/main/cloud/codex';
import { ClaudeCloud, claudeLogin, parseClaudeCloud } from '../../../src/main/cloud/claude';
import { githubRepo, repoInfo, worktreeDir } from '../../../src/main/cloud/repo';
import { shimTarget, type Exec, type Http } from '../../../src/main/cloud/exec';
import { vendorUrl } from '../../../src/main/cloud/provider';

const fx = (name: string) => fs.readFileSync(path.join(__dirname, '../../fixtures/cloud', name), 'utf8');
const json = (name: string) => JSON.parse(fx(name)) as unknown;
const repo = { repo: 'acme/shop', url: 'https://github.com/acme/shop', branch: 'main', root: '/w/shop' };

function fakeHttp(answers: Record<string, { status?: number; body: string }>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const http: Http = (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, ...(init.body ? { body: init.body } : {}) });
    const key = `${init.method} ${url.replace('https://api.cursor.com', '')}`;
    const a = answers[key];
    return Promise.resolve(new Response(a?.body ?? '{}', { status: a?.status ?? (a ? 200 : 404) }));
  };
  return { http, calls };
}

describe('cursor cloud (REST v1)', () => {
  it('maps an agent object, keeping only the vendor’s own page', () => {
    const list = (json('cursor-list.json') as { agents: unknown[] }).agents;
    const a = fromCursor(list[0], 'vendor')!;
    expect(a).toMatchObject({ id: 'bc_00000000-0000-4000-8000-000000000001', engine: 'cursor', status: 'running', repo: 'acme/shop', branch: 'cursor/fix-checkout-total-ab12', runId: 'run_0002', summary: 'Moving the total to a debounce' });
    expect(a.url).toMatch(/^https:\/\/cursor\.com\//);
    const b = fromCursor(list[1], 'vendor')!;
    expect(b.repo).toBe('acme/docs');
    expect(b.url).toBeNull(); // another host is never opened
    expect(fromCursor(list[2], 'vendor')).toBeNull();
  });

  it('statuses: known ones map, an unknown one is "unknown" (drift)', () => {
    expect(cursorStatus('CREATING')).toBe('queued');
    expect(cursorStatus('FINISHED')).toBe('done');
    expect(cursorStatus('EXPIRED')).toBe('failed');
    expect(cursorStatus('CANCELLED')).toBe('stopped');
    expect(cursorStatus('SOMETHING_NEW')).toBe('unknown');
  });

  it('start posts the prompt, the GitHub repo and branch, its own cursor/ branch, never a PR; the key only as a header', async () => {
    const { http, calls } = fakeHttp({ 'POST /v1/agents': { body: fx('cursor-agent.json') } });
    const p = new CursorCloud({ http, key: () => 'key_test_123', rand: () => 'zz11' });
    const a = await p.start({ prompt: 'Fix the total', title: 'Shop · Fix totale', repo });
    expect(a).toMatchObject({ title: 'Shop · Fix totale', status: 'queued', repo: 'acme/shop', branch: 'cursor/fix-checkout-total-ab12', runId: 'run_0001' });
    const body = JSON.parse(calls[0]!.body!) as { target: { branchName: string } };
    expect(body).toMatchObject({ prompt: { text: 'Fix the total' }, source: { repository: 'https://github.com/acme/shop', ref: 'main' }, target: { autoCreatePr: false } });
    expect(body.target.branchName).toBe('cursor/shop-fix-totale-zz11');
    expect(calls[0]!.headers.Authorization).toBe('Bearer key_test_123');
    expect(calls[0]!.url.startsWith('https://api.cursor.com/')).toBe(true);
  });

  it('without a key it fails closed before any request; HTTP errors become the user’s reason', async () => {
    const { http, calls } = fakeHttp({});
    await expect(new CursorCloud({ http, key: () => null }).start({ prompt: 'x', title: 'x', repo })).rejects.toThrow(/chiave Cursor/);
    expect(calls).toHaveLength(0);
    expect(await new CursorCloud({ http, key: () => null }).readiness()).toMatchObject({ ok: false });
    const bad = fakeHttp({ 'GET /v1/agents?limit=50': { status: 401, body: '{}' } });
    await expect(new CursorCloud({ http: bad.http, key: () => 'k' }).list()).rejects.toThrow(/non valida/);
  });

  it('list, follow-up (a new run), stop (cancels the current run) and usage', async () => {
    const id = 'bc_00000000-0000-4000-8000-000000000001';
    const { http, calls } = fakeHttp({
      'GET /v1/agents?limit=50': { body: fx('cursor-list.json') },
      [`POST /v1/agents/${id}/runs`]: { body: '{"id":"run_0003","status":"RUNNING"}' },
      [`POST /v1/agents/${id}/runs/run_0003/cancel`]: { body: '{}' },
      [`GET /v1/agents/${id}/usage`]: { body: fx('cursor-usage.json') },
    });
    const p = new CursorCloud({ http, key: () => 'k' });
    const list = await p.list();
    expect(list.map(a => a.id)).toHaveLength(2);
    const a = list[0]!;
    expect(await p.followUp(a, 'also the tax')).toEqual({ status: 'running', runId: 'run_0003' });
    expect(JSON.parse(calls[1]!.body!)).toEqual({ prompt: { text: 'also the tax' } });
    expect(await p.stop({ ...a, runId: 'run_0003' })).toEqual({ status: 'stopped' });
    expect(await p.usage(a)).toBe(0.84);
    await expect(p.stop({ ...a, runId: undefined })).rejects.toThrow(/nessuna esecuzione/);
  });

  it('usage tolerates usd or cents and says unknown otherwise', () => {
    expect(usageUsd({ costUsd: 1.5 })).toBe(1.5);
    expect(usageUsd({ totalCostCents: 250 })).toBe(2.5);
    expect(usageUsd({ tokens: 10 })).toBeNull();
  });

  it('the SSE stream: events split across chunks, comments and heartbeats skipped, statuses carried', () => {
    const text = fx('cursor-stream.txt');
    const parser = new SseParser();
    const events = [...parser.feed(text.slice(0, 37)), ...parser.feed(text.slice(37))];
    expect(events.map(e => e.event)).toEqual(['status', 'assistant', 'tool_call', 'heartbeat', 'result']);
    const msgs = events.map((e, i) => streamMessage(e, i, 1)).filter(Boolean);
    expect(msgs.map(m => [m!.kind, m!.text])).toEqual([
      ['status', 'RUNNING'], ['assistant', 'Found the recalculation in CartTotal.'], ['tool', 'run_terminal_cmd'], ['status', 'Total recalculated once per change; tests green.'],
    ]);
    expect(msgs.at(-1)!.status).toBe('done');
    expect(events[1]!.id).toBe('2');
  });

  it('stream resumes with Last-Event-ID', async () => {
    const id = 'bc_1';
    const seen: Record<string, string>[] = [];
    const http: Http = (_url, init) => { seen.push(init.headers); return Promise.resolve(new Response(fx('cursor-stream.txt'), { status: 200 })); };
    const p = new CursorCloud({ http, key: () => 'k' });
    const got: string[] = [];
    const a = { id, engine: 'cursor' as const, by: 'user' as const, title: 't', status: 'running' as const, url: null, repo: 'acme/shop', updatedAt: 0, runId: 'r1' };
    await p.stream(a, m => got.push(m.kind), new AbortController().signal);
    await p.stream(a, () => {}, new AbortController().signal);
    expect(got).toContain('assistant');
    expect(seen[0]!['Last-Event-ID']).toBeUndefined();
    expect(seen[1]!['Last-Event-ID']).toBe('5');
  });
});

function fakeExec(answers: Record<string, { code?: number | null; stdout?: string; stderr?: string }>) {
  const calls: { cli: string; args: string[]; cwd?: string }[] = [];
  const exec: Exec = (cli, args, opts) => {
    calls.push({ cli, args, ...(opts?.cwd ? { cwd: opts.cwd } : {}) });
    const a = answers[`${cli} ${args.join(' ')}`] ?? answers[`${cli} ${args[0]}`] ?? answers[cli];
    return Promise.resolve({ code: a ? (a.code === undefined ? 0 : a.code) : 1, stdout: a?.stdout ?? '', stderr: a?.stderr ?? '' });
  };
  return { exec, calls };
}

describe('codex cloud (CLI)', () => {
  it('parses `codex cloud list --json`, skipping ids it cannot pass as an argument', () => {
    const list = parseCodexList(fx('codex-list.json'));
    expect(list.map(a => [a.id, a.status, a.repo])).toEqual([['task_e_0001', 'done', 'acme/shop'], ['task_e_0002', 'running', 'acme/shop'], ['task_e_0003', 'unknown', '']]);
    expect(list[0]!.summary).toBe('12 tests added');
    expect(list[2]!.url).toBe('https://chatgpt.com/codex/tasks/task_e_0003');
    expect(parseCodexList('[{"id":"bad id with spaces"}]')).toEqual([]);
    expect(parseCodexList('not json')).toEqual([]);
    expect(codexStatus('applied')).toBe('done');
  });

  it('start needs the environment, runs in the repo folder and reads the task id from the output', async () => {
    const { exec, calls } = fakeExec({ codex: { stdout: fx('codex-exec.txt') } });
    const p = new CodexCloud(exec);
    await expect(p.start({ prompt: 'x', title: 't', repo })).rejects.toThrow(/ambiente Codex/);
    const a = await p.start({ prompt: '--help me', title: 'Shop · Test', repo, env: 'env_shop' });
    expect(a).toMatchObject({ id: 'task_e_0009', engine: 'codex', status: 'queued', url: 'https://chatgpt.com/codex/tasks/task_e_0009', repo: 'acme/shop' });
    expect(calls[0]).toEqual({ cli: 'codex', args: ['cloud', 'exec', '--env', 'env_shop', 'Compito: --help me'], cwd: '/w/shop' });
    expect(parseCodexStart('{"id":"task_e_77","url":"https://chatgpt.com/codex/tasks/task_e_77"}')).toEqual({ id: 'task_e_77', url: 'https://chatgpt.com/codex/tasks/task_e_77' });
    expect(parseCodexStart('nothing here')).toBeNull();
  });

  it('cloud only with a ChatGPT sign-in', () => {
    expect(codexLogin(fx('codex-login-chatgpt.txt'))).toEqual({ ok: true });
    expect(codexLogin(fx('codex-login-apikey.txt'))).toMatchObject({ ok: false, why: expect.stringMatching(/ChatGPT/) });
    expect(codexLogin('Not logged in')).toMatchObject({ ok: false });
  });

  it('apply runs `codex apply <id>` in the given worktree', async () => {
    const { exec, calls } = fakeExec({ codex: {} });
    await new CodexCloud(exec).applyIn({ id: 'task_e_0001', engine: 'codex', by: 'user', title: 't', status: 'done', url: null, repo: 'acme/shop', updatedAt: 0 }, '/w/shop-wt/x');
    expect(calls[0]).toEqual({ cli: 'codex', args: ['apply', 'task_e_0001'], cwd: '/w/shop-wt/x' });
  });
});

describe('claude cloud sessions (CLI)', () => {
  it('start reads the session id and its claude.ai page from the text output', async () => {
    const { exec, calls } = fakeExec({ claude: { stdout: fx('claude-cloud.txt') } });
    const a = await new ClaudeCloud(exec).start({ prompt: 'Fix flaky e2e', title: 'E2E · Fix', repo });
    expect(a).toMatchObject({ id: 'session_01AbCdEfGh', status: 'unknown', url: 'https://claude.ai/code/session_01AbCdEfGh' });
    expect(calls[0]).toEqual({ cli: 'claude', args: ['--cloud', 'Fix flaky e2e'], cwd: '/w/shop' });
  });

  it('follow-up queues with -p … --cloud <id> --output-format json', async () => {
    const { exec, calls } = fakeExec({ claude: { stdout: fx('claude-followup.json') } });
    const p = new ClaudeCloud(exec);
    expect(await p.followUp({ id: 'session_01AbCdEfGh', engine: 'claude', by: 'user', title: 't', status: 'unknown', url: null, repo: 'acme/shop', updatedAt: 0 }, 'and the docs')).toEqual({ url: 'https://claude.ai/code/session_01AbCdEfGh' });
    expect(calls[0]!.args).toEqual(['-p', 'and the docs', '--cloud', 'session_01AbCdEfGh', '--output-format', 'json']);
    expect(parseClaudeCloud('{"ok":false,"session_id":"session_01AbCdEfGh"}')).toBeNull();
  });

  it('needs a claude.ai sign-in, not an API key', () => {
    expect(claudeLogin(fx('claude-auth.json'))).toEqual({ ok: true });
    expect(claudeLogin('{"loggedIn":true,"authMethod":"apiKey"}')).toMatchObject({ ok: false });
    expect(claudeLogin('{"loggedIn":false}')).toMatchObject({ ok: false });
    expect(claudeLogin('garbage')).toMatchObject({ ok: false });
  });
});

describe('the checkout (repo.ts) and helpers', () => {
  it('GitHub only; Azure DevOps refused with the policy reason', () => {
    expect(githubRepo('https://github.com/acme/shop.git')).toEqual({ repo: 'acme/shop', url: 'https://github.com/acme/shop' });
    // an ssh remote and an Azure DevOps one (fixture lines: they look like an address and an internal host to the guard)
    const [ssh, azure] = fx('remotes.txt').split('\n');
    expect(githubRepo(ssh!)).toEqual({ repo: 'acme/shop', url: 'https://github.com/acme/shop' });
    expect(githubRepo(azure!)).toMatchObject({ why: expect.stringMatching(/Azure DevOps/) });
    expect(githubRepo('https://gitlab.com/a/b')).toMatchObject({ why: expect.stringMatching(/GitHub/) });
  });

  it('the branch must already be on the remote: the app never pushes', async () => {
    const base = { 'git -C /w/shop rev-parse --show-toplevel': { stdout: '/w/shop\n' }, 'git -C /w/shop remote get-url origin': { stdout: 'https://github.com/acme/shop.git\n' }, 'git -C /w/shop rev-parse --abbrev-ref HEAD': { stdout: 'feat/x\n' } };
    const notPushed = fakeExec({ ...base, 'git -C /w/shop rev-parse --verify --quiet refs/remotes/origin/feat/x': { code: 1 } });
    expect(await repoInfo(notPushed.exec, '/w/shop')).toMatchObject({ why: expect.stringMatching(/push/) });
    const pushed = fakeExec({ ...base, 'git -C /w/shop rev-parse --verify --quiet refs/remotes/origin/feat/x': { stdout: 'abc' } });
    expect(await repoInfo(pushed.exec, '/w/shop')).toEqual({ repo: 'acme/shop', url: 'https://github.com/acme/shop', branch: 'feat/x', root: '/w/shop' });
    expect(pushed.calls.every(c => !c.args.includes('push'))).toBe(true);
    expect(await repoInfo(pushed.exec, 'relative')).toMatchObject({ why: expect.any(String) });
  });

  it('worktrees go beside the repo; vendor urls only on the vendor’s host; npm shims resolve to their .js', () => {
    expect(worktreeDir(path.join('/w', 'shop'), 'cursor/fix-a')).toBe(path.join('/w', 'shop-wt', 'cloud-cursor-fix-a'));
    expect(vendorUrl('claude', 'https://claude.ai/code/x')).toBe('https://claude.ai/code/x');
    expect(vendorUrl('claude', 'https://claude.ai.evil.com/x')).toBeNull();
    expect(vendorUrl('codex', 'http://chatgpt.com/codex')).toBeNull();
    const shim = '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n';
    expect(shimTarget(path.join('/npm', 'codex.cmd'), () => shim)).toBe(path.join('/npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
    expect(shimTarget('/x.cmd', () => 'nothing')).toBeNull();
  });
});
