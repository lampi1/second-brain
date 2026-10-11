import { defineConfig } from '@playwright/test';

// End-to-end tests drive the real Electron app (test/e2e/*.spec.ts). No browsers are downloaded: Electron is the browser.
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
});
