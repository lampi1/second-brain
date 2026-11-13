// Main-only installer proof: real Setup/launchers with an isolated home, profile and shell integration, one worker.
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'test/installer', workers: 1, timeout: 240000, reporter: [['list']], outputDir: 'test-results/installer-smoke' });
