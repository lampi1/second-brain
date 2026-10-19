// Main-only UI acceptance for run provenance, explicit outcomes and contextual cards. IPC fixtures spend no tokens.
import { expect, test, type Page } from '@playwright/test';
import type { AgentRun } from '../../src/shared/agents';
import { launchDemo, shot } from './helpers';

async function visit(page: Page, link: string) {
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill(link);
  await page.keyboard.press('Enter');
}

test('expanded run records all three human verdicts and handles failure without changing selection', async () => {
  const { app, page } = await launchDemo();
  try {
    const source = await page.evaluate(async () => (await window.sb.invoke('chat:list', undefined)).find(c => c.id === 'fix')!);
    const run: AgentRun = { runId: 'r_123456789abc', chatId: source.id, agentId: 'scout', version: 7,
      goal: 'Verify UI', startedBy: 'orchestrator', startedAt: 1, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: 0, tokens: null };
    await app.evaluate(({ ipcMain, BrowserWindow }, { source, run }) => {
      let count = 0;
      const chat = { ...source, run, state: 'idle' as const, pending: 0 };
      ipcMain.removeHandler('run:outcome');
      ipcMain.handle('run:outcome', (_e, request: { chatId: string; verdict: 'success' | 'partial' | 'fail' }) => {
        if (request.chatId !== chat.id || !['success', 'partial', 'fail'].includes(request.verdict)) throw new Error('Invalid UI request');
        if (++count === 2) throw new Error('Simulated write failure');
        chat.run.outcome = { verdict: request.verdict, basis: 'human', at: 2, by: 'user' };
        return chat;
      });
      BrowserWindow.getAllWindows()[0]!.webContents.send('chat:updated', chat);
    }, { source, run });
    const tile = page.getByTestId('tile-chat-fix');
    await expect(tile.getByTestId('run-chips')).toContainText('v7');
    await expect(tile.getByTestId('run-chips')).toContainText('auto');
    const expand = page.getByTestId('chat-expand-fix');
    if (await expand.getAttribute('aria-expanded') !== 'true') await expand.click();
    const success = tile.getByTestId('run-outcome-success');
    await success.focus(); await page.keyboard.press('Enter');
    await expect(success).toHaveAttribute('aria-pressed', 'true');
    await tile.getByTestId('run-outcome-partial').click();
    await expect(tile.getByRole('alert')).toContainText('Esito non salvato');
    await expect(success).toHaveAttribute('aria-pressed', 'true');
    for (const verdict of ['partial', 'fail'] as const) {
      await tile.getByTestId(`run-outcome-${verdict}`).click();
      await expect(tile.getByTestId(`run-outcome-${verdict}`)).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(page.locator('[data-orchestrator-overlay]')).toBeVisible();
    await shot(page, 'run-outcome-human');
  } finally { await app.close(); }
});

test('Run on the role page confirms only a successful launch, respects reduced motion and opens Home', async () => {
  const { app, page } = await launchDemo();
  try {
    const catalog = await page.evaluate(() => window.sb.invoke('agents:list', undefined));
    const profile = catalog.profiles.find(p => p.id === 'scout')!;
    const source = await page.evaluate(async () => (await window.sb.invoke('chat:list', undefined)).find(c => c.id === 'fix')!);
    await app.evaluate(({ ipcMain, BrowserWindow }, { catalog, profile, source }) => {
      const ready = { ...catalog, profiles: [profile], problem: null, models: catalog.models.map(m => m.engine === profile.engine
        ? { ...m, enabled: true, trusted: true, installed: true, authenticated: true, defaultModel: true, effort: true, modelSelectable: true,
          models: profile.model ? [{ id: profile.model, name: profile.model }] : m.models } : m) };
      ipcMain.removeHandler('agents:list'); ipcMain.handle('agents:list', () => ready);
      BrowserWindow.getAllWindows()[0]!.webContents.send('agents:changed', ready);
      let attempt = 0;
      ipcMain.removeHandler('chat:create');
      ipcMain.handle('chat:create', (_e, request: { roleId: string; prompt: string; cwd: string }) => {
        if (request.roleId !== profile.id || request.prompt !== 'Verify catalog launch' || !request.cwd) throw new Error('Invalid launch request');
        if (++attempt === 1) throw new Error('Simulated launch failure');
        return { ...source, state: 'idle', title: request.prompt };
      });
    }, { catalog, profile, source });
    await visit(page, 'sb://agenti');
    const overview = page.getByTestId(`catalog-card-${profile.id}`);
    await expect(overview).toBeVisible();
    await expect(overview).toHaveCSS('animation-name', 'none');
    // the card has no Avvia (#81): the launch lives on the role's own page
    await expect(overview.getByTestId(`catalog-run-${profile.id}`)).toHaveCount(0);
    await visit(page, `sb://agenti/${profile.id}`);
    const card = page.getByTestId('agent-studio');
    await card.getByTestId(`catalog-run-${profile.id}`).click();
    await card.getByLabel('Obiettivo', { exact: true }).fill('Verify catalog launch');
    await card.getByLabel('Cartella', { exact: true }).fill(source.cwd);
    await card.locator('button[type=submit]').click();
    await expect(card.getByRole('alert')).toContainText('Avvio non riuscito');
    await card.locator('button[type=submit]').click();
    await expect(page.getByText('Avviata, la trovi nella Home', { exact: true })).toBeVisible();
    await expect(page.locator('[data-orchestrator-overlay]')).toBeVisible();
    await shot(page, 'catalog-run-confirmation');
    await page.getByRole('button', { name: 'Apri', exact: true }).click();
    await expect(page.getByTestId('tile-chat-fix')).toBeVisible();
  } finally { await app.close(); }
});

test('Battito appears only in matching role/search/file contexts and dismissal propagates', async () => {
  const { app, page } = await launchDemo();
  try {
    const info = await page.evaluate(() => window.sb.invoke('app:info', undefined));
    expect(info.brainRoot).toBeTruthy();
    await app.evaluate(({ ipcMain }, root) => {
      ipcMain.removeHandler('app:readFile');
      ipcMain.handle('app:readFile', () => ({ kind: 'text', path: `${root}/AGENTS.md`, size: 10, offset: 0, shown: 10, text: '# Rules', more: false, firstLine: 1 }));
    }, info.brainRoot);
    await visit(page, 'sb://agenti/scout');
    await expect(page.locator('[data-place="agent:scout"]')).toBeVisible();
    await expect(page.locator('[data-orchestrator-overlay]')).toBeVisible();
    await shot(page, 'agent-context-pulse');
    await visit(page, 'sb://esplora/AGENTS.md');
    await expect(page.locator('[data-place="file:AGENTS.md"]')).toBeVisible();
    await expect(page.locator('[data-orchestrator-overlay]')).toBeVisible();
    await shot(page, 'file-context-pulse');
    await page.keyboard.press('Control+K');
    await page.getByTestId('palette-input').fill('zzzznoresultszzzz');
    const pulse = page.locator('[data-place="search"]');
    await expect(pulse).toBeVisible();
    await expect(pulse.locator('article')).toHaveCount(1);
    await shot(page, 'search-context-pulse');
    await pulse.getByRole('button', { name: 'Non mi serve' }).click();
    await expect(pulse).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('context-pulse')).toHaveCount(0);
  } finally { await app.close(); }
});
