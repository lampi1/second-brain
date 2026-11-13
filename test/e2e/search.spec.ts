// E2E of the Ctrl+K full-text search (ADR 0023) on the frozen demo with a temporary brain folder (SB_BRAIN, never the
// user's): one query shows the quick matches, then the groups "Nei messaggi", "Branch" and "Nel brain" with snippet,
// mark and date; Enter on a closed chat's message reopens it; Enter on a brain file opens it in Esplora.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchDemo, shot } from './helpers';

function brainDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-search-'));
  fs.mkdirSync(path.join(d, 'runbook'));
  fs.writeFileSync(path.join(d, 'me.md'), '# Note\n\nI rimborsi si provano sempre in ambiente di test, mai in produzione.\n');
  fs.writeFileSync(path.join(d, 'runbook', 'rimborsi.md'), '# Rimborsi\n\nSe il totale ignora lo sconto, controlla il ricalcolo.\n');
  return d;
}

test('Ctrl+K: messages, branches and brain files, grouped; Enter reopens a closed chat or opens the file', async () => {
  const { app, page } = await launchDemo({ env: { SB_BRAIN: brainDir() } });
  await page.evaluate(() => window.sb.invoke('chat:archive', { chatId: 'mappa' }));

  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('rimborsi');
  const list = page.locator('#palette-list');
  await expect(list.getByText('Nei messaggi', { exact: true })).toBeVisible();
  await expect(list.getByText('Branch', { exact: true })).toBeVisible();
  await expect(list.getByText('Nel brain', { exact: true })).toBeVisible();
  await expect(page.getByTestId('palette-item-found:chat:qa')).toContainText('test case dei rimborsi');
  await expect(page.getByTestId('palette-item-found:chat:qa').locator('mark')).toHaveText('rimborsi');
  await expect(page.getByTestId('palette-item-found:branch:fix/rimborsi-sconto:C:\\progetti\\alfa-e2e')).toContainText('QA · Rimborsi');
  await expect(page.getByTestId('palette-item-found:brain:me.md')).toContainText('riga 3');
  await expect(page.getByTestId('palette-item-found:brain:runbook/rimborsi.md')).toBeVisible();
  await page.getByTestId('palette-item-found:chat:qa').hover();
  await shot(page, 'search-1-groups');

  // a closed chat's message: Enter reopens it
  await page.getByTestId('palette-input').fill('porta la mappa');
  const hit = page.getByTestId('palette-item-found:chat:mappa');
  await expect(hit).toContainText('chiusa, Invio la riapre');
  await expect(hit.locator('mark')).toHaveText('Porta la mappa');
  await shot(page, 'search-2-closed');
  await hit.click();
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('chat:list', undefined))).find(c => c.id === 'mappa')?.closedAt ?? null).toBeNull();

  // a brain file: Enter opens it in Esplora
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('ricalcolo');
  await expect(page.getByTestId('palette-item-found:brain:runbook/rimborsi.md')).toBeVisible();
  await page.getByTestId('palette-input').press('ArrowDown');
  const active = page.locator('.palette-item.active');
  for (let i = 0; i < 20 && !(await active.getAttribute('data-testid'))?.startsWith('palette-item-found:brain:'); i++) await page.getByTestId('palette-input').press('ArrowDown');
  await expect(active).toHaveAttribute('data-testid', 'palette-item-found:brain:runbook/rimborsi.md');
  await page.getByTestId('palette-input').press('Enter');
  await expect(page.getByTestId('cited-file-viewer')).toBeVisible(); // the viewer overlay above the page
  await app.close();
});
