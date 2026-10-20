// E2E of the Memoria page's statistics and the "Manutenzione" button (owner, 2026-10-19) on the frozen demo brain: the
// key numbers with their "?" explanations, "Lo sapevi?", the growth and per-agent charts, the recurring errors (a group
// of 3), the skills table (a skill never used), and the stale files (no "richiami" since ADR 0101); a memory card's lines are
// rendered Markdown and "Apri il file" opens the real file in the viewer; "Manutenzione" runs every job, says what each
// did and lists the change it made (the duplicate memory moved to the shared one) with "Annulla", which takes it back.
// Screenshots dark and light in test-results/shots/memory-*.png.
import { expect, test, type Page } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

async function theme(page: Page, scheme: 'dark' | 'light') {
  await page.evaluate(t => window.sb.invoke('settings:set', { theme: t }), scheme);
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(250);
}

test('Memoria: statistics with explanations, rendered memories that open, Manutenzione with undo', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo({ height: 1100 });
  try {
    await goPage(page, 'memoria');
    const mem = page.getByTestId('bm-memory-page');
    const ins = mem.getByTestId('mm-insights');
    await expect(ins).toBeVisible();
    await expect(ins.getByTestId('mm-k-errors')).toContainText('12');
    await expect(ins.getByTestId('mm-k-agents')).toContainText('4/');
    await expect(ins.getByTestId('mm-k-unused')).toContainText('1/');
    // a "?" says how the number is computed
    await ins.getByTestId('mm-k-lines').getByRole('button').click();
    await expect(page.getByRole('tooltip').filter({ hasText: 'righe di elenco' })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(ins.getByTestId('mm-fact-repeat')).toContainText('3 volte');
    await expect(ins.getByTestId('mm-fact-unusedSkills')).toContainText('pulizia-ambiente');
    await expect(ins.getByTestId('mm-growth').locator('svg[role=img]')).toBeVisible();
    await expect(ins.getByTestId('mm-per-agent').locator('svg[role=img]')).toBeVisible();
    const groups = ins.getByTestId('mm-error-group');
    await expect(groups.first()).toContainText('3');
    await expect(ins.getByTestId('mm-error-groups')).toContainText("Ha letto l'avviso generico");
    await expect(ins.getByTestId('mm-skill-pulizia-ambiente')).toHaveAttribute('data-verdict', 'unused');
    await expect(ins.getByTestId('mm-skill-note-di-rilascio')).toContainText(/\d/);
    await expect(ins.getByTestId('mm-recalled')).toHaveCount(0); // no "richiami" (ADR 0101)
    await expect(ins.getByTestId('mm-stale')).toContainText('Vecchio server di prova');
    await shot(page, 'memory-stats-dark');

    // memory cards: rendered Markdown with date chips; "Apri il file" opens the real file
    const scout = mem.getByTestId('bm-mem-agents/scout/memory.md');
    await expect(scout.locator('.mm-lines time').first()).toBeVisible();
    await expect(mem.getByTestId('bm-mem-agents/artisan/memory.md').locator('.mm-lines code').first()).toHaveText('release/*'); // inline code rendered
    await expect(scout.getByTestId('mm-card-recalls')).toHaveCount(0);
    await scout.scrollIntoViewIfNeeded();
    await shot(page, 'memory-cards-dark');
    await scout.getByTestId('mm-open').click();
    await expect(page.getByText('Prima di cercare nel codice').first()).toBeVisible();
    await goPage(page, 'memoria');

    // Manutenzione: every job, what each did, the change with Annulla
    await mem.getByTestId('bm-maint-now-run').click();
    const dlg = page.getByTestId('bm-maint-now-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId('mm-job-merge-memory')).toHaveAttribute('data-status', 'changed');
    await expect(dlg.getByTestId('mm-job-merge-skills')).not.toHaveAttribute('data-status', 'running');
    await expect(dlg.getByTestId('bm-change').first()).toContainText('memoria condivisa');
    await shot(page, 'memory-maintenance-dark');
    await dlg.getByTestId('bm-undo').first().click();
    await expect(dlg.getByTestId('bm-change').first()).toContainText('Annullata');
    await dlg.getByTestId('bm-maint-now-close').click();
    await expect(dlg).toHaveCount(0);

    // the same button heads the Skill and Regole pages
    await goPage(page, 'regole');
    await expect(page.getByTestId('bm-rules-page').getByTestId('bm-maint-now-run')).toHaveText(/Manutenzione/);
    await goPage(page, 'skill');
    await expect(page.getByTestId('skills-page').getByTestId('bm-maint-now-run')).toBeVisible();
    await shot(page, 'memory-skill-head-dark');

    // light
    await theme(page, 'light');
    await goPage(page, 'memoria');
    await expect(page.getByTestId('mm-insights')).toBeVisible();
    await page.waitForTimeout(300);
    await shot(page, 'memory-stats-light');
    await page.getByTestId('mm-errors').scrollIntoViewIfNeeded();
    await shot(page, 'memory-errors-light');
    await page.getByTestId('bm-mem-section-agents').scrollIntoViewIfNeeded();
    await shot(page, 'memory-cards-light');
  } finally { await app.close(); }
});
