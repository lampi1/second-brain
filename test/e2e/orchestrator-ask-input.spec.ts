// A question opened in the Orchestrator's column (ADR 0269) on a short window (the owner 2026-11-12: «quando espando la
// domanda spesso non riesco a scrollarla fino in fondo» · «da espansa voglio vedere sempre l'input dell'orchestrator
// scrivibile, è quello il campo libero» · «un X per chiudere la domanda che equivale a rispondo dopo»): a long plan to
// approve opens with the Orchestrator's input still in sight, scrolls to its last line, has no answer box of its own
// (the user writes to the Orchestrator, ADR 0274), its ✕ is «Ci penso dopo», and what he writes to the Orchestrator
// answers the Orchestrator's own question. Frozen demo; screenshots in
// test-results/shots/orchestrator-ask-input-*.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('an open question keeps the Orchestrator input in sight; its ✕ answers later', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 830 });
  const demo = (fn: string, ...args: unknown[]) => app.evaluate((_e, [f, a]) => ((globalThis as unknown as { __sbDemo: Record<string, (...x: unknown[]) => unknown> }).__sbDemo[f as string]!)(...(a as unknown[])), [fn, args] as const);
  try {
    await demo('tree');
    const at = Date.now();
    const step = (title: string, role: string) => ({ title, detail: 'un dettaglio del passo abbastanza lungo da andare a capo nella colonna', role, state: 'todo' });
    await demo('plan', 'tree-plan', { phase: 'proposed', at, asked: 6, doneWhen: 'Report nel brain, nuovi tool vivi in test con una prova reale ciascuno',
      steps: [step('Controllo indipendente', 'sentinel'), step('Elenco dei nuovi tool', 'scout'), step('Correggo i problemi', 'artisan'), step('Costruisco i tool', 'artisan'), step('Widget grafico', 'artisan'), step('Ti scrivo cosa aggiornare', 'strategist')],
      clarified: Array.from({ length: 6 }, (_, i) => ({ q: `Domanda chiarita numero ${i + 1}, con un testo abbastanza lungo?`, a: 'Sì' })) });
    const row = page.locator(`[data-ask-row="tree-plan/plan@${at}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    // the plan is its row only: no second copy of its steps above the messages
    await expect(page.getByTestId('plan-tree-plan')).toHaveCount(0);
    await row.getByTestId('orchestrator-ask-toggle').click();
    const input = page.getByTestId('orchestrator-input');
    await expect(input).toBeInViewport();
    await expect(page.getByTestId('qwin-plan-change')).toHaveCount(0); // no box of its own
    await expect(page.getByTestId('qwin-plan-via-input')).toBeVisible();
    await shot(page, 'orchestrator-ask-input-open');

    // the card scrolls to its last line, the input still in sight
    await page.locator('.oasks').evaluate(e => { e.scrollTop = e.scrollHeight; });
    await expect(row.locator('.oask-foot')).toBeInViewport();
    await expect(input).toBeInViewport();
    await shot(page, 'orchestrator-ask-input-bottom');

    // ✕ on the row: «Ci penso dopo», the row folds into «N da rispondere dopo» and the input stays the Orchestrator's
    const folded = page.getByTestId('orchestrator-asks-later');
    const before = Number((await folded.textContent().catch(() => '0'))?.match(/\d+/)?.[0] ?? 0);
    await row.getByTestId('orchestrator-ask-later').click();
    await expect(folded).toContainText(`${before + 1} da rispondere dopo`);
    await expect(row).toHaveCount(0);

    // the Orchestrator asks something itself: what the user writes to it is that answer, and its row goes (ADR 0274)
    await folded.click(); // the demo left it among those «da rispondere dopo»
    const own = page.locator('[data-ask-row^="orchestrator/"]');
    await expect(own).toHaveCount(1);
    await expect(input).toHaveAttribute('placeholder', 'Cosa vuoi fare?');
    await input.fill('Prima la QA dei rimborsi');
    await input.press('Enter');
    await expect(own).toHaveCount(0);
    await expect(input).toHaveValue('');
  } finally { await app.close(); }
});
