// End-to-end: "Migliora l'app" (components/ImprovePage.tsx, LaunchBanner.tsx; ADR 0020) on the demo, with a fake stable
// run (SB_IMPROVE_STABLE), a temp releases folder (SB_RELEASES_ROOT) and a temp git repo standing for the app's code
// (SB_IMPROVE_REPO) whose scripts/release.mjs only prints. Checks: after a start that went back to the previous
// version the notice says which one, why, and where it is now, and goes away when closed; the section shows the
// version in use, main's new commit and the branches by stage; the section's Regia is created in its column (never
// the work Regia); "Aggiorna" asks first, runs release.mjs promote, shows its steps and asks the restart (recorded,
// never real in tests). Screenshots: test-results/shots/improve-*.png.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchDemo, shot } from './helpers';

function fakeAppRepo(): { dir: string; running: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-repo-'));
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  const commit = (file: string, msg: string) => { fs.writeFileSync(path.join(dir, file), msg); g('add', '-A'); g('commit', '-q', '-m', msg); return g('rev-parse', 'HEAD'); };
  g('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'scripts', 'release.mjs'), "console.log('npm run check …'); setTimeout(() => console.log('npm run test:stable …'), 300); setTimeout(() => console.log('promoted 0.1.0-e2e0001 (previous: x)'), 700);\n");
  commit('a.txt', 'Prima versione');
  g('checkout', '-q', '-b', 'feat/tema-scuro'); commit('t.txt', 'Tema scuro più leggibile');
  g('checkout', '-q', 'main'); g('merge', '-q', '--no-ff', '-m', 'Unisci tema scuro', 'feat/tema-scuro');
  const running = g('rev-parse', '--short=7', 'HEAD');
  g('checkout', '-q', '-b', 'feat/scorciatoie'); commit('s.txt', 'Scorciatoie per le chat');
  g('checkout', '-q', 'main'); g('merge', '-q', '--no-ff', '-m', 'Unisci scorciatoie', 'feat/scorciatoie');
  g('checkout', '-q', '-b', 'feat/barra-costi'); const tested = commit('c.txt', 'Barra dei costi compatta');
  g('checkout', '-q', 'main'); g('checkout', '-q', '-b', 'feat/mappa'); commit('m.txt', 'Mappa più veloce');
  g('checkout', '-q', 'main');
  // the branch passed the light check:branch, main's tip the full check (ADR 0027)
  const at = new Date().toISOString();
  fs.writeFileSync(path.join(dir, '.git', 'sb-checks.json'), JSON.stringify({ [tested]: { at, kind: 'light' }, [g('rev-parse', 'main')]: { at, kind: 'full' } }));
  return { dir, running: `0.1.0-${running}` };
}

test("Migliora l'app: the start notice, the stages, the app's Regia, Aggiorna", async () => {
  test.setTimeout(120_000);
  const repo = fakeAppRepo();
  const releases = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-rel-'));
  // last start: the promoted 0.1.0-ffff123 did not open, the launcher went back to the one in use (release.mjs launch
  // leaves current.json pointing at the discarded release and only adds it to bad)
  fs.writeFileSync(path.join(releases, 'current.json'), JSON.stringify({ current: '0.1.0-ffff123', previous: repo.running, bad: ['0.1.0-ffff123'] }));
  fs.writeFileSync(path.join(releases, 'launch-result.json'), JSON.stringify({
    at: new Date().toISOString(), wanted: '0.1.0-ffff123', started: repo.running,
    attempts: [{ id: '0.1.0-ffff123', outcome: 'bad', reason: 'exited with code 1 after 3 s' }, { id: repo.running, outcome: 'started' }],
  }));
  const { app, page } = await launchDemo({ env: { SB_IMPROVE_STABLE: repo.running, SB_RELEASES_ROOT: releases, SB_IMPROVE_REPO: repo.dir } });

  const banner = page.getByTestId('launch-banner');
  await expect(banner).toHaveAttribute('data-outcome', 'fallback');
  await expect(banner).toContainText('La versione nuova non è partita.');
  await expect(banner).toContainText('0.1.0-ffff123');
  await expect(banner).toContainText('si è chiusa da sola dopo 3 secondi (codice 1)');
  await expect(banner).toContainText(`l’app è tornata a ${repo.running}`);
  await shot(page, 'improve-banner');

  await page.getByTestId('launch-open').click();
  const sec = page.getByTestId('improve');
  await expect(sec).toBeVisible();
  // words, not hashes: the version by its date, the changes by their subject (the codes only in the tooltips)
  await expect(sec.getByTestId('improve-running')).toHaveText(/^del \d\d\/\d\d alle \d\d:\d\d$/);
  await expect(sec.getByTestId('improve-running')).toHaveAttribute('data-tip', new RegExp(repo.running));
  await expect(sec.getByTestId('improve-candidate')).toContainText('Pronta una versione nuova con 1 modifica: Scorciatoie per le chat');
  await expect(sec.getByTestId('improve-stage-work')).toContainText('Mappa più veloce');
  await expect(sec.getByTestId('improve-stage-tested')).toContainText('Barra dei costi compatta');
  await expect(sec.getByTestId('improve-stage-approved')).toContainText('Scorciatoie per le chat');
  await expect(sec.getByTestId('improve-stage-promoted')).toContainText('Tema scuro più leggibile');
  await expect(sec.getByTestId('improve-stage-approved')).toContainText('(1)');
  await expect(sec).not.toContainText('feat/');
  const promote = sec.getByTestId('improve-promote');
  await expect(promote).toBeEnabled();

  // the notice, once closed, stays closed (main remembers it was told)
  await page.getByTestId('launch-dismiss').click();
  await expect(banner).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('improve:get', {})).launch)).toBe(null);

  // the section's own Regia: in its column, never the work Regia
  await expect(sec.getByTestId('improve-regia-empty')).toBeVisible();
  await shot(page, 'improve-section');
  await sec.getByTestId('improve-regia-create').click();
  await expect(sec.getByTestId('improve-regia')).toBeVisible();
  const chats = await page.evaluate(async () => (await window.sb.invoke('chat:list', undefined)).filter(c => c.space === 'app'));
  expect(chats).toEqual([expect.objectContaining({ appRegia: true, isRegia: false, cwd: repo.dir, title: 'Orchestrator' })]);
  await shot(page, 'improve-regia');

  // Aggiorna: confirm, release.mjs promote runs, its steps show, the app asks the restart
  await promote.click();
  await expect(page.getByTestId('confirm-ok')).toHaveText(/Aggiorna e riavvia/);
  await page.getByTestId('confirm-ok').click();
  const progress = sec.getByTestId('improve-progress');
  await expect(progress).toHaveAttribute('data-state', 'restarting', { timeout: 15_000 });
  await expect(progress).toContainText('0.1.0-e2e0001');
  await expect(sec.getByTestId('improve-log')).toContainText('promoted 0.1.0-e2e0001');
  await shot(page, 'improve-promoted');
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __sbImprove: { restarts: number } }).__sbImprove.restarts), { timeout: 5000 }).toBe(1);
  await app.close();
});
