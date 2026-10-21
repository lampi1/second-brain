// Main-only acceptance: automatic agent suggestions are retired with the fixed roles (ADR 0083, 0100; bb953da removed
// agent authoring and its "Proposte Agenti" panel). A suggestion stored by an older version (agent-authoring.json) is
// never shown, never offered for approval and never becomes an agent; the old file is left as it is on disk.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('a stored automatic suggestion from an older version is never shown nor turned into an agent', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-authoring-e2e-'));
  const file = path.join(userData, 'agent-authoring.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, used: [], feedback: [], proposals: [{
    id: 'suggestion-one', at: Date.now(), kind: 'suggestion', state: 'pending', reason: 'Organizzare le fonti', expectedEffect: 'Meno domande sulle fonti', evidence: [],
    draft: { name: 'Lettore proposto', purpose: 'Verificare fonti', instructions: 'Riporta fonti verificabili.', engine: 'claude', model: null, avatar: { kind: 'symbol', value: 'eye' }, tools: { allow: ['read'] }, permissionCeiling: 'default' },
  }] }));
  const stored = fs.readFileSync(file, 'utf8');
  const { app, page } = await launchDemo({ userData });
  try {
    await page.getByTestId('nav-agenti').click();
    await expect(page.getByTestId('agent-overview')).toBeVisible();
    await expect(page.getByTestId('agent-approvals')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Proposte Agenti', exact: true })).toHaveCount(0);
    await expect(page.getByText('Lettore proposto')).toHaveCount(0);
    await expect(page.getByTestId('agent-approvals')).not.toContainText('Organizzare le fonti');
    await shot(page, 'agent-suggestion-retired');
    const list = await page.evaluate(() => window.sb.invoke('agents:list', undefined));
    expect(list.profiles.map(p => p.name)).not.toContain('Lettore proposto');
    expect(fs.readFileSync(file, 'utf8')).toBe(stored);
  } finally { await app.close(); }
});
