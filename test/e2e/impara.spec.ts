// E2E of Impara (ADR 0185, 0188) on the frozen demo, whose lessons are written by hand about the real PR #251
// (main/learn/demo.ts) and whose voice is the fake one: the page lists the saved lessons, a GitHub PR link starts a
// lesson (the research and its check on the Preparing screen, then the first pieces while the rest is written), the
// lesson fills the window, the animated board plays each piece's beats (camera, the light along an arrow, «Qui»), the
// code of the piece shows, a check marks the answer and says why, «Spiegamelo meglio» adds a piece after the current
// one, the end grades «Spiegalo tu», and the lesson reopens where it was. A topic asks its question first and shows
// the verified sources of a piece. The review (ADR 0189): subjects on the start page, today's cards one at a time
// (recall, choice, a part of the diagram to click), a subject's quiz where a forgotten card comes back, a lesson moved
// to another subject. Screenshots dark.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

const PR = 'https://github.com/lampi1/second-brain/pull/251';

test('learn a PR on the blackboard: pieces, check, better explanation, explain it yourself, saved', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo();
  try {
    await goPage(page, 'impara');
    await expect(page.getByTestId('impara-start')).toBeVisible();
    await expect(page.getByTestId('impara-lessons').locator('.ip-card')).toHaveCount(3);
    // each card shows its diagram (drawn once mermaid has loaded)
    await expect(page.locator('.ip-thumb img')).toHaveCount(3, { timeout: 15_000 });
    await shot(page, 'impara-start-dark');

    // a GitHub PR by its link: preparing, then the first piece
    await page.getByTestId('impara-kind-pr').click();
    await page.getByTestId('impara-pr-url').fill(PR);
    await page.getByTestId('impara-start-btn').click();
    await expect(page.getByTestId('impara-preparing')).toBeVisible();
    // the research as it goes: no web for a PR (said why), its files read and checked
    const steps = page.getByTestId('impara-prep-steps');
    await expect(steps.locator('li[data-state="skip"]')).toContainText('una PR si spiega dai suoi file');
    await expect(steps).toContainText('5 fatti', { timeout: 10_000 });
    await shot(page, 'impara-prep-dark');
    const player = page.getByTestId('impara-player');
    await expect(page.getByTestId('impara-say')).toContainText('a blocchi', { timeout: 15_000 });
    await expect(page.getByTestId('impara-title')).toHaveText('Risposte parola per parola (PR #251)');
    // full screen by default; the board drawn by the app, its beats played with the voice: the last one sends the light
    await expect(player).toHaveAttribute('data-full', 'true');
    const board = page.getByTestId('impara-diagram');
    await expect(board).toHaveAttribute('data-nodes', '5');
    await expect(board.locator('.st-svg')).toBeVisible();
    await expect(board).toHaveAttribute('data-flow', 'engine>manager', { timeout: 10_000 });
    await expect(board.locator('.st-packet')).toHaveCount(1);
    await expect(page.getByTestId('impara-piece-label')).toHaveText('Pezzo 1 di 5');
    await expect(page.getByTestId('impara-verified')).toContainText('5 fatti verificati');

    // piece 2: its nodes, its real code, its new words
    await page.getByTestId('impara-next').click();
    await expect(board).toHaveAttribute('data-focus', 'manager', { timeout: 10_000 });
    await expect(page.getByTestId('impara-code-panel')).toContainText('ITEM_FRAME_MS');
    await expect(page.getByTestId('impara-note')).toContainText('100 ms → 16 ms');
    await page.waitForTimeout(700);
    await shot(page, 'impara-player-dark');

    // the check after piece 2: a wrong answer is marked, the right one shown, and why
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('impara-check')).toBeVisible();
    await page.getByTestId('impara-opt-1').click();
    await expect(page.getByTestId('impara-opt-0')).toHaveClass(/good/);
    await expect(page.getByTestId('impara-opt-1')).toHaveClass(/bad/);
    await expect(page.getByTestId('impara-check-why')).toContainText('due attese in fila');
    await page.getByTestId('impara-conf-2').click();
    await expect(page.getByTestId('impara-conf-2')).toHaveAttribute('aria-checked', 'true');
    await shot(page, 'impara-check-dark');

    // the rest arrived meanwhile: piece 3, then «Spiegamelo meglio» adds a piece after it and lands on it
    await page.getByTestId('impara-check-next').click();
    await expect(page.getByTestId('impara-piece-label')).toHaveText('Pezzo 3 di 5', { timeout: 15_000 });
    await page.getByTestId('impara-better').click();
    await expect(page.getByTestId('impara-busy')).toBeVisible();
    await expect(page.getByTestId('impara-say')).toContainText('due semafori', { timeout: 10_000 });
    await expect(page.getByTestId('impara-piece-label')).toHaveText('Spiegato meglio');
    await expect(page.getByTestId('impara-rail').locator('.ip-st-x')).toHaveCount(1);

    // the end: «Spiegalo tu», graded
    await page.getByTestId('impara-rail-end').click();
    await expect(page.getByTestId('impara-end')).toBeVisible();
    await page.getByTestId('impara-explain-input').fill('Prima il testo si fermava due volte per 100 ms, nel main e nello store; ora aspetta un fotogramma di 16 ms.');
    await page.getByTestId('impara-explain-send').click();
    await expect(page.getByTestId('impara-grade')).toContainText('finestra nascosta', { timeout: 10_000 });
    await expect(page.getByTestId('impara-score')).toContainText('0/1');
    // its review cards: the 4 checks (one came with «Spiegamelo meglio») and the 4 cards written from the verified
    // facts, in the lesson's subject
    await expect(page.getByTestId('impara-end-cards')).toContainText('8 carte di ripasso in «Second brain»', { timeout: 10_000 });
    await shot(page, 'impara-end-dark');

    // saved: the list has it, and it reopens at the end
    await page.getByTestId('impara-back').click();
    const cards = page.getByTestId('impara-lessons').locator('.ip-card');
    await expect(cards).toHaveCount(4);
    await cards.first().locator('.ip-card-open').click();
    await expect(player).toHaveAttribute('data-at', 'end');
    await expect(page.getByTestId('impara-explain-answer')).toContainText('fotogramma');
  } finally {
    await app.close();
  }
});

test('a saved lesson reopens where it was, light theme, rail with numbers beside the Orchestrator', async () => {
  test.setTimeout(60_000);
  const { app, page } = await launchDemo({ scheme: 'light' });
  try {
    await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await page.emulateMedia({ colorScheme: 'light' });
    await goPage(page, 'impara');
    const card = page.getByTestId('impara-lessons').locator('.ip-card', { hasText: 'PR #249' });
    await card.locator('.ip-card-open').click();
    await expect(page.getByTestId('impara-piece-label')).toHaveText('Pezzo 2 di 3');
    await expect(page.getByTestId('impara-diagram')).toHaveAttribute('data-focus', 'agents,cpu');
    await expect(page.getByTestId('impara-rail-1')).toHaveAttribute('data-tip', 'Il sintomo');
    await page.waitForTimeout(1100);
    await shot(page, 'impara-player-light');
    // voice off: the written text in place of the spoken one
    await page.getByTestId('impara-voice').click();
    await expect(page.getByTestId('impara-text')).toContainText('cpuMs');
    // Esc leaves the full screen (remembered), the button brings it back
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('impara-player')).toHaveAttribute('data-full', 'false');
    await expect(page.getByTestId('impara-page')).toBeVisible();
    await page.getByTestId('impara-fullscreen').click();
    await expect(page.getByTestId('impara-player')).toHaveAttribute('data-full', 'true');
    // a tall diagram about the app itself: drawn whole on the board, its group too, its facts on the rail
    await page.getByTestId('impara-back').click();
    await page.getByTestId('impara-lessons').locator('.ip-card', { hasText: 'Come nasce una lezione' }).locator('.ip-card-open').click();
    const board = page.getByTestId('impara-diagram');
    await expect(board).toHaveAttribute('data-nodes', '9');
    await expect(board.locator('.st-cluster')).toHaveCount(1);
    await expect(board).toHaveAttribute('data-flow', 'ask>files', { timeout: 15_000 });
    await expect(page.getByTestId('impara-verified')).toContainText('2 fatti verificati');
    await page.waitForTimeout(1100);
    await shot(page, 'impara-tall-light');
  } finally {
    await app.close();
  }
});

test('a topic: «Chi spiega», the web and the files researched, a question first, then the sources of a piece', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchDemo();
  try {
    await goPage(page, 'impara');
    await page.getByTestId('impara-kind-topic').click();
    // who explains: the app's choice, or an engine, its model and effort (remembered)
    await expect(page.getByTestId('impara-teacher')).toContainText('Claude · Opus · alto');
    await page.getByTestId('impara-teacher').click();
    await page.getByTestId('impara-teacher-effort-xhigh').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('impara-teacher')).toContainText('molto alto');
    await page.getByTestId('impara-ask-what').fill('Come arrivano le parole sullo schermo');
    await page.getByTestId('impara-start-btn').click();
    const steps = page.getByTestId('impara-prep-steps');
    await expect(steps.locator('li').nth(1)).toContainText('vede solo la tua domanda');
    // the question arrives while the facts are checked; the plan waits for it
    await expect(page.getByTestId('impara-clarify')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('impara-clarify')).toContainText('Ti interessa lo streaming dentro l’app');
    await expect(steps).toContainText('corretti', { timeout: 10_000 });
    // the sources found, once checked, already on the Preparing screen
    await expect(page.getByTestId('impara-prep-sources')).toContainText('developer.mozilla.org');
    await expect(page.getByTestId('impara-prep-sources')).toContainText('store.ts');
    await shot(page, 'impara-clarify-dark');
    await page.getByTestId('impara-clarify-0-0').click();
    await page.getByTestId('impara-clarify-send').click();
    await expect(page.getByTestId('impara-say')).toContainText('a blocchi', { timeout: 15_000 });
    // the piece's sources: the fact the check corrected says so
    await page.getByTestId('impara-cites-toggle').click();
    await expect(page.getByTestId('impara-facts')).toContainText('corretto dalla verifica');
    await expect(page.getByTestId('impara-facts')).toContainText('da 100 a 16 ms');
    await page.waitForTimeout(900);
    await shot(page, 'impara-stage-dark');
    // every source of the lesson in one drawer: the web pages, the files of this PC (opened in the viewer, above the
    // full-screen lesson), the model's knowledge; Esc closes the viewer, then the drawer, the lesson stays full screen
    await page.getByTestId('impara-cites-all').click();
    const drawer = page.getByTestId('impara-sources');
    await expect(drawer).toContainText('2 pagine web · 3 file · 6 fatti');
    await expect(drawer.getByTestId('impara-src-web')).toHaveCount(2);
    await expect(drawer.getByTestId('impara-src-web').first().locator('a')).toHaveAttribute('href', /developer\.mozilla\.org/);
    await expect(drawer.getByTestId('impara-src-file')).toHaveCount(3);
    // with the web on, a files fact without a file never reaches the lesson (nor the web check)
    await expect(drawer).not.toContainText('Dalla conoscenza del modello');
    await shot(page, 'impara-sources-dark');
    await drawer.getByTestId('impara-src-file').filter({ hasText: 'store.ts' }).getByTestId('impara-src-file-open').click();
    const viewer = page.getByTestId('viewer-overlay');
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText('STREAM_MS');
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page.getByTestId('impara-player')).toHaveAttribute('data-full', 'true');
  } finally {
    await app.close();
  }
});

test('the review: subjects, today’s cards (recall, choice, click on the diagram), a subject’s quiz, moving a lesson', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchDemo();
  try {
    await goPage(page, 'impara');
    const home = page.getByTestId('impara-review-home');
    await expect(home).toBeVisible();
    await expect(page.getByTestId('impara-review-due')).toHaveText('2 carte da ripassare oggi');
    await expect(home).toContainText('1 nuova');
    await expect(page.getByTestId('impara-subject')).toHaveCount(2);
    const sec = page.locator('[data-testid="impara-subject"][data-subject="Sicurezza web"]');
    await expect(sec.getByTestId('impara-subject-recall')).toContainText('memoria stimata oggi:');
    await shot(page, 'impara-review-home-dark');

    // today's review: the two due cards and the new one, each answered its own way
    await page.getByTestId('impara-review-start').click();
    const review = page.getByTestId('impara-review');
    await expect(review).toHaveAttribute('data-full', 'true');
    await expect(page.getByTestId('impara-review-count')).toHaveText('1 di 3');
    const seen = new Set<string>();
    for (let n = 0; n < 3; n++) {
      const cardEl = page.getByTestId('impara-review-card');
      await expect(cardEl).toBeVisible();
      const kind = (await cardEl.getAttribute('data-kind'))!;
      seen.add(kind);
      if (kind === 'recall') await page.getByTestId('impara-review-show').click();
      else if (kind === 'choice') await page.getByTestId('impara-review-opt-0').click();
      else {
        await expect(cardEl.locator('[data-node="vfiles"]')).toBeVisible({ timeout: 15_000 });
        await cardEl.locator('[data-node="vfiles"]').click();
        await expect(cardEl.locator('.st-node.right')).toHaveCount(1);
        await expect(page.getByTestId('impara-review-facts')).toBeVisible();
        await page.waitForTimeout(500);
        await shot(page, 'impara-review-node-dark');
      }
      await expect(page.getByTestId('impara-review-answer')).toBeVisible();
      if (kind === 'recall') await shot(page, 'impara-review-recall-dark');
      await page.getByTestId('impara-review-grade-3').click();
    }
    expect([...seen].sort()).toEqual(['choice', 'node', 'recall']);
    await expect(page.getByTestId('impara-review-score')).toHaveText('3 su 3 al primo colpo');
    await page.getByTestId('impara-review-done').click();
    await expect(page.getByTestId('impara-review-due')).toHaveText('Niente in scadenza oggi');

    // a subject's quiz: a wrong answer comes back at the end of the session
    await sec.getByTestId('impara-subject-quiz').click();
    await expect(page.getByTestId('impara-review-title')).toHaveText('Quiz: Sicurezza web');
    await page.getByTestId('impara-review-opt-1').click();
    await expect(page.getByTestId('impara-review-opt-1')).toHaveClass(/bad/);
    await page.getByTestId('impara-review-next').click();
    await expect(page.getByTestId('impara-review-count')).toHaveText('2 di 2');
    await page.getByTestId('impara-review-opt-0').click();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('impara-review-score')).toHaveText('0 su 1 al primo colpo');
    await page.getByTestId('impara-review-done').click();

    // a lesson moved to another subject takes its cards along
    const csp = page.getByTestId('impara-lessons').locator('.ip-card', { hasText: 'Content Security Policy' });
    await csp.getByTestId('impara-subject-chip').click();
    await page.getByTestId('impara-subject-input').fill('Sicurezza');
    await page.getByTestId('impara-subject-save').click();
    await expect(csp.getByTestId('impara-subject-chip')).toHaveText('Sicurezza');
    await expect(page.locator('[data-testid="impara-subject"][data-subject="Sicurezza"]')).toContainText('1 lezione · 1 carta');
    await expect(page.locator('[data-testid="impara-subject"][data-subject="Sicurezza web"]')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
