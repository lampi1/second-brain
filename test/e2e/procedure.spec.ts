// End-to-end: the Procedure page in the frozen demo (SB_DEMO=1 SB_DEMO_FREEZE=1), over the generic demo procedures of
// main/brain/procedures-demo.ts read by the real scanner. The nav shows Procedure (Comunicazione is gone); the list is
// grouped by area and filters by words and tags; a procedure opens rendered with "Copia" on each code block (the
// page writes exactly the block to the clipboard, recorded in the page: the system clipboard is shared and never read)
// and no Esegui anywhere; the fake connection string is masked; the credentials file never
// shows. Screenshots: test-results/shots/procedure-*.png.
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { closeRegia, launchDemo, shot } from './helpers';

let app: ElectronApplication, page: Page;
test.beforeAll(async () => {
  ({ app, page } = await launchDemo());
  await closeRegia(page);
  // The system clipboard is shared with every app and chat on the machine (a read can get their text): the page's
  // clipboard writes are recorded here instead, and the system clipboard is never touched.
  await page.evaluate(() => {
    const w = window as unknown as { __sbCopies: string[] };
    w.__sbCopies = [];
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (t: string) => { w.__sbCopies.push(t); } });
  });
});
test.afterAll(async () => { await app?.close(); });

const copies = () => page.evaluate(() => (window as unknown as { __sbCopies: string[] }).__sbCopies);
/** Click a Copia: it writes exactly `text` to the clipboard, once, and says so. */
async function copied(button: Locator, text: string, toast: string): Promise<void> {
  const before = (await copies()).length;
  await button.click();
  await expect.poll(copies).toHaveLength(before + 1);
  expect((await copies())[before]).toBe(text);
  await expect(page.getByTestId('toasts')).toContainText(toast);
}

test('nav shows Procedure, not Comunicazione; the list is grouped, searchable and filterable', async () => {
  await expect(page.getByTestId('nav-procedure')).toBeVisible();
  await expect(page.getByTestId('nav-comunicazione')).toHaveCount(0);
  await page.getByTestId('nav-procedure').click();
  await expect(page.getByTestId('page-procedure')).toBeVisible();
  await expect(page.getByTestId('page-procedure')).toContainText('Istruzioni riusabili per il tuo lavoro');
  const rows = page.getByTestId('bx-proc-row');
  await expect(rows.first()).toBeVisible();
  const titles = await rows.locator('.t').allTextContents();
  expect(titles).toEqual(expect.arrayContaining(['Cercare un cliente con lookup', 'Pubblicare su un anello di produzione', 'Attivare una funzionalità su una licenza', 'Hotfix di una regressione', 'Brief mattutino', 'Provare un test case']));
  expect(titles).not.toContain('Tono dei commenti'); // a rule without steps is no procedure
  await expect(page.getByTestId('page-procedure')).not.toContainText('Credenziali di test'); // never read
  await shot(page, 'procedure-list');

  const search = page.getByRole('searchbox', { name: 'Cerca nelle procedure' });
  await search.fill('funzionalita licenza'); // every word, accents folded: the feature and the integration runbooks
  await expect(rows.locator('.t')).toHaveText(['Attivare una funzionalità su una licenza', "Attivare l'integrazione con un servizio esterno"]);
  await search.fill('funzionalità su una licenza');
  await expect(rows).toHaveCount(1);
  await search.fill('');
  await page.getByTestId('bx-proc-tag-query').click();
  await expect(rows.locator('.t')).toContainText(['Cercare un cliente con lookup']);
  await expect(page.getByTestId('bx-proc-list')).not.toContainText('Brief mattutino');
  await page.getByTestId('bx-proc-tag-query').click();
  await search.fill('nessuna procedura così');
  await expect(page.getByTestId('bx-proc-none')).toBeVisible();
  await search.fill('');
});

test('a procedure opens rendered: Copia on each block copies it, no Esegui, the credential line is masked', async () => {
  await page.getByTestId('bx-proc-row').filter({ hasText: 'Query in sola lettura su produzione' }).click();
  await expect(page.getByTestId('bx-proc-title')).toHaveText('Query in sola lettura su produzione');
  const md = page.getByTestId('bx-proc-md');
  await expect(md.locator('ol li').first()).toBeVisible();
  await expect(page.getByTestId('bx-proc-masked')).toHaveText('1 riga nascosta');
  await expect(md).not.toContainText('demo-non-reale-42');
  await expect(md).toContainText('riga nascosta');
  const view = page.getByTestId('bx-proc-view');
  await expect(view.getByRole('button', { name: /esegui|run/i })).toHaveCount(0);
  await expect(page.getByTestId('page-procedure').getByRole('button', { name: /esegui/i })).toHaveCount(0);
  const buttons = md.getByRole('button', { name: 'Copia' });
  await expect(buttons).toHaveCount(await md.locator('pre').count());
  await copied(buttons.last(), 'SELECT TOP 10 Id, Nome, Creato FROM Clienti ORDER BY Creato DESC;', 'Blocco copiato');
  await expect(page.getByTestId('bx-proc-discuss')).toBeVisible();
  const prepare=page.getByTestId('bx-proc-discuss-chat');
  await expect(prepare).toHaveText('Prepara richiesta');
  await prepare.click();
  const draft=page.getByTestId('bx-proc-discuss-box');
  await expect(draft.getByRole('textbox')).toBeEditable();
  await expect(page.getByTestId('bx-proc-discuss-mark')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(draft).toHaveCount(0);await expect(prepare).toBeFocused();
  await shot(page, 'procedure-open');

  await page.getByTestId('bx-proc-row').filter({ hasText: 'Cercare un cliente con lookup' }).click();
  await expect(page.getByTestId('bx-proc-title')).toHaveText('Cercare un cliente con lookup');
  await expect(page.getByTestId('bx-proc-masked')).toHaveCount(0);
  await copied(page.getByTestId('bx-proc-md').getByRole('button', { name: 'Copia' }).first(), "EXEC lookup '%testo%'", 'Blocco copiato');
  await shot(page, 'procedure-lookup');
});
