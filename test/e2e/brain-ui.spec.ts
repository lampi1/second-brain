// End-to-end: the brain area of the UI (src/renderer/brain) in the real app, pointed (SB_BRAIN) at a temporary
// synthetic brain whose data server is test/fixtures/brain-ui/brain-site.mjs (the real API shapes, fictional data).
// Every section is rendered through the test route (#brain-test/<page>), its key content asserted, and one screenshot
// saved per section in test-results/shots/brain-*.png (Qualità: its demo shot is in qualita.spec.ts); then the 3D map (WebGL), its 2D fallback and a flow, the
// error state, the virtualized table, the side peek with the keyboard, and the light theme.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { goPage, launch, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');

function fixtureBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-brain-ui-'));
  fs.mkdirSync(path.join(d, 'ops', 'tools'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'brain-site.mjs'), path.join(d, 'ops', 'tools', 'brain-site.mjs'));
  fs.copyFileSync(path.join(FIX, 'data.mjs'), path.join(d, 'ops', 'tools', 'brain-ui-data.mjs'));
  return d;
}

let app: ElectronApplication, page: Page, brain: string;

async function open(target: string, reload = false): Promise<void> {
  await page.evaluate(([t, r]) => { location.hash = `#brain-test/${t}`; if (r) location.reload(); }, [target, reload] as const);
  if (reload) await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('brain-test')).toBeVisible();
}
/** wait until no skeleton is left on the page (every read answered) */
async function settled(): Promise<void> {
  await expect(page.getByTestId('bx-loading')).toHaveCount(0, { timeout: 30000 });
  await page.waitForTimeout(250);
}


test.beforeAll(async () => {
  brain = fixtureBrain();
  ({ app, page } = await launch({ SB_BRAIN: brain }));
  await page.emulateMedia({ colorScheme: "dark" }); // the app default; one light shot at the end
  await expect(page.getByTestId('app')).toBeVisible();
  await open('fatto', true);
});
test.afterAll(async () => { await app?.close(); });

test('Oggi, Adesso and DevOps are gone: their old links open Task', async () => {
  await open('devops');
  await expect(page.getByTestId('brain-page-task')).toBeVisible();
  await open('oggi');
  await expect(page.getByTestId('brain-page-task')).toBeVisible();
  await open('adesso');
  await expect(page.getByTestId('brain-page-task')).toBeVisible();
  // "home" is no longer an alias of Oggi: since 73a4e37 it is the Home page itself (index.tsx BRAIN_PAGES)
  await open('home');
  await expect(page.getByTestId('brain-page-home')).toBeVisible();
});

test('Fatto: a log newest first, grouped by day, each entry with what, who, when and its link; more days on demand', async () => {
  await open('fatto');
  const p = page.getByTestId('brain-page-fatto');
  await settled();
  await expect(p.getByRole('heading', { level: 2, name: 'Fatto' })).toBeVisible();
  await expect(p.locator('.catalog-head')).toBeVisible(); // the head of Agenti and Guida (ADR 0079)
  await expect(p.getByTestId('bx-standup')).toContainText('Export fatture');
  const days = p.getByTestId('fatto-log').locator('section.wl-day');
  await expect(days).toHaveCount(3);
  const today = days.first();
  await expect(today.getByRole('heading', { level: 3 })).toHaveText('Oggi');
  await expect(today.getByTestId('fatto-day-count')).toHaveText('13 esiti');
  // newest first (the 3D map chat ended 15:20, the Procedure chat 14:10, its diary line 13:05), the untimed Cursor chat last
  const rows = today.getByTestId('fatto-entry');
  const times = await rows.locator('.wl-time').allInnerTexts();
  expect(times.slice(0, 3)).toEqual(['15:20', '14:10', '13:05']);
  expect(times.at(-1)).toBe('senza ora');
  const pr = rows.filter({ hasText: 'apply the discount once' });
  await expect(pr.getByRole('link')).toHaveAttribute('href', /pullrequest\/51001$/);
  await expect(pr).toContainText('PR unita');
  await expect(pr.locator('.wl-who')).toHaveText('Tu');
  await expect(rows.filter({ hasText: 'QA ordini' }).locator('.wl-who')).toHaveText('Claude');
  await expect(rows.filter({ hasText: 'Ricerca librerie grafici' }).locator('.wl-who')).toHaveText('Cursor');
  // the app's own work is listed like any other since "Migliora l'app" is gone (ADR 0079); lessons stay in the diary
  await expect(today).toContainText('Pagina Procedure');
  await expect(today).not.toContainText('La stima dei costi va sempre mostrata');
  await shot(page, 'brain-fatto');
  await today.locator('summary', { hasText: 'Dettaglio tecnico' }).click();
  await expect(today).toContainText('3 commit');
  await p.getByTestId('fatto-more').click();
  await expect(days).toHaveCount(6);
  await settled();
  await p.getByTestId('fatto-log').evaluate(el => el.scrollIntoView());
});

test('Idee: table with filters (state, area, who), side peek by keyboard, Esc closes it', async () => {
  await open('idee');
  const p = page.getByTestId('brain-page-idee');
  await settled();
  await expect(p.getByTestId('bx-table-idee')).toContainText('9 righe');
  await p.getByRole('button', { name: 'Filtra per Chi' }).click();
  await page.locator('.ui-select-list [data-value="IA"]').click();
  await expect(p.getByTestId('bx-table-idee')).toContainText('4 di 9 righe');
  await p.getByRole('button', { name: 'Filtra per Chi' }).click();
  await page.locator('.ui-select-list [data-value=""]').click();
  const grid = p.getByRole('grid', { name: 'Idee' });
  await grid.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(p.getByTestId('bx-peek')).toBeVisible();
  await page.waitForTimeout(300); // the peek slides in
  await shot(page, 'brain-idee');
  await page.keyboard.press('Escape');
  await expect(p.getByTestId('bx-peek')).toHaveCount(0);
});

test("Idee · Dall'IA: the AI's ideas with their reasoning in the peek, filter by audience, reflections below; old spunti links land here", async () => {
  await open('spunti/riflessioni');
  const p = page.getByTestId('brain-page-idee');
  await settled();
  await expect(p.getByTestId('bx-tab-ia')).toHaveAttribute('aria-selected', 'true');
  await expect(p.getByTestId('bx-table-idee')).toContainText('4 righe');
  await expect(p.getByLabel('Filtra per Per')).toBeVisible();
  await expect(p.getByTestId('bx-riflessione')).toHaveCount(2);
  await p.getByRole('row').filter({ hasText: 'Rileggere i propri errori' }).click();
  await expect(p.getByTestId('bx-peek').getByTestId('bx-reason')).toContainText('Ho notato');
  await page.waitForTimeout(300);
  await shot(page, 'brain-idee-ia');
  await page.keyboard.press('Escape');
  await p.getByTestId('bx-tab-mie').click();
  await expect(p.getByTestId('bx-tab-mie')).toHaveAttribute('aria-selected', 'true');
  await expect(p.getByTestId('bx-table-idee')).toContainText('5 righe');
  await expect(p.getByTestId('bx-riflessione')).toHaveCount(0);
  await p.getByTestId('bx-tab-tutte').click();
  await expect(p.getByTestId('bx-table-idee')).toContainText('9 righe');
});

test('Costi: KPIs, savings, charts by day / kind / model / area, chats table; period switch', async () => {
  await open('costi');
  const p = page.getByTestId('brain-page-costi');
  await settled();
  await expect(p.getByTestId('bx-lead')).toContainText('in 7 giorni');
  await expect(p.getByTestId('bx-advice')).toContainText('Chat lunghe');
  for (const c of ['spesa-giorni-7', 'spesa-tipo-7', 'spesa-modello-7', 'spesa-area-7']) await expect(p.getByTestId(`bx-chart-${c}`).locator('svg[role=img]')).toBeVisible();
  await expect(p.getByTestId('bx-cost-chats')).toContainText('Regia');
  await expect(p.getByTestId('bx-cost-live')).toContainText('Adesso'); // today's chats by cost, live, above the history
  await shot(page, 'brain-costi');
  await p.getByTestId('bx-chart-spesa-chat-7').scrollIntoViewIfNeeded();
  await shot(page, 'brain-costi-chat');
  await p.getByRole('button', { name: '30 giorni' }).click();
  await expect(p.getByTestId('bx-lead')).toContainText('in 30 giorni');
});

test('Qualità: four metrics with their source (errors caught, rules, PRs, reopened bugs) and proposals in one row', async () => {
  await open('qualita');
  const p = page.getByTestId('brain-page-qualita');
  await settled();
  for (const id of ['trovati', 'tornati', 'pr', 'riaperti']) await expect(p.getByTestId(`bx-q-${id}`)).toContainText('Fonte:');
  await expect(p.getByTestId('bx-q-tornati')).toContainText('2 su 4');
  await expect(p.getByTestId('bx-q-fuori')).toContainText('7 righe su 49 fuori dal conteggio: 3 illeggibili');
  // no DevOps in this run: the PRs card says so, the reopened bugs one says the read is off
  await expect(p.getByTestId('bx-q-riaperti')).toContainText('lettura DevOps spenta');
  await expect(p.getByTestId('bx-q-proposte')).toContainText('Proposte di miglioramento: 34');
  for (const gone of ['lodi', 'taccuini', 'misure', 'bug']) await expect(p.getByTestId(`bx-tab-${gone}`)).toHaveCount(0);
  await shot(page, 'brain-qualita');
});

test('Confronto: the comparison report rendered, files to open and download', async () => {
  await open('confronto');
  const p = page.getByTestId('brain-page-confronto');
  await settled();
  await expect(p.getByTestId('bx-compare-report')).toContainText('Claude · reviewer');
  await expect(p.getByRole('button', { name: 'Tabella in CSV' })).toBeVisible();
  await expect(p.getByTestId('bx-table-file-confronto')).toContainText('pr-51002.md');
  await shot(page, 'brain-confronto');
});

test('retired explorer links open a source file without a directory browser',async()=>{
  fs.writeFileSync(path.join(brain,'viewer-source.ts'),'// first\n// second\n');
  await open('esplora/viewer-source.ts:2');
  const viewer=page.getByTestId('cited-file-viewer');await expect(viewer.locator('[data-l="2"]')).toContainText('second');
  await expect(page.getByTestId('bx-tree')).toHaveCount(0);await expect(page.getByTestId('bx-search')).toHaveCount(0);await shot(page,'brain-file-viewer');
});

test('Mappa: direct exploration, optional filters, keyboard and accessible fallback without a player', async () => {
  await open('mappa');const m=page.getByTestId('brain-map');await expect(m).toBeVisible();
  await expect(m.locator('.bx-map-msg')).toHaveCount(0,{timeout:30000});
  await expect(m.getByTestId('bx-map-menu')).toHaveCount(0);await expect(m.getByTestId('bx-map-player')).toHaveCount(0);
  const canvas=m.getByTestId('bx-map-canvas');
  if(await canvas.count()){
    await expect.poll(async()=>Number(await canvas.getAttribute('data-map-visible-names'))).toBeGreaterThan(0);
    const gl=canvas.locator('canvas');await expect(gl).toHaveCount(1);await page.emulateMedia({reducedMotion:'reduce'});await canvas.focus();
    // the map's picture without the canvas focus ring: it shows from the first key only when an earlier test clicked
    const pic=()=>gl.screenshot({style:'.bx-map-canvas:focus-visible{outline:none!important}'});
    // the same picture: the GPU draws an identical scene (camera, labels, buffers equal to the bit) with up to a few
    // pixels one colour level off, so at most 0.01% of the pixels may differ, by at most 2 levels per channel
    const same=(a:Buffer,b:Buffer)=>page.evaluate(async([x,y])=>{
      const read=async(s:string)=>{const i=await createImageBitmap(new Blob([Uint8Array.from(atob(s),ch=>ch.charCodeAt(0))],{type:'image/png'})),c=new OffscreenCanvas(i.width,i.height),g=c.getContext('2d')!;g.drawImage(i,0,0);return g.getImageData(0,0,i.width,i.height);};
      const p=await read(x),q=await read(y);if(p.width!==q.width||p.height!==q.height)return false;
      let off=0;for(let i=0;i<p.data.length;i+=4){let d=0;for(let k=0;k<4;k++)d=Math.max(d,Math.abs(p.data[i+k]!-q.data[i+k]!));if(d>2)return false;if(d)off++;}
      return off<=p.width*p.height*1e-4;
    },[a.toString('base64'),b.toString('base64')] as const);
    let previous:Buffer=Buffer.alloc(0),stable=0;
    await expect.poll(async()=>{const current=await pic();stable=current.equals(previous)?stable+1:0;previous=current;return stable;},{timeout:20000,intervals:[150]}).toBeGreaterThanOrEqual(3);
    const original=await pic();await page.keyboard.press('ArrowRight');
    await expect.poll(async()=>same(await pic(),original)).toBe(false);
    await page.keyboard.press('Home');await expect.poll(async()=>same(await pic(),original)).toBe(true);
    await page.keyboard.press('+');await expect.poll(async()=>same(await pic(),original)).toBe(false);
    await page.keyboard.press('Home');await expect.poll(async()=>same(await pic(),original)).toBe(true);
  }else await expect(m.getByTestId('bx-map-flat')).toBeVisible();
  await shot(page,'brain-map-direct');
  await expect(m.getByRole('button',{name:'Filtri',exact:true})).toHaveCount(0);
  await expect(m.locator('.bx-map-panel')).toHaveCount(0);
  await m.getByTestId('bx-map-view').click();await expect(m.getByTestId('bx-map-view')).toHaveText('Vista essenziale');
  await m.getByTestId('bx-map-close').click();await expect(m).toHaveCount(0);
  await open('mappa?flat');const flat=page.getByTestId('bx-map-flat');await expect(flat).toContainText('mem.mjs');
  const chosen=flat.getByRole('button',{name:/reviewer/});await chosen.focus();await page.keyboard.press('Enter');await expect(page.getByTestId('bx-map-piece')).toContainText('Verso');
  await expect(page.getByRole('button',{name:'Chiudi la scheda'})).toBeFocused();await page.getByRole('button',{name:'Chiudi la scheda'}).click();await expect(chosen).toBeFocused();
  await chosen.click();await expect(page.getByTestId('bx-map-piece')).toHaveClass('bx-map-context');await expect(page.locator('.bx-map-panel')).toHaveCount(0);
  await shot(page,'brain-map-flat');await page.getByTestId('bx-map-close').click();
});

test('Regole imparate: a brain without ops/improve/improve.mjs shows Regole without that section, never an error or a stack', async () => {
  // this fixture brain has no improve CLI (like a new user's): main answers /api/improve itself (brain/learn.ts), and the
  // learned rules, a section of Regole since ADR 0082, stay hidden (a fresh brain, ADR 0072)
  await page.evaluate(() => { location.hash = ''; location.reload(); });
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('app')).toBeVisible();
  try {
    await goPage(page, 'regole');
    const p = page.getByTestId('bm-rules-page');
    await expect(p).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByTestId('page-miglioramento')).toHaveCount(0);
    await expect(p.getByTestId('bx-error')).toHaveCount(0);
    await expect(p).not.toContainText('Cannot find module');
    await expect(p).not.toContainText('MODULE_NOT_FOUND');
    // a stack frame ("at fn (file:1:2)" or "at file:1:2"); a plain '    at ' would match "aggiornato" once whitespace is normalized
    await expect(p).not.toContainText(/\bat (?:\S+ \()?\S+:\d+:\d+\)?/);
    await shot(page, 'brain-regole-senza-ciclo');
  } finally {
    await open('fatto', true);
  }
});

test('States: technical details stay collapsed until requested', async () => {
  const failure = path.join(brain, 'FAIL_tables');
  fs.writeFileSync(failure, 'Error: Data source unavailable\n    at readData (fixture.mjs:12:3)');
  try {
    await open('idee', true);
    const p = page.getByTestId('brain-page-idee');
    await expect(p.getByTestId('bx-error-cause')).toHaveText('Data source unavailable');
    const details = p.getByTestId('bx-error-details');
    await expect(details.locator('pre')).toBeHidden();
    await shot(page, 'brain-error-collapsed');
    await details.locator('summary').click();
    await expect(details.locator('pre')).toBeVisible();
    await expect(details.locator('pre')).toContainText('at readData');
  } finally {
    fs.rmSync(failure, { force: true });
  }
});

test('States: a failing data source shows its cause and Riprova; light theme follows the app', async () => {
  fs.writeFileSync(path.join(brain, 'FAIL_tables'), '');
  await open('idee', true);
  const p = page.getByTestId('brain-page-idee');
  await expect(p.getByTestId('bx-error-cause')).toHaveText('errore simulato su /api/tables');
  await expect(p.getByTestId('bx-error-details')).toHaveCount(0); // one line: nothing to fold
  await shot(page, 'brain-error');
  fs.rmSync(path.join(brain, 'FAIL_tables'));
  await p.getByRole('button', { name: 'Riprova' }).click();
  await expect(p.getByTestId('bx-table-idee')).toBeVisible({ timeout: 15000 });

  await page.emulateMedia({ colorScheme: 'light' });
  await open('fatto');
  await settled();
  await shot(page, 'brain-fatto-light');
  await page.emulateMedia({ colorScheme: 'dark' });
});
