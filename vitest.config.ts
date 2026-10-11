import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, 'src/shared') } },
  test: { include: ['test/unit/**/*.test.ts', 'src/**/*.test.ts', 'test/live/**/*.test.ts' /* skipped unless SB_LIVE=1 */], environment: 'node', testTimeout: 15000 },
});
