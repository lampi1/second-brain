// A question opened in the Orchestrator's column (ADR 0269) on a short window (the owner 2026-11-12: «quando espando la
// domanda spesso non riesco a scrollarla fino in fondo» · «da espansa voglio vedere sempre l'input dell'orchestrator
// scrivibile, è quello il campo libero» · «un X per chiudere la domanda che equivale a rispondo dopo»): a long plan to
// approve opens with the Orchestrator's input still in sight, scrolls to its last line, has no answer box of its own
// (the user writes to the Orchestrator, ADR 0274), its ✕ is «Ci penso dopo», and what he writes to the Orchestrator
// answers the Orchestrator's own question. A short question (the owner 2026-11-18, a screenshot: half the column an
// empty panel, the chat a strip) is as tall as what it says and the chat keeps the rest. Frozen demo; screenshots in
// test-results/shots/orchestrator-ask-input-*.png, orchestrator-asks-*.png. ADR 0327 (the owner 2026-11-19: «le domande
// se espanse siano veramente leggibili per intero»): the open card says each thing once, why first, answers before the
// details.
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

// The owner 2026-11-13: «le domande dall'orchestratore sono tagliatissime illeggibili»: under a LONG Orchestrator chat
// the rows kept a strip of 90 px (flex shrinks by content size). Closed: every row whole, its Sì / No in sight; open:
// the chat gives way to the card (down to a strip of the last messages), the answers and the input in sight.
test('under a long Orchestrator chat the question rows stay whole and an open one is never the one cut', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 830 });
  const say = (text: string) => app.evaluate((_e, t) => { (globalThis as unknown as { __sbDemo: { say(c: string, t: string): void } }).__sbDemo.say('orchestrator', t); }, text);
  try {
    for (let i = 0; i < 30; i++) await say(`Messaggio ${i + 1} dell'Orchestrator: un paragrafo abbastanza lungo da occupare più righe nella colonna, come in una giornata di lavoro vera con tanti agenti che riportano.`);
    // the demo's requests wait folded in «N da rispondere dopo»: unfolded, they are rows like new ones
    await page.getByTestId('orchestrator-asks-later').click();
    const rows = page.getByTestId('orchestrator-ask');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    const asks = page.getByTestId('orchestrator-asks');
    // every row whole: the list is as tall as its rows (up to its cap), its Sì / No in sight
    await page.waitForTimeout(300);
    await shot(page, 'orchestrator-asks-long-chat');
    const box = await asks.boundingBox();
    expect(box!.height).toBeGreaterThan(110);
    const yes = page.getByTestId('orchestrator-ask-yes').first();
    if (await yes.count()) await expect(yes).toBeInViewport({ ratio: 1 });

    await rows.first().getByTestId('orchestrator-ask-toggle').click();
    const card = page.getByTestId('qwin');
    await expect(card).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, 'orchestrator-asks-long-chat-open');
    // the long chat gives way, never the card: the panel shows the whole card, or the chat is down to its strip
    const fit = await page.evaluate(() => { const o = document.querySelector('.oasks')!, w = document.querySelector('.orchestrator-tile > .items-wrap')!; return { cut: o.scrollHeight - o.clientHeight, chat: Math.round(w.getBoundingClientRect().height) }; });
    expect(fit.cut <= 2 || fit.chat === 72, JSON.stringify(fit)).toBe(true);
    expect(fit.chat).toBeGreaterThanOrEqual(72);
    // its answers in sight without scrolling: the chat's long message scrolls in its own box
    await expect(card.getByRole('button', { name: /^QA rimborsi/ })).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('orchestrator-input')).toBeInViewport();
  } finally { await app.close(); }
});

// The owner 2026-11-18 (a screenshot): a short yes/no question of the Orchestrator, open, took the whole column: under
// its «Ci penso dopo» half the column was an empty panel, and the chat above was a 72 px strip with its last card cut.
test('a short open question is as tall as what it says: no empty panel under it, the chat keeps the rest', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 1296 });
  const demo = (fn: string, ...args: unknown[]) => app.evaluate((_e, [f, a]) => ((globalThis as unknown as { __sbDemo: Record<string, (...x: unknown[]) => unknown> }).__sbDemo[f as string]!)(...(a as unknown[])), [fn, args] as const);
  const Q = 'Faccio applicare al pacchetto della routine i primi 3 cambi?';
  try {
    expect(await demo('show', 'orchestrator', { id: 'brief-short', target: 'next-ask', component: 'brief', title: 'Routine', summary: 'La routine si ferma quasi su ogni bug: la causa è nelle sue regole.',
      props: { done: ['Analisi di 25 run e 39 fermate', 'Causa 1: un controllo fallito non torna mai al fix'], ifYes: 'Artisan modifica i file del pacchetto e Sentinel rivede il diff', ifNo: 'Il pacchetto resta com\'è' } })).toContain('Mostrato');
    await demo('ask', 'orchestrator', { type: 'question', tool: 'AskUserQuestion', title: Q, detail: Q, input: {}, questions: [{ question: Q, header: 'Routine', multiSelect: false, options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] }] });
    const row = page.locator('[data-ask-row^="orchestrator/"]').filter({ hasText: 'Orchestrator' }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    if (!(await page.getByTestId('qwin').count())) await row.getByTestId('orchestrator-ask-toggle').click();
    await expect(page.getByTestId('qwin-card-opt-1')).toBeInViewport({ ratio: 1 });
    await shot(page, 'orchestrator-asks-short-open');
    // ADR 0327, one question, one text: the brief is drawn once (in the card, not also in the chat above), no box that
    // repeats the chat's last message, why first, the answers before «Cosa ho fatto»
    await expect(page.locator('.orchestrator-tile').getByText('Analisi di 25 run e 39 fermate')).toHaveCount(1);
    await expect(page.getByTestId('qwin').getByText('Messaggio della chat')).toHaveCount(0);
    await expect(page.getByTestId('qwin-card-ctx-lead')).toHaveText('La routine si ferma quasi su ogni bug: la causa è nelle sue regole.');
    const order = await page.evaluate(() => { const y = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top; return { actions: y('qwin-card-actions'), evidence: y('qwin-card-evidence') }; });
    expect(order.actions, JSON.stringify(order)).toBeLessThan(order.evidence);
    const fit = await page.evaluate(() => {
      const o = document.querySelector('.oasks')!, w = document.querySelector('.orchestrator-tile > .items-wrap')!, last = o.lastElementChild!;
      return { cut: o.scrollHeight - o.clientHeight, empty: Math.round(o.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom), chat: Math.round(w.getBoundingClientRect().height), panel: Math.round(o.getBoundingClientRect().height) };
    });
    expect(fit.cut, JSON.stringify(fit)).toBeLessThanOrEqual(2);   // the whole card, nothing to scroll
    expect(fit.empty, JSON.stringify(fit)).toBeLessThanOrEqual(4); // and nothing empty under its last row
    expect(fit.chat, JSON.stringify(fit)).toBeGreaterThan(150);    // the chat is more than a strip
    await expect(page.getByTestId('orchestrator-input')).toBeInViewport();
  } finally { await app.close(); }
});
