// Main-only acceptance for the persisted lifecycle queue. Requires the real/demo lifecycle wiring at integration.
// The normal helper keeps Electron hidden; this branch writes the test but never launches it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('pending lifecycle evidence survives reload and opening its editor never applies it', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lifecycle-e2e-'));
  fs.writeFileSync(path.join(userData, 'agent-lifecycle.json'), JSON.stringify({ version: 1, pendingRuns: [], lastDay: '', trials: [], proposals: [{
    key: 'work:fixture', kind: 'create', agentIds: [], reason: 'Tre revisioni ripetute', evidence: [{ kind: 'run', ref: 'r_000000000001', at: 1 }], at: 1, state: 'pending',
  }] }));
  const { app, page } = await launchDemo({ userData });
  try {
    await page.getByTestId('nav-agenti').click();
    // the list page shows pending lifecycle suggestions in the Da approvare inbox (AgentApprovals.tsx)
    const panel = page.getByTestId('agent-approvals');
    await expect(panel).toContainText('Tre revisioni ripetute');
    await panel.getByText('Evidenze (1)', { exact: true }).click();
    await expect(panel).toContainText('r_000000000001');
    const before = await page.evaluate(() => window.sb.invoke('agents:list', undefined));
    await shot(page, 'agent-lifecycle-pending');
    await page.reload(); await page.getByTestId('nav-agenti').click();
    await page.getByTestId('agent-approvals').getByRole('button', { name: 'Prepara nell’editor' }).click();
    await expect(page.getByTestId('agent-studio')).toBeVisible();
    const after = await page.evaluate(() => window.sb.invoke('agents:list', undefined));
    expect(after.profiles).toEqual(before.profiles);
  } finally { await app.close(); }
});
