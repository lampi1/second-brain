// Vitest config of the unit and live tests (`npm test`, `npx vitest run`).
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, 'src/shared') } },
  test: { include: ['test/unit/**/*.test.ts', 'src/**/*.test.ts', 'test/live/**/*.test.ts' /* skipped unless SB_LIVE=1 */], environment: 'node',
    // one generous ceiling for tests and hooks alike, never a tight step deadline: unit tests start no process, git, port
    // or network and wait on events, not clocks (docs/agents/rules.md §7); a test that needs this much is a bug
    testTimeout: 120000,
    hookTimeout: 120000,
    // half the cores per run (default: all but one): parallel agent chats each ran 13 workers on 14 cores (2026-11-07)
    pool: 'forks', maxWorkers: '50%',
    // the fake CLIs' children left suspended by this run are ended at its end
    globalSetup: ['test/fixtures/sweep-suspended.mjs'],
    // both lazy dictionaries, for tests that switch the language synchronously
    setupFiles: ['test/fixtures/i18n-all.ts'] },
});
