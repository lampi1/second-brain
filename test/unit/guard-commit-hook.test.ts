// The guard's pre-commit hook (ADR 0061) on real temp repos: .githooks/pre-commit (scripts/guard-commit.mjs) blocks a
// staged bad line, a wrong author e-mail, a deny list that is set but missing, empty or a deny word in a path, and lets a
// clean commit through. Every block names file:line and the rule, never the matched value. Also scripts/setup-hooks.mjs
// (`npm run setup`: core.hooksPath, the optional config printed, never set) and the guard-lib helpers.
// Setup and values: guard-hooks-helpers.ts; the pre-push hook: guard-push-hook.test.ts.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helpers, no type declarations
import { expandEnv, guardStatus, identEmail, sha256 } from '../../scripts/guard-lib.mjs';
// @ts-expect-error plain .mjs helper, no type declarations
import { parseUpdates } from '../../scripts/guard-push.mjs';
import { env, MAIL, neverShows, NOREPLY, repo, ROOT, SECRET, SLOW, WORD } from './guard-hooks-helpers';

describe('pre-commit', () => {
  it('a clean commit passes', () => {
    const r = repo();
    r.write('a.txt', 'hello\n');
    expect(r.commit('feat: a clean file').status).toBe(0);
  }, SLOW);

  it('a staged bad line blocks: file:line + rule and the fix, never the value', () => {
    const r = repo();
    r.write('ok.txt', 'fine\n');
    r.write('src/bad.ts', `const id = 1;\nconst key = '${SECRET}';\n`);
    const c = r.commit('feat: bad');
    expect(c.status).not.toBe(0);
    expect(c.out).toContain('src/bad.ts:2  aws-key');
    expect(c.out).toContain('How to fix');
    neverShows(c.out);
    expect(r.git('rev-parse', '--verify', '-q', 'HEAD').status).not.toBe(0); // nothing committed
  }, SLOW);

  it('scans the staged bytes, not the working tree', () => {
    const r = repo();
    r.write('a.txt', `owner ${MAIL}\n`);
    r.setup('add', 'a.txt');
    r.write('a.txt', 'clean now but not staged\n');
    const c = r.git('commit', '-q', '-m', 'feat: x');
    expect(c.status).not.toBe(0);
    expect(c.out).toContain('a.txt:1  email');
    neverShows(c.out);
  }, SLOW);

  it('a proven false positive passes once its printed .guardallow line is staged', () => {
    const r = repo();
    const body = `host = '${'x'}.database.windows.net'\n`;
    r.write('t/fixture.ts', body);
    const c = r.commit('test: fixture');
    expect(c.status).not.toBe(0);
    const pin = `t/fixture.ts internal-host sha256:${sha256(Buffer.from(body))}`;
    expect(c.out).toContain(pin);
    r.write('.guardallow', `# made-up host, test fixture\n${pin}\n`);
    expect(r.commit('test: fixture, pinned').status).toBe(0);
  }, SLOW);

  it('a deny-list word blocks; a deny list set but missing blocks every commit', () => {
    const r = repo();
    const deny = r.deny(`${WORD}\n`);
    r.write('notes.md', `met ${WORD} today\n`);
    const c = r.commit('docs: notes');
    expect(c.status).not.toBe(0);
    expect(c.out).toContain('notes.md:1  deny-list');
    neverShows(c.out);

    r.write('notes.md', 'met someone today\n');
    expect(r.commit('docs: notes').status).toBe(0);
    fs.rmSync(deny);
    r.write('more.md', 'more\n');
    const m = r.commit('docs: more');
    expect(m.status).not.toBe(0);
    expect(m.out).toContain('guard.denyList is set but the file cannot be read');
  }, SLOW);

  it('a file or folder name with a deny word blocks, the name masked; staged out/ is scanned too', () => {
    const r = repo();
    r.deny(`${WORD}\n`);
    r.write(`docs/${WORD}-notes.md`, 'neutral\n');
    const c = r.commit('docs: notes');
    expect(c.status).not.toBe(0);
    expect(c.out).toContain('docs/***-notes.md (path)  deny-list');
    neverShows(c.out);
    r.setup('rm', '-q', '--cached', '-r', 'docs');
    fs.rmSync(path.join(r.dir, 'docs'), { recursive: true });
    r.write('out/x.txt', `${WORD}\n`);
    r.setup('add', '-f', 'out/x.txt');
    const o = r.git('commit', '-q', '-m', 'chore: x');
    expect(o.status).not.toBe(0);
    expect(o.out).toContain('out/x.txt:1  deny-list');
  }, SLOW);

  it('a deny list saved as UTF-16 (PowerShell 5.1) still blocks; an empty one blocks every commit', () => {
    const r = repo();
    const deny = r.deny(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${WORD}\r\n`, 'utf16le')]));
    r.write('a.md', `${WORD}\n`);
    const c = r.commit('docs: a');
    expect(c.status).not.toBe(0);
    expect(c.out).toContain('a.md:1  deny-list');
    fs.writeFileSync(deny, '# nothing yet\n');
    r.write('a.md', 'neutral\n');
    const e = r.commit('docs: a');
    expect(e.status).not.toBe(0);
    expect(e.out).toContain('has no entries');
  }, SLOW);

  it('guard.email set: another author e-mail blocks, without printing it', () => {
    const r = repo();
    r.setup('config', 'guard.email', NOREPLY);
    r.setup('config', 'user.email', MAIL);
    r.write('a.txt', 'a\n');
    const c = r.commit('feat: a');
    expect(c.status).not.toBe(0);
    expect(c.out).toContain('author e-mail is not guard.email');
    expect(c.out).toContain(`git config user.email "${NOREPLY}"`);
    neverShows(c.out);
    r.setup('config', 'user.email', NOREPLY);
    expect(r.commit('feat: a').status).toBe(0);
  }, SLOW);
});

describe('setup and helpers', () => {
  it('setup-hooks turns the hooks on for the repo and only prints the optional config', () => {
    const r = repo({ hooks: false });
    fs.cpSync(path.join(ROOT, '.githooks'), path.join(r.dir, '.githooks'), { recursive: true });
    const out = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(new URL('file:///' + path.join(ROOT, 'scripts', 'setup-hooks.mjs').replace(/\\/g, '/')).href)}).then(m => process.exit(m.setupHooks(process.cwd())))`],
      { cwd: r.dir, env, encoding: 'utf8' });
    expect(out.status, out.stderr).toBe(0);
    expect(r.git('config', '--local', '--get', 'core.hooksPath').out.trim()).toBe('.githooks');
    expect(out.stdout).toContain('guard hooks: active');
    expect(out.stdout).toContain('git config guard.denyList');
    expect(r.git('config', '--get', 'guard.email').status).toBe(1); // never set by setup
    expect(guardStatus(r.dir)).toMatchObject({ repo: true, hooks: true, deny: 'unset', email: 'unset' });
  }, SLOW);

  it('parses pre-push input and refuses a malformed line', () => {
    const z = '0'.repeat(40), a = 'a'.repeat(40);
    expect(parseUpdates(`refs/heads/x ${a} refs/heads/x ${z}\n`)).toEqual([{ localRef: 'refs/heads/x', localSha: a, remoteRef: 'refs/heads/x', remoteSha: z }]);
    expect(parseUpdates('')).toEqual([]);
    expect(() => parseUpdates('refs/heads/x nope refs/heads/x')).toThrow(/unexpected pre-push input/);
  });

  it('reads identities and expands %VARS% in the deny list path', () => {
    expect(identEmail(`Dev <${NOREPLY.toUpperCase()}> 1700000000 +0100`)).toBe(NOREPLY);
    expect(expandEnv('%LOCALAPPDATA%/x/deny.txt', { LOCALAPPDATA: 'C:/L' })).toBe('C:/L/x/deny.txt');
    expect(expandEnv('%NOPE%/x', {})).toBe('%NOPE%/x');
  });
});
