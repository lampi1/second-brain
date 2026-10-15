// E2E of the DevOps page (real app, a synthetic brain with a fake ops/tools/devops-me.mjs from test/fixtures/devops):
// nothing is read until asked (automatic read off by default); "Aggiorna ora" runs the script, shows news with titles
// and links and their whole text, the unread ones highlighted, PRs with who they wait for, work items opening in place on
// description, comments and test outcomes, a sidebar badge and a feed event; "Segna tutte come lette" clears them; an
// expired az login shows the command to run; the gear menu turns the automatic read on. Screenshots dark and light.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, setSize, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures');
function fixtureBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-devops-'));
  fs.mkdirSync(path.join(d, 'ops', 'tools'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'brain-ui', 'brain-site.mjs'), path.join(d, 'ops', 'tools', 'brain-site.mjs'));
  fs.copyFileSync(path.join(FIX, 'brain-ui', 'data.mjs'), path.join(d, 'ops', 'tools', 'brain-ui-data.mjs'));
  fs.copyFileSync(path.join(FIX, 'devops', 'devops-me.mjs'), path.join(d, 'ops', 'tools', 'devops-me.mjs'));
  return d;
}

test('DevOps page: read on demand, unread news with links, badge and feed, mark read, az login expired, automatic read', async () => {
  const brain = fixtureBrain();
  const { app, page } = await launch({ SB_BRAIN: brain });
  try {
    await setSize(app, 1600, 1000);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.getByTestId('nav-devops').click();
    const dv = page.getByTestId('brain-page-devops');
    await expect(dv.getByTestId('bx-lead')).toContainText('DevOps non ancora letto');
    await expect(dv.getByTestId('devops-prs')).toHaveCount(0); // no empty sections claiming "nothing" before a read
    await expect(dv.getByTestId('devops-auto').getByRole('group', { name: 'Aggiornamento automatico' }).getByRole('button', { name: 'Spento' })).toHaveAttribute('aria-pressed', 'true');

    // Aggiorna ora: the script runs, news with title + link, unread highlighted
    await dv.getByTestId('devops-refresh').click();
    const mention = dv.getByTestId('devops-news-mention:1');
    await expect(mention).toHaveAttribute('data-unread', '1', { timeout: 30_000 });
    await expect(mention.getByRole('link', { name: 'Il totale del rimborso ignora lo sconto' })).toHaveAttribute('href', 'https://dev.azure.com/o/Shop/_workitems/edit/4711');
    await expect(mention).toContainText('Giulia ti menziona');
    await expect(dv.getByTestId('devops-followed').getByTestId('devops-news-followed:4650:12')).toContainText('stato Active → Resolved');
    await expect(dv.getByTestId('devops-pr-812')).toContainText('build fallita');
    await expect(dv.getByTestId('devops-pr-812')).toContainText('auto-complete attivo');
    await expect(dv.getByTestId('devops-pr-812')).toContainText('Giulia Bianchi: approvata');
    await expect(dv.getByTestId('devops-assigned')).toContainText('Fatture: invio PEC dal dettaglio');
    // the content is in the app (2026-10-12): the whole mention, who the PR waits for, its last comment, and a work
    // item that opens in place on its description, comments and test outcomes
    await expect(dv.getByTestId('devops-body-mention:1')).toHaveText('Riesci a guardarlo oggi? Il cliente ha già fatto due resi così.');
    await expect(dv.getByTestId('devops-wait-812')).toHaveText('Aspetta te: build fallita');
    await expect(dv.getByTestId('devops-pr-812')).toContainText('Manca il test per lo sconto percentuale.');
    await expect(dv.getByTestId('devops-tile-prs')).toContainText('1 aspetta te');
    const item = dv.getByTestId('devops-assigned').getByTestId('devops-item-4711');
    await expect(item).toContainText('2 test: 1 passato, 1 fallito');
    await expect(item).toContainText('Giulia: Riesci a guardarlo oggi?');
    await expect(item.getByTestId('devops-desc-4711')).toBeHidden();
    await item.locator('summary').click();
    await expect(item.getByTestId('devops-desc-4711')).toContainText('Con un reso parziale il rimborso usa il prezzo pieno.');
    await expect(item.getByTestId('devops-tests')).toContainText('Reso parziale con sconto di riga');
    await dv.getByTestId('devops-tile-items').click();   // a tile jumps to its section
    await expect(dv.getByTestId('devops-assigned')).toBeInViewport();
    await shot(page, 'devops-item-open');
    await item.locator('summary').click();
    await dv.getByTestId('devops-tile-news').click();
    await expect(page.getByTestId('nav-badge-devops')).toHaveText('2');
    // the feed (the Regia's Novità and the notification center) got the news, once
    await page.keyboard.press('Control+Shift+N');
    await expect(page.getByTestId('center')).toContainText('2 novità su DevOps'); // a first read: one summary line
    await page.keyboard.press('Escape');
    await page.getByTestId('brain-page-devops').evaluate(el => { el.scrollTop = 0; });
    await shot(page, 'devops-dark');

    await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(300);
    await shot(page, 'devops-light');
    await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'dark' }));

    // "Da leggere" counts its own news (the followed ticket is told apart); "Segna tutte come lette" marks only those, the
    // followed ticket has its own "Letta"; the rows stay in place, marked read, until the next read
    await expect(dv.getByTestId('devops-tile-news')).toContainText('1');
    await expect(dv.getByTestId('bx-lead')).toContainText('1 novità da leggere');
    await expect(dv.getByTestId('bx-lead')).toContainText('1 sui ticket che segui');
    await dv.getByTestId('devops-mark-all').click();
    await expect(page.getByTestId('nav-badge-devops')).toHaveText('1');
    await dv.getByTestId('devops-read-followed-followed:4650:12').click();
    await expect(page.getByTestId('nav-badge-devops')).toHaveText('');
    await expect(mention).toHaveAttribute('data-unread', '0');
    await expect(mention).toContainText('letta');

    // az login expired: a clear message with the command, the last data stays
    fs.writeFileSync(path.join(brain, 'devops-fail'), '');
    await dv.getByTestId('devops-refresh').click();
    await expect(dv.getByTestId('devops-error')).toContainText('Accesso a DevOps scaduto', { timeout: 30_000 });
    await expect(dv.getByTestId('bx-lead')).toContainText('Accesso a DevOps scaduto');
    await expect(page.getByTestId('toasts')).toContainText('accesso scaduto');
    await expect(dv.getByTestId('devops-refresh')).toBeEnabled();
    await expect(dv.getByTestId('devops-error-command')).toHaveText('az login');
    await expect(dv.getByTestId('devops-pr-812')).toBeVisible();
    await shot(page, 'devops-login-expired');

    // the page itself turns the automatic read on and sets the interval (the gear menu no longer does: one place, 2026-10-15)
    const auto = dv.getByTestId('devops-auto');
    await auto.getByRole('group', { name: 'Aggiornamento automatico' }).getByRole('button', { name: 'Acceso' }).click();
    await expect(auto.getByRole('group', { name: 'Aggiornamento automatico' }).getByRole('button', { name: 'Acceso' })).toHaveAttribute('aria-pressed', 'true');
    await auto.getByRole('button', { name: '1 h' }).click();
    await expect(auto.getByRole('button', { name: '1 h' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('settings').click();
    await expect(page.getByTestId('settings-pop')).not.toContainText('DevOps');
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});
