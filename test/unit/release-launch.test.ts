// scripts/release.mjs launch (the stable launcher behind the desktop icon): a release whose window never reports ready
// is marked bad and the previous one starts; a start refused because the app is already open or still quitting (exit
// 75, src/main/index.ts) is never marked bad (2026-10-12: 91967ec marked bad by a click while the old app was
// closing); each start's outcome lands in launch-result.json. The "Electron" here is a copy of Node running a fake
// release (package.json main) that plays each case.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, '..', '..', 'scripts', 'release.mjs');
const exe = process.platform === 'win32' ? 'electron.exe' : 'electron';
let root = '';

// the fake app: SB_FAKE_PLAN is a comma list, one entry per start ("busy" → exit 75, "fail" → exit 1, "ready" → write
// ready.json like index.ts and stay up a moment); the start count lives in a file; a started app keeps the
// launch-result.json it found while starting (seen-launch-result.json), what the real app reads at that moment
const MAIN = `const fs=require('node:fs'),path=require('node:path');
const n=path.join(process.env.SB_USER_DATA,'starts');const i=fs.existsSync(n)?Number(fs.readFileSync(n,'utf8')):0;fs.writeFileSync(n,String(i+1));
const step=(process.env.SB_FAKE_PLAN||'ready').split(',')[i]||'ready';
if(step==='busy')process.exit(75);if(step==='fail')process.exit(1);
const lr=path.join(process.env.SB_RELEASES_ROOT,'launch-result.json');if(fs.existsSync(lr))fs.copyFileSync(lr,path.join(process.env.SB_USER_DATA,'seen-launch-result.json'));
fs.writeFileSync(path.join(process.env.SB_USER_DATA,'ready.json'),JSON.stringify({release:process.env.SB_RELEASE,pid:process.pid,at:new Date().toISOString()}));
setTimeout(()=>{},1500);`;

function setup(ids: string[]): { base: string; userData: string } {
  const base = fs.mkdtempSync(path.join(root, 'rel-'));
  fs.mkdirSync(path.join(base, 'electron', '1.0.0'), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(base, 'electron', '1.0.0', exe));
  for (const id of ids) {
    const dir = path.join(base, 'releases', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ main: 'main.cjs' }));
    fs.writeFileSync(path.join(dir, 'main.cjs'), MAIN);
    fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify({ id, electron: '1.0.0', claudeEngine: null }));
  }
  fs.writeFileSync(path.join(base, 'current.json'), JSON.stringify({ current: ids[0], previous: ids[1] ?? null, bad: [], history: [] }));
  const userData = path.join(base, 'ud');
  fs.mkdirSync(userData);
  return { base, userData };
}

function launch(base: string, userData: string, plan: string, waitMs = 3000): { out: string; state: { bad: string[] }; starts: number; result: { wanted: string; started: string | null; attempts: { id: string; outcome: string; reason: string }[] } } {
  let out = '';
  try {
    out = execFileSync(process.execPath, [script, 'launch'], { encoding: 'utf8', env: { ...process.env, SB_RELEASES_ROOT: base, SB_USER_DATA: userData, SB_FAKE_PLAN: plan, SB_LAUNCH_WAIT_MS: String(waitMs) }, timeout: 60_000 });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? '') + String((e as { stderr?: string }).stderr ?? ''); }
  return { out, state: JSON.parse(fs.readFileSync(path.join(base, 'current.json'), 'utf8')), starts: Number(fs.readFileSync(path.join(userData, 'starts'), 'utf8')), result: JSON.parse(fs.readFileSync(path.join(base, 'launch-result.json'), 'utf8')) };
}

beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-launch-')); });
afterAll(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* a fake app may still hold a file */ } });

describe('release.mjs launch', () => {
  it('starts the current release when its window reports ready', () => {
    const { base, userData } = setup(['b', 'a']);
    const r = launch(base, userData, 'ready');
    expect(r.out).toContain('started b');
    expect(r.state.bad).toEqual([]);
    expect(r.result).toMatchObject({ wanted: 'b', started: 'b', attempts: [{ id: 'b', outcome: 'started' }] });
  }, 60_000);

  it('the app starting reads this start in launch-result.json, never the record of an earlier start', () => {
    const { base, userData } = setup(['b', 'a']);
    // the record of an earlier start of another release (a promotion minutes ago, then a rollback to b)
    fs.writeFileSync(path.join(base, 'launch-result.json'), JSON.stringify({ at: new Date().toISOString(), wanted: 'x', started: 'x', attempts: [{ id: 'x', outcome: 'started', reason: 'window ready after 3 s' }] }));
    launch(base, userData, 'ready');
    expect(JSON.parse(fs.readFileSync(path.join(userData, 'seen-launch-result.json'), 'utf8'))).toMatchObject({ wanted: 'b', started: null, attempts: [] });
  }, 60_000);

  it('a release that exits without ready is marked bad and the previous one starts', () => {
    const { base, userData } = setup(['b', 'a']);
    const r = launch(base, userData, 'fail,ready');
    expect(r.out).toContain('started a');
    expect(r.state.bad).toEqual(['b']);
    // launch-result.json: what the app says after the restart (went back to the previous one, and why)
    expect(r.result).toMatchObject({ wanted: 'b', started: 'a', attempts: [{ id: 'b', outcome: 'bad', reason: expect.stringMatching(/^exited with code 1 after \d+ s$/) }, { id: 'a', outcome: 'started' }] });
    // the next start skips the bad one and says so
    expect(launch(base, userData, 'ready').result.attempts.map(a => [a.id, a.outcome])).toEqual([['b', 'skipped-bad'], ['a', 'started']]);
  }, 60_000);

  it('the app still quitting (its pid gone soon): waits, starts the same release again, never marks it bad', () => {
    const { base, userData } = setup(['b', 'a']);
    // the old instance, recorded in ready.json as the last one that started: it ends 3 s after the new start was
    // refused (the fake app's first start writes the starts file), so the launcher finds it still quitting
    const starts = JSON.stringify(path.join(userData, 'starts'));
    const old = spawn(process.execPath, ['-e', `const fs=require('node:fs');const t=setInterval(()=>{if(fs.existsSync(${starts})){clearInterval(t);setTimeout(()=>{},3000);}},50)`], { stdio: 'ignore' });
    fs.writeFileSync(path.join(userData, 'ready.json'), JSON.stringify({ release: 'a', pid: old.pid, at: new Date(Date.now() - 60_000).toISOString() }));
    fs.writeFileSync(path.join(userData, 'quitting.json'), JSON.stringify({ pid: old.pid })); // index.ts before-quit
    const r = launch(base, userData, 'busy,ready', 15_000);
    expect(r.out).toContain('started b');
    expect(r.state.bad).toEqual([]);
    expect(r.starts).toBe(2);
    expect(r.result).toMatchObject({ started: 'b', attempts: [{ id: 'b', outcome: 'started', reason: expect.stringMatching(/after pid \d+ finished quitting/) }] });
  }, 60_000);

  it('the app already open (alive, not quitting): brought to the front at once, nothing marked bad, the previous one not started', () => {
    const { base, userData } = setup(['b', 'a']);
    fs.writeFileSync(path.join(userData, 'ready.json'), JSON.stringify({ release: 'b', pid: process.pid, at: new Date(Date.now() - 60_000).toISOString() }));
    const t0 = Date.now();
    const r = launch(base, userData, 'busy,ready', 30_000);
    expect(Date.now() - t0).toBeLessThan(15_000); // no wait for an app that is not quitting (it would take 30 s)
    expect(r.out).toContain('already running');
    expect(r.state.bad).toEqual([]);
    expect(r.starts).toBe(1);
    expect(r.result).toMatchObject({ started: null, attempts: [{ id: 'b', outcome: 'already-running' }] });
  }, 60_000);
});
