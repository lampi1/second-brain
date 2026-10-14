// "Migliora l'app" (src/main/improve, ADR 0020): the stage of each branch from git, whether "Aggiorna" may run and why
// not, how the last start went (new version, or back to the previous one and why, told once), and the service end to
// end on a real temp git repo with a fake release.mjs: the state it reads, a promotion that restarts, one that fails.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ChatSummary, ImproveState, NewChat, RoutingTable } from '../../src/shared/contract';
import { branchStages, checkAt, launchOutcome, nextSeen, promoteGate, promoteStep, reasonText, shaOfRelease } from '../../src/main/improve/stages';
import { appRegiaPrompt, cleanEnv, ImproveService, type ImproveDeps } from '../../src/main/improve/service';
import { routeChat, type RouteRequest } from '../../src/main/brain/routing';
import { DEMO_REGISTRY } from '../../src/main/brain/routing-demo';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-12T10:00:00Z');

describe('stages', () => {
  it('release id → sha; check lookup by full or short sha', () => {
    expect(shaOfRelease('0.1.0-91967ec')).toBe('91967ec');
    expect(shaOfRelease('dev')).toBe(null);
    const checks = { abcdef1234567890: { at: '2026-10-12T09:00:00Z' } };
    expect(checkAt(checks, 'abcdef1')).toBe(Date.parse('2026-10-12T09:00:00Z'));
    expect(checkAt(checks, 'abcdef1234567890ffff')).not.toBe(null);
    expect(checkAt(checks, '1111111')).toBe(null);
  });

  it('a light check (check:branch) counts for a branch, only a full one counts for main (ADR 0027)', () => {
    const at = '2026-10-12T09:00:00Z';
    const checks = { ['a'.repeat(40)]: { at, kind: 'light' as const }, ['b'.repeat(40)]: { at, kind: 'full' as const }, ['c'.repeat(40)]: { at } };
    expect(checkAt(checks, 'aaaaaaa')).toBe(Date.parse(at));
    expect(checkAt(checks, 'aaaaaaa', 'full')).toBe(null);
    expect(checkAt(checks, 'bbbbbbb', 'full')).toBe(Date.parse(at));
    // entries written before the kind existed were full checks
    expect(checkAt(checks, 'ccccccc', 'full')).toBe(Date.parse(at));
    const out = branchStages({ refs: [{ name: 'feat/light', sha: 'a'.repeat(40), at: NOW, subject: '' }], main: 'main', merged: new Set(), inUse: null, checks, now: NOW });
    expect(out[0]).toMatchObject({ stage: 'tested', checkAt: Date.parse(at) });
  });

  it('each branch gets its stage; main, old and extra branches are left out; newest first', () => {
    const refs = [
      { name: 'main', sha: 'm'.repeat(40), at: NOW, subject: 'main' },
      { name: 'feat/work', sha: 'a'.repeat(40), at: NOW - 1000, subject: 'a' },
      { name: 'feat/tested', sha: 'b'.repeat(40), at: NOW - 2000, subject: 'b' },
      { name: 'feat/approved', sha: 'c'.repeat(40), at: NOW - 3000, subject: 'c' },
      { name: 'feat/promoted', sha: 'd'.repeat(40), at: NOW - 4000, subject: 'd' },
      { name: 'feat/old', sha: 'e'.repeat(40), at: NOW - 20 * DAY, subject: 'e' },
    ];
    const out = branchStages({
      refs, main: 'main', merged: new Set(['main', 'feat/approved', 'feat/promoted']), inUse: new Set(['feat/promoted']),
      checks: { ['b'.repeat(40)]: { at: '2026-10-12T09:00:00Z' } }, now: NOW,
      chatOf: b => (b === 'feat/work' ? { id: 'c1', title: 'App · cosa' } : null),
    });
    expect(out.map(b => [b.name, b.stage])).toEqual([['feat/work', 'work'], ['feat/tested', 'tested'], ['feat/approved', 'approved'], ['feat/promoted', 'promoted']]);
    expect(out[0]).toMatchObject({ sha: 'aaaaaaa', chatId: 'c1', chatTitle: 'App · cosa', checkAt: null });
    expect(out[1]!.checkAt).not.toBe(null);
  });

  it('a merged branch with an unknown version in use stays "approved"', () => {
    const out = branchStages({ refs: [{ name: 'x', sha: 'c'.repeat(40), at: NOW, subject: '' }], main: 'main', merged: new Set(['x']), inUse: null, checks: {}, now: NOW });
    expect(out[0]!.stage).toBe('approved');
  });

  const gate = (o: Partial<Parameters<typeof promoteGate>[0]> = {}) => promoteGate({
    stable: true, repo: 'C:/code', repoProblem: null, branch: 'main', main: 'main', dirty: false, mainSha: 'b'.repeat(40), runningSha: 'aaaaaaa', busy: false, node: true, mainChecked: true, ...o,
  });
  it('Aggiorna: on with something new on a clean main; off with the reason otherwise', () => {
    expect(gate()).toEqual({ ok: true, why: '' });
    expect(gate({ stable: false }).why).toMatch(/app stabile/);
    expect(gate({ repo: null }).why).toMatch(/cartella del codice/);
    expect(gate({ branch: 'feat/x' }).why).toMatch(/feat\/x/);
    expect(gate({ dirty: true }).why).toMatch(/non salvate/);
    expect(gate({ mainSha: 'aaaaaaa'.padEnd(40, '0') }).why).toMatch(/già in uso/);
    expect(gate({ busy: true }).why).toMatch(/in corso/);
    expect(gate({ node: false }).why).toMatch(/Node/);
    expect(gate({ repoProblem: 'Git non legge' }).ok).toBe(false);
    // main's tip without a full `npm run check` (only a light one, or none): off, the Regia runs it first
    expect(gate({ mainChecked: false })).toEqual({ ok: false, why: expect.stringMatching(/test completi.*npm run check/) });
  });

  const state = { current: '0.1.0-new1234', previous: '0.1.0-old1234', bad: [] as string[] };
  it('start outcome: the new version came up (once)', () => {
    const seen = { running: '0.1.0-old1234', at: NOW - DAY };
    const l = launchOutcome({ running: '0.1.0-new1234', stable: true, state, result: null, seen, now: NOW });
    expect(l).toMatchObject({ outcome: 'new', running: '0.1.0-new1234' });
    // the next start of the same version says nothing
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
  it('start outcome: nothing for a dev build, a first start, the same version', () => {
    expect(launchOutcome({ running: 'dev', stable: false, state, result: null, seen: null, now: NOW })).toBe(null);
    expect(launchOutcome({ running: '0.1.0-new1234', stable: true, state, result: null, seen: null, now: NOW })).toBe(null);
  });
  it('start outcome: the record of the start before (new version came up fine) is no fallback', () => {
    const result = { at: new Date(NOW - 60_000).toISOString(), wanted: '0.1.0-old1234', started: '0.1.0-old1234', attempts: [{ id: '0.1.0-old1234', outcome: 'started', reason: 'window ready after 2 s' }] };
    const l = launchOutcome({ running: '0.1.0-new1234', stable: true, state, result, seen: { running: '0.1.0-old1234', at: 0 }, now: NOW });
    expect(l).toMatchObject({ outcome: 'new', running: '0.1.0-new1234' });
  });
  it('start outcome: the launcher record written before the start (started still null)', () => {
    const at = new Date(NOW - 3000).toISOString();
    // the wanted release is the one starting: no attempt yet, nothing about a fallback
    const fresh = { at, wanted: '0.1.0-new1234', started: null, attempts: [] };
    expect(launchOutcome({ running: '0.1.0-new1234', stable: true, state, result: fresh, seen: { running: '0.1.0-old1234', at: 0 }, now: NOW })).toMatchObject({ outcome: 'new' });
    expect(launchOutcome({ running: '0.1.0-new1234', stable: true, state, result: fresh, seen: { running: '0.1.0-new1234', at: 0 }, now: NOW })).toBe(null);
    // the wanted release failed, the previous one is starting: the launcher's reason, started still null
    const fell = { at, wanted: '0.1.0-new1234', started: null, attempts: [{ id: '0.1.0-new1234', outcome: 'bad', reason: 'window not ready within 30 s' }] };
    expect(launchOutcome({ running: '0.1.0-old1234', stable: true, state, result: fell, seen: { running: '0.1.0-old1234', at: 0 }, now: NOW })).toMatchObject({ outcome: 'fallback', wanted: '0.1.0-new1234', reason: 'non ha aperto la finestra entro 30 secondi' });
  });
  it('start outcome: back to an older release by hand (rollback) is not "the new version"', () => {
    const st = { current: '0.1.0-old1234', previous: '0.1.0-new1234', bad: [], history: [{ id: '0.1.0-old1234' }, { id: '0.1.0-new1234' }] };
    expect(launchOutcome({ running: '0.1.0-old1234', stable: true, state: st, result: null, seen: { running: '0.1.0-new1234', at: 0 }, now: NOW })).toBe(null);
  });
  it('a branch just created from main, with nothing of its own, is work', () => {
    const sha = 'f'.repeat(40);
    const out = branchStages({ refs: [{ name: 'feat/nuova', sha, at: NOW, subject: 'main tip' }], main: 'main', mainSha: sha, merged: new Set(['feat/nuova']), inUse: new Set(['feat/nuova']), checks: {}, now: NOW });
    expect(out[0]!.stage).toBe('work');
  });
  it('Aggiorna stays off for a version that did not start last time', () => {
    expect(gate({ failedBefore: true }).why).toMatch(/non è partita/);
  });
  it('promotion steps from release.mjs output', () => {
    expect(promoteStep('')).toBe('Avvio');
    expect(promoteStep('npm run check …\n> tsc')).toMatch(/Test in corso/);
    expect(promoteStep('npm run check …\nnpm run test:stable …')).toMatch(/stabile/);
    expect(promoteStep('npm run test:stable …\nsharing Electron 44 runtime …')).toBe('Copia della versione');
    expect(promoteStep('promoted 0.1.0-abc (previous: x)')).toBe('Versione pronta');
  });
  it('the environment of the promotion drops what this run was started with, keeps the user settings', () => {
    const env = cleanEnv({ PATH: 'p', SB_RELEASE: 'x', SB_ENGINE_CLAUDE: 'e', SB_TEST: '1', SB_HIDDEN: '1', SB_IMPROVE_REPO: 'r', ELECTRON_RUN_AS_NODE: '1', SB_USER_DATA: 'u', SB_CLAUDE_PATH: 'c', SB_RELEASES_ROOT: 'r', SB_NO_SYNC: '1' });
    expect(env).toEqual({ PATH: 'p', SB_USER_DATA: 'u', SB_CLAUDE_PATH: 'c', SB_RELEASES_ROOT: 'r', SB_NO_SYNC: '1' });
  });
});

// ---- the service on a real repo

function repoWithHistory(): { dir: string; base: string; m1: string; m2: string; b1: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-improve-'));
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  const commit = (file: string, msg: string) => { fs.writeFileSync(path.join(dir, file), msg); g('add', '-A'); g('commit', '-q', '-m', msg); return g('rev-parse', 'HEAD'); };
  g('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'scripts', 'release.mjs'), "console.log('npm run check …'); setTimeout(() => { if (process.env.FAIL_PROMOTE) { console.error('lint failed'); process.exit(1); } console.log('promoted 0.1.0-test'); }, 50);\n");
  commit('a.txt', 'start');
  g('checkout', '-q', '-b', 'feat/promoted'); commit('d.txt', 'promoted change');
  g('checkout', '-q', 'main'); g('merge', '-q', '--no-ff', '-m', 'merge promoted', 'feat/promoted');
  const m1 = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'feat/approved'); commit('c.txt', 'approved change');
  g('checkout', '-q', 'main'); g('merge', '-q', '--no-ff', '-m', 'merge approved', 'feat/approved');
  const m2 = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'feat/tested'); const b1 = commit('b.txt', 'tested change');
  g('checkout', '-q', 'main'); g('checkout', '-q', '-b', 'feat/work'); commit('w.txt', 'work in progress');
  g('checkout', '-q', 'main');
  fs.writeFileSync(path.join(g('rev-parse', '--git-common-dir').replace(/^\.git$/, path.join(dir, '.git')), 'sb-checks.json'), JSON.stringify({ [b1]: { at: new Date().toISOString(), kind: 'light' }, [m2]: { at: new Date().toISOString(), kind: 'full' } }));
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-releases-'));
  return { dir, base, m1, m2, b1 };
}

function service(o: { dir: string; base: string; running: string; stable?: boolean; env?: Record<string, string>; restartFails?: boolean; routing?: ImproveDeps['routing'] }) {
  const states: ImproveState[] = [];
  const created: NewChat[] = [];
  let restarts = 0;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ud-'));
  const s = new ImproveService({
    userData, releasesBase: o.base, running: o.running, stable: o.stable ?? true, appRepo: () => o.dir, devRepo: null,
    chats: { list: () => [] as ChatSummary[], create: async (r: NewChat) => { created.push(r); return { id: 'x', harness: r.harness } as ChatSummary; } },
    emit: st => states.push(st), restart: failed => { restarts++; if (o.restartFails) failed(); }, node: process.execPath,
    ...(o.routing ? { routing: o.routing } : {}),
  });
  return { s, states, created, restarts: () => restarts, userData };
}

// one repo for every test (git on Windows takes a few seconds for the ~20 commands); promotions never change it
type Repo = ReturnType<typeof repoWithHistory>;
let repo: Repo;
const fresh = () => ({ ...repo, base: fs.mkdtempSync(path.join(os.tmpdir(), 'sb-releases-')) });

describe('ImproveService', { timeout: 30_000 }, () => {
  beforeAll(() => { repo = repoWithHistory(); }, 120_000);
  it('reads the stages, the candidate and the gate from git', async () => {
    const r = fresh();
    const { s } = service({ dir: r.dir, base: r.base, running: `0.1.0-${r.m1.slice(0, 7)}` });
    const st = await s.refresh();
    const stage = Object.fromEntries(st.branches.map(b => [b.name, b.stage]));
    expect(stage).toEqual({ 'feat/work': 'work', 'feat/tested': 'tested', 'feat/approved': 'approved', 'feat/promoted': 'promoted' });
    expect(st.candidate).toMatchObject({ sha: r.m2.slice(0, 7), subject: 'merge approved', checkAt: expect.any(Number) });
    expect(st.canPromote).toBe(true);
    expect(st.repoProblem).toBe(null);
  });

  it("main's tip with only a light check: Aggiorna off until the full check", async () => {
    const r = fresh();
    const file = path.join(r.dir, '.git', 'sb-checks.json');
    const before = fs.readFileSync(file, 'utf8');
    try {
      fs.writeFileSync(file, JSON.stringify({ [r.m2]: { at: new Date().toISOString(), kind: 'light' } }));
      const { s } = service({ dir: r.dir, base: r.base, running: `0.1.0-${r.m1.slice(0, 7)}` });
      const st = await s.refresh();
      expect(st.candidate).toMatchObject({ sha: r.m2.slice(0, 7), checkAt: null });
      expect(st.canPromote).toBe(false);
      expect(st.promoteWhy).toMatch(/test completi/);
    } finally { fs.writeFileSync(file, before); }
  });

  it('nothing new: Aggiorna off with the reason', async () => {
    const r = fresh();
    const { s } = service({ dir: r.dir, base: r.base, running: `0.1.0-${r.m2.slice(0, 7)}` });
    const st = await s.refresh();
    expect(st.candidate).toBe(null);
    expect(st.canPromote).toBe(false);
    expect(st.promoteWhy).toMatch(/già in uso/);
  });

  it('a folder that is not this app: a clear problem, no crash', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-notapp-'));
    const { s } = service({ dir, base: dir, running: '0.1.0-aaaaaaa' });
    const st = await s.refresh();
    expect(st.repoProblem).toMatch(/release\.mjs/);
    expect(st.canPromote).toBe(false);
  });

  it('Aggiorna: runs release.mjs promote, then restarts', async () => {
    const r = fresh();
    const { s, states, restarts } = service({ dir: r.dir, base: r.base, running: `0.1.0-${r.m1.slice(0, 7)}` });
    // a second click while git is still read never starts a second promotion
    const [first, second] = await Promise.allSettled([s.promote(), s.promote()]);
    expect(first.status).toBe('fulfilled');
    expect(second).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/in corso/) }) });
    await expect.poll(() => s.state().promote?.state, { timeout: 8000 }).toBe('restarting');
    expect(s.state().promote).toMatchObject({ version: '0.1.0-test', step: 'Riavvio sulla versione nuova' });
    expect(states.some(x => x.promote?.state === 'running')).toBe(true);
    await expect.poll(restarts, { timeout: 4000 }).toBe(1);
    await expect(s.promote()).rejects.toThrow(/in corso/);
  });

  it('a restart that cannot start: the section says so and Aggiorna is free again', async () => {
    const r = fresh();
    const { s, restarts } = service({ dir: r.dir, base: r.base, running: `0.1.0-${r.m1.slice(0, 7)}`, restartFails: true });
    await s.promote();
    await expect.poll(restarts, { timeout: 10_000 }).toBe(1);
    expect(s.state().promote).toMatchObject({ state: 'error', step: expect.stringMatching(/riavvio non è partito/) });
  });

  it('a failed promotion changes nothing and never restarts', async () => {
    const r = fresh();
    process.env.FAIL_PROMOTE = '1';
    try {
      const { s, restarts } = service({ dir: r.dir, base: r.base, running: `0.1.0-${r.m1.slice(0, 7)}` });
      await s.promote();
      await expect.poll(() => s.state().promote?.state, { timeout: 8000 }).toBe('error');
      expect(s.state().promote!.log).toMatch(/lint failed/);
      expect(s.state().promote!.step).toMatch(/Non aggiornata/);
      await new Promise(res => setTimeout(res, 1700));
      expect(restarts()).toBe(0);
    } finally { delete process.env.FAIL_PROMOTE; }
  });

  it('refuses to promote from a dev build', async () => {
    const r = fresh();
    const { s } = service({ dir: r.dir, base: r.base, running: 'dev', stable: false });
    await expect(s.promote()).rejects.toThrow(/app stabile/);
  });

  it('the start notice: read at construction, told once, dismissable', () => {
    const r = fresh();
    fs.writeFileSync(path.join(r.base, 'current.json'), JSON.stringify({ current: '0.1.0-new1234', previous: '0.1.0-old1234', bad: ['0.1.0-new1234'] }));
    fs.writeFileSync(path.join(r.base, 'launch-result.json'), JSON.stringify({ at: new Date().toISOString(), wanted: '0.1.0-new1234', started: '0.1.0-old1234', attempts: [{ id: '0.1.0-new1234', outcome: 'bad', reason: 'window not ready within 30 s' }] }));
    const a = service({ dir: r.dir, base: r.base, running: '0.1.0-old1234' });
    expect(a.s.state().launch).toMatchObject({ outcome: 'fallback', wanted: '0.1.0-new1234' });
    expect(a.s.dismissLaunch().launch).toBe(null);
    // a second start with the same userData: already told
    const again = new ImproveService({ userData: a.userData, releasesBase: r.base, running: '0.1.0-old1234', stable: true, appRepo: () => r.dir, devRepo: null, chats: { list: () => [], create: async () => ({}) as ChatSummary }, emit: () => {}, restart: () => {}, node: null });
    expect(again.state().launch).toBe(null);
  });

  it('creates the section\'s Regia in the code folder, with its role', async () => {
    const r = fresh();
    const { s, created } = service({ dir: r.dir, base: r.base, running: 'dev', stable: false });
    await s.createRegia('claude', 'claude-opus-5-5');
    expect(created[0]).toMatchObject({ harness: 'claude', cwd: r.dir, space: 'app', appRegia: true, model: 'claude-opus-5-5', title: "Regia dell'app" });
    expect(created[0]!.prompt).toBe(appRegiaPrompt(r.dir));
    expect(appRegiaPrompt(r.dir)).toMatch(/Non aggiorni e non riavvii mai/);
  });

  it('with the routing table: kind regia, area App, the engine the user picked; the route on the chat', async () => {
    const r = fresh();
    const table: RoutingTable = { version: 5, appliedAt: null, by: null, exploration: 0, costWeight: 7, routes: [
      { kind: '*', area: ['App', 'Pers · App'], harness: 'claude', model: 'claude-opus-5-5', effort: 'medium', why: 'app: Opus medio', since: '2026-10-14', evidence: 'regola' },
    ] };
    const routing = { route: (req: RouteRequest) => routeChat(req, table, DEMO_REGISTRY, null, 9), engineOn: () => true, agentsMayOpen: () => true };
    const { s, created } = service({ dir: r.dir, base: r.base, running: 'dev', stable: false, routing });
    await s.createRegia('claude');
    expect(created[0]).toMatchObject({ harness: 'claude', model: 'claude-opus-5-5', effort: 'medium', space: 'app', appRegia: true, cwd: r.dir,
      route: { source: 'table', kind: 'regia', area: 'App', version: 5 } });
    expect(created[0]!.prompt).toBe(appRegiaPrompt(r.dir));
    // the app's chats only on appChats's engine (ADR 0032 hard rule, ADR 0046): refused on Cursor, nothing created
    await expect(s.createRegia('cursor')).rejects.toThrow(/sull’app vanno solo su Claude/);
    expect(created).toHaveLength(1);
  });
});
