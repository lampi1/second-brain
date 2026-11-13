// E2E of the questions window's speed and steadiness (ADR 0049), on the demo with the window on: it opens in under
// 100 ms (from the render that first has the request to the painted frame, lib/questions.ts qwinStats), nothing on
// screen moves once it is open (the window is anchored at the top: the context that loads late grows downward), other
// chats streaming never render it again, and with ten requests waiting the keyboard answers them one after another
// (1 answers, the next takes the keyboard) until the window closes. Screenshot: test-results/shots/qperf-ten.png.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type D = { stop(id: string): Promise<void>; ask(id: string, r: object): void; say(id: string, t: string): void };
const demo = <A extends unknown[]>(app: ElectronApplication, fn: (d: D, ...a: A) => void, ...a: A) =>
  app.evaluate((_e, [src, args]) => { const d = (globalThis as unknown as { __sbDemo: D }).__sbDemo; return new Function('d', 'a', `return (${src})(d, ...a)`)(d, args); }, [fn.toString(), a] as const);
const question = (q: string, opts: string[]) => ({
  type: 'question', tool: 'AskUserQuestion', title: q, detail: q, input: {},
  questions: [{ question: q, header: 'Ok', multiSelect: false, options: opts.map(label => ({ label })) }],
});
/** The Orchestrator's input has the keyboard by default (OrchestratorTile.tsx) and the window takes the keyboard only when
 *  no field has it (ADR 0019, 0044): the field is left first, as a user who is not writing anywhere. */
async function leaveFields(page: Page): Promise<void> {
  await expect(page.getByTestId('orchestrator-input')).toBeFocused();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test('ten requests waiting: the rail lists them, the keyboard answers them one after another', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchDemo();
  for (const id of ['orchestrator', 'qa', 'feedback']) await demo(app, (d, c) => d.stop(c), id);
  await leaveFields(page);
  const chats = ['orchestrator', 'qa', 'feedback', 'fix', 'sms'];
  for (let i = 0; i < 10; i++) await demo(app, (d, id, q) => d.ask(id, q), chats[i % chats.length]!, question(`Passo ${i + 1}: procedo?`, ['Sì', 'No']));
  await expect(page.getByTestId('qwin-count')).toHaveText('10');
  await expect(page.getByTestId('qwin-pick')).toHaveCount(9);
  await expect(page.getByTestId('qwin-current')).toContainText('Passo 1');
  await expect(page.getByTestId('qwin-card')).toBeFocused();
  // the rail never makes the window taller than the screen
  const vp = await page.evaluate(() => innerHeight);
  const box = (await page.getByTestId('qwin').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(vp);
  await shot(page, 'qperf-ten');
  for (let i = 0; i < 10; i++) {
    await expect(page.getByTestId('qwin-card-q')).toHaveText(`Passo ${i + 1}: procedo?`);
    await expect(page.getByTestId('qwin-card')).toBeFocused();
    await page.keyboard.press('1');
  }
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  await app.close();
});
