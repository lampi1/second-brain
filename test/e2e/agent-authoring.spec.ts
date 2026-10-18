// Main-only acceptance: a stored suggestion remains a draft until the user's explicit panel decision.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchDemo, openAgents, shot } from './helpers';

test('review an automatic suggestion and create it only from the decision panel', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-authoring-e2e-'));
  fs.writeFileSync(path.join(userData, 'agent-authoring.json'), JSON.stringify({ version: 1, used: [], feedback: [], proposals: [{
    id: 'suggestion-one', at: Date.now(), kind: 'suggestion', state: 'pending', reason: 'Organizzare le fonti', expectedEffect: 'Meno domande sulle fonti', evidence: [],
    draft: { name: 'Lettore proposto', purpose: 'Verificare fonti', instructions: 'Riporta fonti verificabili.', engine: 'claude', model: null, avatar: { kind: 'symbol', value: 'eye' }, tools: { allow: ['read'] }, permissionCeiling: 'default' },
  }] }));
  const { app, page } = await launchDemo({ userData });
  try {
    await openAgents(page);
    const panel = page.getByRole('region', { name: 'Proposte Agenti', exact: true });
    await expect(panel.getByText('Lettore proposto', { exact: true })).toBeVisible();
    await panel.getByText('Confronta definizioni', { exact: true }).click();
    await expect(panel).toContainText('Riporta fonti verificabili.');
    await shot(page, 'agent-suggestion-review');
    await panel.getByRole('button', { name: 'Crea Agente', exact: true }).click();
    await expect(panel.getByText('Lettore proposto', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('agent-studio').getByRole('heading', { name: 'Lettore proposto', exact: true })).toBeVisible();
    await shot(page, 'agent-suggestion-accepted');
  } finally { await app.close(); }
});
