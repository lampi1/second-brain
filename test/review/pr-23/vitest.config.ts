// Vitest config for the PR 23 review tests only (test/review/** is outside the main config's include list).
// Why: these tests pin bugs found in review and fail on the PR head on purpose. Who: the reviewer, by hand:
// `npx vitest run --config test/review/pr-23/vitest.config.ts`.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
export default defineConfig({
  root,
  resolve: { alias: { '@shared': path.resolve(root, 'src/shared') } },
  test: { include: ['test/review/pr-23/**/*.test.ts'], environment: 'node', testTimeout: 120000 },
});
