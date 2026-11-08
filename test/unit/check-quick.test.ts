// scripts/check-quick.mjs (`npm run check:quick`): picks only the tests that import a changed file, name it in a code
// string or a node -e program, or reach it through a test helper or a git hook, never the transitive graph; warns WITHOUT
// tests for what no test reaches, and runs the doc freshness tests only when the change touches what they read.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain .mjs script without types
import { changedPaths as changedPathsOf, codeStrings as codeStringsOf, hookPaths as hookPathsOf, needsDocTests as needsDocTestsOf, pickTests as pickTestsOf, relatedTests as relatedTestsOf, resolveSpecifier as resolveOf, specifiers as specifiersOf, verdict as verdictOf } from '../../scripts/check-quick.mjs';

const relatedTests = relatedTestsOf as (changed: string[], tests: string[], read: (f: string) => string) => string[];
type Opts = { helpers?: string[]; hooks?: Map<string, string[]> };
const pickTests = pickTestsOf as (changed: string[], tests: string[], read: (f: string) => string, opts?: Opts) => { tests: string[]; uncovered: string[] };
const hookPaths = hookPathsOf as (text: string) => string[];
const codeStrings = codeStringsOf as (text: string) => string[];
const changedPaths = changedPathsOf as (nameStatus: string, untracked: string) => { all: string[]; present: string[] };
const resolveSpecifier = resolveOf as (testFile: string, spec: string) => string | null;
const specifiers = specifiersOf as (text: string) => string[];
const needsDocTests = needsDocTestsOf as (changed: string[]) => boolean;
const verdict = verdictOf as (uncovered: string[], seconds: number) => string;

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
      'test/unit/hook.test.ts': "spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'fake-hooks.mjs')]);",
      'test/unit/log.test.ts': "execFileSync(process.execPath, ['scripts/fake-logs.mjs', '--json']);",
      'test/unit/readme.test.ts': "import * as rc from '../../scripts/fake-other.mjs';",
      'test/unit/adapters.test.ts': "write(b.personal, '.claude/hooks/check.mjs', '');",
    };
    const changed = ['scripts/fake-hooks.mjs', 'scripts/fake-logs.mjs', 'scripts/untested.mjs', 'docs/x.md', 'eslint.config.mjs', 'src/shared/x.d.ts'];
    const { tests, uncovered } = pickTests(changed, Object.keys(files), f => files[f] ?? '');
    expect(tests).toEqual(['test/unit/hook.test.ts', 'test/unit/log.test.ts']);
    expect(uncovered).toEqual(['scripts/untested.mjs', 'eslint.config.mjs']);
    expect(pickTests(['docs/x.md', 'package.json'], Object.keys(files), f => files[f] ?? '').uncovered).toEqual([]);
  });

  it('never counts a path named in a comment or quoted inside a fixture string as coverage', () => {
    const LOGS = ['scripts', 'logs.mjs'].join('/'); // built, not a literal: this file must not select itself
    expect(pickTests([LOGS], ['test/unit/unrelated.test.ts'], () => '// scripts/logs.mjs is not tested here'))
      .toEqual({ tests: [], uncovered: [LOGS] });
    const files: Record<string, string> = {
      'test/unit/block.test.ts': "/* runs scripts/logs.mjs */\nit('x', () => {});",
      'test/unit/fixture.test.ts': "const text = \"execFileSync(process.execPath, ['scripts/logs.mjs']);\";",
      'test/unit/title.test.ts': "it('records them: node scripts/logs.mjs', () => {});",
      'test/unit/template.test.ts': 'spawnSync(process.execPath, [`${ROOT}/scripts/logs.mjs`]);',
    };
    expect(pickTests([LOGS], Object.keys(files), f => files[f] ?? ''))
      .toEqual({ tests: ['test/unit/template.test.ts'], uncovered: [] });
    const self = fs.readFileSync(path.join(import.meta.dirname, 'check-quick.test.ts'), 'utf8');
    expect(pickTests([LOGS], ['test/unit/check-quick.test.ts'], () => self).tests).toEqual([]);
  });

  it('picks the tests that import a file inside a program string run with node -e or String.raw', () => {
    const files: Record<string, string> = {
      'test/unit/origin.test.ts': "const program = `import {logPositive} from './brain-template/ops/tools/fake-feedback.mjs'; logPositive({});`;\nexecFileSync(process.execPath, ['--input-type=module', '-e', program]);",
      'test/unit/raw.test.ts': "const program = String.raw`\n  import { parse } from './brain-template/ops/tools/fake-recurrence.mjs';\n  parse('');\n`;",
      'test/unit/text.test.ts': "const note = 'from now on: tools/fake-feedback.mjs';",
    };
    const changed = ['brain-template/ops/tools/fake-feedback.mjs', 'brain-template/ops/tools/fake-recurrence.mjs'];
    expect(pickTests(changed, Object.keys(files), f => files[f] ?? '')).toEqual({ tests: ['test/unit/origin.test.ts', 'test/unit/raw.test.ts'], uncovered: [] });
  });

  it('picks a test that commits through the git hooks for the scripts the hooks exec', () => {
    expect(hookPaths('#!/bin/sh\n# scripts/fake-not-run.mjs does the work\nexec node "$(dirname "$0")/../scripts/fake-commit.mjs" "$@"\n'))
      .toEqual(['../scripts/fake-commit.mjs']);
    const files: Record<string, string> = {
      'test/unit/commit-hook.test.ts': "import { repo } from './hook-helpers';\nrepo().commit('x');",
      'test/unit/hook-helpers.ts': "export const HOOKS = path.join(ROOT, '.fake-hooks');",
      'test/unit/other.test.ts': "// .fake-hooks are not used here",
    };
    const hooks = new Map([['.fake-hooks', ['../scripts/fake-commit.mjs']]]);
    const opts = { helpers: ['test/unit/hook-helpers.ts'], hooks };
    expect(pickTests(['scripts/fake-commit.mjs'], ['test/unit/commit-hook.test.ts', 'test/unit/other.test.ts'], f => files[f] ?? '', opts))
      .toEqual({ tests: ['test/unit/commit-hook.test.ts'], uncovered: [] });
  });

  it('picks the tests that reach a changed fixture through a helper, and warns for a fixture no test reaches', () => {
    const files: Record<string, string> = {
      'test/unit/chats/claude.test.ts': "import { FAKE } from './helpers';\nspawn(process.execPath, [FAKE]);",
      'test/unit/chats/helpers.ts': "export const FAKE = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'fake-cli.mjs');",
      'test/unit/chats/other.test.ts': "import { x } from '../../../src/main/x';",
    };
    const tests = ['test/unit/chats/claude.test.ts', 'test/unit/chats/other.test.ts'];
    const opts = { helpers: ['test/unit/chats/helpers.ts'] };
    expect(pickTests(['test/fixtures/fake-cli.mjs'], tests, f => files[f] ?? '', opts)).toEqual({ tests: ['test/unit/chats/claude.test.ts'], uncovered: [] });
    expect(pickTests(['test/fixtures/fake-orphan.mjs'], tests, f => files[f] ?? '', opts)).toEqual({ tests: [], uncovered: ['test/fixtures/fake-orphan.mjs'] });
    expect(pickTests(['test/e2e/fake.spec.ts'], tests, f => files[f] ?? '', opts).uncovered).toEqual([]);
  });

  it('follows an imported index one level of re-exports; a same-name test in another folder runs but covers nothing', () => {
    const files: Record<string, string> = {
      'test/unit/fake-runtime/resolve.test.ts': "import { resolveFake } from '../../../packages/fake-runtime/src/index';",
      'packages/fake-runtime/src/index.ts': "export * from './fake-format';\nexport { resolveFake } from './fake-cmd';\nexport type { T } from './fake-types';",
      'test/unit/chats/fake-cmd.test.ts': "import { x } from '../../../src/main/chats/fake-cmd';",
    };
    const read = (f: string) => { if (!(f in files)) throw new Error('ENOENT'); return files[f]!; };
    const tests = ['test/unit/chats/fake-cmd.test.ts', 'test/unit/fake-runtime/resolve.test.ts'];
    expect(pickTests(['packages/fake-runtime/src/fake-cmd.ts'], tests, read)).toEqual({ tests, uncovered: [] });
    expect(pickTests(['packages/fake-runtime/src/fake-cmd.ts'], [tests[0]!], read))
      .toEqual({ tests: [tests[0]], uncovered: ['packages/fake-runtime/src/fake-cmd.ts'] });
    expect(pickTests(['packages/fake-runtime/src/fake-types.ts'], tests, read).uncovered).toEqual(['packages/fake-runtime/src/fake-types.ts']);
    expect(pickTests(['src/main/chats/fake-cmd.ts'], [tests[0]!], read)).toEqual({ tests: [tests[0]], uncovered: [] });
  });

  it('picks a test that loads the ESLint config without naming it; other root configs say WITHOUT', () => {
    const files: Record<string, string> = {
      'test/unit/lint-rules.test.ts': 'const eslint = new ' + 'ESLint({ cwd });',
      'test/unit/other.test.ts': "import { x } from '../../src/main/x';",
    };
    expect(pickTests(['eslint.config.cjs', 'fake.config.ts'], Object.keys(files), f => files[f] ?? ''))
      .toEqual({ tests: ['test/unit/lint-rules.test.ts'], uncovered: ['fake.config.ts'] });
  });

  it('skips the paths fs calls create, and caches no reach cut short by an import cycle', () => {
    expect(codeStrings("fs.writeFileSync(path.join(d, 'fake-dir', 'fake-chats.mjs'), 'x');\nfs.copyFileSync(path.join(FIX, 'a.mjs'), path.join(d, 'fake-site', 'fake-parse.mjs'));\nrun(path.join(ROOT, 'fake-tools', 'fake-run.mjs'));"))
      .toEqual(['x', 'a.mjs', 'fake-tools/fake-run.mjs', 'fake-tools', 'fake-run.mjs']);
    const files: Record<string, string> = {
      'test/unit/a.test.ts': "import { h } from './fake-h1';",
      'test/unit/b.test.ts': "import { h } from './fake-h2';",
      'test/unit/fake-h1.ts': "import { h } from './fake-h2';\nimport { y } from '../../src/main/fake-y';",
      'test/unit/fake-h2.ts': "import { h } from './fake-h1';",
    };
    const opts = { helpers: ['test/unit/fake-h1.ts', 'test/unit/fake-h2.ts'] };
    expect(pickTests(['src/main/fake-y.ts'], ['test/unit/a.test.ts', 'test/unit/b.test.ts'], f => files[f] ?? '', opts).tests)
      .toEqual(['test/unit/a.test.ts', 'test/unit/b.test.ts']);
  });

  it('says "green WITHOUT tests" for uncovered sources (exit 0), plain green only when every source has a test', () => {
    expect(verdict([], 12)).toBe('check:quick green in 12 s: ready to try. Before the merge: the e2e specs of the touched part, under the e2e lock (docs/agents/rules.md rule 7)');
    const few = verdict(['src/renderer/a.tsx', 'scripts/b.mjs'], 12);
    expect(few).toMatch(/^check:quick green WITHOUT tests: src\/renderer\/a\.tsx, scripts\/b\.mjs \(typecheck and lint only\)/);
    expect(few).not.toContain('ready to try');
    expect(few).toContain('the e2e specs of the touched part');
    const many = verdict(Array.from({ length: 13 }, (_, i) => `src/renderer/f${i}.tsx`), 12);
    expect(many).toContain('src/renderer/f9.tsx and 3 more (typecheck and lint only)');
    expect(many).not.toContain('f10.tsx');
    // no exit for uncovered files; a failed typecheck, lint or test still exits with its status before the verdict
    expect(code).not.toMatch(/uncovered\.length\)\s*\{[^}]*process\.exit/);
    expect(code).toContain('process.exit(r.status ?? 1)');
    expect(code).toMatch(/run\('unit'[^]*console\.log\(`\\n\$\{verdict\(uncovered/);
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
