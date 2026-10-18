// Vitest config for the PR 19 review tests only: the repo's vitest.config.ts includes test/unit/** and src/**, not
// test/review/**. Run from the repo root: npx vitest run --config test/review/pr-19/vitest.config.ts
// Used by the reviewer to prove the findings in docs/reviews/pr-19.md; each test FAILS on the PR head because of the bug.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '../../..');
export default defineConfig({
  root: repo,
  resolve: { alias: { '@shared': path.resolve(repo, 'src/shared') } },
  test: { include: ['test/review/pr-19/**/*.test.ts'], environment: 'node', testTimeout: 15000 },
});
