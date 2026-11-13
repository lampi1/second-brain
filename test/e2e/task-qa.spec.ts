// E2E of the Task page's QA tab with the demo data (SB_DEMO: qa-status.mjs --mine --json faked by tasks/demo.ts, no
// network): after "Aggiorna ora" the «Test e QA» tab lists each PR with a test plan as a row; its detail shows
// done/missing, who ran how many, the failed and blocked test cases first with who and when, a QA bug under its test
// case, the ones still to do with who they are assigned to; names and titles only (no ids in the text). The aggregate
// section and its "Copia per lo stand-up" button were removed with the strips + detail redesign (ADR 0181, 0182): the
// spec checks the copy button is gone. Screenshots dark and light.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';
// the demo DevOps data's pull request URL (src/main/tasks/demo.ts)
const prUrl = (id: number) => `https://dev.azure.com/o/Shop/_git/shop-web/pullrequest/${id}`;

test('Task page: the QA tab shows done/missing, who ran them and QA bugs per PR', async () => {
  const { app, page } = await launchDemo();
  try {
    await page.getByTestId('nav-task').click();
    const dv = page.getByTestId('brain-page-task');
    await dv.getByTestId('task-refresh').click();
    await dv.getByTestId('task-tab-qa').click({ timeout: 30_000 });
    const detail = dv.getByTestId('task-detail');

    await dv.getByTestId('task-row-qa:812').click();
    const card = detail.getByTestId('qa-report-812');
    await expect(card.getByTestId('qa-headline')).toHaveText('4 su 6 fatti · mancano 2 · 1 fallito · 1 bloccato · 1 bug aperto');
    await expect(card.getByTestId('qa-people')).toHaveText('Eseguiti da Giulia Bianchi 2, Sara Neri 2');
    await expect(card.getByRole('link', { name: /Rimborso: lo sconto in origine entra nel totale/ })).toHaveAttribute('href', prUrl(812));
    await card.getByTestId('qa-plan-7000').locator('summary').click();
    const failed = card.getByTestId('qa-point-1');
    await expect(failed).toContainText('fallito');
    await expect(failed).toContainText('Giulia Bianchi');
    await expect(failed.getByRole('link', { name: 'Rimborso parziale: lo sconto di riga si perde con due righe uguali' })).toHaveAttribute('href', 'https://dev.azure.com/o/Shop/_workitems/edit/5201');
    await expect(card.getByTestId('qa-point-5')).toContainText('assegnato a Sara Neri');
    // failed first, then blocked, then the ones to do
    await expect(card.locator('.qa-points li').first()).toHaveAttribute('data-testid', 'qa-point-1');
    await expect(card.locator('.qa-points li').nth(1)).toHaveAttribute('data-testid', 'qa-point-4');
    await expect(card).toContainText('Il messaggio di conferma del reso è in inglese'); // a bug not on a test case
    // names and titles: the visible text carries no ids (they stay inside links)
    expect(await detail.innerText()).not.toMatch(/\b(812|809|5201|5101|7000)\b/);
    await expect(dv.getByTestId('qa-copy')).toHaveCount(0);
    await page.mouse.move(2, 2);
    await shot(page, 'task-qa-dark');

    await dv.getByTestId('task-row-qa:809').click();
    await expect(detail.getByTestId('qa-report-809').getByTestId('qa-headline')).toHaveText('0 su 2 fatti · mancano 2');
    expect(await detail.innerText()).not.toMatch(/\b(812|809|5140|5141|7010)\b/);

    await dv.getByTestId('task-row-qa:812').click();
    await expect(detail.getByTestId('qa-report-812')).toBeVisible();
    await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(300);
    await shot(page, 'task-qa-light');
  } finally {
    await app.close();
  }
});
