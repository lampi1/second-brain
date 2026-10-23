// E2E: a yes/no question in the questions window (ADR 0135): Sì / No (two big tiles), «Altro…»
// and «Ci penso dopo»; a question set aside comes back when the Orchestrator's recap opens everything waiting
// (ui:command unblock, what app_unblock sends). Demo app, hidden window. Screenshots: qyesno-<step>.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type D = { stop(id: string): Promise<void>; ask(id: string, r: object): void; say(id: string, t: string): void };
const demo = <A extends unknown[]>(app: ElectronApplication, fn: (d: D, ...a: A) => void, ...a: A) =>
  app.evaluate((_e, [src, args]) => { const d = (globalThis as unknown as { __sbDemo: D }).__sbDemo; return new Function('d', 'a', `return (${src})(d, ...a)`)(d, args); }, [fn.toString(), a] as const);
const Q = 'Ho corretto il totale del rimborso e i test del modulo Ordini passano (42/42, screenshot del carrello prima e dopo nel report). Faccio il commit sul ramo della PR?';

test('a yes/no question: Sì / No / Altro / Ci penso dopo, back on the recap', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo({ width: 1366, height: 768 });
  for (const id of ['orchestrator', 'qa', 'feedback', 'fix', 'sms', 'mappa']) await demo(app, (d, c) => d.stop(c), id);
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(300);
    const dismiss = page.getByTestId('qwin-card-dismiss');
    if (!(await dismiss.count())) break;
    await dismiss.click();
  }
  await expect(page.getByTestId('qwin')).toHaveCount(0);

  await demo(app, (d, id, t) => d.say(id, t), 'fix', 'Il rimborso ignorava lo sconto dell’ordine: ora lo sottrae. `dotnet test Shop.Tests --filter Orders` → 42 passati.');
  await demo(app, (d, id, q) => d.ask(id, q), 'fix', { type: 'question', tool: 'AskUserQuestion', title: Q, detail: Q, input: {},
    questions: [{ question: Q, header: 'Fix', multiSelect: false, options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] }] });
  await expect(page.getByTestId('qwin')).toBeVisible();
  await expect(page.getByTestId('qwin-card-opt-1')).toContainText('Sì');
  await expect(page.locator('.gu-yn.no')).toContainText('No');
  await expect(page.locator('.gu-yn.yes.rec')).toContainText('Sì');
  await expect(page.getByTestId('qwin-card-other')).toBeVisible();
  await expect(page.getByTestId('qwin-later')).toContainText('Ci penso dopo');
  await page.mouse.move(2, 2);
  await shot(page, 'qyesno-window');
  // the two tiles in view, the pointer on «No» (it lifts)
  await page.getByTestId('qwin-card-opt-2').scrollIntoViewIfNeeded();
  await page.getByTestId('qwin-card-opt-2').hover();
  await page.waitForTimeout(250);
  await shot(page, 'qyesno-tiles');
  await page.mouse.move(2, 2);

  // «Ci penso dopo»: the window goes, the question still waits; the recap brings it back
  await page.getByTestId('qwin-later').click();
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().startsWith('file:')) w.webContents.send('ui:command', { action: 'unblock' }); });
  await expect(page.getByTestId('qwin')).toBeVisible();
  await expect(page.getByTestId('qwin-card-opt-1')).toContainText('Sì');
  await shot(page, 'qyesno-recap');
  await app.close();
});
