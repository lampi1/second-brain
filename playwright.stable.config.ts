// Playwright config of the stable-copy test (`npm run test:stable`).
import { defineConfig } from '@playwright/test';

// The stable-copy test (test/stable): promotes into a temp folder and opens that release with the real brain.
export default defineConfig({ testDir: 'test/stable', timeout: 600000, workers: 1, reporter: [['list']], outputDir: 'test-results/stable' });
