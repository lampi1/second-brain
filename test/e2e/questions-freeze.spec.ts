// E2E: the questions window keeps the card as it opened (ADR 0259, the owner 2026-11-10: «a volte la modale si modifica
// da sola mentre è aperta»): text the chat writes after the card opened shows only after «Mostra» on the notice, and the
// Sì / No answers stay in sight while a long context scrolls. Demo app. Screenshots: qfreeze-open.png, qfreeze-news.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, shot } from './helpers';
type D = { stop(id: string): Promise<void>; ask(id: string, r: object): void; say(id: string, t: string): void };
const demo = <A extends unknown[]>(app: ElectronApplication, fn: (d: D, ...a: A) => unknown, ...a: A) =>
  app.evaluate((_e, [src, args]) => { const d = (globalThis as unknown as { __sbDemo: D }).__sbDemo; return new Function('d', 'a', `return (${src})(d, ...a)`)(d, args); }, [fn.toString(), a] as const);
test('an open question card does not change under the reader; its answers stay in sight', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo({ scheme: 'dark', width: 1366, height: 900, config: { theme: 'dark' } });
  for (const id of ['orchestrator', 'qa', 'feedback', 'fix', 'sms', 'mappa']) await demo(app, (d, c) => d.stop(c), id);
  for (let i = 0; i < 5; i++) { await page.waitForTimeout(300); const x = page.getByTestId('qwin-card-dismiss'); if (!(await x.count())) break; await x.click(); }
  await demo(app, (d, id, t) => d.say(id, t), 'fix', 'Ho analizzato il problema. '.repeat(40));
  const Q = 'Procedo con il commit sul ramo fix/at-7?';
  await demo(app, (d, id, q) => d.ask(id, q), 'fix', { type: 'question', tool: 'AskUserQuestion', title: Q, detail: Q, input: {}, questions: [{ question: Q, header: 'Fix', multiSelect: false, options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] }] });
  await expect(page.getByTestId('qwin-card')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('qwin-card-opt-1')).toBeInViewport();
  await shot(page, 'qfreeze-open');
  await demo(app, (d, id, t) => d.say(id, t), 'fix', 'NOTA AGGIUNTA DOPO');
  await expect(page.getByTestId('qwin-news')).toBeVisible();
  await expect(page.getByTestId('qwin')).not.toContainText('NOTA AGGIUNTA DOPO');
  await shot(page, 'qfreeze-news');
  await page.getByTestId('qwin-news').click();
  await expect(page.getByTestId('qwin')).toContainText('NOTA AGGIUNTA DOPO');
  await expect(page.getByTestId('qwin-news')).toHaveCount(0);
  await app.close();
});
