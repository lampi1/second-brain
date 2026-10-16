// End-to-end: brain domains and their multi-PC sync (ADR 0059) in the real app, with two local bare repos in a temp
// folder as the "private remotes" (never a real repo, never GitHub). The brain (SB_BRAIN) is a this-pc work domain; the
// userData config.json lists two "everywhere" domains, each a clone of its bare repo; SB_PUBLISH_DIR points at a fake
// scan.mjs with the real command line (test/fixtures/sync/fake-scan.mjs). Checked: the other PC's commit is pulled at
// start; an edit is committed and pushed after it settles; a conflict stops only that domain, shows the three choices
// in the top-bar status and «Tieni la mia» pushes the user's version; the guard blocks a push with file:line and never
// the value. Screenshots: brain-sync-conflict, brain-sync-guard.
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, shot } from './helpers';

const FAKE_SCAN = path.resolve(import.meta.dirname, '..', 'fixtures', 'sync', 'fake-scan.mjs');
const WORD = 'ACME-CLIENTE-SEGRETO';
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const user = (d: string) => { git(d, 'config', 'user.name', 'E2E'); git(d, 'config', 'user.email', 'e2e@example.com'); };

/** A bare repo seeded with domain.json + notes.md, and a clone of it at `dir` (this PC). */
function domain(name: string): { bare: string; dir: string } {
  const base = tmp('sb-e2e-sync-');
  const bare = path.join(base, `${name}.git`);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  const seed = path.join(base, 'seed');
  fs.mkdirSync(seed);
  git(seed, 'init', '-q', '-b', 'main'); user(seed);
  fs.writeFileSync(path.join(seed, 'domain.json'), JSON.stringify({ name, scope: 'everywhere', remote: bare }));
  fs.writeFileSync(path.join(seed, 'notes.md'), '# Note\n\nriga uno\n');
  git(seed, 'add', '-A'); git(seed, 'commit', '-q', '-m', 'seed');
  git(seed, 'push', '-q', bare, 'HEAD:refs/heads/main');
  const dir = path.join(base, 'pc', name);
  execFileSync('git', ['clone', '-q', bare, dir]); user(dir);
  return { bare, dir };
}

/** "The other PC": a commit pushed straight to the bare repo. */
function otherPc(bare: string, file: string, text: string): void {
  const d = path.join(tmp('sb-e2e-other-'), 'c');
  execFileSync('git', ['clone', '-q', bare, d]); user(d);
  fs.writeFileSync(path.join(d, file), text);
  git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'altro PC');
  git(d, 'push', '-q', 'origin', 'HEAD:main');
}

const remoteText = (bare: string, f: string) => { try { return git(bare, 'show', `main:${f}`); } catch { return ''; } };
const readText = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const domainState = (page: Page, name: string) => page.evaluate(n => window.sb.invoke('sync:get', undefined).then(s => s.domains.find(d => d.name === n)), name);

test('brain sync: pull at start, push after an edit, a conflict waits for the user, the guard blocks without the value', async () => {
  test.setTimeout(180_000);
  const personale = domain('Personale');
  const famiglia = domain('Famiglia');
  // before the app starts, the other PC pushed a note: it must be here after the first sync
  otherPc(personale.bare, 'da-altro-pc.md', 'scritto sull\'altro PC\n');

  const brain = tmp('sb-e2e-work-'); // the this-pc work brain: no domain.json, never synced
  fs.writeFileSync(path.join(brain, 'ideas.md'), '# Idee\n');
  const guard = tmp('sb-e2e-guard-');
  fs.copyFileSync(FAKE_SCAN, path.join(guard, 'scan.mjs'));
  fs.writeFileSync(path.join(guard, 'deny-work.txt'), `${WORD}\n`); // a domain's default list (the product sync keeps deny.txt)
  const userData = tmp('sb-e2e-ud-');
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ domains: [personale.dir, famiglia.dir] }));

  const { page } = await launch({ SB_BRAIN: brain, SB_PUBLISH_DIR: guard, SB_SYNC_SETTLE_MS: '800' }, userData);
  await expect(page.getByTestId('app')).toBeVisible();

  // 1. pull at start; the work brain is listed but off
  await expect.poll(() => fs.existsSync(path.join(personale.dir, 'da-altro-pc.md')), { timeout: 30_000 }).toBe(true);
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveAttribute('data-tone', 'ok', { timeout: 30_000 });
  const st = await page.evaluate(() => window.sb.invoke('sync:get', undefined));
  expect(st.domains.map(d => `${d.name}:${d.scope}:${d.state}`)).toEqual([`${path.basename(brain)}:this-pc:off`, 'Personale:everywhere:idle', 'Famiglia:everywhere:idle']);

  // 2. an edit is committed and pushed once it settles
  fs.writeFileSync(path.join(personale.dir, 'idea.md'), 'una idea da questo PC\n');
  await expect.poll(() => remoteText(personale.bare, 'idea.md'), { timeout: 30_000 }).toBe('una idea da questo PC');

  // 3. a conflict: the other PC and this one change the same line; only Famiglia stops, the user chooses
  otherPc(famiglia.bare, 'notes.md', '# Note\n\nriga dell\'altro PC\n');
  fs.writeFileSync(path.join(famiglia.dir, 'notes.md'), '# Note\n\nriga di questo PC\n');
  await expect(status).toHaveAttribute('data-tone', 'bad', { timeout: 30_000 });
  expect((await domainState(page, 'Personale'))?.state).toBe('idle');
  await status.click();
  const pop = page.getByTestId('sync-pop');
  await expect(pop).toBeVisible();
  await expect(page.getByTestId('sync-block-Famiglia')).toHaveAttribute('data-kind', 'conflict');
  await expect(page.getByTestId('sync-block-Famiglia')).toContainText('notes.md');
  await expect(page.getByTestId('sync-mine-Famiglia')).toBeVisible();
  await expect(page.getByTestId('sync-theirs-Famiglia')).toBeVisible();
  await expect(page.getByTestId('sync-both-Famiglia')).toBeVisible();
  expect(readText(path.join(famiglia.dir, 'notes.md'))).toContain('riga di questo PC'); // nothing resolved by itself
  await shot(page, 'brain-sync-conflict');
  await page.getByTestId('sync-mine-Famiglia').click();
  await expect.poll(() => remoteText(famiglia.bare, 'notes.md'), { timeout: 30_000 }).toContain('riga di questo PC');
  await expect(status).toHaveAttribute('data-tone', 'ok', { timeout: 30_000 });

  // 4. the guard: a forbidden word blocks the push, the status shows file:line + rule, never the word
  const before = git(personale.bare, 'rev-parse', 'main');
  fs.writeFileSync(path.join(personale.dir, 'lavoro.md'), `# Lavoro\n\ncliente ${WORD}\n`);
  await expect(status).toHaveAttribute('data-tone', 'bad', { timeout: 30_000 });
  if (!(await pop.isVisible())) await status.click();
  const block = page.getByTestId('sync-block-Personale');
  await expect(block).toHaveAttribute('data-kind', 'guard');
  await expect(block).toContainText('lavoro.md:3 · deny-list');
  await expect(page.locator('body')).not.toContainText(WORD);
  expect(git(personale.bare, 'rev-parse', 'main')).toBe(before);
  await shot(page, 'brain-sync-guard');
  const feed = await page.evaluate(() => window.sb.invoke('feed:list', undefined));
  expect(feed.some(e => e.kind === 'brain-sync' && e.priority === 'urgent')).toBe(true);
  expect(JSON.stringify(feed)).not.toContain(WORD);
});
