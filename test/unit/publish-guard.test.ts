// The guard on this repo's files (ADR 0061): the repo is public product, so its tracked files (and new ones not yet
// added; ignored ones never are) must carry no secret, personal or company data: names, hosts, e-mails, paths. Same
// scanner, allow file and deny list as the git hooks: tools/guard/scan.mjs, the repo's .guardallow and, when this
// repo's git config has `guard.denyList`, that private list. Set but missing → the test FAILS (never a silent skip);
// unset (a PC with no private list, CI) → built-in rules only. Read-only: it scans a temp copy and prints only
// file:line + rule, never a matched value.
// SB_GUARD_FILES (newline-separated repo paths): scan only those, the branch's changed files (scripts/check-branch.mjs);
// the allow file pins paths, so a subset is checked exactly as in the whole scan.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper shared with the hooks, no type declarations
import { readGuardConfig } from '../../scripts/guard-lib.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const SCAN = path.join(root, 'tools', 'guard', 'scan.mjs');
const ALLOW = path.join(root, '.guardallow');
const only = process.env.SB_GUARD_FILES ? new Set(process.env.SB_GUARD_FILES.split('\n').map(f => f.trim().replace(/\\/g, '/')).filter(Boolean)) : null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-publish-guard-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('publish guard', () => {
  it('the repo files carry no finding', () => {
    const { denyList } = readGuardConfig(root) as { denyList: string | null };
    if (denyList) expect(fs.existsSync(denyList), 'git config guard.denyList is set but the file is missing: restore it (or unset the key on a PC with no private list)').toBe(true);
    const files = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
      .split('\0').filter(f => f && (!only || only.has(f)) && fs.existsSync(path.join(root, f)));
    for (const f of new Set(files)) {
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      fs.copyFileSync(path.join(root, f), path.join(tmp, f));
    }
    const args = [SCAN, tmp, '--json', '--no-skip', '--allow', ALLOW, ...(denyList ? ['--deny', denyList] : [])];
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
    expect(r.status === 0 || r.status === 2, `scan failed: ${r.stderr}`).toBe(true);
    const found = (JSON.parse(r.stdout) as { findings: { where: string; line: number; rule: string }[] }).findings
      .map(f => `${f.where}${f.line ? `:${f.line}` : ''}  ${f.rule}`);
    // a finding: use a generic placeholder (example.com, "Studio Demo", a made-up name); see the line, not this output
    expect(found).toEqual([]);
  }, 120_000); // copies and scans every repo file: ~4 s alone, 64-70 s measured with two full suites in parallel
});
