// Playwright config of the README screenshots (`npm run shots`).
import { defineConfig } from '@playwright/test';

// README screenshots (test/shots/readme.spec.ts → docs/screenshots/*.webp), run by `npm run shots`. Never part of the
// e2e suite: it writes into docs/.
export default defineConfig({
  testDir: 'test/shots',
  timeout: 180000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/shots-run',
});
