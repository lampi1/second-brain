// Review-only vitest config for the claim audits of PRs #26 and #29: runs test/review/pr-26-29/**/*.test.ts from the
// repo root with the '@shared' alias, node environment. Not part of the product's test suites.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');

export default defineConfig({
  root,
  resolve: { alias: { '@shared': path.resolve(root, 'src/shared') } },
  test: { include: ['test/review/pr-26-29/**/*.test.ts'], environment: 'node', testTimeout: 20000 },
});
