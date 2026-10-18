// Review-only vitest config: runs the failing proofs under test/review/search/** (not part of the main suite), with the
// repo's '@shared' alias. Used by reviewers: npx vitest run --config test/review/search/vitest.config.ts <dir>
import { defineConfig } from 'vitest/config';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
export default defineConfig({
  root,
  resolve: { alias: { '@shared': path.resolve(root, 'src/shared') } },
  test: { include: ['test/review/search/**/*.test.ts'], environment: 'node', testTimeout: 15000 },
});
