// scripts/check-quick.mjs (`npm run check:quick`): picks only the tests that import a changed file directly or share
// its name, never the transitive graph, and runs the doc freshness tests only when the change touches what they read.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain .mjs script without types
import { changedPaths as changedPathsOf, needsDocTests as needsDocTestsOf, pickTests as pickTestsOf, relatedTests as relatedTestsOf, resolveSpecifier as resolveOf, specifiers as specifiersOf } from '../../scripts/check-quick.mjs';

const relatedTests = relatedTestsOf as (changed: string[], tests: string[], read: (f: string) => string) => string[];
const pickTests = pickTestsOf as (changed: string[], tests: string[], read: (f: string) => string) => { tests: string[]; uncovered: string[] };
const changedPaths = changedPathsOf as (nameStatus: string, untracked: string) => { all: string[]; present: string[] };
const resolveSpecifier = resolveOf as (testFile: string, spec: string) => string | null;
const specifiers = specifiersOf as (text: string) => string[];
const needsDocTests = needsDocTestsOf as (changed: string[]) => boolean;

const code = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'scripts', 'check-quick.mjs'), 'utf8')
  .split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');

describe('check:quick', () => {
  it('reads static, dynamic and mocked imports', () => {
    const text = "import { a } from '../../src/main/a';\nimport type { B } from '@shared/b';\nconst c = await import('../../src/main/c.js');\nvi.mock('../../src/main/d', () => ({}));\nimport 'node:fs';";
    expect(specifiers(text)).toEqual(['../../src/main/a', '../../src/main/c.js', '../../src/main/d', 'node:fs']);
  });

  it('skips type-only imports, which the typecheck covers', () => {
    const text = "import type { A } from '@shared/contract';\nimport { type B, type C as D } from '../../src/main/b';\nimport { type E, f } from '../../src/main/e';";
    expect(specifiers(text)).toEqual(['../../src/main/e']);
  });

  it('resolves relative, @shared and index specifiers; packages resolve to null', () => {
    expect(resolveSpecifier('test/unit/chats/x.test.ts', '../../../src/main/chats/manager.js')).toBe('src/main/chats/manager');
    expect(resolveSpecifier('test/unit/x.test.ts', '@shared/contract')).toBe('src/shared/contract');
    expect(resolveSpecifier('src/main/foo/x.test.ts', './index')).toBe('src/main/foo');
    expect(resolveSpecifier('test/unit/x.test.ts', 'vitest')).toBeNull();
  });

  it('picks direct importers, same-name tests and changed tests, never the transitive graph', () => {
    const files: Record<string, string> = {
      'test/unit/direct.test.ts': "import { x } from '../../src/main/a';",
      'test/unit/a.test.ts': "import { y } from '../../src/main/other';",
      'test/unit/transitive.test.ts': "import { z } from '../../src/main/b'; // b imports a",
      'test/unit/edited.test.ts': '',
      'test/unit/unrelated.test.ts': "import { w } from '../../src/main/c';",
    };
    const picked = relatedTests(['src/main/a.ts', 'test/unit/edited.test.ts', 'docs/x.md'], Object.keys(files), f => files[f] ?? '');
    expect(picked).toEqual(['test/unit/a.test.ts', 'test/unit/direct.test.ts', 'test/unit/edited.test.ts']);
  });

  it('picks tests that name a changed file as a string and reports the changed sources no test covers', () => {
    const files: Record<string, string> = {
      'test/unit/hook.test.ts': "spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'setup-hooks.mjs')]);",
      'test/unit/log.test.ts': "execFileSync(process.execPath, ['scripts/logs.mjs', '--json']);",
      'test/unit/readme.test.ts': "import * as rc from '../../scripts/readme-check.mjs';",
      'test/unit/adapters.test.ts': "write(b.personal, '.claude/hooks/check.mjs', '');",
    };
    const changed = ['scripts/setup-hooks.mjs', 'scripts/logs.mjs', 'scripts/untested.mjs', 'docs/x.md', 'eslint.config.mjs', 'src/shared/x.d.ts'];
    const { tests, uncovered } = pickTests(changed, Object.keys(files), f => files[f] ?? '');
    expect(tests).toEqual(['test/unit/hook.test.ts', 'test/unit/log.test.ts']);
    expect(uncovered).toEqual(['scripts/untested.mjs']);
    expect(pickTests(['docs/x.md', 'package.json'], Object.keys(files), f => files[f] ?? '').uncovered).toEqual([]);
    expect(code).toMatch(/uncovered\.length[^]*process\.exit\(1\)[^]*check:quick green/);
  });

  it('picks the importers of deleted files and of the old name of renamed ones; lints only the files still there', () => {
    const status = 'M\tsrc/main/a.ts\nD\tscripts/gone.mjs\nR087\tsrc/main/old.ts\tsrc/main/new.ts\nA\tdocs/x.md\n';
    const { all, present } = changedPaths(status, '');
    expect(all).toEqual(['src/main/a.ts', 'scripts/gone.mjs', 'src/main/old.ts', 'src/main/new.ts', 'docs/x.md']);
    expect(present).toEqual(['src/main/a.ts', 'src/main/new.ts', 'docs/x.md']);
    const files: Record<string, string> = {
      'test/unit/gone.test.ts': "// @ts-expect-error plain .mjs\nimport { g } from '../../scripts/gone.mjs';",
      'test/unit/mocked.test.ts': "vi.mock('../../src/main/old', () => ({}));",
    };
    expect(pickTests(all, Object.keys(files), f => files[f] ?? '').tests).toEqual(['test/unit/gone.test.ts', 'test/unit/mocked.test.ts']);
    expect(code).toContain("'--name-status', '-M'");
  });

  it('runs the doc freshness tests only for the inputs they read', () => {
    expect(needsDocTests(['src/main/appctl/tool-catalog.ts'])).toBe(true);
    expect(needsDocTests(['README.md'])).toBe(true);
    expect(needsDocTests(['src/main/chats/manager.ts'])).toBe(true);
    expect(needsDocTests(['scripts/check-quick.mjs', 'test/unit/check-quick.test.ts', 'package.json'])).toBe(false);
  });

  it('runs no e2e, no build, no vitest --changed and records no check', () => {
    expect(code).not.toMatch(/e2e\.mjs|playwright|test:e2e|build\.mjs|'--changed'|check-pass\.mjs/);
    for (const step of ["'typecheck'", "'lint'", "'unit'"]) expect(code).toContain(step);
  });
});
