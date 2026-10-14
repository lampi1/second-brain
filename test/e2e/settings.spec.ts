// End-to-end: the Settings page (components/SettingsPage.tsx) on the demo. Reached from the gear menu and with Ctrl+,;
// the theme applies at once (light and dark screenshots); the Claude <-> Cursor mail switch is saved in the settings;
// the model comparison shows what it compares and its cost so far, and its experiment and agent switches go through
// 'compare:set' (the demo keeps them in memory; the real app runs the brain's switch.mjs, unit-tested in
// test/unit/brain/compare.test.ts); "Chat aperte dalla Regia" saves engine, models and effort and "Nuova chat" starts
// from them. Screenshots: test-results/shots/settings-*.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('Impostazioni: groups, theme live, mail switch, model comparison switches with their cost', async () => {
  const { app, page } = await launchDemo();
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  const s = page.getByTestId('settings-page');
  await expect(s).toBeVisible();
  for (const g of ['st-group-look', 'st-group-chat', 'st-group-compare']) await expect(s.getByTestId(g)).toBeVisible();

  // the model comparison: what it compares, the cost so far, one switch per experiment and per agent
  const exp = s.getByTestId('st-exp-cursor-vs-claude');
  // the main switch, first on the page, in the user's words
  await expect(s.locator('.st-group').first()).toHaveAttribute('data-testid', 'st-group-compare');
  await expect(exp).toContainText('Opus rifà in automatico il lavoro dei reviewer di Cursor');
  await expect(exp).toContainText('Cursor Agent (gpt-5)');
  await expect(s.getByTestId('st-exp-cost-cursor-vs-claude')).toContainText('Finora 4 confronti · Claude Code (opus) 6,12 $ · Cursor 1,84 $ (1 confronto senza costo)');
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
  await shot(page, 'settings-dark');

  await main.click();
  await expect(main).toHaveAttribute('aria-checked', 'false');
  await expect(s.getByTestId('st-agent-cursor-vs-claude-reviewer')).toHaveClass(/dim/);
  await expect(exp).toContainText("valgono solo con l'interruttore sopra acceso");

  // the mail switch is a real setting
  const cross = s.getByTestId('st-cross-switch');
  await expect(cross).toHaveAttribute('aria-checked', 'true');
  await cross.click();
  await expect(cross).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('settings:get', undefined)).messaging.crossHarness)).toBe(false);

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

  // the engines the Regia may use
  const cur = s.getByTestId('st-engine-cursor-switch');
  await cur.click();
  await expect(cur).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => (await get()).engines.cursor).toBe(false);

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
  await page.getByTestId('topbar-new').click();
  const d = page.getByTestId('newchat');
  await expect(d.getByTestId('newchat-harness-cursor')).toHaveAttribute('aria-checked', 'true');
  await d.getByTestId('newchat-advanced').locator('summary').click();
  await expect(d.getByTestId('newchat-model')).toHaveValue('grok-4.7');
  await shot(page, 'settings-regia-chats-newchat');
  await d.getByTestId('newchat-harness-claude').click();
  await expect(d.getByTestId('newchat-model')).toHaveValue('claude-opus-5-5');
  await expect(d.getByTestId('newchat-effort-high')).toHaveAttribute('aria-checked', 'true');
  await app.close();
});
