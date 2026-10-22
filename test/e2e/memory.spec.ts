// E2E of Memoria's Statistiche and File tabs and the "Manutenzione" button (owner, 2026-10-19; tabs since ADR 0122) on the
// frozen demo brain: "Lo sapevi?" with its "?" explanations, the growth and per-agent charts, the skills table (a skill
// never used), and the stale files (no "richiami" since ADR 0101; the key numbers and the recurring errors left with the
// Dashboard's duplicates: the hub's counters and Qualità hold them); a memory card's lines are
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
    await mem.getByTestId('mh-tab-statistiche').click();
    const ins = mem.getByTestId('mm-insights');
    await expect(ins).toBeVisible();
    await expect(ins.getByTestId('mm-k-errors')).toHaveCount(0); // no KPI row: the hub's counters say it once
    // the hub's counter says how it is computed
    await expect(mem.getByTestId('mh-pulse-lines')).toHaveAttribute('title', /righe di elenco/);

    await expect(ins.getByTestId('mm-fact-repeat')).toContainText('3 volte');
    await expect(ins.getByTestId('mm-fact-unusedSkills')).toContainText('pulizia-ambiente');
    await expect(ins.getByTestId('mm-growth').locator('svg[role=img]')).toBeVisible();
    await expect(ins.getByTestId('mm-per-agent').locator('svg[role=img]')).toBeVisible();
    await expect(ins.getByTestId('mm-error-groups')).toHaveCount(0); // the recurring errors are on Qualità
    await expect(ins.getByTestId('mm-skill-pulizia-ambiente')).toHaveAttribute('data-verdict', 'unused');
    await expect(ins.getByTestId('mm-skill-note-di-rilascio')).toContainText(/\d/);
    await expect(ins.getByTestId('mm-recalled')).toHaveCount(0); // no "richiami" (ADR 0101)
    await expect(ins.getByTestId('mm-stale')).toContainText('Vecchio server di prova');
    await shot(page, 'memory-stats-dark');

    // memory cards (File): rendered Markdown with date chips; "Apri il file" opens the real file
    await mem.getByTestId('mh-tab-file').click();
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

    // the button is once, in the hub's head, on every tab: Skill and Regole no longer repeat it
    await goPage(page, 'regole');
    await expect(page.getByTestId('bm-rules-page')).toBeVisible();
    await expect(page.getByTestId('bm-maint-now-run')).toHaveCount(1);
    await goPage(page, 'skill');
    await expect(page.getByTestId('skills-page')).toBeVisible();
    await expect(page.getByTestId('bm-maint-now-run')).toHaveCount(1);
    await shot(page, 'memory-skill-head-dark');

    // light
    await theme(page, 'light');
    await goPage(page, 'memoria');
    await page.getByTestId('mh-tab-statistiche').click();
    await expect(page.getByTestId('mm-insights')).toBeVisible();
    await page.waitForTimeout(300);
    await shot(page, 'memory-stats-light');
    await page.getByTestId('mh-tab-file').click();
    await page.getByTestId('bm-mem-section-agents').scrollIntoViewIfNeeded();
    await shot(page, 'memory-cards-light');
  } finally { await app.close(); }
});
