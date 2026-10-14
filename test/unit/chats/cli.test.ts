// Engine resolution (src/main/chats/cli.ts): the embedded Claude binary by default (ADR 0010), a release's copy from
// SB_ENGINE_CLAUDE, SB_CLAUDE_PATH for tests; scripts run with this runtime as Node; the quit kill lands even when
// taskkill is too slow.
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { commandFor, killTreesWithin, resolveClaude } from '../../../src/main/chats/cli';
import { alive, tmp, waitFor } from './helpers';

const saved = { SB_CLAUDE_PATH: process.env.SB_CLAUDE_PATH, SB_ENGINE_CLAUDE: process.env.SB_ENGINE_CLAUDE };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('Claude engine resolution', () => {
  it('uses the embedded official binary of the dependency by default', () => {
    delete process.env.SB_CLAUDE_PATH; delete process.env.SB_ENGINE_CLAUDE;
    const r = resolveClaude();
    expect(r?.source).toBe('embedded');
    expect(r?.path).toMatch(/[\\/]@anthropic-ai[\\/]claude-agent-sdk-win32-x64[\\/]claude\.exe$/);
    expect(fs.existsSync(r?.path ?? '')).toBe(true);
  });

  it('a release passes its own copy in SB_ENGINE_CLAUDE; SB_CLAUDE_PATH (tests) wins over everything', () => {
    const rel = path.join(tmp('engines'), 'claude.exe');
    fs.writeFileSync(rel, '');
    delete process.env.SB_CLAUDE_PATH;
    process.env.SB_ENGINE_CLAUDE = rel;
    expect(resolveClaude()).toEqual({ path: rel, source: 'release' });
    process.env.SB_ENGINE_CLAUDE = path.join(tmp('x'), 'missing.exe'); // a stale variable never wins over the embedded one
    expect(resolveClaude()?.source).toBe('embedded');
    process.env.SB_CLAUDE_PATH = 'C:\\fake\\claude.mjs';
    expect(resolveClaude()).toEqual({ path: 'C:\\fake\\claude.mjs', source: 'override' });
    expect(resolveClaude('D:\\x.exe')).toEqual({ path: 'D:\\x.exe', source: 'override' });
  });

  it('runs .mjs engines with this runtime as Node and never leaks that switch to real ones', () => {
    expect(commandFor('C:\\f\\fake.mjs', ['-p'], {})).toEqual({ command: process.execPath, args: ['C:\\f\\fake.mjs', '-p'], env: { ELECTRON_RUN_AS_NODE: '1' } });
    expect(commandFor('C:\\e\\claude.exe', ['-p'], { ELECTRON_RUN_AS_NODE: '1', A: 'b' })).toEqual({ command: 'C:\\e\\claude.exe', args: ['-p'], env: { A: 'b' } });
  });
});

describe('quit kill', () => {
  // a loaded box makes taskkill outlast its timeout (15-40 s measured): the quit kill must still land, at once
  // (the tree kill of a child that escapes the job is covered by manager.test's shutdown test)
  it('a bounded quit kill whose taskkill is too slow terminates the processes directly, their job children with them', async () => {
    const f = path.join(tmp('kill'), 'child.pid');
    const p = spawn(process.execPath, ['-e', `const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e3)'],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(f)},String(c.pid));setInterval(()=>{},1e3)`], { stdio: 'ignore' });
    const child = Number(await waitFor(() => fs.existsSync(f) && fs.readFileSync(f, 'utf8'), 'the child pid'));
    await killTreesWithin([p.pid], 1);
    expect(alive(p.pid!)).toBe(false); // dead when the bounded kill resolves
    await waitFor(() => !alive(child), 'the child killed with it', 3000);
  });

  it('a child outside the job, which taskkill has not reached yet, is terminated from the picture, before its parent', async () => {
    const f = path.join(tmp('kill'), 'child.pid');
    const p = spawn(process.execPath, ['-e', `const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e3)'],{stdio:'ignore',detached:true});c.unref();require('fs').writeFileSync(${JSON.stringify(f)},String(c.pid));setInterval(()=>{},1e3)`], { stdio: 'ignore' });
    const child = Number(await waitFor(() => fs.existsSync(f) && fs.readFileSync(f, 'utf8'), 'the child pid'));
    const order: number[] = [];
    await killTreesWithin([p.pid], 1, { kids: pid => { order.push(pid); return [child]; } });
    expect(order).toEqual([p.pid]); // asked only for the one still alive at the cap
    await waitFor(() => !alive(p.pid!) && !alive(child), 'both terminated at once, not when a slow taskkill lands', 1500);
  });

  it('resolves within its time, the steps after the wait included: the ones it terminated go to after in one call', async () => {
    const ps = [0, 1].map(() => spawn(process.execPath, ['-e', 'setInterval(()=>{},1e3)'], { stdio: 'ignore' }));
    await waitFor(() => ps.every(p => p.pid && alive(p.pid)), 'both running');
    const calls: { pids: number[]; at: number }[] = [];
    const t0 = Date.now();
    // the caller's taskkill already runs (here: none): nothing lands before the cap, both are terminated directly
    await killTreesWithin(ps.map(p => p.pid), 400, { started: { spawnMs: 0 }, after: (pids, at) => { calls.push({ pids, at }); } });
    const took = Date.now() - t0;
    expect(calls).toHaveLength(1);
    expect([...calls[0]!.pids].sort()).toEqual(ps.map(p => p.pid!).sort());
    expect(calls[0]!.at).toBeLessThanOrEqual(t0 + 400);
    expect(took).toBeLessThan(400 + 150); // the reserve (300 ms at least) absorbs late timers
    for (const p of ps) await waitFor(() => !alive(p.pid!), 'terminated', 3000);
  });
});
