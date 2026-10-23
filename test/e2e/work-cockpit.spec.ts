// Agent-only Home and durable modal decisions: authored here, never run without the owner's authorization.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workflows } from '../../src/main/workflows/service';
import { launchDemo, shot } from './helpers';
test('Home contains agents, while a durable proposal is deferred and answered in the shared modal', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-decisions-'));
  const work = new Workflows(path.join(userData, 'work-threads.json'));
  const row = work.create({ title: 'Search accessibility', profile: 'feature', priority: 'support', chatIds: [] });
  work.report({ id: row.id, expectedVersion: row.version, action: 'propose', summary: 'Add keyboard navigation to the search results' });
  const { app, page } = await launchDemo({ userData, orchestrator: true });
  try {
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('work-cockpit')).toHaveCount(0);
    await expect(page.getByTestId('work-routine')).toHaveCount(0);
    await expect(page.getByTestId('work-recap')).toBeVisible();
    const proposal = page.getByTestId('qwin-work');
    // Existing native requests keep their order; the rail allows choosing this durable proposal explicitly.
    const pick = page.getByTestId('qwin-pick').filter({ hasText: 'Search accessibility' });
    if (await pick.count()) await pick.click();
    await expect(proposal).toContainText('Add keyboard navigation');
    await expect(proposal.getByRole('button', { name: 'Altro…', exact: true })).toBeVisible();
    await shot(page, 'work-modal-proposal');
    await page.getByTestId('qwin-later').click();
    await expect(proposal).toHaveCount(0);
    // app_unblock uses this same command; postponed workflow decisions return without opening a chat.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send('ui:command', { action: 'unblock' }));
    const again = page.getByTestId('qwin-pick').filter({ hasText: 'Search accessibility' });
    if (await again.count()) await again.click();
    await expect(proposal).toBeVisible();
    await proposal.getByRole('button', { name: 'Altro…', exact: true }).click();
    await proposal.getByRole('textbox', { name: 'La tua risposta' }).fill('Limit the change to search results only.');
    await proposal.getByRole('button', { name: 'Invia risposta', exact: true }).click();
    await expect(proposal).toHaveCount(0);
    const saved = new Workflows(path.join(userData, 'work-threads.json')).list()[0]!;
    expect(saved.status).toBe('blocked');
    expect(saved.events.at(-1)?.text).toContain('Limit the change to search results only.');
    expect(saved.approvedProposal).toBeUndefined();
    await expect(page.getByTestId('work-cockpit')).toHaveCount(0);
    await shot(page, 'work-modal-feedback');
  } finally { await app.close(); }
});
