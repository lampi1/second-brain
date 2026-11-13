// E2E: Esegui as a «Bivio» question (ADR 0259): a command left by a chat is «Eseguo questo comando sul tuo PC?», the
// chat's reason under it, the command whole with its folder and Copia, the roads (Sì runs it here and the result goes to
// the chat; «Non serve» lets it go on); after Sì the run shows in the strip at the bottom. A block followed by a
// question in the same turn: the command card comes first, its run answers that question by itself. Demo app.
// Screenshots: command-bivio.png, command-bivio-strip.png, command-bivio-then-question.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type D = { stop(id: string): Promise<void>; working(id: string): void; ask(id: string, r: object): void; say(id: string, t: string): void; turn(id: string, t: string): void };
const demo = <A extends unknown[]>(app: ElectronApplication, fn: (d: D, ...a: A) => unknown, ...a: A) =>
  app.evaluate((_e, [src, args]) => { const d = (globalThis as unknown as { __sbDemo: D }).__sbDemo; return new Function('d', 'a', `return (${src})(d, ...a)`)(d, args); }, [fn.toString(), a] as const);
const CMD = process.platform === 'win32' ? "Write-Output 'test verdi'" : "echo 'test verdi'";
// another command for the last step: the same one ran with success a moment ago, and is not asked again (by design)
const CMD2 = process.platform === 'win32' ? "Write-Output 'fix verificato'" : "echo 'fix verificato'";

test('a command to run is a «Bivio» question; after Sì its run shows in the strip', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo({ scheme: 'dark', width: 1366, height: 900, config: { theme: 'dark', runResults: true }, env: { SB_RUN_RESULTS: '1' } });
  for (const id of ['orchestrator', 'qa', 'feedback', 'fix', 'sms', 'mappa']) await demo(app, (d, c) => d.stop(c), id);
  for (let i = 0; i < 5; i++) { await page.waitForTimeout(300); const x = page.getByTestId('qwin-card-dismiss'); if (!(await x.count())) break; await x.click(); }
  await expect(page.getByTestId('qwin')).toHaveCount(0);

  await demo(app, (d, id, t) => d.turn(id, t), 'sms', `Servono i test del modulo Ordini per capire se il bug c'è anche su master. Lancia questo:\n\n\`\`\`powershell\n${CMD}\n\`\`\``);
  const card = page.getByTestId('qwin-card');
  await expect(card).toHaveAttribute('data-kind', 'command');
  await expect(page.getByTestId('qwin-card-q')).toHaveText('Eseguo questo comando sul tuo PC?');
  await expect(page.getByTestId('qwin-card-ctx-lead')).toContainText('Servono i test del modulo Ordini');
  await expect(page.getByTestId('qwin-card-code')).toHaveText(CMD);
  await expect(page.getByTestId('qwin-card-road-yes')).toContainText('L’esito va a');
  await expect(page.getByTestId('qwin-card-run')).toContainText('Sì, eseguilo');
  await expect(page.getByTestId('qwin-card-dismiss')).toContainText('Non serve');
  await page.mouse.move(2, 2);
  await shot(page, 'command-bivio');

  await page.getByTestId('qwin-card-run').click();
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  const strip = page.getByTestId('run-watch-strip');
  await expect(strip).toBeVisible();
  await expect(strip).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
  await expect(strip).toContainText('Fatto');
  await shot(page, 'command-bivio-strip');
  await expect(strip).toHaveCount(0, { timeout: 10_000 }); // «Fatto» goes by itself

  // a block, then a question in the same turn: the command comes first
  await demo(app, (d, id) => d.working(id), 'fix');
  await demo(app, (d, id, t) => d.say(id, t), 'fix', `Ho preparato il fix. Lancia questo per verificare:\n\n\`\`\`powershell\n${CMD2}\n\`\`\``);
  await demo(app, (d, id, q) => d.ask(id, q), 'fix', { type: 'question', tool: 'AskUserQuestion', title: 'Hai lanciato i test del modulo Ordini?', detail: '', input: {},
    questions: [{ question: 'Hai lanciato i test del modulo Ordini?', header: 'Fix', multiSelect: false, options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] }] });
  await expect(page.getByTestId('qwin-card')).toHaveAttribute('data-kind', 'command', { timeout: 10_000 });
  await page.mouse.move(2, 2);
  await shot(page, 'command-bivio-then-question');
  await app.close();
});
