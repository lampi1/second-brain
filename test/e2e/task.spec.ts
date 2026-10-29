// E2E of the Task page (real app, a synthetic brain with a fake ops/tools/devops-me.mjs from test/fixtures/devops):
// nothing is read until asked (automatic read off by default); "Aggiorna ora" runs the script and fills the list (one
// strip per record, those for me first, ADR 0182): a chosen strip shows in the detail pane the news with its link and
// whole text, the PR with who it waits for, the work item with its description, comments and test outcomes; J/K move,
// E marks read; a sidebar badge and a feed event; "Segna tutte come lette" clears them; an expired az login shows the
// command to run; the page's link turns the automatic read on. The head is Agenti's (ADR 0079). Screenshots dark and light: test-results/shots/task-*.png.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, setSize, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures');
function fixtureBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-task-'));
  fs.mkdirSync(path.join(d, 'ops', 'tools'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'brain-ui', 'brain-site.mjs'), path.join(d, 'ops', 'tools', 'brain-site.mjs'));
  fs.copyFileSync(path.join(FIX, 'brain-ui', 'data.mjs'), path.join(d, 'ops', 'tools', 'brain-ui-data.mjs'));
  fs.copyFileSync(path.join(FIX, 'devops', 'devops-me.mjs'), path.join(d, 'ops', 'tools', 'devops-me.mjs'));
  return d;
}

test('Task page: read on demand, unread news with links, badge and feed, mark read, az login expired, automatic read', async () => {
  const brain = fixtureBrain();
  const { app, page } = await launch({ SB_BRAIN: brain });
  try {
    await setSize(app, 1600, 1000);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.getByTestId('nav-task')).toHaveAccessibleName(/^Task/);
    await expect(page.getByTestId('sidebar')).not.toContainText('DevOps');
    await page.getByTestId('nav-task').click();
    const dv = page.getByTestId('brain-page-task');
    await expect(dv.getByRole('heading', { level: 2, name: 'Task' })).toBeVisible();
    await expect(dv.locator('.catalog-head')).toBeVisible();     // the head of Agenti
    await expect(dv.getByTestId('task-auto')).toHaveCount(0); // the reading settings live in Settings → Notifiche (ADR 0101)
    await expect(dv.getByTestId('task-auto-state')).toContainText('Lettura automatica spenta');
    await expect(dv.getByTestId('bx-lead')).toContainText('Task non ancora letti');
    await expect(dv.getByTestId('task-never')).toBeVisible();
    await shot(page, 'task-empty');
    await expect(dv.getByTestId('task-list')).toHaveCount(0); // no empty list claiming "nothing" before a read

    // Aggiorna ora: the list opens on "Per te", the mention and the PR waiting for me first; the first one is shown
    await dv.getByTestId('task-refresh').click();
    const strip = dv.getByTestId('task-row-news:mention:1');
    await expect(strip).toHaveAttribute('data-unread', '1', { timeout: 30_000 });
    await expect(dv.getByTestId('task-tab-mine')).toHaveAttribute('aria-selected', 'true');
    await expect(strip).toContainText('Giulia ti menziona');
    await expect(dv.getByTestId('task-row-pr:812')).toContainText('Aspetta te: build fallita');
    const detail = dv.getByTestId('task-detail');
    const mention = detail.getByTestId('task-news-mention:1');
    await expect(mention.getByRole('link', { name: 'Il totale del rimborso ignora lo sconto' })).toHaveAttribute('href', 'https://dev.azure.com/o/Shop/_workitems/edit/4711');
    // the content is in the app (2026-10-12): the whole mention
    await expect(detail.getByTestId('task-body-mention:1')).toHaveText('Riesci a guardarlo oggi? Il cliente ha già fatto due resi così.');
    // J moves to the next strip: the PR with who it waits for, its checks, voters and last comment
    await dv.getByTestId('task-list').focus();
    await page.keyboard.press('j');
    await expect(dv.getByTestId('task-row-pr:812')).toHaveAttribute('aria-selected', 'true');
    await expect(detail.getByTestId('task-wait-812')).toHaveText('Aspetta te: build fallita');
    await expect(detail.getByTestId('task-pr-812')).toContainText('auto-complete attivo');
    await expect(detail.getByTestId('task-pr-812')).toContainText('Giulia Bianchi: approvata');
    await expect(detail.getByTestId('task-pr-812')).toContainText('Manca il test per lo sconto percentuale.');
    // Notifiche: the followed ticket is one strip with its changes; opening it is reading it (no «Letta» button)
    await dv.getByTestId('task-tab-news').click();
    await dv.getByTestId('task-row-followed:4650').click();
    await expect(detail.getByTestId('task-news-followed:4650:12')).toContainText('stato Active → Resolved');
    await expect(dv.getByTestId('task-row-followed:4650')).toHaveAttribute('data-unread', '0');
    await expect(detail.getByRole('button', { name: 'Letta' })).toHaveCount(0);
    // Work item: the item in full, its description, comments and test outcomes
    await dv.getByTestId('task-tab-items').click();
    await expect(dv.getByTestId('task-list')).toContainText('Fatture: invio PEC dal dettaglio');
    await expect(dv.getByTestId('task-row-item:4711')).toContainText('2 test: 1 passato, 1 fallito');
    await dv.getByTestId('task-row-item:4711').click();
    const item = detail.getByTestId('task-item-4711');
    await expect(item.getByTestId('task-desc-4711')).toContainText('Con un reso parziale il rimborso usa il prezzo pieno.');
    await expect(item.getByTestId('task-tests')).toContainText('Reso parziale con sconto di riga');
    await expect(item).toContainText('Riesci a guardarlo oggi?');
    await shot(page, 'task-item-open');
    await dv.getByTestId('task-tab-mine').click();
    await expect(page.getByTestId('nav-badge-task')).toHaveText('1'); // the mention: shown first on its own, not opened yet
    // the feed (the Orchestrator's Novità and the notification center) got the news, once
    await page.keyboard.press('Control+Shift+N');
    await expect(page.getByTestId('center')).toContainText('2 novità su DevOps'); // a first read: one summary line
    await page.keyboard.press('Escape');
    await page.getByTestId('brain-page-task').evaluate(el => { el.scrollTop = 0; });
    await shot(page, 'task-dark');

    await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(300);
    await shot(page, 'task-light');
    await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'dark' }));

    // the lead counts the news apart from the followed ticket (already read above); clicking the mention's strip reads
    // it; the strips stay in place, marked read, until the next read
    await expect(dv.getByTestId('bx-lead')).toContainText('3 per te'); // the mention, the PR waiting for me, the review asked of me
    await expect(dv.getByTestId('bx-lead')).toContainText('1 novità da leggere');
    await expect(dv.getByTestId('bx-lead')).not.toContainText('sui ticket che segui');
    await expect(dv.getByTestId('task-mark-all')).toBeVisible();
    await dv.getByTestId('task-row-news:mention:1').click();
    await expect(page.getByTestId('nav-badge-task')).toHaveText('');
    await expect(dv.getByTestId('task-mark-all')).toHaveCount(0);
    await expect(dv.getByTestId('task-row-news:mention:1')).toHaveAttribute('data-unread', '0');
    await expect(detail.getByTestId('task-news-mention:1')).toHaveAttribute('data-unread', '0');
    await expect(detail.getByTestId('task-news-mention:1')).toContainText('letta');

    // az login expired: a clear message with the command, the last data stays
    fs.writeFileSync(path.join(brain, 'task-fail'), '');
    await dv.getByTestId('task-refresh').click();
    await expect(dv.getByTestId('task-error')).toContainText('Accesso a DevOps scaduto', { timeout: 30_000 });
    await expect(dv.getByTestId('bx-lead')).toContainText('Accesso a DevOps scaduto');
    await expect(page.getByTestId('toasts')).toContainText('accesso scaduto');
    await expect(dv.getByTestId('task-refresh')).toBeEnabled();
    await expect(dv.getByTestId('task-error-command')).toHaveText('az login');
    await dv.getByTestId('task-tab-all').click();
    await expect(dv.getByTestId('task-row-pr:812')).toBeVisible(); // the last data stays
    await shot(page, 'task-login-expired');

    // the page's link opens Settings → Notifiche, where the automatic read is turned on and its interval set (one place)
    await dv.getByTestId('task-settings-link').click();
    const auto = page.getByTestId('task-auto');
    await expect(auto).toBeVisible();
    await expect(auto.getByRole('group', { name: 'Aggiornamento automatico' }).getByRole('button', { name: 'Spento' })).toHaveAttribute('aria-pressed', 'true');
    await auto.getByRole('group', { name: 'Aggiornamento automatico' }).getByRole('button', { name: 'Acceso' }).click();
    await expect(auto.getByRole('group', { name: 'Aggiornamento automatico' }).getByRole('button', { name: 'Acceso' })).toHaveAttribute('aria-pressed', 'true');
    await auto.getByRole('button', { name: '1 h' }).click();
    await expect(auto.getByRole('button', { name: '1 h' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('settings').click();
    await expect(page.getByTestId('settings-pop')).not.toContainText('DevOps');
    await expect(page.getByTestId('settings-pop')).not.toContainText('Task');
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});
