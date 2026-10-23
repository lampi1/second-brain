// Visual regression spec for the persistent cockpit and its versioned decisions. Runs on main only, never on branches.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workflows } from '../../src/main/workflows/service';
import { launchDemo, shot } from './helpers';
test('the work thread stays visible after a no and exposes a fresh recap', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cockpit-'));
  const work = new Workflows(path.join(userData, 'work-threads.json'));
  const row = work.create({ title: 'Search accessibility', profile: 'feature', priority: 'support', chatIds: [] });
  work.report({ id: row.id, expectedVersion: row.version, action: 'propose', summary: 'Add keyboard navigation to the search results' });
  const { app, page } = await launchDemo({ userData, orchestrator: true });
  try {
    await expect(page.getByTestId('work-cockpit')).toBeVisible();
    await expect(page.getByTestId('work-recap')).toBeVisible();
    await expect(page.getByTestId('work-thread')).toContainText('Search accessibility');
    await shot(page, 'work-cockpit-proposal');
    await page.getByRole('button', { name: 'No, proponi altro', exact: true }).click();
    await expect(page.getByTestId('work-thread')).toContainText('Bloccato');
    await expect(page.getByRole('button', { name: 'Sì, procedi', exact: true })).toHaveCount(0);
    await shot(page, 'work-cockpit-rejected');
  } finally { await app.close(); }
});
