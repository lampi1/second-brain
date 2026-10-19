// AI-driven usability test (docs/ux-principles.md "Validation"): the user's real scenarios on the frozen demo, each run
// as a user would (keys, typing, clicks), with every step recorded with its elapsed time, a screenshot at the end, and
// a budget of actions it must not exceed ("few keystrokes"). The report is written to
// test-results/usability/report.json (scenario, steps, actions, ms, screenshot) for agents and reviewers to read.
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { demoLayout, expandChats, launchDemo, showBrowsers } from './helpers';

const OUT = path.resolve(import.meta.dirname, '..', '..', 'test-results', 'usability');
interface Step { what: string; kind: 'key' | 'type' | 'click' | 'check'; atMs: number }
interface Result { scenario: string; actions: number; budget: number; ms: number; steps: Step[]; screenshot: string }
const results: Result[] = [];

class Scenario {
  steps: Step[] = [];
  actions = 0;
  private t0 = performance.now();
  constructor(readonly name: string, readonly page: Page) {}
  private log(what: string, kind: Step['kind']) { this.steps.push({ what, kind, atMs: Math.round(performance.now() - this.t0) }); }
  async press(combo: string, what = combo) { await this.page.keyboard.press(combo); this.actions++; this.log(what, 'key'); }
  async type(text: string, what = `scrive «${text}»`) { await this.page.keyboard.type(text); this.actions++; this.log(what, 'type'); }
  async click(testid: string, what: string) { await this.page.getByTestId(testid).click(); this.actions++; this.log(what, 'click'); }
  async check(what: string, fn: () => Promise<unknown>) { await fn(); this.log(what, 'check'); }
  async done(budget: number) {
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`);
    await this.page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
    const r: Result = { scenario: this.name, actions: this.actions, budget, ms: Math.round(performance.now() - this.t0), steps: this.steps, screenshot: path.relative(path.resolve(OUT, '..', '..'), file) };
    results.push(r);
    console.log(`[usability] ${r.scenario}: ${r.actions}/${budget} azioni, ${r.ms} ms`);
    expect(this.actions, `${this.name}: troppe azioni`).toBeLessThanOrEqual(budget);
  }
}

test.afterAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
});

test('Rispondo a una domanda dalla sua tessera senza aprire la chat', async () => {
  const { app, page } = await launchDemo();
  await expandChats(page, 'qa', 'feedback'); // their questions sit on the open strips
  const s = new Scenario('Rispondo a una domanda dalla sua tessera', page);
  await s.press('Control+J', 'Ctrl+J: la cosa più vecchia che mi aspetta');
  await s.press('1', '1: scelgo la prima opzione');
  await s.check('restano 2 domande, nessuna chat aperta', async () => {
    await expect(page.locator('[data-request-key]')).toHaveCount(2);
    await expect(page.getByTestId('maximized')).toHaveCount(0);
  });
  await s.done(2);
  await app.close();
});

test('Avvio una chat', async () => {
  const { app, page } = await launchDemo();
  const s = new Scenario('Avvio una chat', page);
  await s.press('Control+N', 'Ctrl+N: nuova richiesta all\'Orchestrator');
  await s.type('Controlla i log di oggi');
  await s.press('Enter', 'Invio: la manda');
  await s.check('la richiesta è nella colonna dell\'Orchestrator, che la smista', async () => {
    await expect(page.getByTestId('tile-orchestrator')).toContainText('Controlla i log di oggi');
  });
  await s.done(3);
  await app.close();
});

test('Fermo tutto', async () => {
  const { app, page } = await launchDemo();
  const s = new Scenario('Fermo tutto', page);
  await s.press('Control+Shift+Period', 'Ctrl+Shift+.: ferma tutto');
  await s.press('Enter', 'Invio: confermo (2 chat al lavoro)');
  await s.check('nessuna chat al lavoro', async () => {
    await expect(page.getByTestId('topbar-stopall')).toBeDisabled();
    await expect(page.getByTestId('chat-state-fix')).toHaveAttribute('data-state', 'idle');
  });
  await s.done(2);
  await app.close();
});

test('Trovo una chat con la ricerca', async () => {
  const { app, page } = await launchDemo();
  const s = new Scenario('Trovo una chat con la ricerca', page);
  await s.press('Control+K', 'Ctrl+K: cerca');
  await s.type('mappa');
  await s.press('Enter', 'Invio: apro la chat');
  await s.check('la chat finita torna nella colonna degli agenti con il cursore nel suo campo', async () => {
    await expect(page.getByTestId('tile-chat-mappa')).toBeVisible();
    await expect(page.getByTestId('chat-input-mappa')).toBeFocused();
  });
  await s.done(3);
  await app.close();
});

test('Seguo un browser a schermo intero e torno', async () => {
  const { app, page } = await launchDemo();
  await showBrowsers(page, 'qa'); // its browser sits beside the open strip
  const s = new Scenario('Seguo un browser a schermo intero', page);
  await s.click('browser-max-tab-qa', '⤢ sul browser della QA');
  await s.check('il browser riempie lo spazio di lavoro', async () => {
    // The persistent Orchestrator column keeps its space beside the maximized browser.
    const col = await page.getByTestId('maximized').evaluate(e => e.getBoundingClientRect().width);
    await expect.poll(async () => (await demoLayout(app)).find(l => l.tabId === 'tab-qa')?.rect?.width ?? 0).toBeGreaterThan(col * 0.9);
  });
  await s.press('Escape', 'Esc: torno alla colonna degli agenti');
  await s.check('di nuovo la colonna degli agenti', async () => { await expect(page.getByTestId('tile-chat-qa')).toBeVisible(); });
  await s.done(2);
  await app.close();
});

test('Torno all’Orchestrator da qualsiasi punto', async () => {
  const { app, page } = await launchDemo();
  await expandChats(page, 'fix'); // the input is on the open strip
  await page.getByTestId('chat-input-fix').click();
  const s = new Scenario('Torno all’Orchestrator', page);
  await s.press('Control+0', 'Ctrl+0: Orchestrator');
  await s.check('il cursore è nell’Orchestrator', async () => { await expect(page.getByTestId('orchestrator-input')).toBeFocused(); });
  await s.done(1);
  await app.close();
});
