import { defineConfig } from '@playwright/test';

// End-to-end tests drive the real Electron app (test/e2e/*.spec.ts). No browsers are downloaded: Electron is the browser.
// Two projects (ADR 0042): "parallel" runs spec files side by side (each launch has its own profile, MCP port and temp
// folders), SB_E2E_WORKERS of them (scripts/e2e.mjs picks it from the machine's cores and load; 1 when unset);
// "exclusive" holds the specs that cannot share the machine, run one at a time after the parallel ones by scripts/e2e.mjs.
// Each project has its own outputDir, so the second run does not wipe the first one's artifacts; scripts/e2e.mjs clears
// test-results/shots once at the start.

/** Specs that need the machine to themselves, and why. */
export const EXCLUSIVE: Record<string, string> = {
  'map-live.spec.ts': 'frame times and fps budgets',
  'chats.spec.ts': 'quit timed against a budget, process trees counted',
  'stability.spec.ts': 'hang and reload delays timed on the clock',
  'questions-perf.spec.ts': 'questions window open time against a 100 ms budget',
  // these read the real system clipboard back (Copia in the renderer writes it): two at once would read each other's
  'brain-nav.spec.ts': 'system clipboard',
  'task-qa.spec.ts': 'system clipboard',
  'genui.spec.ts': 'system clipboard',
  'navigation.spec.ts': 'system clipboard',
  'link-peek.spec.ts': 'system clipboard',
  'codeblocks.spec.ts': 'system clipboard',
};
const exclusive = Object.keys(EXCLUSIVE).map(f => `**/${f}`);

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60000,
  workers: Math.max(1, Number(process.env.SB_E2E_WORKERS) || 1),
  reporter: process.env.SB_E2E_JSON ? [['list'], ['json', { outputFile: process.env.SB_E2E_JSON }]] : [['list']],
  outputDir: 'test-results',
  // the fake CLIs' children left suspended by this run are ended at its end (test/fixtures/sweep-suspended.mjs)
  globalSetup: './test/fixtures/sweep-suspended.mjs',
  // without the project name: one baseline per screenshot whichever project runs it
  updateSnapshots: 'none', // ordinary checks never create unreviewed source-tree media
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{-snapshotSuffix}{ext}',
  projects: [
    { name: 'parallel', testIgnore: exclusive, outputDir: 'test-results/parallel' },
    { name: 'exclusive', testMatch: exclusive, outputDir: 'test-results/exclusive', workers: 1 },
  ],
});
