// Review of PR 22 (agent metrics A6): runs only the review's proving tests (test/review/pr-22), which the main
// vitest.config.ts does not include. Used by the reviewer: `npx vitest run --config test/review/pr-22/vitest.config.ts`.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
export default defineConfig({
  root,
  resolve: { alias: { '@shared': path.join(root, 'src/shared') } },
  test: { include: ['test/review/pr-22/**/*.test.ts'], environment: 'node', testTimeout: 60000 },
});
