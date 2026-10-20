// E2E of the Task page (real app, a synthetic brain with a fake ops/tools/devops-me.mjs from test/fixtures/devops):
// nothing is read until asked (automatic read off by default); "Aggiorna ora" runs the script, shows news with titles
// and links and their whole text, the unread ones highlighted, PRs with who they wait for, work items opening in place on
// description, comments and test outcomes, a sidebar badge and a feed event; "Segna tutte come lette" clears them; an
// expired az login shows the command to run; the page turns the automatic read on. Laid out like Agenti (ADR 0079:
// the DevOps page became Task): the same head, toolbar and cards. Screenshots dark and light: test-results/shots/task-*.png.
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
    await expect(dv.getByTestId('task-prs')).toHaveCount(0); // no empty sections claiming "nothing" before a read

    // Aggiorna ora: the script runs, news with title + link, unread highlighted
    await dv.getByTestId('task-refresh').click();
    const mention = dv.getByTestId('task-news-mention:1');
    await expect(mention).toHaveAttribute('data-unread', '1', { timeout: 30_000 });
    await expect(mention.getByRole('link', { name: 'Il totale del rimborso ignora lo sconto' })).toHaveAttribute('href', 'https://dev.azure.com/o/Shop/_workitems/edit/4711');
    await expect(mention).toContainText('Giulia ti menziona');
    await expect(dv.getByTestId('task-followed').getByTestId('task-news-followed:4650:12')).toContainText('stato Active → Resolved');
    await expect(dv.getByTestId('task-pr-812')).toContainText('build fallita');
    await expect(dv.getByTestId('task-pr-812')).toContainText('auto-complete attivo');
    await expect(dv.getByTestId('task-pr-812')).toContainText('Giulia Bianchi: approvata');
    await expect(dv.getByTestId('task-assigned')).toContainText('Fatture: invio PEC dal dettaglio');
    // the content is in the app (2026-10-12): the whole mention, who the PR waits for, its last comment, and a work
    // item that opens in place on its description, comments and test outcomes
    await expect(dv.getByTestId('task-body-mention:1')).toHaveText('Riesci a guardarlo oggi? Il cliente ha già fatto due resi così.');
    await expect(dv.getByTestId('task-wait-812')).toHaveText('Aspetta te: build fallita');
    await expect(dv.getByTestId('task-pr-812')).toContainText('Manca il test per lo sconto percentuale.');
    await expect(dv.getByTestId('task-tile-prs')).toContainText('1 aspetta te');
    const item = dv.getByTestId('task-assigned').getByTestId('task-item-4711');
    await expect(item).toContainText('2 test: 1 passato, 1 fallito');
    await expect(item).toContainText('Giulia: Riesci a guardarlo oggi?');
    await expect(item.getByTestId('task-desc-4711')).toBeHidden();
    await item.locator('summary').click();
    await expect(item.getByTestId('task-desc-4711')).toContainText('Con un reso parziale il rimborso usa il prezzo pieno.');
    await expect(item.getByTestId('task-tests')).toContainText('Reso parziale con sconto di riga');
    await dv.getByTestId('task-tile-items').click();   // a tile jumps to its section
    await expect(dv.getByTestId('task-assigned')).toBeInViewport();
    await shot(page, 'task-item-open');
    await item.locator('summary').click();
    await dv.getByTestId('task-tile-news').click();
    await expect(page.getByTestId('nav-badge-task')).toHaveText('2');
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

    // "Da leggere" counts its own news (the followed ticket is told apart); "Segna tutte come lette" marks only those, the
    // followed ticket has its own "Letta"; the rows stay in place, marked read, until the next read
    await expect(dv.getByTestId('task-tile-news')).toContainText('1');
    await expect(dv.getByTestId('bx-lead')).toContainText('1 novità da leggere');
    await expect(dv.getByTestId('bx-lead')).toContainText('1 sui ticket che segui');
    await dv.getByTestId('task-mark-all').click();
    await expect(page.getByTestId('nav-badge-task')).toHaveText('1');
    await dv.getByTestId('task-read-followed-followed:4650:12').click();
    await expect(page.getByTestId('nav-badge-task')).toHaveText('');
    await expect(mention).toHaveAttribute('data-unread', '0');
    await expect(mention).toContainText('letta');

    // az login expired: a clear message with the command, the last data stays
    fs.writeFileSync(path.join(brain, 'task-fail'), '');
    await dv.getByTestId('task-refresh').click();
    await expect(dv.getByTestId('task-error')).toContainText('Accesso a DevOps scaduto', { timeout: 30_000 });
    await expect(dv.getByTestId('bx-lead')).toContainText('Accesso a DevOps scaduto');
    await expect(page.getByTestId('toasts')).toContainText('accesso scaduto');
    await expect(dv.getByTestId('task-refresh')).toBeEnabled();
    await expect(dv.getByTestId('task-error-command')).toHaveText('az login');
    await expect(dv.getByTestId('task-pr-812')).toBeVisible();
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
