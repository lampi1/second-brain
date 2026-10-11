// The STABLE copy as the user gets it (live check 2026-10-11: the 0.1.0 stable started without its brain and every
// section showed an error, while the dev e2e were green). Promotes the current commit into a temp releases folder,
// starts that release the way the launcher does (shared Electron runtime + SB_RELEASE, a fresh userData, NO SB_TEST,
// NO SB_BRAIN: the app must find the brain by itself), opens every brain section and the map, and fails if any of
// them shows an error or no data. Reads the real brain of this PC read-only. Run: npm run test:stable
import { test, expect, _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..', '..');
const SECTIONS = ['home', 'adesso', 'fatto', 'dafare', 'idee', 'spunti', 'costi', 'qualita', 'collabora', 'confronto', 'esplora'];

test('the packaged stable copy finds the brain by itself and every section shows data', async () => {
  test.setTimeout(600000);
  const releases = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stable-'));
  execFileSync(process.execPath, [path.join(repo, 'scripts', 'release.mjs'), 'promote', '--skip-check', '--allow-dirty'], { cwd: repo, env: { ...process.env, SB_RELEASES_ROOT: releases, SB_NO_SYNC: '1' }, stdio: 'pipe' });
  const state = JSON.parse(fs.readFileSync(path.join(releases, 'current.json'), 'utf8')) as { current: string };
  const rel = JSON.parse(fs.readFileSync(path.join(releases, 'releases', state.current, 'release.json'), 'utf8')) as { electron: string; claudeEngine: string | null };
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stable-ud-'));
  const env: Record<string, string> = { ...(process.env as Record<string, string>), SB_RELEASE: state.current, SB_USER_DATA: userData, SB_MCP_PORT: '0', SB_NO_SYNC: '1' };
  delete env.SB_TEST; delete env.SB_BRAIN; delete env.ELECTRON_RUN_AS_NODE;
  if (rel.claudeEngine) env.SB_ENGINE_CLAUDE = rel.claudeEngine;
  const app = await electron.launch({ executablePath: path.join(releases, 'electron', rel.electron, 'electron.exe'), args: [path.join(releases, 'releases', state.current)], env });
  // the first page Playwright sees may be the overlay layer (#overlay): wait for the app page itself
  await app.firstWindow();
  let page = app.windows().find(p => !p.url().includes('#overlay'));
  for (let i = 0; !page && i < 60; i++) { await new Promise(r => setTimeout(r, 500)); page = app.windows().find(p => !p.url().includes('#overlay')); }
  if (!page) throw new Error('app page not found');
  const shots = path.join(repo, 'test-results', 'shots');
  fs.mkdirSync(shots, { recursive: true });
  try {
    await expect(page.getByTestId('app')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('brain-setup')).toHaveCount(0, { timeout: 30000 }); // the brain was found by itself
    for (const id of SECTIONS) {
      await page.getByTestId(`nav-${id}`).click();
      const sec = page.getByTestId(`brain-page-${id}`);
      await expect(sec).toBeVisible({ timeout: 30000 });
      // loading finished and nothing failed
      // every block loaded (no skeleton left): slow sources (DevOps through day.mjs, 30 days of costs) get 3 minutes
      await expect(sec.getByTestId('bx-loading')).toHaveCount(0, { timeout: 180000 });
      const errs = await sec.getByTestId('bx-error').allInnerTexts();
      if (errs.length) {
        const logs = fs.readdirSync(path.join(userData, 'logs')).map(f => fs.readFileSync(path.join(userData, 'logs', f), 'utf8')).join('').split('\n').filter(l => /"(warn|error)"/.test(l)).slice(-8).join('\n');
        throw new Error(`${id}: ${errs.length} errors: ${errs[0]?.replace(/\s+/g, ' ')}\n--- logs ---\n${logs}`);
      }
      // some sections read slow sources (Fatto: DevOps through day.mjs, up to ~40 s on a cold cache)
      await expect.poll(async () => (await sec.innerText()).length, { message: `${id} has content`, timeout: 120000 }).toBeGreaterThan(200);
      await page.screenshot({ path: path.join(shots, `stable-${id}.png`) });
    }
    await page.getByTestId('nav-workspace').click().catch(() => { /* the grid button may have another id */ });
    await page.screenshot({ path: path.join(shots, 'stable-workspace.png') });
  } finally {
    await app.close();
  }
});
