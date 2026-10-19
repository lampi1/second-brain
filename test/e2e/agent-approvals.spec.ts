// Main-only acceptance for the "Da approvare" inbox on the Agenti page: seeded pending changes (an Orchestrator
// suggestion, two lifecycle suggestions; lessons are applied by the maintenance, never asked here, ADR 0077) appear in one place with a sidebar count; each decision asks
// for a confirmation, applies through its channel, an approval can be undone and a suggestion can be set aside. Hidden window (helpers.launchDemo).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('pending agent changes gather in Da approvare and are decided only after confirmation', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-approvals-e2e-'));
  fs.writeFileSync(path.join(userData, 'agent-authoring.json'), JSON.stringify({ version: 1, used: [], feedback: [], proposals: [{
    id: 'suggestion-approve', at: Date.now(), kind: 'suggestion', state: 'pending', reason: 'Tre richieste di verifica delle fonti questa settimana', expectedEffect: 'Meno domande sulle fonti',
    evidence: [{ kind: 'run', ref: 'r_000000000007', at: 1 }],
    draft: { name: 'Verificatore fonti', purpose: 'Verificare fonti', instructions: 'Riporta fonti verificabili.\nSegnala quelle dubbie.', engine: 'claude', model: null, avatar: { kind: 'symbol', value: 'eye' }, tools: { allow: ['read'] }, permissionCeiling: 'default' },
  }] }));
  fs.writeFileSync(path.join(userData, 'agent-lifecycle.json'), JSON.stringify({ version: 1, pendingRuns: [], lastDay: '', trials: [], proposals: [{
    key: 'work:fixture', kind: 'create', agentIds: [], reason: 'Tre revisioni ripetute', evidence: [{ kind: 'run', ref: 'r_000000000001', at: Date.now() - 86_400_000 }], at: Date.now() - 7_200_000, state: 'pending',
  }, {
    key: 'model:default-general:haiku', kind: 'model-trial', model: 'haiku', agentIds: ['default-general'], reason: 'Stessi esiti a un terzo del costo', evidence: [], at: Date.now() - 600_000, state: 'pending',
  }] }));
  const { app, page } = await launchDemo({ userData });
  try {
    await expect(page.getByTestId('nav-badge-approvals')).toHaveText('3');
    await page.getByTestId('nav-agenti').click();
    const inbox = page.getByTestId('agent-approvals');
    await expect(inbox.getByTestId('approval-card')).toHaveCount(3);
    await expect(inbox).toContainText('Verificatore fonti');
    await expect(inbox).toContainText('Tre revisioni ripetute');
    await shot(page, 'agent-approvals-inbox');

    // a decision asks first; Escape steps back without deciding
    const suggestion = inbox.getByTestId('approval-card').filter({ hasText: 'Verificatore fonti' });
    await suggestion.getByRole('button', { name: 'Crea l’agente', exact: true }).click();
    await expect(suggestion.getByRole('group', { name: 'Conferma la decisione' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(suggestion.getByRole('group', { name: 'Conferma la decisione' })).toHaveCount(0);
    await suggestion.getByRole('button', { name: 'Crea l’agente', exact: true }).click();
    await expect(suggestion.getByRole('button', { name: 'Conferma: Crea l’agente' })).toBeFocused();
    await shot(page, 'agent-approvals-confirm');
    await page.keyboard.press('Enter');
    await expect(inbox.getByRole('status')).toContainText('Verificatore fonti: modifica applicata.');
    await expect(inbox.getByTestId('approval-card')).toHaveCount(2);
    let list = await page.evaluate(() => window.sb.invoke('agents:list', undefined));
    expect(list.profiles.some(p => p.name === 'Verificatore fonti')).toBe(true);
    await shot(page, 'agent-approvals-done');

    // Annulla takes the new agent back out of the catalog
    await inbox.getByRole('button', { name: 'Annulla', exact: true }).click();
    await expect(inbox.getByRole('status')).toContainText('Decisione annullata.');
    list = await page.evaluate(() => window.sb.invoke('agents:list', undefined));
    expect(list.profiles.some(p => p.name === 'Verificatore fonti')).toBe(false);

    // Ignora sets a suggestion aside: it leaves the queue and nothing on the agent changes
    const trial = inbox.getByTestId('approval-card').filter({ hasText: 'Stessi esiti a un terzo del costo' });
    await trial.getByRole('button', { name: 'Ignora', exact: true }).click();
    await expect(trial.getByRole('group', { name: 'Conferma la decisione' })).toContainText('14 giorni');
    await shot(page, 'agent-approvals-dismiss');
    await trial.getByRole('button', { name: 'Conferma: Ignora' }).click();
    await expect(inbox.getByTestId('approval-card')).toHaveCount(1);
    await expect(page.getByTestId('nav-badge-approvals')).toHaveText('1');
    const queue = await page.evaluate(() => window.sb.invoke('brain:api', { path: '/api/agents/lifecycle' }));
    expect(JSON.stringify(queue)).not.toContain('model:default-general:haiku');
    expect((await page.evaluate(() => window.sb.invoke('agents:list', undefined))).profiles).toEqual(list.profiles);

    // a lifecycle suggestion is prepared in the editor; opening it changes nothing
    await inbox.getByRole('button', { name: 'Prepara nell’editor', exact: true }).click();
    await expect(page.getByTestId('agent-studio')).toBeVisible();
    expect((await page.evaluate(() => window.sb.invoke('agents:list', undefined))).profiles).toEqual(list.profiles);
  } finally { await app.close(); }
});
