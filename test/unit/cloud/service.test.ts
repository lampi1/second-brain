// The cloud agents' service (src/main/cloud/service.ts, ADR 0080) over fake providers and a fake git: a start fails
// closed (engine off, not ready, not GitHub, branch not pushed, Cursor budget reached), Cursor's spend increase goes to
// the budget and engines/spend.ts once, polling asks nobody while the window is hidden and backs off when nothing runs,
// follow-up / stop only where the engine has them, "Porta in locale" always into a new worktree, the store survives a
// restart. Plus the demo's service (cloud/demo.ts) and app_create_chat where:'cloud' (appctl/tools.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CloudAgent, CloudEngine } from '../../../src/shared/cloud';
import { CloudService, POLL_MAX_MS, POLL_MIN_MS, type CloudDeps } from '../../../src/main/cloud/service';
import type { CloudProvider } from '../../../src/main/cloud/provider';
import type { Exec } from '../../../src/main/cloud/exec';
import { demoCloud } from '../../../src/main/cloud/demo';

const git = (opts: { remote?: string; pushed?: boolean } = {}): { exec: Exec; calls: string[][] } => {
  const calls: string[][] = [];
  const exec: Exec = (cli, args) => {
    calls.push([cli, ...args]);
    const ok = (stdout = '') => Promise.resolve({ code: 0, stdout, stderr: '' });
    if (args.includes('--show-toplevel')) return ok('/w/shop');
    if (args.includes('get-url')) return ok(opts.remote ?? 'https://github.com/acme/shop.git');
    if (args.includes('--abbrev-ref')) return ok('main');
    if (args.includes('--verify')) return opts.pushed === false ? Promise.resolve({ code: 1, stdout: '', stderr: '' }) : ok('abc');
    return ok();
  };
  return { exec, calls };
};

const agent = (o: Partial<CloudAgent> = {}): CloudAgent => ({ id: 'a1', engine: 'cursor', by: 'user', title: 't', status: 'running', url: null, repo: 'acme/shop', updatedAt: 1, runId: 'r1', ...o });

function provider(engine: CloudEngine, o: Partial<CloudProvider> = {}): CloudProvider & { started: number } {
  const p = {
    engine, started: 0,
    readiness: () => Promise.resolve({ ok: true }),
    start: () => { p.started++; return Promise.resolve(agent({ id: `${engine}-1`, engine, status: 'queued' })); },
    ...o,
  };
  return p;
}

function make(o: Partial<CloudDeps> = {}, providers: Partial<Record<CloudEngine, CloudProvider>> = {}) {
  const emitted: number[] = [];
  const spent: number[] = [];
  let now = new Date(2026, 9, 19, 10).getTime();
  const s = new CloudService({
    file: null, emit: st => emitted.push(st.agents.length), exec: git().exec, http: () => Promise.reject(new Error('no network')),
    cursorKey: () => 'k', engineOn: () => true, budget: () => ({ limitUsd: null, localTodayUsd: 0 }), addSpend: usd => spent.push(usd), visible: () => true,
    now: () => now, providers: { cursor: provider('cursor'), codex: provider('codex'), claude: provider('claude'), ...providers }, ...o,
  });
  return { s, emitted, spent, tick: (ms: number) => { now += ms; } };
}

describe('cloud service: start', () => {
  it('starts on a GitHub checkout whose branch is pushed, remembers who and where', async () => {
    const { s, emitted } = make();
    const a = await s.start({ engine: 'cursor', cwd: '/w/shop', prompt: 'Fix it', title: 'Shop · Fix' }, 'agent');
    expect(a).toMatchObject({ id: 'cursor-1', by: 'agent', cwd: '/w/shop', repo: 'acme/shop' });
    expect(s.state().agents.map(x => x.id)).toEqual(['cursor-1']);
    expect(emitted.length).toBeGreaterThan(0);
    s.shutdown();
  });

  it('fails closed: engine off, not ready, Azure DevOps, unpushed branch, empty prompt', async () => {
    await expect(make({ engineOn: () => false }).s.start({ engine: 'cursor', cwd: '/w/shop', prompt: 'x' }, 'user')).rejects.toThrow(/spento/);
    await expect(make({}, { codex: provider('codex', { readiness: () => Promise.resolve({ ok: false, why: 'serve ChatGPT' }) }) }).s.start({ engine: 'codex', cwd: '/w/shop', prompt: 'x' }, 'user')).rejects.toThrow(/ChatGPT/);
    await expect(make({ exec: git({ remote: 'https://dev.azure.com/o/p/_git/r' }).exec }).s.start({ engine: 'cursor', cwd: '/w/shop', prompt: 'x' }, 'user')).rejects.toThrow(/Azure DevOps/);
    await expect(make({ exec: git({ pushed: false }).exec }).s.start({ engine: 'cursor', cwd: '/w/shop', prompt: 'x' }, 'user')).rejects.toThrow(/push/);
    await expect(make().s.start({ engine: 'cursor', cwd: '/w/shop', prompt: '  ' }, 'user')).rejects.toThrow(/compito/);
    await expect(make().s.start({ engine: 'gemini' as CloudEngine, cwd: '/w/shop', prompt: 'x' }, 'user')).rejects.toThrow(/cursor \| codex \| claude/);
  });

  it('a Cursor start is blocked once the budget’s Cursor daily limit is reached (local + cloud spend)', async () => {
    const cursor = provider('cursor');
    const { s } = make({ budget: () => ({ limitUsd: 5, localTodayUsd: 5 }) }, { cursor });
    await expect(s.start({ engine: 'cursor', cwd: '/w/shop', prompt: 'x' }, 'user')).rejects.toThrow(/limite di spesa/);
    expect(cursor.started).toBe(0);
    // Codex and Claude draw from the plan: never blocked by the API budget
    await expect(s.start({ engine: 'claude', cwd: '/w/shop', prompt: 'x' }, 'user')).resolves.toMatchObject({ engine: 'claude' });
  });

  it('readiness per engine, for a folder', async () => {
    const { s } = make({ exec: git({ pushed: false }).exec, cursorKey: () => null }, { cursor: provider('cursor', { readiness: () => Promise.resolve({ ok: false, why: 'manca la chiave' }) }) });
    const r = await s.readiness('/w/shop');
    expect(r.cursor).toEqual({ ok: false, why: 'manca la chiave' });
    expect(r.codex.why).toMatch(/push/);
  });

  it('Codex remembers the environment per repo', async () => {
    const seen: (string | undefined)[] = [];
    const codex = provider('codex', { start: i => { seen.push(i.env); return Promise.resolve(agent({ id: `c${seen.length}`, engine: 'codex' })); } });
    const { s } = make({}, { codex });
    await s.start({ engine: 'codex', cwd: '/w/shop', prompt: 'x', env: 'env_shop' }, 'user');
    await s.start({ engine: 'codex', cwd: '/w/shop', prompt: 'y' }, 'user');
    expect(seen).toEqual(['env_shop', 'env_shop']);
  });
});

describe('cloud service: polling and spend', () => {
  it('asks nobody while the window is hidden; 30 s while something runs, backing off to 10 min when nothing does', async () => {
    vi.useFakeTimers();
    try {
      let visible = false, lists = 0;
      const cursor = provider('cursor', { list: () => { lists++; return Promise.resolve([agent({ status: 'done' })]); }, usage: () => Promise.resolve(null) });
      const { s, tick } = make({ visible: () => visible }, { cursor });
      await s.tick();
      expect(lists).toBe(0);
      visible = true;
      tick(POLL_MIN_MS);
      await s.tick();
      expect(lists).toBe(1);
      expect(s.pollMs).toBe(2 * POLL_MIN_MS); // nothing runs: back-off
      for (let i = 0; i < 8; i++) { tick(POLL_MAX_MS); await s.tick(); }
      expect(s.pollMs).toBe(POLL_MAX_MS);
      // a refresh never runs twice within 30 s
      await s.refresh();
      expect(lists).toBe(9);
      s.shutdown();
    } finally { vi.useRealTimers(); }
  });

  it('Cursor’s spend: only the increase counts, once, in the day’s total and engines/spend.ts', async () => {
    let usd = 0.5;
    const cursor = provider('cursor', { list: () => Promise.resolve([agent()]), usage: () => Promise.resolve(usd) });
    const { s, spent, tick } = make({}, { cursor });
    await s.refresh();
    tick(POLL_MIN_MS); usd = 0.8; await s.refresh();
    tick(POLL_MIN_MS); await s.refresh();
    expect(spent.map(x => Math.round(x * 100) / 100)).toEqual([0.5, 0.3]);
    expect(s.state().todayUsd).toBe(0.8);
    expect(s.state().agents[0]!.costUsd).toBe(0.8);
    s.shutdown();
  });

  it('a dismissed agent does not come back from the vendor’s list', async () => {
    const cursor = provider('cursor', { list: () => Promise.resolve([agent({ status: 'done' })]), usage: () => Promise.resolve(null) });
    const { s, tick } = make({}, { cursor });
    await s.refresh();
    s.dismiss('a1');
    tick(POLL_MIN_MS); await s.refresh();
    expect(s.state().agents).toEqual([]);
  });

  it('the list keeps what the app knows (its title, folder, who started it)', async () => {
    const cursor = provider('cursor', { start: () => Promise.resolve(agent({ title: 'vendor name', status: 'queued' })), list: () => Promise.resolve([agent({ title: 'vendor name', by: 'vendor', status: 'done', summary: 'ok' })]), usage: () => Promise.resolve(null) });
    const { s } = make({}, { cursor });
    await s.start({ engine: 'cursor', cwd: '/w/shop', prompt: 'x', title: 'Mine' }, 'agent');
    // start sets its title from the request
    s.store.data.agents[0]!.title = 'Mine';
    await s.refresh();
    expect(s.state().agents[0]).toMatchObject({ title: 'Mine', by: 'agent', cwd: '/w/shop', status: 'done', summary: 'ok' });
  });
});

describe('cloud service: actions', () => {
  it('follow-up and stop only where the engine has them; the rest says "apri la sua pagina"', async () => {
    const { s } = make({}, { cursor: provider('cursor', { followUp: () => Promise.resolve({ runId: 'r2', status: 'running' }), stop: () => Promise.resolve({ status: 'stopped' }) }) });
    s.store.data.agents = [agent(), agent({ id: 'x1', engine: 'codex' })];
    expect(await s.followUp('a1', 'more')).toMatchObject({ runId: 'r2' });
    expect(await s.stop('a1')).toMatchObject({ status: 'stopped' });
    await expect(s.followUp('x1', 'more')).rejects.toThrow(/pagina/);
    await expect(s.stop('x1')).rejects.toThrow(/pagina/);
    await expect(s.followUp('nope', 'x')).rejects.toThrow(/non trovato/);
  });

  it('"Porta in locale" fetches the agent’s branch into a new worktree beside the repo, never the checkout', async () => {
    const g = git();
    const { s } = make({ exec: g.exec });
    s.store.data.agents = [agent({ branch: 'cursor/fix-a', cwd: '/w/shop', status: 'done' })];
    const r = await s.apply('a1');
    expect(r.branch).toBe('cursor/fix-a');
    expect(r.worktree).toBe(path.join('/w', 'shop-wt', 'cloud-cursor-fix-a'));
    expect(g.calls.some(c => c.includes('fetch'))).toBe(true);
    expect(g.calls.some(c => c.includes('worktree') && c.includes('add'))).toBe(true);
    expect(g.calls.some(c => c.includes('checkout') || c.includes('reset') || c.includes('push'))).toBe(false);
    s.store.data.agents = [agent({ id: 'b', branch: 'main', cwd: '/w/shop' })];
    await expect(s.apply('b')).rejects.toThrow(/branch non valido/);
  });

  it('Codex brings home with codex apply in a fresh worktree', async () => {
    const applied: string[] = [];
    const { s } = make({}, { codex: provider('codex', { applyIn: (_a, w) => { applied.push(w); return Promise.resolve(); } }) });
    s.store.data.agents = [agent({ id: 'task_e_1', engine: 'codex', status: 'done', cwd: '/w/shop', title: 'Test pagamenti' })];
    const r = await s.apply('task_e_1');
    expect(applied).toEqual([r.worktree]);
    expect(r.branch).toMatch(/^codex\//);
  });

  it('the store survives a restart without messages', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cloud-')), 'cloud-agents.json');
    const { s } = make({ file });
    await s.start({ engine: 'claude', cwd: '/w/shop', prompt: 'x', title: 'Mine' }, 'user');
    s.store.data.agents[0]!.messages = [{ id: 'm', kind: 'assistant', text: 'secret-ish transcript', at: 1 }];
    s.store.save();
    const again = make({ file }).s;
    expect(again.state().agents.map(a => a.id)).toEqual(['claude-1']);
    expect(fs.readFileSync(file, 'utf8')).not.toContain('transcript');
  });
});

describe('demo cloud agents', () => {
  it('one per engine in the demo’s areas, buttons answer without CLI or network', async () => {
    const s = demoCloud({ emit: () => {}, now: () => 1_760_000_000_000 });
    const st = s.state();
    expect(st.agents.map(a => a.engine).sort()).toEqual(['claude', 'codex', 'cursor']);
    expect(st.agents.map(a => a.repo.split('/')[1])).toEqual(expect.arrayContaining(['alfa-shop', 'alfa-e2e']));
    await expect(s.followUp('bc-demo-checkout', 'ciao')).resolves.toMatchObject({ status: 'running' });
    await expect(s.start({ engine: 'codex', cwd: 'C:\\progetti\\alfa-shop', prompt: 'x', env: 'env1' }, 'user')).resolves.toMatchObject({ repo: 'alfa/alfa-shop' });
    expect((await s.readiness('C:\\progetti\\alfa-shop')).cursor.ok).toBe(true);
  });
});
