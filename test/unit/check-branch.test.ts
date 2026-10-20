// scripts/check-branch.mjs (`npm run check:branch`, ADR 0027): the light check of a branch starts no e2e and no build
// (since 2026-10-15 the e2e runs only on main, in `npm run check`) and still records the tip as "tested (light)".
// Reads the script's text; its lint list goes in chunks that fit a Windows command line.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain .mjs script without types
import { chunks as chunksOf } from '../../scripts/check-branch.mjs';

const chunks = chunksOf as (list: string[], max: number) => string[][];

const text = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'scripts', 'check-branch.mjs'), 'utf8');
const code = text.split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');

describe('check:branch', () => {
  it('starts no e2e, no Playwright and no build', () => {
    expect(code).not.toMatch(/e2e\.mjs|playwright|test:e2e|build\.mjs/);
  });

  it('runs typecheck, lint, the related unit tests and the publish guard, then records a light check', () => {
    for (const step of ["'typecheck'", "'lint'", "'--changed'", 'publish-guard.test.ts']) expect(code).toContain(step);
    expect(code).toMatch(/check-pass\.mjs', '--kind', 'light'/);
  });

  it('splits a long lint list so every eslint call fits a Windows command line', async () => {
    const files = Array.from({ length: 400 }, (_, i) => `src/renderer/components/SomeLongComponentName${i}.tsx`);
    const parts = chunks(files, 6000);
    expect(parts.flat()).toEqual(files);
    for (const p of parts) expect(p.join(' ').length).toBeLessThanOrEqual(6000);
    expect(chunks([], 10)).toEqual([]);
  });
});
