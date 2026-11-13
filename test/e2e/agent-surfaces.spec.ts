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

test('a role\'s page starts nothing: work starts only from the Orchestrator\'s column (ADR 0083)', async () => {
  const { app, page } = await launchDemo();
  try {
    await visit(page, 'sb://agenti');
    await expect(page.getByTestId('catalog-card-scout')).toBeVisible();
    await expect(page.locator('[data-testid^="catalog-run-"]')).toHaveCount(0);
    await visit(page, 'sb://agenti/scout');
    await expect(page.getByTestId('agent-studio')).toBeVisible();
    await expect(page.locator('[data-testid^="catalog-run-"]')).toHaveCount(0);
    await expect(page.locator('[data-orchestrator-overlay]')).toBeVisible();
  } finally { await app.close(); }
});

