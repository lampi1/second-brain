import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, 'src/shared') } },
  test: { include: ['test/unit/**/*.test.ts', 'src/**/*.test.ts', 'test/live/**/*.test.ts' /* skipped unless SB_LIVE=1 */], environment: 'node',
    // Git- and process-heavy tests take up to ~1 min on a Windows PC with real-time antivirus scanning (owner's work PC)
    testTimeout: 120000,
    // the fake CLIs' children left suspended by this run are ended at its end
    globalSetup: ['test/fixtures/sweep-suspended.mjs'],
    // both lazy dictionaries, for tests that switch the language synchronously
    setupFiles: ['test/fixtures/i18n-all.ts'] },
});
