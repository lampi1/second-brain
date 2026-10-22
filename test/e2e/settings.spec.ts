// End-to-end: the Settings page (components/SettingsPage.tsx) on the demo: the essential groups only
// (docs/settings-surface.md). Reached from the gear menu and with Ctrl+,; the theme applies at once (light and dark
// screenshots) from its Select, by mouse and keyboard; cross-engine messaging is always available; the technical
// controls of earlier releases (model comparison, spending limits, MCP port, "Chat aperte dall'Orchestrator", compaction)
// are retired from the page and their stored values are kept as they were; Windows notifications, the brain folder and
// the archive delay stay; «Account e strumenti» turns an engine on and off by the user's click (switching one off also
// closes the key an older release reads, ADR 0046) and keeps an API key encrypted, shown only as "saved"; the search
// matches titles, descriptions and keywords; Codex autonomy is an explicit repository list confirmed by the user.
// Screenshots: test-results/shots/settings-*.png.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { choose, launchDemo, shot } from './helpers';

const ESSENTIAL = ['profile', 'update', 'connectors', 'accounts', 'roles', 'space', 'writing', 'appearance', 'notifications', 'advanced'];

/** A Linux container has no keyring, so safeStorage refuses keys there (engines/secrets.ts); on such a machine only, a
 *  stand-in cipher (never the plain text) plays the OS one so the page's key flow can be checked. Windows uses the real one. */
async function keyringStandIn(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ safeStorage }) => {
    if (safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text') return;
    const flip = (s: string) => [...s].reverse().map(c => String.fromCharCode(c.charCodeAt(0) ^ 1)).join('');
    Object.assign(safeStorage, {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptString: (s: string) => Buffer.from(flip(s), 'utf8'),
      decryptString: (b: Buffer) => flip(b.toString('utf8')),
    });
  });
}

test('Impostazioni: groups, theme live, messaging always available, the model comparison retired with its switches kept', async () => {
  const { app, page } = await launchDemo();
  const compare = () => page.evaluate(async () => window.sb.invoke('compare:list', undefined));
  const before = await compare();
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  const s = page.getByTestId('settings-page');
  await expect(s).toBeVisible();
  await expect(s.locator('.st-group')).toHaveCount(ESSENTIAL.length);
  for (const g of ESSENTIAL) await expect(s.getByTestId(`st-group-${g}`)).toHaveCount(1);
  await expect(s.getByTestId('st-group-profile')).toBeVisible();
  await expect(s.getByTestId('st-view')).toHaveCount(0);
  await expect(s.getByTestId('st-group-routing')).toHaveCount(0);

  // the model comparison is no longer on the page; its experiments and agent switches are kept as they were
  await expect(s.getByTestId('st-group-compare')).toHaveCount(0);
  await expect(s.locator('[data-testid^="st-exp-"], [data-testid^="st-agent-switch-"]')).toHaveCount(0);
  await shot(page, 'settings-dark');
  expect(await compare()).toEqual(before);

  // Chat-to-chat transport has no switch; engine launch controls stay separate.
  await expect(s.getByTestId('st-cross-switch')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).messaging.crossHarness)).toBe(true);

  // theme: applied at once
  const theme = s.getByTestId('st-theme-select');
  await theme.scrollIntoViewIfNeeded();
  await choose(theme, 'light');
  await expect(page.locator('html[data-theme="light"]')).toHaveCount(1);
  await page.mouse.move(2, 2);
  await shot(page, 'settings-light');
  await choose(theme, 'dark');
  await expect(page.locator('html[data-theme="dark"]')).toHaveCount(1);
  // the keyboard: Enter opens the list on the current choice, the arrows move, Enter picks and gives the focus back
  await theme.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('st-theme-select-list')).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.locator('html[data-theme="light"]')).toHaveCount(1);
  await expect(theme).toHaveAttribute('data-value', 'light');
  await expect(theme).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('html[data-theme="dark"]')).toHaveCount(1);

  // Ctrl+, from the chats
  await page.getByTestId('page-back').click();
  await expect(s).toHaveCount(0);
  await page.keyboard.press('Control+Comma');
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await app.close();
});

test('spending limits and the MCP port retired with their values kept; Windows notifications, engines on and off, the brain folder', async () => {
  const budget = { enabled: true, claude: { mode: 'warn', dailyUsd: 12.5, perChatUsd: null }, cursor: { mode: 'off', dailyUsd: null, perChatUsd: null } };
  const { app, page } = await launchDemo({ config: { budget } });
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  const s = page.getByTestId('settings-page');
  const get = () => page.evaluate(async () => window.sb.invoke('settings:get', undefined));
  await expect(s).toBeVisible();

  // spending limits and the MCP port are no longer on the page; the saved limits stay as they were
  await expect(s.getByTestId('st-group-budget')).toHaveCount(0);
  await expect(s.locator('[data-testid^="st-budget-"]')).toHaveCount(0);
  await expect(s.getByTestId('st-group-app')).toHaveCount(0);
  await expect(s.getByTestId('st-mcp-port')).toHaveCount(0);

  // Windows notifications
  const toasts = s.getByTestId('st-toasts-select');
  await toasts.scrollIntoViewIfNeeded();
  await expect(toasts).toHaveAttribute('data-value', 'urgent');
  await choose(toasts, 'off');
  await expect.poll(async () => (await get()).osToasts).toBe('off');
  expect((await get()).budget).toEqual(budget);

  // each engine on or off by the user's click; one off also closes «Gli Orchestrator possono usare» (the only key an
  // older release reads)
  const cursor = s.getByTestId('st-tool-cursor');
  await cursor.scrollIntoViewIfNeeded();
  await expect(cursor.locator('.st-state')).toHaveText('Disponibile');
  await cursor.getByRole('button', { name: 'Configura', exact: true }).click();
  await cursor.getByRole('button', { name: 'Disattiva', exact: true }).click();
  await expect.poll(async () => (await get()).engineOn.cursor).toBe(false);
  await expect.poll(async () => (await get()).engines.cursor).toBe(false);
  await expect(cursor.locator('.st-state')).toHaveText('Disattivato');
  await expect(cursor.getByRole('button', { name: 'Attiva', exact: true })).toBeVisible();
  await expect(s.getByTestId('st-tool-claude').locator('.st-state')).toHaveText('Disponibile');
  await page.mouse.move(2, 2);
  await shot(page, 'settings-engines');

  // the brain folder: what is linked, changed only through the folder picker
  const space = s.getByTestId('st-group-space');
  await space.scrollIntoViewIfNeeded();
  await expect(space).toContainText((await get()).brainRoot ?? 'Non collegato');
  await expect(space.getByRole('button', { name: 'Collega cartella', exact: true })).toBeVisible();
  await choose(s.getByTestId('st-theme-select'), 'light');
  await expect(page.locator('html[data-theme="light"]')).toHaveCount(1);
  await space.scrollIntoViewIfNeeded();
  await shot(page, 'settings-space-light');
  expect((await get()).budget).toEqual(budget);
  await app.close();
});

test('Chat aperte dall’Orchestrator: retired from Settings, the saved engine, models and effort kept', async () => {
  const chats = { harness: 'cursor', claudeModel: 'claude-opus-5-5', cursorModel: 'grok-4.7', claudeEffort: 'high', cursorReasoning: 'low', cursorFast: true };
  const { app, page } = await launchDemo({ config: { orchestratorChats: chats } });
  try {
    const get = () => page.evaluate(async () => window.sb.invoke('settings:get', undefined));
    expect((await get()).orchestratorChats).toEqual(chats);
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    const s = page.getByTestId('settings-page');
    await expect(s).toBeVisible();
    // the model a chat runs on comes from its role now (agent profiles): no editor here
    await expect(s.getByTestId('st-group-orchestrator-chats')).toHaveCount(0);
    await expect(s.locator('[data-testid^="st-rc-"]')).toHaveCount(0);
    // saving an unrelated setting leaves them as they were
    const archive = s.getByTestId('st-archive-select');
    await archive.scrollIntoViewIfNeeded();
    await choose(archive, '10');
    await expect.poll(async () => (await get()).autoCloseMin).toBe(10);
    expect((await get()).orchestratorChats).toEqual(chats);
    await page.mouse.move(2, 2);
    await shot(page, 'settings-orchestrator-chats-retired');
  } finally {
    await app.close();
  }
});

test('Impostazioni: the compaction window and «Orchestrators corte» retired from the page, their values kept', async () => {
  const { app, page } = await launchDemo({ config: { compactWindowTokens: 150_000, orchestratorDayCompact: false } });
  try {
    const read = () => page.evaluate(async () => {
      const st = await window.sb.invoke('settings:get', undefined);
      return [st.compactWindowTokens, st.orchestratorDayCompact];
    });
    expect(await read()).toEqual([150_000, false]);
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    const s = page.getByTestId('settings-page');
    await expect(s).toBeVisible();
    await expect(s.getByTestId('st-compact')).toHaveCount(0);
    await expect(s.getByTestId('st-orchestrator-day-switch')).toHaveCount(0);
    const density = s.getByTestId('st-density-select');
    await density.scrollIntoViewIfNeeded();
    await choose(density, 'compact');
    await expect(page.locator('html[data-density="compact"]')).toHaveCount(1);
    await page.mouse.move(2, 2);
    await shot(page, 'settings-compact');
    expect(await read()).toEqual([150_000, false]);
  } finally {
    await app.close();
  }
});

test('Account e strumenti: an engine turns on by the user\'s click, its API key is saved encrypted and never shown again', async () => {
  const { app, page, userData } = await launchDemo({ config: { engineOn: { codex: false } } });
  await keyringStandIn(app);
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  const codex = page.getByTestId('settings-page').getByTestId('st-tool-codex');
  await codex.scrollIntoViewIfNeeded();
  const get = () => page.evaluate(async () => window.sb.invoke('settings:get', undefined));

  // off until the user turns it on; only their click turns it on
  await expect(codex.locator('.st-state')).toHaveText('Disattivato');
  await codex.getByRole('button', { name: 'Configura', exact: true }).click();
  await codex.getByRole('button', { name: 'Attiva', exact: true }).click();
  await expect.poll(async () => (await get()).engineOn.codex).toBe(true);
  // the user's click records the engine's fingerprint (engines/trust.ts)
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'engine-trust.json'), 'utf8')).codex).toMatch(/^[0-9a-f]{16}$/);
  await expect(codex.locator('.st-state')).toHaveText('Disponibile');
  // Gemini CLI and Kimi were removed from the app (ADR 0046): no rows
  await expect(page.getByTestId('st-tool-gemini')).toHaveCount(0);
  await expect(page.getByTestId('st-tool-kimi')).toHaveCount(0);

  // the key: typed once, sent, the field emptied, then only "saved"
  const KEY = 'sk-e2eTestKeyNotReal0123456789wxyz';
  const input = codex.getByLabel('Chiave del servizio', { exact: true });
  await expect(input).toHaveAttribute('type', 'password');
  await expect(input).toBeEnabled();
  await input.fill(KEY);
  await codex.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(codex).toContainText('Chiave salvata su questo PC');
  await expect(input).toHaveValue('');
  expect(await page.content()).not.toContain('0123456789');
  const status = await page.evaluate(async () => window.sb.invoke('secrets:status', undefined));
  expect(status.keys.codex).toBeTruthy();
  expect(JSON.stringify(status)).not.toContain('0123456789');
  expect(fs.readFileSync(path.join(userData, 'secrets.json'), 'utf8')).not.toContain(KEY);
  // an engine that logs in by itself has no key field
  const claude = page.getByTestId('st-tool-claude');
  await claude.getByRole('button', { name: 'Configura', exact: true }).click();
  await expect(claude.getByLabel('Chiave del servizio', { exact: true })).toHaveCount(0);
  await codex.scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  await shot(page, 'settings-engines-keys');

  await codex.getByRole('button', { name: 'Rimuovi chiave', exact: true }).click();
  await expect(codex).not.toContainText('Chiave salvata su questo PC');
  await app.close();
  const logs = path.join(userData, 'logs');
  for (const f of fs.readdirSync(logs)) expect(fs.readFileSync(path.join(logs, f), 'utf8')).not.toContain(KEY);
});

test('settings search finds labels, descriptions and sections, preserves drafts and explains no matches', async () => {
  const { app, page } = await launchDemo({ config: { messaging: { crossHarness: false } } });
  try {
    await keyringStandIn(app);
    await page.keyboard.press('Control+Comma');
    const s = page.getByTestId('settings-page');
    const search = s.getByRole('searchbox', { name: 'Cerca nelle impostazioni' });
    await expect(s.getByTestId('st-cross-switch')).toHaveCount(0);
    expect(await page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).messaging.crossHarness)).toBe(true);
    // a label, without its accent
    await search.fill('SPAZIATURA');
    await expect(s.getByTestId('st-group-appearance')).toBeVisible();
    await expect(s.locator('.st-group:visible')).toHaveCount(1);
    // a group's description
    await search.fill('pulizia dei lavori conclusi');
    await expect(s.getByTestId('st-group-space')).toBeVisible();
    await expect(s.getByTestId('st-group-appearance')).toBeHidden();
    await expect(s.locator('.st-group:visible')).toHaveCount(1);
    // a section's title
    await search.fill('Notifiche');
    await expect(s.getByTestId('st-group-notifications')).toBeVisible();
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    const codex = s.getByTestId('st-tool-codex');
    await codex.getByRole('button', { name: 'Configura', exact: true }).click();
    const key = codex.getByLabel('Chiave del servizio', { exact: true });
    await key.fill('unsavedKeyDraftXYZ');
    await search.fill('unsavedKeyDraftXYZ');
    await expect(s.getByTestId('st-search-empty')).toContainText('Nessuna impostazione trovata');
    await expect(s.locator('.st-group:visible')).toHaveCount(0);
    await shot(page, 'settings-search-empty');
    await s.getByTestId('st-search-clear').click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    // the unsaved key typed before the search is still there
    await expect(key).toHaveValue('unsavedKeyDraftXYZ');
    await search.fill('notifiche');
    await shot(page, 'settings-search');
  } finally { await app.close(); }
});

test('Codex autonomy is an explicit empty-by-default repository selection and can be revoked', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-autonomy-e2e-'));
  fs.mkdirSync(path.join(root, '.git'));
  const { app, page } = await launchDemo();
  try {
    // the folder picker answers with the test repository (no native dialog in a hidden run)
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
    }, root);
    const roots = () => page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).codexAutonomyRoots);
    await page.keyboard.press('Control+Comma');
    const s = page.getByTestId('settings-page');
    await s.getByTestId('st-search').fill('Autonomia Codex');
    const row = s.getByTestId('codex-autonomy');
    await expect(row).toContainText('Nessun repository autorizzato');
    await expect(row).toContainText('senza chiedere conferma per ogni comando');
    expect(await roots()).toEqual([]);
    // adding one is a proposal the user confirms; nothing changes before the confirmation
    await row.getByRole('button', { name: 'Aggiungi cartella', exact: true }).click();
    const confirm = row.getByRole('group', { name: 'Conferma modifica' });
    await expect(confirm).toContainText(fs.realpathSync.native(root));
    expect(await roots()).toEqual([]);
    await confirm.getByRole('button', { name: 'Conferma modifica', exact: true }).click();
    await expect.poll(roots).toEqual([fs.realpathSync.native(root)]);
    await expect(row.locator('code')).toHaveText(fs.realpathSync.native(root));
    await shot(page, 'settings-codex-autonomy');
    // revoked the same way
    await row.getByRole('button', { name: `Rimuovi ${fs.realpathSync.native(root)}`, exact: true }).click();
    await row.getByRole('group', { name: 'Conferma modifica' }).getByRole('button', { name: 'Conferma modifica', exact: true }).click();
    await expect.poll(roots).toEqual([]);
    await expect(row).toContainText('Nessun repository autorizzato');
  } finally { await app.close(); }
});
