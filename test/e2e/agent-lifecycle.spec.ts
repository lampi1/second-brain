// Main-only acceptance for the persisted lifecycle queue (Da approvare, AgentApprovals.tsx): a pending suggestion and its
// evidence survive a reload, and reading it never applies it. Since the fixed roles (ADR 0083, 0100) the queue holds only
// tier suggestions: a retired "create an agent" entry from an older queue file is dropped on load, and the old
// "Prepara nell’editor" step is gone. Hidden window (helpers.launchDemo).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('pending lifecycle evidence survives reload and reading it never applies it', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lifecycle-e2e-'));
  fs.writeFileSync(path.join(userData, 'agent-lifecycle.json'), JSON.stringify({ version: 1, pendingRuns: [], lastDay: '', trials: [], proposals: [{
    key: 'tier:scout:top:[]', kind: 'tier', tier: 'top', skills: [], agentIds: ['scout'], reason: 'Tre revisioni ripetute', evidence: [{ kind: 'run', ref: 'r_000000000001', at: 1 }], at: 1, state: 'pending',
  }, {
    key: 'work:fixture', kind: 'create', agentIds: [], reason: 'Un agente nuovo per le revisioni', evidence: [], at: 1, state: 'pending',
  }] }));
  const { app, page } = await launchDemo({ userData });
  try {
    await page.getByTestId('nav-agenti').click();
    // the list page shows pending lifecycle suggestions in the Da approvare inbox
    const panel = page.getByTestId('agent-approvals');
    await expect(panel).toContainText('Tre revisioni ripetute');
    await expect(panel).not.toContainText('Un agente nuovo per le revisioni');
    await panel.getByText('Evidenze (1)', { exact: true }).click();
    await expect(panel).toContainText('r_000000000001');
    const before = await page.evaluate(() => window.sb.invoke('agents:list', undefined));
    await shot(page, 'agent-lifecycle-pending');
    await page.reload(); await page.getByTestId('nav-agenti').click();
    const again = page.getByTestId('agent-approvals');
    await expect(again).toContainText('Tre revisioni ripetute');
    await again.getByText('Evidenze (1)', { exact: true }).click();
    await expect(again).toContainText('r_000000000001');
    await expect(again.getByRole('button', { name: 'Prepara nell’editor' })).toHaveCount(0);
    const after = await page.evaluate(() => window.sb.invoke('agents:list', undefined));
    expect(after.profiles).toEqual(before.profiles);
    expect(after.profiles.find(p => p.id === 'scout')).toMatchObject({ tier: 'mid' });
    expect(after.profiles.find(p => p.id === 'scout')!.trial).toBeUndefined();
  } finally { await app.close(); }
});
