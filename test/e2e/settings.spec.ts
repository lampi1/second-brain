// End-to-end: the Settings page (components/SettingsPage.tsx) on the demo. Reached from the gear menu and with Ctrl+,;
// the theme applies at once (light and dark screenshots); cross-engine messaging is always available;
// the model comparison shows what it compares and its cost so far, and its experiment and agent switches go through
// 'compare:set' (the demo keeps them in memory; the real app runs the brain's switch.mjs, unit-tested in
// test/unit/brain/compare.test.ts); "Chat aperte dalla Regia" saves engine, models and effort and "Nuova chat" starts
// from them; «Motori» turns a new engine on by the user's click and keeps its API key encrypted, shown only as a mask
// (ADR 0046). Screenshots: test-results/shots/settings-*.png.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('Impostazioni: groups, theme live, messaging always available, model comparison switches with their cost', async () => {
  const { app, page } = await launchDemo();
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  const s = page.getByTestId('settings-page');
  await expect(s).toBeVisible();
  for (const g of ['st-group-look', 'st-group-chat', 'st-group-compare']) await expect(s.getByTestId(g)).toBeVisible();
  await expect(s.getByTestId('st-view')).toHaveCount(0);
  await expect(s.getByTestId('st-group-routing')).toHaveCount(0);

  // the model comparison: what it compares, the cost so far, one switch per experiment and per agent
  const exp = s.getByTestId('st-exp-cursor-vs-claude');
  // the main switch, first on the page, in the user's words
  await expect(s.locator('.st-group').first()).toHaveAttribute('data-testid', 'st-group-compare');
  await expect(exp).toContainText('Opus rifà in automatico il lavoro dei reviewer di Cursor');
  // each side and the judge by engine, model and effort (ADR 0046 §4), side a's compared agents in brackets
  await expect(s.getByTestId('st-exp-sides-cursor-vs-claude')).toHaveText('A: Cursor (reviewer) · B: Claude opus medium · giudice: Claude sonnet');
  await expect(s.getByTestId('st-exp-cost-cursor-vs-claude')).toContainText('Finora 4 confronti · Claude opus medium 6,12 $ · Cursor 1,84 $ (1 confronto senza costo)');
  const main = s.getByTestId('st-exp-switch-cursor-vs-claude');
  await expect(main).toHaveAttribute('aria-checked', 'true');
  const inv = s.getByTestId('st-agent-switch-cursor-vs-claude-code-investigator');
  await expect(inv).toHaveAttribute('aria-checked', 'false');
  await inv.click();
  await expect(inv).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.evaluate(async () => {
    const r = await window.sb.invoke('compare:list', undefined);
    return r.ok ? r.experiments[0]!.agents.find(a => a.name === 'code-investigator')!.on : null;
  })).toBe(true);
  await expect(s.getByTestId('st-exp-sides-cursor-vs-claude')).toContainText('A: Cursor (reviewer, code-investigator)');
  await shot(page, 'settings-dark');

  await main.click();
  await expect(main).toHaveAttribute('aria-checked', 'false');
  await expect(s.getByTestId('st-agent-cursor-vs-claude-reviewer')).toHaveClass(/dim/);
  await expect(exp).toContainText("valgono solo con l'interruttore sopra acceso");

  // Chat-to-chat transport has no switch; engine launch controls stay separate.
  await expect(s.getByTestId('st-cross-switch')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).messaging.crossHarness)).toBe(true);

  // theme: applied at once
  await s.getByTestId('st-theme-choice-light').click();
  await expect(page.locator('html[data-theme="light"]')).toHaveCount(1);
  await expect(s.getByTestId('st-theme-choice-light')).toHaveAttribute('aria-checked', 'true');
  await shot(page, 'settings-light');
  await s.getByTestId('st-theme-choice-dark').click();
  await expect(page.locator('html[data-theme="dark"]')).toHaveCount(1);
  // the keyboard, like radio buttons: one tab stop, the arrows move the choice
  await expect(s.getByTestId('st-theme-choice-light')).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('html[data-theme="light"]')).toHaveCount(1);
  await expect(s.getByTestId('st-theme-choice-light')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('html[data-theme="dark"]')).toHaveCount(1);

  // Ctrl+, from the chats
  await page.getByTestId('page-back').click();
  await expect(s).toHaveCount(0);
  await page.keyboard.press('Control+Comma');
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await app.close();
});

test('spending limits, Windows notifications, the engines the Regia may use, the brain folder read only', async () => {
  const { app, page } = await launchDemo();
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  const s = page.getByTestId('settings-page');
  const get = () => page.evaluate(async () => window.sb.invoke('settings:get', undefined));

  // spending limits: a $ amount saved on Enter; a wrong one is put back and nothing is saved
  const g = s.getByTestId('st-group-budget');
  await g.scrollIntoViewIfNeeded();
  await expect(g.getByTestId('st-budget-enabled-switch')).toHaveAttribute('aria-checked', 'true');
  const daily = g.getByTestId('st-budget-claude-daily');
  await daily.fill('50');
  await daily.press('Enter');
  await expect.poll(async () => (await get()).budget.claude.dailyUsd).toBe(50);
  for (const bad of ['-3', '1.000']) { // "1.000" is never read as 1 $
    await daily.fill(bad);
    await daily.press('Enter');
    await expect(daily).toHaveValue('50');
  }
  expect((await get()).budget.claude.dailyUsd).toBe(50);
  await daily.fill('');
  await daily.blur();
  await expect.poll(async () => (await get()).budget.claude.dailyUsd).toBeNull();
  // "chiedi se continuare" is not wired yet: not offered
  await expect(g.getByTestId('st-budget-cursor-mode-ask')).toHaveCount(0);
  await g.getByTestId('st-budget-cursor-mode-off').click();
  await expect.poll(async () => (await get()).budget.cursor.mode).toBe('off');
  await expect(g.getByTestId('st-budget-cursor-chat')).toHaveCount(0); // Cursor gives no per-chat cost
  await g.getByTestId('st-budget-claude-daily').fill('12,5');
  await g.getByTestId('st-budget-claude-daily').press('Enter');
  await expect.poll(async () => (await get()).budget.claude.dailyUsd).toBe(12.5);
  await shot(page, 'settings-budget');

  // Windows notifications
  await s.getByTestId('st-toasts-choice-off').click();
  await expect.poll(async () => (await get()).osToasts).toBe('off');

  // each engine on or off, and whether the Regie may use it (ADR 0046)
  const eng = s.getByTestId('st-group-engines');
  await eng.scrollIntoViewIfNeeded();
  const cur = eng.getByTestId('st-engine-claude-switch');
  await cur.click();
  await expect(cur).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => (await get()).engines.claude).toBe(false);
  // an engine off closes «Le Regie possono usare» too (the only key an older release reads) and dims it
  const off = eng.getByTestId('st-engine-on-cursor-switch');
  await off.click();
  await expect.poll(async () => (await get()).engineOn.cursor).toBe(false);
  await expect.poll(async () => (await get()).engines.cursor).toBe(false);
  await expect(eng.getByTestId('st-engine-cursor-switch')).toHaveAttribute('aria-checked', 'false');
  await expect(eng.getByTestId('st-engine-cursor')).toHaveClass(/dim/);
  await shot(page, 'settings-engines');

  // the brain folder and the MCP port: read only
  const info = s.getByTestId('st-group-app');
  await info.scrollIntoViewIfNeeded();
  await expect(info.getByTestId('st-brain-root')).toContainText((await get()).brainRoot ?? 'non collegata');
  await expect(info.locator('input, select, button:not(.help-tip)')).toHaveCount(0); // the "?" (HelpTip, ADR 0040) only explains
  const mcpUrl = (await page.evaluate(async () => window.sb.invoke('app:info', undefined))).mcpUrl;
  await expect(info.getByTestId('st-mcp-port')).toContainText(new URL(mcpUrl).port); // the port in use, not the saved one
  await page.getByTestId('st-theme-choice-light').click();
  await expect(page.locator('html[data-theme="light"]')).toHaveCount(1);
  await g.scrollIntoViewIfNeeded();
  await shot(page, 'settings-budget-light');
  await app.close();
});

test('Chat aperte dalla Regia: engine, models (Cursor\'s own list), effort; saved at once, "Nuova chat" starts from them', async () => {
  const { app, page } = await launchDemo();
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  const g = page.getByTestId('st-group-regia-chats');
  await g.scrollIntoViewIfNeeded();
  await expect(g).toBeVisible();
  // CLI defaults until chosen
  await expect(g.getByTestId('st-rc-harness-choice-claude')).toHaveAttribute('aria-checked', 'true');
  await expect(g.getByTestId('st-rc-cursor-model-select')).toHaveValue('');
  // the Cursor list is the one the CLI offered (demo: with Grok 4.7), not the built-in one
  await expect(g.getByTestId('st-rc-cursor-model-select').locator('option[value="grok-4.7-fast"]')).toHaveCount(1);
  await expect(g.getByTestId('st-rc-cursor-model')).toContainText("ha offerto all'ultima chat Cursor");

  await g.getByTestId('st-rc-harness-choice-cursor').click();
  await g.getByTestId('st-rc-cursor-model-select').selectOption('grok-4.7');
  await g.getByTestId('st-rc-claude-model-select').selectOption('claude-opus-5-5');
  await g.getByTestId('st-rc-claude-effort-select').selectOption('high');
  // Cursor reasoning and fast (every Cursor chat): medium and off until changed
  await expect(g.getByTestId('st-rc-cursor-reasoning-select')).toHaveValue('medium');
  await expect(g.getByTestId('st-rc-cursor-fast-switch')).toHaveAttribute('aria-checked', 'false');
  await g.getByTestId('st-rc-cursor-reasoning-select').selectOption('low');
  await g.getByTestId('st-rc-cursor-fast-switch').click();
  await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).regiaChats))
    .toEqual({ harness: 'cursor', claudeModel: 'claude-opus-5-5', cursorModel: 'grok-4.7', claudeEffort: 'high', cursorReasoning: 'low', cursorFast: true });
  await expect(g.getByTestId('st-rc-harness-choice-cursor')).toHaveAttribute('aria-checked', 'true');
  await shot(page, 'settings-regia-chats');

  // "Nuova chat" starts from them: Cursor with Grok 4.7; switching to Claude takes Claude's model and effort
  await page.getByTestId('page-back').click();
  await page.keyboard.press('Control+N');
  const d = page.getByTestId('newchat');
  await d.getByTestId('newchat-engine-options').locator('summary').click();
  await expect(d.getByTestId('newchat-harness-cursor')).toHaveAttribute('aria-checked', 'true');
  await d.getByTestId('newchat-advanced').locator('summary').click();
  await expect(d.getByTestId('newchat-model')).toHaveAttribute('data-value', 'grok-4.7');
  await shot(page, 'settings-regia-chats-newchat');
  await d.getByTestId('newchat-harness-claude').click();
  await expect(d.getByTestId('newchat-model')).toHaveAttribute('data-value', 'claude-opus-5-5');
  // the effort stays "automatico" (the table's, ADR 0051) until the user picks one
  await expect(d.getByTestId('newchat-effort-default')).toHaveAttribute('aria-checked', 'true');
  await app.close();
});

test('Impostazioni: the Claude chats compact at 200k by default and «Regie corte» is on; both saved at once', async () => {
  const { app, page } = await launchDemo();
  try {
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    const s = page.getByTestId('settings-page');
    const row = s.getByTestId('st-compact');
    await row.scrollIntoViewIfNeeded();
    await expect(row.getByRole('radio', { name: '200k' })).toHaveAttribute('aria-checked', 'true');
    const day = s.getByTestId('st-regia-day-switch');
    await expect(day).toHaveAttribute('aria-checked', 'true');
    await page.mouse.move(2, 2);
    await shot(page, 'settings-compact');
    await row.getByRole('radio', { name: '150k' }).click();
    await day.click();
    await expect(day).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => page.evaluate(async () => {
      const st = await window.sb.invoke('settings:get', undefined);
      return [st.compactWindowTokens, st.regiaDayCompact];
    })).toEqual([150_000, false]);
  } finally {
    await app.close();
  }
});

test('Motori: a new engine turns on by the user\'s click, its API key is saved encrypted and shown only as a mask', async () => {
  const { app, page, userData } = await launchDemo();
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  const eng = page.getByTestId('settings-page').getByTestId('st-group-engines');
  await eng.scrollIntoViewIfNeeded();
  const get = () => page.evaluate(async () => window.sb.invoke('settings:get', undefined));

  // Codex ships off; how it starts is shown before the user turns it on, and only their click turns it on
  const on = eng.getByTestId('st-engine-on-codex-switch');
  await expect(on).toHaveAttribute('aria-checked', 'false');
  await expect(eng.getByTestId('st-engine-on-codex-runs')).toHaveText('Avvio: codex app-server · accesso: codex login');
  await on.click();
  await expect(on).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await get()).engineOn.codex).toBe(true);
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'engine-trust.json'), 'utf8')).codex).toMatch(/^[0-9a-f]{16}$/);
  // Gemini CLI was removed from the app (ADR 0046, 15/10): no row
  await expect(eng.getByTestId('st-engine-on-gemini-switch')).toHaveCount(0);

  // the key: typed once, sent, the field emptied, then only its mask
  const KEY = 'sk-e2eTestKeyNotReal0123456789wxyz';
  const row = eng.getByTestId('st-key-anthropic');
  await expect(row.getByTestId('st-key-anthropic-input')).toHaveAttribute('type', 'password');
  await row.getByTestId('st-key-anthropic-input').fill(KEY);
  await row.getByTestId('st-key-anthropic-save').click();
  await expect(row.getByTestId('st-key-anthropic-mask')).toHaveText('Salvata: sk-…wxyz');
  await expect(row.getByTestId('st-key-anthropic-input')).toHaveValue('');
  const status = await page.evaluate(async () => window.sb.invoke('secrets:status', undefined));
  expect(JSON.stringify(status)).not.toContain('0123456789');
  expect(fs.readFileSync(path.join(userData, 'secrets.json'), 'utf8')).not.toContain(KEY);
  // an engine that logs in by itself has no key field
  await expect(eng.getByTestId('st-key-kimi')).toHaveCount(0);
  await expect(eng.getByTestId('st-key-claude')).toHaveCount(0);
  await row.scrollIntoViewIfNeeded();
  await shot(page, 'settings-engines-keys');

  await row.getByTestId('st-key-anthropic-delete').click();
  await expect(row.getByTestId('st-key-anthropic-mask')).toHaveCount(0);
  await app.close();
  const logs = path.join(userData, 'logs');
  for (const f of fs.readdirSync(logs)) expect(fs.readFileSync(path.join(logs, f), 'utf8')).not.toContain(KEY);
});

test('settings search finds labels, descriptions and sections, preserves drafts and explains no matches', async () => {
  const { app, page } = await launchDemo({ config: { messaging: { crossHarness: false } } });
  try {
    await page.keyboard.press('Control+Comma');
    const s = page.getByTestId('settings-page');
    const search = s.getByRole('searchbox', { name: 'Cerca nelle impostazioni' });
    await expect(s.getByTestId('st-cross-switch')).toHaveCount(0);
    expect(await page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).messaging.crossHarness)).toBe(true);
    await search.fill('DENSITA');
    await expect(s.getByTestId('st-group-look')).toBeVisible();
    await expect(s.locator('.st-group:visible')).toHaveCount(1);
    await search.fill('solo 127.0.0.1');
    await expect(s.getByTestId('st-group-app')).toBeVisible();
    await expect(s.getByTestId('st-group-look')).toBeHidden();
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    const key = s.getByTestId('st-key-anthropic-input');
    await key.fill('unsavedKeyDraftXYZ');
    await search.fill('unsavedKeyDraftXYZ');
    await expect(s.getByTestId('st-search-empty')).toContainText('Prova con altre parole');
    await expect(s.locator('.st-group:visible')).toHaveCount(0);
    await shot(page, 'settings-search-empty');
    await s.getByTestId('st-search-clear').click();
    await expect(search).toBeFocused();
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
    await page.keyboard.press('Control+Comma');
    const s = page.getByTestId('settings-page');
    await s.getByTestId('st-search').fill('Autonomia Codex');
    const row = s.getByTestId('st-codex-autonomy');
    const input = row.getByTestId('st-codex-autonomy-roots');
    await expect(input).toHaveValue('');
    await expect(row).toContainText('i permessi in attesa richiedono ancora la tua risposta');
    await input.fill(root);
    await row.getByTestId('st-codex-autonomy-save').click();
    await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).codexAutonomyRoots)).toEqual([fs.realpathSync.native(root)]);
    await shot(page, 'settings-codex-autonomy');
    await input.fill('');
    await row.getByTestId('st-codex-autonomy-save').click();
    await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).codexAutonomyRoots)).toEqual([]);
  } finally { await app.close(); }
});
