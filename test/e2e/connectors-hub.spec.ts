// Settings → Connettori (issue #91, ADR 0086) on the demo's made-up MCP servers (no process, no network, no real
// token): the totals and the cards say what each server is, whether it works, its tools and roles; "Prova" turns an
// untried server into a working one; the missing token is said with its fix and typed write-only (only its mask comes
// back); a server is added from the form; the herald card's MCP section narrows a server once the card's «Server MCP»
// tool class is on (the demo's Herald reads only, so its section starts disabled). Dark and light screenshots of
// the section. Hidden window (SB_HIDDEN, set by the helpers).
import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { choose, goPage, launchDemo } from './helpers';

const SHOTS = path.resolve(import.meta.dirname, '..', '..', 'test-results', 'shots');
async function shotOf(el: Locator, name: string): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  await el.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled', caret: 'hide' });
}
async function openConnectors(page: Page): Promise<Locator> {
  await page.keyboard.press('Control+,');
  const group = page.getByTestId('st-group-connectors');
  await group.scrollIntoViewIfNeeded();
  await expect(group.getByTestId('connectors-hub')).toBeVisible();
  return group;
}

test('Connettori: accounts and MCP servers as cards, Prova, write-only token, add a server, dark and light', async () => {
  const { app, page } = await launchDemo({ width: 1500, height: 2300 });
  try {
    const group = await openConnectors(page);
    const ado = group.getByTestId('hub-server-azure-devops'), jira = group.getByTestId('hub-server-jira'), docs = group.getByTestId('hub-server-docs-search');
    await expect(ado.getByRole('status')).toHaveText('Funziona');
    await expect(ado).toContainText('4 lettura · 2 scrittura');
    await expect(jira.getByRole('status')).toHaveText('Manca il token');
    await expect(group.getByTestId('hub-problem-jira')).toContainText('Inseriscilo nel campo Token');
    await expect(docs.getByRole('status')).toHaveText('Non ancora provato');
    for (const name of ['GitHub', 'Jira Cloud', 'Azure DevOps']) await expect(group.getByTestId('app-connectors').getByRole('article', { name })).toBeVisible();
    // Prova: the app opens the server as a chat would and lists its tools
    await docs.getByRole('button', { name: 'Prova Documentazione', exact: true }).click();
    await expect(docs.getByRole('status')).toHaveText('Funziona');
    await expect(docs).toContainText('2 lettura · 0 scrittura');
    await expect(group.getByTestId('hub-totals')).toContainText('Funzionano');
    await page.mouse.move(2, 2);
    await shotOf(group.getByTestId('connectors-hub'), 'connectors-hub-dark');

    // the token: typed once, then only its mask; never readable back
    const token = 'atl_e2eSecretToken1234567890wxyz';
    await jira.getByPlaceholder('Incolla il token').fill(token);
    await jira.getByRole('button', { name: 'Salva token', exact: true }).click();
    await expect(jira.getByTestId('hub-token-jira')).toContainText('…wxyz');
    await expect(jira.getByRole('status')).toHaveText('Non ancora provato');
    expect(await page.content()).not.toContain(token);
    const state = await page.evaluate(() => (window as unknown as { sb: { invoke(c: string, a: unknown): Promise<unknown> } }).sb.invoke('mcpservers:state', undefined));
    expect(JSON.stringify(state)).not.toContain(token);

    // a new server from the form
    await group.getByTestId('hub-add').click();
    const editor = group.getByTestId('hub-editor');
    await editor.getByRole('textbox', { name: 'Nome', exact: true }).fill('Sentry');
    await editor.getByRole('textbox', { name: 'Comando', exact: true }).fill('npx');
    await editor.getByRole('textbox', { name: 'Argomenti (uno per riga)', exact: true }).fill('-y\n@sentry/mcp-server');
    await editor.getByRole('textbox', { name: 'Variabile del token', exact: true }).fill('SENTRY_ACCESS_TOKEN');
    await editor.getByRole('textbox', { name: 'A cosa serve', exact: true }).fill('Gli errori in produzione, per lo Scout');
    await shotOf(editor, 'connectors-hub-editor');
    await editor.getByRole('button', { name: 'Salva', exact: true }).click();
    const sentry = group.getByTestId('hub-server-sentry');
    await expect(sentry.getByRole('status')).toHaveText('Manca il token');
    await expect(sentry).toContainText('npx -y @sentry/mcp-server');
    // a secret in a plain field is refused with what to do
    await group.getByTestId('hub-add').click();
    await editor.getByRole('textbox', { name: 'Nome', exact: true }).fill('Bad');
    await editor.getByRole('textbox', { name: 'Comando', exact: true }).fill('npx');
    await editor.getByRole('textbox', { name: 'Variabili (NOME=valore)', exact: true }).fill('GITHUB_TOKEN=ghp_x');
    await editor.getByRole('button', { name: 'Salva', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('campo Token');
    await editor.getByRole('button', { name: 'Annulla', exact: true }).click();

    // the herald's MCP section, in its permissions card (the card back's "Modifica permessi", ADR 0085): Azure DevOps
    // read-only from the demo, narrowed to none here
    await goPage(page, 'agenti');
    const card = page.getByTestId('catalog-card-herald');
    await card.getByTestId('catalog-flip-herald').click();
    await expect(card).toHaveAttribute('data-flipped', 'true');
    await card.getByTestId('catalog-perms-edit-herald').click();
    const section = page.getByTestId('role-permissions').getByTestId('agent-mcp-herald');
    await expect(section).toContainText('Azure DevOps');
    const select = section.getByTestId('agent-mcp-herald-azure-devops');
    await expect(select).toHaveAttribute('data-value', 'read');
    await expect(section).toContainText('4 di 6 strumenti');
    // the demo's Herald was narrowed to reading (no «Server MCP» class): no server reaches it until the class is on
    await expect(select).toBeDisabled();
    await page.getByTestId('role-permissions').getByTestId('perm-toggle-mcp').click();
    await expect(select).toBeEnabled();
    await section.scrollIntoViewIfNeeded();
    await shotOf(page.getByTestId('perm-section-mcp'), 'connectors-hub-agent-card');
    await choose(select, 'none');
    await expect(section).toContainText('0 di 6 strumenti');
  } finally { await app.close(); }
});

test('Connettori in the light theme', async () => {
  const { app, page } = await launchDemo({ width: 1500, height: 2300, scheme: 'light' });
  try {
    await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const group = await openConnectors(page);
    await expect(group.getByTestId('hub-server-github').getByRole('status')).toHaveText('Funziona');
    await page.mouse.move(2, 2);
    await shotOf(group.getByTestId('connectors-hub'), 'connectors-hub-light');
  } finally { await app.close(); }
});
