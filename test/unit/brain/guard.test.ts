// The domain push guard's wiring (src/main/brain/guard.ts, ADR 0059 + 0061): the scanner is the one shipped with the app
// (tools/guard/scan.mjs, copied by the build to out/guard/scan.mjs), the deny list and the optional allow list stay
// private in the publish folder; anything missing = null (the push is blocked). Then the real scanner on real commits:
// a deny-list word blocks with file:line + rule and never the value, a domain's own .guardallow cannot silence it, a
// top-level out/ folder is scanned too, two paths differing only in case block. Temp folders only; never the user's publish folder.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { appScanner, findGuard, noGuardHint, publishDir, scanCommits } from '../../../src/main/brain/guard';
import { plainNode, tmpDir } from './helpers';

const REPO_SCAN = path.resolve(import.meta.dirname, '..', '..', '..', 'tools', 'guard', 'scan.mjs');
const WORD = 'ACME-CLIENTE-SEGRETO';
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
/** An environment whose shared app folder is a temp folder (LOCALAPPDATA on Windows, XDG_DATA_HOME on Linux). */
const fakeEnv = (): NodeJS.ProcessEnv => { const d = tmpDir('sb-shared-'); return { LOCALAPPDATA: d, XDG_DATA_HOME: d }; };
const mac = process.platform === 'darwin'; // there the shared folder is under the real home: not touched by tests

describe('findGuard', () => {
  it.skipIf(mac)('uses the app\'s scanner and the private deny list; a scan.mjs left in the publish folder is ignored', () => {
    const env = fakeEnv();
    const pub = publishDir(env);
    fs.mkdirSync(pub, { recursive: true });
    fs.writeFileSync(path.join(pub, 'deny-work.txt'), `${WORD}\n`);
    fs.writeFileSync(path.join(pub, 'scan.mjs'), '// an old copy from the retired product sync\n');
    expect(findGuard('deny-work.txt', env, 'Personale', REPO_SCAN)).toEqual({ scan: REPO_SCAN, deny: path.join(pub, 'deny-work.txt') });
    fs.writeFileSync(path.join(pub, 'allow-Personale.txt'), '');
    expect(findGuard('deny-work.txt', env, 'Personale', REPO_SCAN)?.allow).toBe(path.join(pub, 'allow-Personale.txt'));
  });

  it.skipIf(mac)('fails closed: no deny list, no scanner, or a deny list name with a path', () => {
    const env = fakeEnv();
    expect(findGuard('deny-work.txt', env, 'Personale', REPO_SCAN)).toBeNull(); // a new PC: no publish folder at all
    const pub = publishDir(env);
    fs.mkdirSync(pub, { recursive: true });
    fs.writeFileSync(path.join(pub, 'deny-work.txt'), `${WORD}\n`);
    expect(findGuard('deny-work.txt', env, 'Personale', path.join(tmpDir(), 'scan.mjs'))).toBeNull();
    expect(findGuard('deny-work.txt', env, 'Personale', null)).toBeNull();
    expect(findGuard('../deny-work.txt', env, 'Personale', REPO_SCAN)).toBeNull();
  });

  it('SB_PUBLISH_DIR (tests) holds the scanner too', () => {
    const d = tmpDir('sb-guard-');
    fs.writeFileSync(path.join(d, 'deny-work.txt'), `${WORD}\n`);
    expect(findGuard('deny-work.txt', { SB_PUBLISH_DIR: d }, undefined, REPO_SCAN)).toBeNull();
    fs.writeFileSync(path.join(d, 'scan.mjs'), '');
    expect(findGuard('deny-work.txt', { SB_PUBLISH_DIR: d }, undefined, REPO_SCAN)?.scan).toBe(path.join(d, 'scan.mjs'));
  });

  it('the app\'s scanner is out/guard/scan.mjs beside the main bundle; the build copies it there', () => {
    const out = path.resolve(tmpDir('sb-app-'), 'out');
    expect(appScanner(pathToFileURL(path.join(out, 'main', 'index.js')).href)).toBe(path.join(out, 'guard', 'scan.mjs'));
    const build = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', '..', 'scripts', 'build.mjs'), 'utf8');
    expect(build).toContain("path.join(root, 'tools', 'guard', 'scan.mjs'), path.join(root, 'out', 'guard', 'scan.mjs')");
  });

  it('the hint names the missing deny list and how to make it, not the retired product sync', () => {
    const h = noGuardHint('deny-casa.txt');
    expect(h).toContain('deny-casa.txt');
    expect(h).toContain(publishDir()); // the folder this PC really reads, per OS
    expect(noGuardHint('deny-casa.txt', { SB_PUBLISH_DIR: 'Z:/pub' })).toContain('Z:/pub');
    expect(h).toContain('una parola per riga');
    expect(h).not.toMatch(/sincronizzazione del prodotto/);
  });
});

describe('scanCommits with the real scanner', () => {
  function repo(files: Record<string, string>): { root: string; commit: string } {
    const root = tmpDir('sb-dom-');
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.com');
    for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); }
    git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'note');
    return { root, commit: git(root, 'rev-parse', 'HEAD') };
  }
  const guard = () => { const d = tmpDir('sb-pub-'); fs.writeFileSync(path.join(d, 'deny-work.txt'), `${WORD}\n`); return { scan: REPO_SCAN, deny: path.join(d, 'deny-work.txt') }; };

  it('a clean commit passes', async () => {
    const { root, commit } = repo({ 'note.md': '# Nota\n\nniente di strano\n' });
    expect(await scanCommits(root, [commit], guard(), plainNode)).toEqual({ ok: true });
  }, 60_000);

  it('a deny-list word blocks with file:line + rule, never the value; a domain\'s .guardallow and out/ do not hide it', async () => {
    const { root, commit } = repo({
      'note.md': `riga\n${WORD}\n`,
      '.guardallow': `note.md deny-list\nout/** deny-list\n# ${WORD}\n`,
      'out/x.md': `${WORD}\n`,
    });
    const r = await scanCommits(root, [commit], guard(), plainNode);
    expect(r.ok).toBe(false);
    const findings = 'findings' in r ? r.findings : [];
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'note.md', line: 2, rule: 'deny-list' }),
      expect.objectContaining({ file: 'out/x.md', rule: 'deny-list' }),
      expect.objectContaining({ file: 'guardallow-del-dominio.txt', rule: 'deny-list' }),
    ]));
    expect(JSON.stringify(r)).not.toContain(WORD);
  }, 60_000);

  /** A commit made from git objects, not files: a case-insensitive file system cannot hold both names. */
  function rawCommit(files: [string, string][]): { root: string; commit: string } {
    const root = tmpDir('sb-dom-');
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.com');
    for (const [f, t] of files) {
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: t, encoding: 'utf8' }).trim();
      git(root, 'update-index', '--add', '--cacheinfo', `100644,${blob},${f}`);
    }
    git(root, 'commit', '-q', '-m', 'note');
    return { root, commit: git(root, 'rev-parse', 'HEAD') };
  }

  it('a domain .guardallow is never overwritten by a file named like its stand-in in another case', async () => {
    const { root, commit } = rawCommit([['.guardallow', `${WORD}\n`], ['GuardAllow-del-dominio.txt', 'neutro\n']]);
    const r = await scanCommits(root, [commit], guard(), plainNode);
    expect(r.ok).toBe(false);
    expect('findings' in r ? r.findings : []).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'deny-list' })]));
  }, 60_000);

  it.skipIf(process.platform === 'linux')('two paths that differ only in case block the push (one would hide the other on this file system)', async () => {
    const { root, commit } = rawCommit([['Note.md', `${WORD}\n`], ['note.md', 'neutro\n']]);
    const r = await scanCommits(root, [commit], guard(), plainNode);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('solo per maiuscole') });
  }, 60_000);
});
