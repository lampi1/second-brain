// E2E: a decision card answered by voice (ADR 0150 + 0152, wired by ADR 0154): with the voice conversation on (Settings → Voce), the question card
// in the questions window is read aloud and the fake engine's «sì» is the click on Sì: the card closes and the chat
// gets the answer. Demo app, fake voice engine (SB_VOICE_FAKE_TEXT).
import { expect, test, type ElectronApplication } from '@playwright/test';
import { goPage, launchDemo } from './helpers';

type D = { stop(id: string): Promise<void>; ask(id: string, r: object): void };
const demo = <A extends unknown[]>(app: ElectronApplication, fn: (d: D, ...a: A) => unknown, ...a: A) =>
  app.evaluate((_e, [src, args]) => { const d = (globalThis as unknown as { __sbDemo: D }).__sbDemo; return new Function('d', 'a', `return (${src})(d, ...a)`)(d, args); }, [fn.toString(), a] as const);
const Q = 'Faccio il merge della PR?';

test('voice conversation: «sì» answers the open decision card', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchDemo({ env: { SB_VOICE_FAKE_TEXT: 'Sì.', SB_VOICE_FAKE_DELAY_MS: '4000' } });
  try {
    for (const id of ['orchestrator', 'qa', 'feedback', 'fix', 'sms', 'mappa']) await demo(app, (d, c) => d.stop(c), id);
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(300);
      const dismiss = page.getByTestId('qwin-card-dismiss');
      if (!(await dismiss.count())) break;
      await dismiss.click();
    }
    await demo(app, (d, id, q) => d.ask(id, q), 'fix', { type: 'question', tool: 'AskUserQuestion', title: Q, detail: Q, input: {},
      questions: [{ question: Q, header: 'Fix', multiSelect: false, options: [{ label: 'Sì' }, { label: 'No' }] }] });
    await expect(page.getByTestId('qwin-card-q')).toHaveText(Q);
    // the answer the card sends (chat:answer), seen in main on its way in
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as { __answers: unknown[] };
      g.__answers = [];
      const map = (ipcMain as unknown as { _invokeHandlers: Map<string, (e: unknown, a: unknown) => unknown> })._invokeHandlers;
      const inner = map.get('chat:answer')!;
      map.set('chat:answer', (e, a) => { g.__answers.push(a); return inner(e, a); });
    });
    // nothing answers it by itself
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('qwin-card')).toHaveCount(1);
    // dictation never answers a card: only the conversation does
    await goPage(page, 'impostazioni');
    // (the questions window covers the page: the switch is clicked through it, as if the window were moved aside)
    await page.getByTestId('st-voice-talk-on').evaluate(el => (el as HTMLElement).click());
    // The utterance starts after the prompt finishes; early binary answers are preserved and replay the question.
    await expect(page.getByTestId('qwin-card')).toHaveCount(0, { timeout: 15_000 });
    const answers = await app.evaluate(() => (globalThis as unknown as { __answers: unknown[] }).__answers);
    expect(answers).toEqual([expect.objectContaining({ chatId: 'fix', answer: { kind: 'question', answers: { [Q]: 'Sì' } } })]);
  } finally {
    await app.close();
  }
});
