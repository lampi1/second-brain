// Direct scanner contract regressions: history/path alias coverage, mandatory inputs and unallowable metadata.
// Every repository, deny list and synthetic value belongs to this test; no real credentials or remote are read.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const scanner = path.resolve(import.meta.dirname, '../../tools/guard/scan.mjs');
const roots: string[] = [];
const WORD = ['Acme', 'Private', 'Company'].join('');
const setup = () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-scanner-')); roots.push(base);
  const root = path.join(base, 'source'); fs.mkdirSync(root);
  return { base, root };
};
const scan = (root: string, ...args: string[]) => spawnSync(process.execPath, [scanner, root, ...args, '--json'], { encoding: 'utf8', windowsHide: true });
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('scanner input and history boundaries', () => {
  it.each([
    ['noreply', 'github.com', 0],
    ['personal', 'github.com', 2],
    ['personal', 'gmail.com', 2],
    ['noreply', 'github.com.evil.test', 2],
    ['noreply', 'github.com-personal.test', 2],
    ['prefix-noreply', 'github.com', 2],
    ['noreply+personal', 'github.com', 2],
    ['.noreply', 'github.com', 2],
    ['+noreply', 'github.com', 2],
  ])('only exempts the exact GitHub system mailbox: %s at %s', (name, domain, status) => {
    const { base, root } = setup();
    const meta = path.join(base, 'meta.json');
    fs.writeFileSync(meta, JSON.stringify([{ label: 'fixture', text: ['GitHub <', name, '@', domain, '>'].join('') }]));
    const result = scan(root, '--meta', meta);
    expect(result.status, result.stderr).toBe(status);
    expect(JSON.parse(result.stdout).findings).toEqual(status === 0 ? [] : [expect.objectContaining({ rule: 'email' })]);
  });
  it('rejects unknown options instead of silently omitting requested checks', () => {
    const { root } = setup();
    const result = scan(root, '--unsupported-check');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown option');
  });
  it('fails closed when history is requested outside a Git repository', () => {
    const { root } = setup();
    const result = scan(root, '--history');
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('"ok": true');
  });
  it('checks ref metadata even with zero new commits, without allowing or echoing the value', () => {
    const { base, root } = setup();
    const commits = path.join(base, 'commits'); fs.writeFileSync(commits, '');
    const deny = path.join(base, 'deny'); fs.writeFileSync(deny, WORD);
    const meta = path.join(base, 'meta.json'); fs.writeFileSync(meta, JSON.stringify([{ label: 'pushed ref 1 of 1, remote name', text: `refs/heads/${WORD}` }]));
    const allow = path.join(base, 'allow'); fs.writeFileSync(allow, '* *\n');
    const result = scan(root, '--commits', commits, '--meta', meta, '--deny', deny, '--allow', allow);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).findings).toMatchObject([{ where: 'pushed ref 1 of 1, remote name', rule: 'deny-list' }]);
    expect(result.stdout).not.toContain(WORD);
  });
  it('masks a forbidden pathname and refuses to pin a private file name', () => {
    const { base, root } = setup();
    fs.writeFileSync(path.join(root, `${WORD}-notes.md`), 'neutral');
    const deny = path.join(base, 'deny'); fs.writeFileSync(deny, WORD);
    const allow = path.join(base, 'allow'); fs.writeFileSync(allow, '* *\n');
    const result = scan(root, '--deny', deny, '--allow', allow);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).findings).toMatchObject([{ where: '***-notes.md (path)', rule: 'deny-list' }]);
    expect(result.stdout).not.toContain(WORD);
  });
  it('scans a forbidden historical alias even after its removal and a benign alias has the same blob', () => {
    const { base, root } = setup();
    const config = path.join(base, 'empty-git-config'); fs.writeFileSync(config, '');
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config };
    const git = (...args: string[]) => {
      const r = spawnSync('git', args, { cwd: root, env, encoding: 'utf8', windowsHide: true });
      expect(r.status, r.stderr).toBe(0);
    };
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
    fs.writeFileSync(path.join(root, 'a.md'), 'neutral\n');
    fs.mkdirSync(path.join(root, 'z'));
    fs.writeFileSync(path.join(root, 'z/.env'), 'neutral\n');
    git('add', '-A'); git('commit', '-qm', 'fixture one');
    fs.unlinkSync(path.join(root, 'z/.env'));
    git('add', '-A'); git('commit', '-qm', 'fixture two');
    const result = scan(root, '--history');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).findings).toEqual(expect.arrayContaining([expect.objectContaining({ where: expect.stringMatching(/^z\/\.env@[a-f0-9]{8}$/), rule: 'env-file' })]));
  });
});
