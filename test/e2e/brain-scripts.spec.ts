// End-to-end: a skill's scripts and queries on the Skill page (ADR 0263; the Script page of ADR 0076 is gone) and the Log
// page that holds the brain's changelog (ADR 0111) in the frozen demo, over the made-up scripts, queries and changelog of
// main/brain/scripts-demo.ts and queries-demo.ts read by the real readers and the demo's Log events (main/activity/demo.ts).
// A skill lists its scripts and queries with their titles, a row opens the file; a query still in the old folder is
// assigned to a skill; the Log shows the tasks as chains, the changelog's lines in its stream, and a step's details.
// Screenshots: test-results/shots/skill-parts.png, skill-unassigned.png, log-*.png.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { choose, goPage, launchDemo, shot } from './helpers';

let app: ElectronApplication, page: Page;
test.beforeAll(async () => { ({ app, page } = await launchDemo()); });
test.afterAll(async () => { await app?.close(); });

test('Skill: a skill shows its scripts and queries; the old ones not in a skill are assigned there (ADR 0263)', async () => {
  await goPage(page, 'skill'); // Script & Query is no tab any more: scripts and queries are files of their skill
  await expect(page.locator('#mh-tab-script')).toHaveCount(0);
  await page.getByTestId('bm-skill-pulizia-ambiente').click();
  const parts = page.getByTestId('sl-parts');
  await expect(parts.getByTestId('sl-parts-scripts')).toContainText('Pulisci i branch già uniti');
  await expect(parts.getByTestId('sl-parts-scripts')).toContainText('PowerShell');
  await expect(parts.getByTestId('sl-parts-queries')).toContainText('Errori 5xx per servizio');
  await shot(page, 'skill-parts');
  await parts.getByTestId('sl-part-scripts/pulisci-branch.ps1').click();
  await expect(page.getByTestId('sl-files')).toBeVisible();
  await expect(page.getByTestId('sk-md')).toHaveValue(/@title Pulisci i branch/);

  // the demo leaves a few in the brain's old folders: the user picks the skill
  const un = page.getByTestId('sl-unassigned');
  await un.getByTestId('sl-un-toggle').click();
  const line = un.getByTestId('sl-un-query-login-falliti.md');
  await expect(line).toContainText('Login falliti per utente');
  await shot(page, 'skill-unassigned');
  await choose(line.getByTestId('sl-un-skill'), 'pulizia-ambiente');
  await line.getByTestId('sl-un-move').click();
  await expect(un.getByTestId('sl-un-query-login-falliti.md')).toHaveCount(0);
  await page.getByTestId('sl-tab-read').click();
  await expect(page.getByTestId('sl-parts-queries')).toContainText('Login falliti per utente');
});

test('Log: the brain changelog is on the Log page; the tasks are chains, a step opens its details', async () => {
  await page.getByTestId('nav-log').click();
  const p = page.getByTestId('log-page');
  await expect(p).toBeVisible();
  await expect(page.getByTestId('nav-changelog')).toHaveCount(0);
  await expect(p.getByTestId('lg-task').first()).toBeVisible();
  await page.mouse.move(2, 2);
  await shot(page, 'log-page');

  await p.getByTestId('lg-filter-brain').click();
  await expect(p.getByTestId('lg-row')).toHaveCount(8);
  await p.getByTestId('lg-filter-all').click();
  await p.getByTestId('lg-task').first().getByTestId('lg-step-work').first().click();
  const detail = page.getByTestId('lg-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('Input');
  await shot(page, 'log-detail');
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
});
