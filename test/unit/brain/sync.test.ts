// The domains' multi-PC sync (src/main/brain/sync.ts + guard.ts, ADR 0059) with real git: a local bare repo in a temp
// folder stands in for the private remote, two clones for two PCs. Push and pull, a conflict that stops the sync until
// the user chooses (mine / theirs / both), the publish guard (a fake scan.mjs with the real command line) blocking a push
// with file:line and never the value, the missing guard failing closed (also when only the product's deny.txt is there:
// a domain uses its own list, default deny-work.txt), a this-pc domain never syncing, a new empty
// remote, and the lock of a second writer. Never touches a real repo.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readDomain } from '../../../src/main/brain/domains';
import { findGuard } from '../../../src/main/brain/guard';
import { DomainSync, syncBeforeCreate } from '../../../src/main/brain/sync';
import type { DomainSyncStatus, SyncState } from '../../../src/shared/contract';
import { plainNode, tmpDir } from './helpers';

const FAKE_SCAN = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'sync', 'fake-scan.mjs');
const WORD = 'ACME-CLIENTE-SEGRETO';
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function guardDir(denyList = 'deny-work.txt'): string {
  const d = tmpDir('sb-guard-');
  fs.copyFileSync(FAKE_SCAN, path.join(d, 'scan.mjs'));
  fs.writeFileSync(path.join(d, denyList), `# test\n${WORD}\n`);
  return d;
}

function setupUser(dir: string): void { git(dir, 'config', 'user.name', 'Test'); git(dir, 'config', 'user.email', 'test@example.com'); }

/** A bare remote with one commit (domain.json + notes.md), and `n` clones of it. */
function world(n: number, opts: { scope?: 'everywhere' | 'this-pc'; empty?: boolean; denyList?: string } = {}): { bare: string; pcs: string[] } {
  const bare = path.join(tmpDir('sb-remote-'), 'personal.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  const seed = tmpDir('sb-seed-');
  git(seed, 'init', '-q', '-b', 'main');
  setupUser(seed);
  fs.writeFileSync(path.join(seed, 'domain.json'), JSON.stringify({ name: 'Personale', scope: opts.scope ?? 'everywhere', remote: bare, ...(opts.denyList ? { denyList: opts.denyList } : {}) }));
  fs.writeFileSync(path.join(seed, 'notes.md'), '# Note\n\nriga uno\n');
  git(seed, 'add', '-A'); git(seed, 'commit', '-q', '-m', 'seed');
  if (opts.empty) return { bare, pcs: [seed] };
  git(seed, 'push', '-q', bare, 'HEAD:refs/heads/main');
  const pcs = Array.from({ length: n }, () => {
    const d = path.join(tmpDir('sb-pc-'), 'personale');
    execFileSync('git', ['clone', '-q', bare, d]);
    setupUser(d);
    return d;
  });
  return { bare, pcs };
}

const made: DomainSync[] = [];
function syncer(dir: string, guard: string | null = guardDir(), opts: { node?: typeof plainNode; settleMs?: number } = {}) {
  const states: SyncState[] = [];
  const blocked: DomainSyncStatus[] = [];
  const ud = tmpDir('sb-ud-');
  const s = new DomainSync({
    domains: () => [readDomain(dir)],
    guard: d => (guard ? findGuard(d.denyList, { SB_PUBLISH_DIR: guard }, d.name) : null),
    node: opts.node ?? plainNode, stateFile: path.join(ud, 'sync-state.json'), conflictsDir: path.join(ud, 'conflicts'),
    onState: st => states.push(st), onBlocked: d => blocked.push(d), watch: false, settleMs: opts.settleMs,
  });
  made.push(s);
  const one = () => s.state().domains[0]!;
  return { s, states, blocked, one, ud };
}
const SLOW = 180_000; // real git + node per step; slow when the machine is busy
/** A file as text, line endings normalised (core.autocrlf may be on, as on the owner's PC). */
const readText = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const remoteFile = (bare: string, f: string) => git(bare, 'show', `main:${f}`);

afterEach(() => { for (const s of made.splice(0)) s.stop(); });

describe('domain sync (real git, temp bare remote)', () => {
  it('a change on one PC is committed, guarded and pushed; the other PC pulls it', async () => {
    const { bare, pcs: [a, b] } = world(2);
    const A = syncer(a!), B = syncer(b!);
    fs.writeFileSync(path.join(a!, 'idea.md'), 'una idea nuova\n');
    await A.s.sync('Personale');
    expect(A.one()).toMatchObject({ state: 'idle', blocked: null, ahead: 0, behind: 0 });
    expect(A.one().lastSync).toBeTypeOf('number');
    expect(remoteFile(bare, 'idea.md')).toBe('una idea nuova');
    // the app's commit: a neutral identity and no host name, never the user's global git identity
    expect(git(bare, 'log', '-1', '--format=%s', 'main')).toMatch(/^sync: \d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(git(bare, 'log', '-1', '--format=%an <%ae>|%cn <%ce>', 'main')).toBe('second-brain <sync@example.com>|second-brain <sync@example.com>');
    await B.s.sync('Personale');
    expect(readText(path.join(b!, 'idea.md'))).toBe('una idea nuova\n');
    expect(B.one().state).toBe('idle');
    // the last sync survives a restart
    expect(JSON.parse(fs.readFileSync(path.join(A.ud, 'sync-state.json'), 'utf8')).lastSync.Personale).toBe(A.one().lastSync);
  }, SLOW);

  it('a conflict stops that domain until the user chooses; nothing is resolved by itself; "both" writes the two versions', async () => {
    const { bare, pcs: [a, b] } = world(2);
    const A = syncer(a!), B = syncer(b!);
    fs.writeFileSync(path.join(a!, 'notes.md'), '# Note\n\nriga di A\n');
    await A.s.sync('Personale');
    fs.writeFileSync(path.join(b!, 'notes.md'), '# Note\n\nriga di B\n');
    await B.s.sync('Personale');
    expect(B.one().state).toBe('blocked');
    expect(B.one().blocked).toEqual({ kind: 'conflict', files: ['notes.md'] });
    expect(B.blocked).toHaveLength(1);
    // the folder is as the user left it: no rebase in progress, their text still there
    expect(readText(path.join(b!, 'notes.md'))).toContain('riga di B');
    expect(fs.existsSync(path.join(b!, '.git', 'rebase-merge'))).toBe(false);
    // a later sync does nothing while it waits for the user
    await B.s.sync('Personale');
    expect(B.one().state).toBe('blocked');
    expect(remoteFile(bare, 'notes.md')).toContain('riga di A');

    const both = await B.s.resolve('Personale', 'both');
    const block = both.domains[0]!.blocked!;
    expect(block.kind).toBe('conflict');
    const copies = block.kind === 'conflict' ? block.copies ?? [] : [];
    expect(copies.map(f => path.basename(f)).sort()).toEqual(['notes.loro.md.txt', 'notes.mia.md.txt']); // .txt: opening a copy never runs it
    expect(fs.readFileSync(copies.find(f => f.includes('.mia.'))!, 'utf8')).toContain('riga di B');
    expect(fs.readFileSync(copies.find(f => f.includes('.loro.'))!, 'utf8')).toContain('riga di A');

    await B.s.resolve('Personale', 'mine');
    expect(B.one()).toMatchObject({ state: 'idle', blocked: null });
    expect(remoteFile(bare, 'notes.md')).toContain('riga di B');
  }, SLOW);

  it('"keep theirs" takes the other PC\'s lines and keeps this PC\'s other changes', async () => {
    const { bare, pcs: [a, b] } = world(2);
    const A = syncer(a!), B = syncer(b!);
    fs.writeFileSync(path.join(a!, 'notes.md'), '# Note\n\nriga di A\n');
    await A.s.sync('Personale');
    fs.writeFileSync(path.join(b!, 'notes.md'), '# Note\n\nriga di B\n');
    fs.writeFileSync(path.join(b!, 'altro.md'), 'solo B\n');
    await B.s.sync('Personale');
    expect(B.one().blocked?.kind).toBe('conflict');
    await B.s.resolve('Personale', 'theirs');
    expect(B.one().state).toBe('idle');
    expect(readText(path.join(b!, 'notes.md'))).toContain('riga di A');
    expect(remoteFile(bare, 'altro.md')).toBe('solo B');
  }, SLOW);

  it('the guard blocks a push with file:line + rule, never the value; once removed the app\'s commits are squashed and nothing reaches the remote\'s history', async () => {
    const { bare, pcs: [a] } = world(1);
    const A = syncer(a!);
    const before = git(bare, 'rev-parse', 'main');
    fs.writeFileSync(path.join(a!, 'lavoro.md'), `# Lavoro\n\nil cliente ${WORD} chiama\n`);
    await A.s.sync('Personale');
    expect(A.one().state).toBe('blocked');
    expect(A.one().blocked).toEqual({ kind: 'guard', findings: [{ file: 'lavoro.md', line: 3, rule: 'deny-list', commit: expect.any(String) }] });
    expect(JSON.stringify(A.states)).not.toContain(WORD);
    expect(JSON.stringify(A.blocked)).not.toContain(WORD);
    expect(git(bare, 'rev-parse', 'main')).toBe(before);

    fs.writeFileSync(path.join(a!, 'lavoro.md'), '# Lavoro\n\nil cliente chiama\n');
    await A.s.sync('Personale');
    expect(A.one()).toMatchObject({ state: 'idle', blocked: null });
    expect(git(bare, 'rev-list', '--count', `${before}..main`)).toBe('1'); // one squashed commit
    expect(git(bare, 'log', '-p', 'main')).not.toContain(WORD);
  }, SLOW);

  it('the user\'s own commits are never rewritten: the block stays until they fix their history', async () => {
    const { bare, pcs: [a] } = world(1);
    const A = syncer(a!);
    const before = git(bare, 'rev-parse', 'main');
    fs.writeFileSync(path.join(a!, 'x.md'), `${WORD}\n`);
    git(a!, 'add', '-A'); git(a!, 'commit', '-q', '-m', 'mio commit');
    await A.s.sync('Personale');
    expect(A.one().blocked?.kind).toBe('guard');
    fs.writeFileSync(path.join(a!, 'x.md'), 'pulito\n');
    await A.s.sync('Personale');
    expect(A.one().blocked?.kind).toBe('guard');
    expect(git(a!, 'log', '--format=%s')).toContain('mio commit');
    expect(git(bare, 'rev-parse', 'main')).toBe(before);
  }, SLOW);

  it('no guard on this PC: the push is blocked with a hint (fail closed)', async () => {
    const { bare, pcs: [a] } = world(1);
    const A = syncer(a!, null);
    const before = git(bare, 'rev-parse', 'main');
    fs.writeFileSync(path.join(a!, 'idea.md'), 'x\n');
    await A.s.sync('Personale');
    expect(A.one().blocked).toMatchObject({ kind: 'no-guard', hint: expect.stringContaining('scan.mjs') });
    expect(git(bare, 'rev-parse', 'main')).toBe(before);
  }, SLOW);

  it('a domain uses its own deny list: only the product\'s deny.txt is not enough (fail closed); domain.json `denyList` picks another', async () => {
    const { bare, pcs: [a] } = world(1);
    const A = syncer(a!, guardDir('deny.txt'));
    const before = git(bare, 'rev-parse', 'main');
    fs.writeFileSync(path.join(a!, 'idea.md'), 'x\n');
    await A.s.sync('Personale');
    expect(A.one().blocked).toMatchObject({ kind: 'no-guard', hint: expect.stringContaining('deny-work.txt') });
    expect(git(bare, 'rev-parse', 'main')).toBe(before);

    const own = world(1, { denyList: 'deny-personale.txt' });
    const B = syncer(own.pcs[0]!, guardDir('deny-personale.txt'));
    fs.writeFileSync(path.join(own.pcs[0]!, 'lavoro.md'), `${WORD}\n`);
    await B.s.sync('Personale');
    expect(B.one().blocked).toMatchObject({ kind: 'guard', findings: [{ file: 'lavoro.md', line: 1, rule: 'deny-list' }] });
  }, SLOW);

  it('a this-pc domain never syncs, even with a remote in its file; a folder without domain.json neither', async () => {
    const { bare, pcs: [a] } = world(1, { scope: 'this-pc' });
    const A = syncer(a!);
    expect(A.one()).toMatchObject({ state: 'off', remote: null, scope: 'this-pc' });
    expect(A.one().problem).toMatch(/solo questo PC/);
    const before = git(bare, 'rev-parse', 'main');
    fs.writeFileSync(path.join(a!, 'idea.md'), 'x\n');
    await A.s.sync('Personale');
    await A.s.syncAll();
    expect(git(bare, 'rev-parse', 'main')).toBe(before);
    expect(git(a!, 'status', '--porcelain')).toContain('idea.md'); // not even committed

    const plain = tmpDir('sb-plain-');
    const P = syncer(plain);
    expect(P.one()).toMatchObject({ state: 'off', scope: 'this-pc', remote: null, problem: null });
  }, SLOW);

  it('a new empty remote gets its first push', async () => {
    const { bare, pcs: [seed] } = world(1, { empty: true });
    const A = syncer(seed!);
    await A.s.sync('Personale');
    expect(A.one()).toMatchObject({ state: 'idle', blocked: null });
    expect(remoteFile(bare, 'notes.md')).toContain('riga uno');
  }, SLOW);

  it('a second writer on this PC (the lock in .git) makes the cycle wait; nothing pushed meanwhile', async () => {
    const { bare, pcs: [a] } = world(1);
    const A = syncer(a!);
    fs.writeFileSync(path.join(a!, '.git', 'sb-sync.lock'), 'other\n');
    const before = git(bare, 'rev-parse', 'main');
    fs.writeFileSync(path.join(a!, 'idea.md'), 'x\n');
    await A.s.sync('Personale');
    expect(git(bare, 'rev-parse', 'main')).toBe(before);
    expect(A.one().state).toBe('idle');
    fs.unlinkSync(path.join(a!, '.git', 'sb-sync.lock'));
    await A.s.sync('Personale');
    expect(remoteFile(bare, 'idea.md')).toBe('x');
  }, SLOW);

  it('a git operation left in progress is reported, not forced', async () => {
    const { pcs: [a] } = world(1);
    const A = syncer(a!);
    fs.writeFileSync(path.join(a!, '.git', 'MERGE_HEAD'), '0000000000000000000000000000000000000000\n');
    await A.s.sync('Personale');
    expect(A.one().blocked).toMatchObject({ kind: 'error', message: expect.stringContaining('operazione git') });
    expect(A.blocked).toHaveLength(0); // a transient error is not a feed alarm
  }, SLOW);
});

/** A git hook (sh, as git for Windows runs it) that does `body` once: a flag file outside the repo. */
function hookOnce(repo: string, name: string, body: string): void {
  const flag = path.join(tmpDir('sb-flag-'), 'done').replace(/\\/g, '/');
  const f = path.join(repo, '.git', 'hooks', name);
  fs.writeFileSync(f, `#!/bin/sh\n[ -f "${flag}" ] && exit 0\ntouch "${flag}"\n${body}\n`);
  fs.chmodSync(f, 0o755);
}
const sh = (p: string) => `"${p.replace(/\\/g, '/')}"`;

describe('domain sync: review fixes (ADR 0059)', () => {
  it('an edit made while the sync rebases is never reset, even when the rebase ends in a conflict', async () => {
    const { pcs: [a, b] } = world(2);
    const A = syncer(a!), B = syncer(b!);
    fs.writeFileSync(path.join(a!, 'notes.md'), '# Note\n\nriga di A\n');
    await A.s.sync('Personale');
    fs.writeFileSync(path.join(b!, 'notes.md'), '# Note\n\nriga di B\n');
    // the user (or an agent) writes while the sync runs: a checkout during the rebase is the moment
    hookOnce(b!, 'post-checkout', `echo "scritto durante la sync" >> ${sh(path.join(b!, 'notes.md'))}`);
    await B.s.sync('Personale');
    expect(B.one().blocked).toEqual({ kind: 'conflict', files: ['notes.md'] });
    const text = readText(path.join(b!, 'notes.md'));
    expect(text).toContain('riga di B');
    expect(text).toContain('scritto durante la sync');
  }, SLOW);

  it('a change made during a cycle is synced by a cycle of its own, not dropped', async () => {
    const { bare, pcs: [a] } = world(1);
    const A = syncer(a!, guardDir(), { settleMs: 200 });
    fs.writeFileSync(path.join(a!, 'idea.md'), 'x\n');
    hookOnce(a!, 'post-commit', `echo "arrivata dopo" > ${sh(path.join(a!, 'dopo.md'))}`);
    await A.s.sync('Personale');
    expect(remoteFile(bare, 'idea.md')).toBe('x');
    const t = Date.now();
    let got = '';
    while (Date.now() - t < 120_000 && !got) {
      try { got = remoteFile(bare, 'dopo.md'); } catch { await new Promise(r => setTimeout(r, 200)); }
    }
    expect(got).toBe('arrivata dopo');
  }, SLOW);

  it('a file changed between the commit and the rebase is committed and the sync retries: never a conflict', async () => {
    const { bare, pcs: [a, b] } = world(2);
    const lines = (over: Record<number, string>) => Array.from({ length: 10 }, (_, i) => over[i + 1] ?? `riga ${i + 1}`).join('\n') + '\n';
    fs.writeFileSync(path.join(a!, 'notes.md'), lines({}));
    const A = syncer(a!), B = syncer(b!);
    await A.s.sync('Personale');
    await B.s.sync('Personale');
    fs.writeFileSync(path.join(a!, 'notes.md'), lines({ 2: 'riga 2 di A' }));
    await A.s.sync('Personale');
    fs.writeFileSync(path.join(b!, 'notes.md'), lines({ 9: 'riga 9 di B' }));
    hookOnce(b!, 'post-commit', `echo "aggiunta durante la sync" >> ${sh(path.join(b!, 'notes.md'))}`);
    await B.s.sync('Personale');
    expect(B.one()).toMatchObject({ state: 'idle', blocked: null });
    const remote = remoteFile(bare, 'notes.md');
    expect(remote).toContain('riga 2 di A');
    expect(remote).toContain('riga 9 di B');
    expect(remote).toContain('aggiunta durante la sync');
  }, SLOW);

  it('exactly the scanned commit is pushed: a commit made during the scan waits for its own scan', async () => {
    const { bare, pcs: [a] } = world(1);
    const g = guardDir();
    fs.renameSync(path.join(g, 'scan.mjs'), path.join(g, 'fake.mjs'));
    // a scanner that, while it runs, sees a commit with the word land in the domain (once), then answers as the fake one
    fs.writeFileSync(path.join(g, 'scan.mjs'), [
      "import { execFileSync, spawnSync } from 'node:child_process';",
      "import fs from 'node:fs';",
      "import path from 'node:path';",
      'const dom = process.env.SB_TEST_DOMAIN;',
      "const flag = path.join(process.env.SB_TEST_FLAG, 'done');",
      'if (!fs.existsSync(flag)) {',
      "  fs.writeFileSync(flag, '');",
      `  fs.writeFileSync(path.join(dom, 'tardi.md'), '${WORD}\\n');`,
      "  execFileSync('git', ['-C', dom, 'add', '-A']);",
      "  execFileSync('git', ['-C', dom, 'commit', '-q', '-m', 'durante il controllo']);",
      '}',
      "const r = spawnSync(process.execPath, [path.join(import.meta.dirname, 'fake.mjs'), ...process.argv.slice(2)], { encoding: 'utf8' });",
      'process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(r.status ?? 1);',
      '',
    ].join('\n'));
    const node = { exe: process.execPath, env: { ...process.env, SB_TEST_DOMAIN: a!, SB_TEST_FLAG: tmpDir('sb-flag-') } };
    const A = syncer(a!, g, { node });
    fs.writeFileSync(path.join(a!, 'idea.md'), 'x\n');
    await A.s.sync('Personale');
    expect(remoteFile(bare, 'idea.md')).toBe('x');
    expect(() => remoteFile(bare, 'tardi.md')).toThrow();
    await A.s.sync('Personale');
    expect(A.one().blocked).toMatchObject({ kind: 'guard', findings: [{ file: 'tardi.md', line: 1 }] });
    expect(git(bare, 'log', '-p', 'main')).not.toContain(WORD);
  }, SLOW);

  it('a merge commit\'s own changes are scanned too', async () => {
    const { bare, pcs: [a] } = world(1);
    const A = syncer(a!);
    const before = git(bare, 'rev-parse', 'main');
    git(a!, 'switch', '-q', '-c', 'lato');
    fs.writeFileSync(path.join(a!, 'lato.md'), 'innocuo\n');
    git(a!, 'add', '-A'); git(a!, 'commit', '-q', '-m', 'lato');
    git(a!, 'switch', '-q', 'main');
    git(a!, 'merge', '-q', '--no-ff', '--no-commit', 'lato');
    fs.writeFileSync(path.join(a!, 'nel-merge.md'), `${WORD}\n`);
    git(a!, 'add', '-A'); git(a!, 'commit', '-q', '-m', 'merge');
    await A.s.sync('Personale');
    expect(A.one().blocked).toMatchObject({ kind: 'guard', findings: [{ file: 'nel-merge.md', line: 1 }] });
    expect(git(bare, 'rev-parse', 'main')).toBe(before);
  }, SLOW);

  it('a commit message and its author are scanned too', async () => {
    const { bare, pcs: [a] } = world(1);
    const A = syncer(a!);
    const before = git(bare, 'rev-parse', 'main');
    fs.writeFileSync(path.join(a!, 'pulito.md'), 'niente\n');
    git(a!, 'add', '-A'); git(a!, 'commit', '-q', '-m', `nota per ${WORD}`);
    await A.s.sync('Personale');
    const b = A.one().blocked;
    expect(b?.kind).toBe('guard');
    expect(b?.kind === 'guard' ? b.findings.map(f => f.file) : []).toEqual([expect.stringMatching(/^_commit-[0-9a-f]{7}\.txt$/)]);
    expect(git(bare, 'rev-parse', 'main')).toBe(before);
  }, SLOW);

  it('the allow list never comes from the domain: only the private allow-<domain>.txt beside the scanner', async () => {
    const { bare, pcs: [a] } = world(1);
    const g = guardDir();
    const A = syncer(a!, g);
    fs.writeFileSync(path.join(a!, '.guardallow'), `${WORD}\n`);
    fs.writeFileSync(path.join(a!, 'lavoro.md'), `${WORD}\n`);
    await A.s.sync('Personale');
    expect(A.one().blocked?.kind).toBe('guard');
    expect(() => remoteFile(bare, 'lavoro.md')).toThrow();
    fs.writeFileSync(path.join(g, 'allow-Personale.txt'), `${WORD}\n`);
    await A.s.sync('Personale');
    expect(A.one()).toMatchObject({ state: 'idle', blocked: null });
  }, SLOW);
});

describe('sync before a new chat', () => {
  it('create waits for the sync, and still runs when the sync fails', async () => {
    const order: string[] = [];
    const target = { create: async (n: number) => { order.push(`create ${n}`); return n * 2; } };
    syncBeforeCreate(target, async () => { await new Promise(r => setTimeout(r, 50)); order.push('sync'); });
    expect(await target.create(2)).toBe(4);
    expect(order).toEqual(['sync', 'create 2']);
    const failing = { create: async () => 'ok' };
    syncBeforeCreate(failing, () => Promise.reject(new Error('rete')));
    expect(await failing.create()).toBe('ok');
  });

  it('beforeRead is bounded: a remote that never answers holds a chat back only maxMs', async () => {
    const { pcs: [a] } = world(1);
    const { s } = syncer(a!);
    s.syncAll = () => new Promise(() => { /* never */ });
    const t = Date.now();
    await s.beforeRead(100, 0);
    expect(Date.now() - t).toBeLessThan(5_000);
  }, SLOW);
});
