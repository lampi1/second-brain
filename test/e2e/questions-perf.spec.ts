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
type Stats = { renders: number; cardRenders: number; openMs: number };
const stats = (page: Page) => page.evaluate(() => ({ ...(globalThis as unknown as { __sbQwin: Stats }).__sbQwin }));
const resetOpen = (page: Page) => page.evaluate(() => { (globalThis as unknown as { __sbQwin: Stats }).__sbQwin.openMs = -1; });

test('the questions window opens fast, stays still, and other chats never render it', async () => {
  const { app, page } = await launchDemo({ config: { questionsModal: true } });
  for (const id of ['regia', 'qa', 'feedback']) await demo(app, (d, c) => d.stop(c), id);
  await expect(page.getByTestId('qwin')).toHaveCount(0);

  // opening: under 100 ms, the card takes the keyboard (nobody is typing)
  await resetOpen(page);
  await demo(app, (d, id, t) => d.say(id, t), 'qa', 'Il test case 7 fallisce anche su master: il rimborso ignora lo sconto. Report: [report TC7](https://dev.azure.com/o/Shop/_workitems/edit/4720).');
  await demo(app, (d, id, q) => d.ask(id, q), 'qa', question('Apro un bug per il test case 7?', ['Sì', 'No']));
  await expect(page.getByTestId('qwin-card')).toBeFocused();
  await expect.poll(async () => (await stats(page)).openMs).toBeGreaterThanOrEqual(0);
  const { openMs } = await stats(page);
  expect(openMs).toBeLessThan(100);

  // nothing moves once it is open: the window's top edge and the question stay where they first painted
  const top0 = (await page.getByTestId('qwin').boundingBox())!.y;
  const q0 = (await page.getByTestId('qwin-card-q').boundingBox())!.y;
  await page.waitForTimeout(600);
  expect((await page.getByTestId('qwin').boundingBox())!.y).toBe(top0);
  expect((await page.getByTestId('qwin-card-q').boundingBox())!.y).toBe(q0);

  // other chats' events (a streaming answer, a new message) never render the window or its card
  const before = await stats(page);
  for (let i = 0; i < 30; i++) await demo(app, (d, id, t) => d.say(id, t), i % 2 ? 'sms' : 'fix', `Passo ${i}: controllo i log.`);
  await expect(page.getByTestId('tile-chat-sms')).toContainText('Passo 29');
  const after = await stats(page);
  expect(after.renders - before.renders).toBe(0);
  expect(after.cardRenders - before.cardRenders).toBe(0);

  // a second request arrives: the rail grows the window to the left, the question being read stays where it was
  const at = (await page.getByTestId('qwin-card-q').boundingBox())!;
  await demo(app, (d, id, q) => d.ask(id, q), 'fix', question('Rilancio la pipeline?', ['Sì', 'No']));
  await expect(page.getByTestId('qwin-count')).toHaveText('2');
  const now = (await page.getByTestId('qwin-card-q').boundingBox())!;
  expect([now.x, now.y]).toEqual([at.x, at.y]);
  await app.close();
});

test('ten requests waiting: the rail lists them, the keyboard answers them one after another', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchDemo({ config: { questionsModal: true } });
  for (const id of ['regia', 'qa', 'feedback']) await demo(app, (d, c) => d.stop(c), id);
  const chats = ['regia', 'qa', 'feedback', 'fix', 'sms'];
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
