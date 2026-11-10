// E2E: the «Bivio» question card (ADR 0259): the short question, one sentence of context, a before → after, what was
// done as numbered steps with its evidence, and the two roads (Se Sì / Se No) with their next steps and buttons that
// say the action; a question without a brief keeps the chat's text folded. Demo app. Screenshots: qbivio-<scheme>.png,
// qbivio-nobrief.png, qbivio-narrow.png.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type D = { stop(id: string): Promise<void>; ask(id: string, r: object): void; say(id: string, t: string): void; show(id: string, a: object): string };
const demo = <A extends unknown[]>(app: ElectronApplication, fn: (d: D, ...a: A) => unknown, ...a: A) =>
  app.evaluate((_e, [src, args]) => { const d = (globalThis as unknown as { __sbDemo: D }).__sbDemo; return new Function('d', 'a', `return (${src})(d, ...a)`)(d, args); }, [fn.toString(), a] as const);
const yn = (q: string) => ({ type: 'question', tool: 'AskUserQuestion', title: q, detail: q, input: {},
  questions: [{ question: q, header: 'Fix', multiSelect: false, options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] }] });

async function clear(app: ElectronApplication, page: Page) {
  for (const id of ['orchestrator', 'qa', 'feedback', 'fix', 'sms', 'mappa']) await demo(app, (d, c) => d.stop(c), id);
  for (let i = 0; i < 5; i++) { await page.waitForTimeout(300); const x = page.getByTestId('qwin-card-dismiss'); if (!(await x.count())) break; await x.click(); }
  await expect(page.getByTestId('qwin')).toHaveCount(0);
}

const BRIEF = { id: 'brief-bivio', target: 'next-ask', component: 'brief', title: 'Fix rimborso', summary: 'Rimborso corretto',
  props: { why: 'Il rimborso ignorava lo sconto sugli ordini spediti a metà: ho corretto il calcolo.',
    done: ['Corretto il calcolo del rimborso', 'Aggiunto il test del caso TC7'],
    change: { what: 'Rimborso TC7', before: '120,00 €', after: '108,00 €' },
    ifYes: 'Faccio il commit e aggiorno la PR', ifNo: 'Lascio le modifiche non salvate',
    yesLabel: 'Sì, faccio il commit', noLabel: 'No, lascio così',
    yesSteps: ['Commit sul ramo fix/at-7', 'Aggiorno la PR 815', 'Chiedo la review a Sara'], noSteps: ['Le modifiche restano non salvate', 'Mi fermo e aspetto te'],
    checks: [{ label: '42/42 test', status: 'ok' }], files: [{ path: 'src/Orders/Refund.cs', why: 'il calcolo', added: 6, removed: 2 }] } };

for (const scheme of ['dark', 'light'] as const) {
  test(`a question as «Bivio»: context, before → after, roads with next steps · ${scheme}`, async () => {
    test.setTimeout(120_000);
    const { app, page } = await launchDemo({ scheme, width: 1366, height: 900, config: { theme: scheme } });
    await clear(app, page);
    expect(await demo(app, (d, id, a) => d.show(id, a), 'fix', BRIEF)).toContain('Mostrato');
    await demo(app, (d, id, q) => d.ask(id, q), 'fix', yn('Faccio il commit del fix sul rimborso?'));
    await expect(page.getByTestId('qwin-card-q')).toHaveText('Faccio il commit del fix sul rimborso?');
    await expect(page.getByTestId('qwin-card-ctx-lead')).toContainText('Il rimborso ignorava lo sconto');
    await expect(page.getByTestId('qwin-card-change')).toContainText('108,00 €');
    await expect(page.getByTestId('qwin-card-road-yes')).toContainText('Aggiorno la PR 815');
    await expect(page.getByTestId('qwin-card-road-no')).toContainText('Mi fermo e aspetto te');
    await expect(page.getByTestId('qwin-card-opt-1')).toContainText('Sì, faccio il commit');
    await expect(page.getByTestId('qwin-card-opt-2')).toContainText('No, lascio così');
    await expect(page.getByTestId('qwin-card-opt-1')).toBeInViewport();
    await page.mouse.move(2, 2);
    await shot(page, `qbivio-${scheme}`);
    if (scheme === 'dark') {
      await clear(app, page);
      await demo(app, (d, id, t) => d.say(id, t), 'sms', 'Ho controllato il log: le notifiche partono due volte. Ecco il dettaglio lungo che non serve per decidere.');
      await demo(app, (d, id, q) => d.ask(id, q), 'sms', yn('Le notifiche partono due volte. Tolgo il doppio invio?'));
      await expect(page.getByTestId('qwin-card-ctx-lead')).toHaveText('Le notifiche partono due volte.');
      await expect(page.getByTestId('qwin-card-ctx-body')).toHaveCount(0); // the chat's text stays folded
      await page.mouse.move(2, 2);
      await shot(page, 'qbivio-nobrief');
      await clear(app, page);
      await page.setViewportSize({ width: 1000, height: 760 });
      expect(await demo(app, (d, id, a) => d.show(id, a), 'fix', { ...BRIEF, id: 'brief-bivio-2' })).toContain('Mostrato');
      await demo(app, (d, id, q) => d.ask(id, q), 'fix', yn('Faccio il commit del fix sul rimborso?'));
      await expect(page.getByTestId('qwin-card-opt-1')).toBeInViewport();
      await page.mouse.move(2, 2);
      await shot(page, 'qbivio-narrow');
    }
    await app.close();
  });
}
