// E2E gallery of the questions window (ADR 0049): every kind of request the window shows, photographed in dark and
// light, at 1366×768 and 1920×1080, so a change to its look is seen whole: a question with its context, links and a
// text to approve (a ```md comment with Copia, ADR 0043), a question whose turn left commands (Esegui), several
// questions in one request, long texts, a permission with a long command, a command to run, and ten requests waiting.
// Screenshots: test-results/shots/qgal-<scenario>-<theme>-<width>.png.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type D = { stop(id: string): Promise<void>; ask(id: string, r: object): void; say(id: string, t: string): void; turn(id: string, t: string): void };
const demo = <A extends unknown[]>(app: ElectronApplication, fn: (d: D, ...a: A) => void, ...a: A) =>
  app.evaluate((_e, [src, args]) => { const d = (globalThis as unknown as { __sbDemo: D }).__sbDemo; return new Function('d', 'a', `return (${src})(d, ...a)`)(d, args); }, [fn.toString(), a] as const);
type Opt = { label: string; description?: string };
const question = (qs: { q: string; header?: string; opts: (string | Opt)[]; multi?: boolean }[]) => ({
  type: 'question', tool: 'AskUserQuestion', title: qs[0]!.q, detail: qs[0]!.q, input: {},
  questions: qs.map(x => ({ question: x.q, header: x.header ?? 'Domanda', multiSelect: !!x.multi, options: x.opts.map(o => (typeof o === 'string' ? { label: o } : o)) })),
});

const COMMENT = [
  'Ho verificato il test case 7 su master e sul ramo della PR: il rimborso ignora lo sconto applicato in origine.',
  '',
  'Ecco il commento per Sara sul bug, da approvare:',
  '',
  '```md',
  'Hi Sara,',
  '',
  'Test case 7 fails on **master** too, so it is not caused by the PR.',
  '',
  '- Refund total: `120,00 €` (expected `108,00 €`)',
  '- The discount of the original order is ignored',
  '- Steps and screenshots: [report TC7](https://dev.azure.com/o/Shop/_workitems/edit/4720)',
  '',
  'Can you confirm the expected value? Thanks!',
  '```',
  '',
  'Report completo: [report TC7](file:///C:/demo/report/tc7.md). La PR è https://git.example.com/shop/pull/815.',
].join('\n');

async function clear(app: ElectronApplication, page: Page) {
  for (const id of ['orchestrator', 'qa', 'feedback', 'fix', 'sms', 'mappa']) await demo(app, (d, c) => d.stop(c), id);
  // a turn that ends with shell blocks leaves them as commands to run: "Non serve" takes them away
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(300);
    const dismiss = page.getByTestId('qwin-card-dismiss');
    if (!(await dismiss.count())) break;
    await dismiss.click();
  }
  await expect(page.getByTestId('qwin')).toHaveCount(0);
}

async function snap(page: Page, name: string) {
  await expect(page.getByTestId('qwin')).toBeVisible();
  await page.mouse.move(2, 2);
  await page.waitForTimeout(150);
  await shot(page, name);
}

for (const [scheme, width, height] of [['dark', 1366, 768], ['light', 1920, 1080], ['light', 1366, 768], ['dark', 1920, 1080]] as const) {
  test(`questions window gallery · ${scheme} ${width}`, async () => {
    test.setTimeout(120_000);
    const { app, page } = await launchDemo({ scheme, width, height, config: { questionsModal: true, theme: scheme } });
    const tag = `${scheme}-${width}`;
    await clear(app, page);

    // 1. a question with context, links and a comment to approve
    await demo(app, (d, id, t) => d.say(id, t), 'qa', COMMENT);
    await demo(app, (d, id, q) => d.ask(id, q), 'qa', question([{ q: 'Pubblico il commento sul bug del test case 7?', header: 'QA', opts: [
      { label: 'Pubblica (consigliato)', description: 'lo pubblico così com\'è e taggo Sara' },
      { label: 'Cambia il testo', description: 'mi dici cosa cambiare e te lo rimando' },
      { label: 'Non pubblicare', description: 'resta nel report, nessun commento' },
    ] }]));
    await snap(page, `qgal-context-${tag}`);
    await clear(app, page);

    // 2. a question whose turn left commands to run
    await demo(app, (d, id, t) => d.say(id, t), 'fix', "Prima di decidere lancia i test del modulo:\n```powershell\ndotnet test Shop.Tests --filter Orders\n```\nE se vuoi vedere il diff:\n```powershell\ngit -C C:\\progetti\\shop diff --stat main\n```");
    await demo(app, (d, id, q) => d.ask(id, q), 'fix', question([{ q: 'Faccio il commit del fix sul ramo della PR?', header: 'Fix', opts: ['Sì, committa (consigliato)', 'Aspetta i test', 'No'] }]));
    await snap(page, `qgal-commands-${tag}`);
    await clear(app, page);

    // 3. several questions in one request, long texts
    await demo(app, (d, id, t) => d.say(id, t), 'orchestrator', 'La mappa 3D è pronta in due varianti. La prima tiene i nodi fermi e muove solo la camera; la seconda ricalcola il layout a ogni nota nuova, più viva ma più pesante sulla GPU integrata.');
    await demo(app, (d, id, q) => d.ask(id, q), 'orchestrator', question([
      { q: 'Quale variante della mappa 3D porto in main, considerando che il portatile ha solo la GPU integrata e che la mappa resta aperta tutto il giorno accanto alle chat?', header: 'Mappa', opts: [
        { label: 'Nodi fermi, camera mobile (consigliato)', description: 'leggera: 60 fps anche con 2000 note, il layout cambia solo quando apri la mappa; le note nuove compaiono in un angolo finché non la riapri' },
        { label: 'Layout vivo', description: 'ogni nota nuova sposta i vicini con un\'animazione; più bella, ma 25-30 fps con 2000 note sulla GPU integrata' },
        { label: 'Tutte e due, scelta nelle impostazioni', description: 'più codice da mantenere e da testare' },
      ] },
      { q: 'Tengo le etichette sempre visibili?', header: 'Etichette', opts: ['Sì', 'Solo al passaggio del mouse'] },
      { q: 'Quali viste aggiungo?', header: 'Viste', multi: true, opts: ['Per cartella', 'Per data', 'Per tag'] },
    ]));
    await snap(page, `qgal-long-${tag}`);
    await clear(app, page);

    // 4. a permission with a long command
    await demo(app, (d, id, q) => d.ask(id, q), 'feedback', {
      type: 'permission', tool: 'Bash', title: 'Bash', detail: '',
      input: { command: 'npx playwright test test/e2e/questions.spec.ts test/e2e/answer-later.spec.ts test/e2e/one-popup.spec.ts --workers=1 --reporter=list && node scripts/report.mjs --out test-results/report.html', description: 'Lancia gli e2e delle domande e scrive il report' },
    });
    await snap(page, `qgal-permission-${tag}`);
    await clear(app, page);

    // 5. a command to run
    await demo(app, (d, id, t) => d.turn(id, t), 'sms', "Fatto: il fix è in main. Ora lancia il controllo:\n\n```powershell\nnpm run doctor -- --dev\n```");
    await snap(page, `qgal-command-${tag}`);
    await clear(app, page);

    // 6. ten requests waiting
    const chats = ['orchestrator', 'qa', 'feedback', 'fix', 'sms'];
    for (let i = 0; i < 10; i++) {
      await demo(app, (d, id, q) => d.ask(id, q), chats[i % chats.length]!, question([{ q: `Domanda ${i + 1}: procedo con il passo ${i + 1}?`, header: 'Passo', opts: ['Sì', 'No'] }]));
    }
    await snap(page, `qgal-ten-${tag}`);
    await app.close();
  });
}
