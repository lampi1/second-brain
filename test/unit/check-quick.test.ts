// scripts/check-quick.mjs (`npm run check:quick`): picks only the tests that import a changed file directly or share
// its name, never the transitive graph, and runs the doc freshness tests only when the change touches what they read.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain .mjs script without types
import { needsDocTests as needsDocTestsOf, relatedTests as relatedTestsOf, resolveSpecifier as resolveOf, specifiers as specifiersOf } from '../../scripts/check-quick.mjs';

const relatedTests = relatedTestsOf as (changed: string[], tests: string[], read: (f: string) => string) => string[];
const resolveSpecifier = resolveOf as (testFile: string, spec: string) => string | null;
const specifiers = specifiersOf as (text: string) => string[];
const needsDocTests = needsDocTestsOf as (changed: string[]) => boolean;

const code = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'scripts', 'check-quick.mjs'), 'utf8')
  .split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');

describe('check:quick', () => {
  it('reads static, dynamic and mocked imports', () => {
    const text = "import { a } from '../../src/main/a';\nimport type { B } from '@shared/b';\nconst c = await import('../../src/main/c.js');\nvi.mock('../../src/main/d', () => ({}));\nimport 'node:fs';";
    expect(specifiers(text)).toEqual(['../../src/main/a', '@shared/b', '../../src/main/c.js', '../../src/main/d', 'node:fs']);
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
