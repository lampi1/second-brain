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
// the shared runtime's executable per OS, as release.mjs electronFor (macOS: inside the app bundle)
const exe = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? path.join('Electron.app', 'Contents', 'MacOS', 'Electron') : 'electron';
let root = '';

// the fake app: SB_FAKE_PLAN is a comma list, one entry per start ("busy" → exit 75, "fail" → exit 1, "ready" → write
// ready.json like index.ts and stay up a moment); the start count lives in a file; a started app keeps the
// launch-result.json it found while starting (seen-launch-result.json), what the real app reads at that moment
const MAIN = `const fs=require('node:fs'),path=require('node:path');
const n=path.join(process.env.SB_USER_DATA,'starts');const i=fs.existsSync(n)?Number(fs.readFileSync(n,'utf8')):0;fs.writeFileSync(n,String(i+1));
const step=(process.env.SB_FAKE_PLAN||'ready').split(',')[i]||'ready';
if(step==='reselect'){require('node:child_process').execFileSync(process.execPath,[process.env.SB_TEST_RELEASE_SCRIPT,'install','external'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});process.exit(1);}
if(step==='busy')process.exit(75);if(step==='fail')process.exit(1);
const lr=path.join(process.env.SB_RELEASES_ROOT,'launch-result.json');if(fs.existsSync(lr))fs.copyFileSync(lr,path.join(process.env.SB_USER_DATA,'seen-launch-result.json'));
fs.writeFileSync(path.join(process.env.SB_USER_DATA,'ready.json'),JSON.stringify({release:process.env.SB_RELEASE,pid:process.pid,at:new Date().toISOString()}));
setTimeout(()=>{},1500);`;

function setup(ids: string[]): { base: string; userData: string } {
  const base = fs.mkdtempSync(path.join(root, 'rel-'));
  fs.mkdirSync(path.dirname(path.join(base, 'electron', '1.0.0', exe)), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(base, 'electron', '1.0.0', exe));
  for (const id of ids) {
    const dir = path.join(base, 'releases', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ main: 'main.cjs' }));
    fs.writeFileSync(path.join(dir, 'main.cjs'), MAIN);
    fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify({ id, writerProtocol: 1, electron: '1.0.0', claudeEngine: null }));
  }
  fs.writeFileSync(path.join(base, 'current.json'), JSON.stringify({ current: ids[0], previous: ids[1] ?? null, writerProtocol: 1, bad: [], history: [] }));
  const userData = path.join(base, 'ud');
  fs.mkdirSync(userData);
  return { base, userData };
}

function launch(base: string, userData: string, plan: string, waitMs = 3000): { out: string; state: { bad: string[] }; starts: number; result: { wanted: string; started: string | null; attempts: { id: string; outcome: string; reason: string }[] } } {
  let out = '';
  try {
    out = execFileSync(process.execPath, [script, 'launch'], { encoding: 'utf8', env: { ...process.env, SB_RELEASES_ROOT: base, SB_USER_DATA: userData, SB_TEST_RELEASE_SCRIPT: path.join(base, 'release.mjs'), SB_FAKE_PLAN: plan, SB_LAUNCH_WAIT_MS: String(waitMs) }, timeout: 60_000 });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? '') + String((e as { stderr?: string }).stderr ?? ''); }
  return { out, state: JSON.parse(fs.readFileSync(path.join(base, 'current.json'), 'utf8')), starts: Number(fs.readFileSync(path.join(userData, 'starts'), 'utf8')), result: JSON.parse(fs.readFileSync(path.join(base, 'launch-result.json'), 'utf8')) };
}

beforeAll(() => { root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-launch-'))); });
afterAll(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* a fake app may still hold a file */ } });

describe('release.mjs launch', () => {
  it('a superseded launcher cannot mark bad or overwrite a concurrent external activation', () => {
    const { base, userData } = setup(['b', 'a', 'external']);
    fs.copyFileSync(script, path.join(base, 'release.mjs'));
    fs.copyFileSync(path.join(path.dirname(script), 'update.mjs'), path.join(base, 'update.mjs'));
    const output = path.join(base, 'releases/external/out');
    fs.mkdirSync(path.join(output, 'main'), { recursive: true });
    fs.writeFileSync(path.join(output, 'main/index.js'), '// Inert activation fixture');
    fs.writeFileSync(path.join(output, 'icon.ico'), 'fixture');
    const result = launch(base, userData, 'reselect');
    expect(result.out).toContain('stale launcher');
    expect(JSON.parse(fs.readFileSync(path.join(base, 'current.json'), 'utf8'))).toMatchObject({ current: 'external', previous: 'b', bad: [] });
    expect(result.starts).toBe(1);
  }, 15000);
  it.skipIf(process.platform !== 'win32')('the installed VBS shortcut bootstraps a retained runtime when the current runtime is missing', async () => {
    const { base, userData } = setup(['b', 'a']);
    fs.copyFileSync(script, path.join(base, 'release.mjs'));
    fs.copyFileSync(path.join(path.dirname(script), 'update.mjs'), path.join(base, 'update.mjs'));
    fs.mkdirSync(path.join(base, 'electron', '2.0.0'), { recursive: true });
    fs.copyFileSync(process.execPath, path.join(base, 'electron', '2.0.0', 'electron.exe'));
    fs.writeFileSync(path.join(base, 'releases', 'b', 'release.json'), JSON.stringify({ id: 'b', writerProtocol: 1, electron: '2.0.0', claudeEngine: null }));
    for (const id of ['a', 'b']) {
      const output = path.join(base, 'releases', id, 'out');
      fs.mkdirSync(path.join(output, 'main'), { recursive: true });
      fs.writeFileSync(path.join(output, 'main', 'index.js'), '// activation fixture');
      fs.writeFileSync(path.join(output, 'icon.ico'), 'fixture');
    }
    fs.writeFileSync(path.join(base, 'current.json'), JSON.stringify({ current: 'a', previous: null, writerProtocol: 1, bad: [], history: [] }));
    // This exercises Windows script-host bootstrap, not a timeout: use the production readiness window.
    const env = { ...process.env, SB_RELEASES_ROOT: base, SB_USER_DATA: userData, SB_FAKE_PLAN: 'ready', SB_LAUNCH_WAIT_MS: '30000' };
    execFileSync(process.execPath, [path.join(base, 'release.mjs'), 'install', 'b'], { env, windowsHide: true });
    fs.unlinkSync(path.join(base, 'electron', '2.0.0', 'electron.exe'));
    const startedAt = Date.now();
    let cscriptError: string | null = null;
    try {
      execFileSync(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'cscript.exe'), ['//B', '//Nologo', path.join(base, 'launch.vbs')], { env: { ...env, PATH: '' }, windowsHide: true, timeout: 10000 });
    } catch (error) { cscriptError = String(error); }
    const scriptHostMs = Date.now() - startedAt;
    const result = path.join(base, 'launch-result.json');
    const end = Date.now() + 70000;
    let observed: { started?: string } | null = null;
    while (Date.now() < end) {
      try { observed = JSON.parse(fs.readFileSync(result, 'utf8')); } catch { /* writer may be between truncate/write */ }
      if (observed?.started || cscriptError) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const readJson = (file: string): unknown => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
    const state = readJson(path.join(base, 'current.json')) as { bad?: string[] } | null;
    const diagnostics = { base, elapsedMs: Date.now() - startedAt, scriptHostMs, cscriptError, result: readJson(result), state,
      ready: readJson(path.join(userData, 'ready.json')), starts: readJson(path.join(userData, 'starts')) };
    if (cscriptError || observed?.started !== 'a' || !state?.bad?.includes('b')) {
      // Preserve bounded synthetic-fixture evidence before afterAll removes its files; never a real user profile.
      const artifacts = path.resolve(import.meta.dirname, '..', '..', 'test-results', 'unit');
      fs.mkdirSync(artifacts, { recursive: true });
      fs.writeFileSync(path.join(artifacts, `release-vbs-${process.pid}.json`), JSON.stringify(diagnostics, null, 2));
    }
    const detail = JSON.stringify(diagnostics);
    expect(cscriptError, detail).toBeNull();
    expect(observed, detail).toMatchObject({ wanted: 'b', started: 'a' });
    expect(state?.bad, detail).toContain('b');
  }, 90000);

  it.each(['missing', 'malformed'])('invalid current metadata (%s) falls back to the previous release', kind => {
    const { base, userData } = setup(['b', 'a']);
    const metadata = path.join(base, 'releases', 'b', 'release.json');
    if (kind === 'missing') fs.unlinkSync(metadata); else fs.writeFileSync(metadata, '{broken');
    const r = launch(base, userData, 'ready');
    expect(r.state.bad).toEqual(['b']);
    expect(r.result).toMatchObject({ wanted: 'b', started: 'a', attempts: [{ id: 'b', outcome: 'bad' }, { id: 'a', outcome: 'started' }] });
  }, 60_000);

  it('an unavailable current runtime falls back without crashing on spawn error', () => {
    const { base, userData } = setup(['b', 'a']);
    fs.writeFileSync(path.join(base, 'releases', 'b', 'release.json'), JSON.stringify({ id: 'b', electron: '2.0.0', claudeEngine: null }));
    const r = launch(base, userData, 'ready');
    expect(r.state.bad).toEqual(['b']);
    expect(r.result.started).toBe('a');
  }, 60_000);

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
