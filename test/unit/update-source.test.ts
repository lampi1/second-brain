// The app's update machinery outside the retired "Migliora l'app" section (ADR 0079; ADR 0074, 0075): how the last
// start went (src/main/update/launch.ts: new version, or back to the previous one and why, told once), the promotion's
// steps and clean environment, and AppSourceService (src/main/update/source.ts) end to end on a real temp git repo with
// fake scripts/pull.mjs and scripts/release.mjs: main's tip as the candidate, "Aggiorna" on a dev build (pull, relaunch)
// and on a stable copy (pull, promote-now, restart), the Orchestrator's pull, the start notice and its marker's rename.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AppSourceState } from '../../src/shared/contract';
import { launchOutcome, nextSeen, promoteStep, reasonText, shaOfRelease } from '../../src/main/update/launch';
import { AppSourceService, cleanEnv } from '../../src/main/update/source';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-12T10:00:00Z');

describe('launch helpers', () => {
  it('release id → sha', () => {
    expect(shaOfRelease('0.1.0-91967ec')).toBe('91967ec');
    expect(shaOfRelease('dev')).toBe(null);
  });

  const state = { current: '0.1.0-new1234', previous: '0.1.0-old1234', bad: [] as string[] };
  it('start outcome: the new version came up (once)', () => {
    const seen = { running: '0.1.0-old1234', at: NOW - DAY };
    const l = launchOutcome({ running: '0.1.0-new1234', stable: true, state, result: null, seen, now: NOW });
    expect(l).toMatchObject({ outcome: 'new', running: '0.1.0-new1234' });
    expect(launchOutcome({ running: '0.1.0-new1234', stable: true, state, result: null, seen: nextSeen('0.1.0-new1234', l, seen, NOW), now: NOW + 1000 })).toBe(null);
  });
  it('start outcome: back to the previous one, with the launcher\'s reason; told once', () => {
    const result = { at: new Date(NOW - 5000).toISOString(), wanted: '0.1.0-new1234', started: '0.1.0-old1234', attempts: [{ id: '0.1.0-new1234', outcome: 'bad', reason: 'exited with code 1 after 4 s' }, { id: '0.1.0-old1234', outcome: 'started' }] };
    const bad = { ...state, bad: ['0.1.0-new1234'] };
    const l = launchOutcome({ running: '0.1.0-old1234', stable: true, state: bad, result, seen: { running: '0.1.0-old1234', at: 0 }, now: NOW });
    expect(l).toMatchObject({ outcome: 'fallback', wanted: '0.1.0-new1234', running: '0.1.0-old1234' });
    expect(l!.reason).toBe('si è chiusa da sola dopo 4 secondi (codice 1)');
    expect(reasonText({ outcome: 'bad', reason: 'window not ready within 30 s' })).toBe('non ha aperto la finestra entro 30 secondi');
    expect(reasonText({ outcome: 'skipped-bad', reason: 'marked bad by an earlier start' })).toBe('era già stata scartata a un avvio precedente');
    const seen = nextSeen('0.1.0-old1234', l, null, NOW);
    expect(seen.fallbackOf).toBe('0.1.0-new1234');
    expect(launchOutcome({ running: '0.1.0-old1234', stable: true, state: bad, result: null, seen, now: NOW + DAY })).toBe(null);
  });
  it('start outcome: without the launcher\'s file, a bad current release still says so', () => {
    const l = launchOutcome({ running: '0.1.0-old1234', stable: true, state: { ...state, bad: ['0.1.0-new1234'] }, result: null, seen: null, now: NOW });
    expect(l).toMatchObject({ outcome: 'fallback', reason: reasonText(undefined) });
  });
  it('start outcome: nothing for a dev build, a first start, the same version, a rollback by hand', () => {
    expect(launchOutcome({ running: 'dev', stable: false, state, result: null, seen: null, now: NOW })).toBe(null);
    expect(launchOutcome({ running: '0.1.0-new1234', stable: true, state, result: null, seen: null, now: NOW })).toBe(null);
    const st = { current: '0.1.0-old1234', previous: '0.1.0-new1234', bad: [], history: [{ id: '0.1.0-old1234' }, { id: '0.1.0-new1234' }] };
    expect(launchOutcome({ running: '0.1.0-old1234', stable: true, state: st, result: null, seen: { running: '0.1.0-new1234', at: 0 }, now: NOW })).toBe(null);
  });
  it('start outcome: the launcher record written before the start (started still null)', () => {
    const at = new Date(NOW - 3000).toISOString();
    const fresh = { at, wanted: '0.1.0-new1234', started: null, attempts: [] };
    expect(launchOutcome({ running: '0.1.0-new1234', stable: true, state, result: fresh, seen: { running: '0.1.0-old1234', at: 0 }, now: NOW })).toMatchObject({ outcome: 'new' });
    const fell = { at, wanted: '0.1.0-new1234', started: null, attempts: [{ id: '0.1.0-new1234', outcome: 'bad', reason: 'window not ready within 30 s' }] };
    expect(launchOutcome({ running: '0.1.0-old1234', stable: true, state, result: fell, seen: { running: '0.1.0-old1234', at: 0 }, now: NOW })).toMatchObject({ outcome: 'fallback', reason: 'non ha aperto la finestra entro 30 secondi' });
  });
  it('promotion steps from release.mjs output', () => {
    expect(promoteStep('')).toBe('Avvio');
    expect(promoteStep('npm run check …\n> tsc')).toMatch(/Test in corso/);
    expect(promoteStep('npm run check …\nnpm run test:stable …')).toMatch(/stabile/);
    expect(promoteStep('promoted 0.1.0-abc (previous: x)')).toBe('Versione pronta');
  });
  it('the environment of pull.mjs, release.mjs and the launcher drops what this run was started with, keeps the user settings', () => {
    const env = cleanEnv({ PATH: 'p', SB_RELEASE: 'x', SB_ENGINE_CLAUDE: 'e', SB_TEST: '1', SB_HIDDEN: '1', SB_UPDATE_REPO: 'r', SB_UPDATE_STABLE: '1', ELECTRON_RUN_AS_NODE: '1', SB_USER_DATA: 'u', SB_CLAUDE_PATH: 'c', SB_RELEASES_ROOT: 'r', SB_NO_SYNC: '1' });
    expect(env).toEqual({ PATH: 'p', SB_USER_DATA: 'u', SB_CLAUDE_PATH: 'c', SB_RELEASES_ROOT: 'r', SB_NO_SYNC: '1' });
  });
});

// ---- the service on a real repo

const PULL = "const c = process.argv.includes('--check'); const u = process.env.UPTODATE === '1'; console.log(JSON.stringify(c ? { ok: true, check: true, behind: 2, ahead: 0, canUpdate: true, commits: ['abc1234 Uno', 'def5678 Due'], message: '2 aggiornamenti su GitHub.' } : { ok: true, upToDate: u, from: 'aaa', to: u ? 'aaa' : 'bbb', message: 'ok' }));\n";
const RELEASE = "console.log('npm run check …'); setTimeout(() => { if (process.env.FAIL_PROMOTE) { console.error('lint failed'); process.exit(1); } console.log('promoted 0.1.0-test'); }, 50);\n";

function makeRepo(): { dir: string; first: string; tip: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-update-'));
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'scripts', 'release.mjs'), RELEASE);
  fs.writeFileSync(path.join(dir, 'scripts', 'pull.mjs'), PULL);
  g('add', '-A'); g('commit', '-q', '-m', 'start');
  const first = g('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b'); g('add', '-A'); g('commit', '-q', '-m', 'the new thing');
  return { dir, first, tip: g('rev-parse', 'HEAD') };
}

function service(o: { dir: string | null; running: string; stable?: boolean; restartFails?: boolean; userData?: string; base?: string }) {
  const states: AppSourceState[] = [];
  let restarts = 0, relaunches = 0;
  const userData = o.userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ud-'));
  const releasesBase = o.base ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sb-releases-'));
  const s = new AppSourceService({
    userData, releasesBase, running: o.running, stable: o.stable ?? true, appRepo: () => o.dir, devRepo: o.dir,
    emit: st => states.push(st), restart: failed => { restarts++; if (o.restartFails) failed(); }, relaunch: () => { relaunches++; }, node: process.execPath,
  });
  return { s, states, restarts: () => restarts, relaunches: () => relaunches, userData, releasesBase };
}

let repo: ReturnType<typeof makeRepo>;

describe('AppSourceService', { timeout: 30_000 }, () => {
  beforeAll(() => { repo = makeRepo(); }, 60_000);

  it('main\'s tip is the candidate of a stable copy; nothing new when it is in use; a folder that is not this app says so', async () => {
    const older = await service({ dir: repo.dir, running: `0.1.0-${repo.first.slice(0, 7)}` }).s.refresh();
    expect(older).toMatchObject({ repoProblem: null, candidate: { sha: repo.tip.slice(0, 7), subject: 'the new thing' } });
    expect(older.runningAt).toEqual(expect.any(Number));
    expect((await service({ dir: repo.dir, running: `0.1.0-${repo.tip.slice(0, 7)}` }).s.refresh()).candidate).toBe(null);
    const notApp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-notapp-'));
    expect((await service({ dir: notApp, running: '0.1.0-aaaaaaa' }).s.refresh()).repoProblem).toMatch(/release\.mjs/);
    expect((await service({ dir: null, running: 'dev', stable: false }).s.refresh()).repoProblem).toMatch(/Impostazioni/);
  });

  it('pull (ADR 0074, the Orchestrator\'s app_update_code): runs scripts/pull.mjs --json, one at a time; a folder without it says how', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pull-svc-'));
    const { s } = service({ dir, running: 'dev', stable: false });
    await expect(s.pull()).rejects.toThrow(/manca scripts\/pull\.mjs/);
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(path.join(dir, 'scripts', 'pull.mjs'), "setTimeout(() => console.log('build …\\n' + JSON.stringify({ ok: process.argv.includes('--json'), message: 'Aggiornata', from: 'a', to: 'b' })), 100);\n");
    const first = s.pull();
    await expect(s.pull()).rejects.toThrow(/già in corso/);
    expect(await first).toEqual({ ok: true, message: 'Aggiornata', from: 'a', to: 'b' });
  });

  it('Aggiorna on a dev build (ADR 0075): the check counts, the pull relaunches, nothing new says so', async () => {
    const { s, relaunches } = service({ dir: repo.dir, running: 'dev', stable: false });
    expect((await s.sourceCheck()).source).toMatchObject({ state: 'idle', behind: 2, canUpdate: true, commits: ['abc1234 Uno', 'def5678 Due'] });
    expect((await s.updateNow()).source).toMatchObject({ state: 'restarting', canUpdate: false });
    await expect.poll(relaunches, { timeout: 4000 }).toBe(1);
    process.env.UPTODATE = '1';
    try { expect((await s.updateNow()).source).toMatchObject({ state: 'done', message: expect.stringContaining('ultima versione') }); }
    finally { delete process.env.UPTODATE; }
    expect(relaunches()).toBe(1);
  });

  it('Aggiorna on a stable copy: pull, release.mjs promote-now, then the restart; a second click is refused', async () => {
    const { s, restarts } = service({ dir: repo.dir, running: `0.1.0-${repo.first.slice(0, 7)}` });
    expect((await s.updateNow()).source.state).toBe('updating');
    await expect(s.updateNow()).rejects.toThrow(/già in corso/);
    await expect.poll(() => s.state().promote?.state, { timeout: 8000 }).toBe('restarting');
    expect(s.state().promote).toMatchObject({ version: '0.1.0-test', step: 'Riavvio sulla versione nuova' });
    expect(s.state().source).toMatchObject({ state: 'restarting' });
    await expect.poll(restarts, { timeout: 4000 }).toBe(1);
  });

  it('a failed promotion changes nothing and never restarts', async () => {
    process.env.FAIL_PROMOTE = '1';
    try {
      const { s, restarts } = service({ dir: repo.dir, running: `0.1.0-${repo.first.slice(0, 7)}` });
      await s.updateNow();
      await expect.poll(() => s.state().promote?.state, { timeout: 8000 }).toBe('error');
      expect(s.state().promote!.log).toMatch(/lint failed/);
      expect(s.state().source.state).toBe('error');
      await new Promise(res => setTimeout(res, 1700));
      expect(restarts()).toBe(0);
    } finally { delete process.env.FAIL_PROMOTE; }
  });

  it('Aggiorna without a code folder explains and does nothing', async () => {
    const { s } = service({ dir: path.join(os.tmpdir(), 'sb-missing-xyz'), running: 'dev', stable: false });
    expect((await s.sourceCheck()).source).toMatchObject({ canUpdate: false, message: expect.stringContaining('pull.mjs') });
    await expect(s.updateNow()).rejects.toThrow(/pull\.mjs/);
  });

  it('inRepo: the code folder and its git worktrees, nothing else', async () => {
    const { s } = service({ dir: repo.dir, running: 'dev', stable: false });
    expect(await s.inRepo(repo.dir)).toBe(true);
    expect(await s.inRepo(path.join(repo.dir, 'scripts'))).toBe(true);
    expect(await s.inRepo(os.tmpdir())).toBe(false);
    expect(await s.inRepo('relative/dir')).toBe(false);
  });

  it('the start notice: read at construction, told once, dismissable; the old improve-seen.json marker is honored and renamed', () => {
    const a = service({ dir: repo.dir, running: '0.1.0-old1234' });
    fs.writeFileSync(path.join(a.releasesBase, 'current.json'), JSON.stringify({ current: '0.1.0-new1234', previous: '0.1.0-old1234', bad: ['0.1.0-new1234'] }));
    fs.writeFileSync(path.join(a.releasesBase, 'launch-result.json'), JSON.stringify({ at: new Date().toISOString(), wanted: '0.1.0-new1234', started: '0.1.0-old1234', attempts: [{ id: '0.1.0-new1234', outcome: 'bad', reason: 'window not ready within 30 s' }] }));
    const b = service({ dir: repo.dir, running: '0.1.0-old1234', base: a.releasesBase });
    expect(b.s.state().launch).toMatchObject({ outcome: 'fallback', wanted: '0.1.0-new1234' });
    expect(b.s.dismissLaunch().launch).toBe(null);
    expect(service({ dir: repo.dir, running: '0.1.0-old1234', base: a.releasesBase, userData: b.userData }).s.state().launch).toBe(null);
    // a userData from before ADR 0079: the fallback was told under the old name, not told again, the marker renamed
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ud-old-'));
    fs.copyFileSync(path.join(b.userData, 'launch-seen.json'), path.join(old, 'improve-seen.json'));
    expect(service({ dir: repo.dir, running: '0.1.0-old1234', base: a.releasesBase, userData: old }).s.state().launch).toBe(null);
    expect(fs.existsSync(path.join(old, 'improve-seen.json'))).toBe(false);
    expect(fs.existsSync(path.join(old, 'launch-seen.json'))).toBe(true);
  });
});
