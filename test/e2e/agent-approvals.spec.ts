// Main-only acceptance for the "Da approvare" inbox on the Agenti page: seeded pending changes (an Orchestrator
// suggestion, a learned rule, a lifecycle suggestion) appear in one place with a sidebar count; each decision asks for
// a confirmation, applies through its channel, and an approval can be undone. Hidden window (helpers.launchDemo).
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
  fs.writeFileSync(path.join(userData, 'agent-learn-proposals.json'), JSON.stringify({ version: 1, proposals: [{
    id: '0123456789abcdef', agentId: 'default-general', rule: 'Cita sempre il file e la riga che hai letto.', evidence: 'Due correzioni sulle citazioni', createdAt: Date.now() - 3_600_000, status: 'pending',
  }] }));
  fs.writeFileSync(path.join(userData, 'agent-lifecycle.json'), JSON.stringify({ version: 1, pendingRuns: [], lastDay: '', trials: [], proposals: [{
    key: 'work:fixture', kind: 'create', agentIds: [], reason: 'Tre revisioni ripetute', evidence: [{ kind: 'run', ref: 'r_000000000001', at: Date.now() - 86_400_000 }], at: Date.now() - 7_200_000, state: 'pending',
  }] }));
  const { app, page } = await launchDemo({ userData });
  try {
    await expect(page.getByTestId('nav-badge-approvals')).toHaveText('3');
    await page.getByTestId('nav-agenti').click();
    const inbox = page.getByTestId('agent-approvals');
    await expect(inbox.getByTestId('approval-card')).toHaveCount(3);
    await expect(inbox).toContainText('Verificatore fonti');
    await expect(inbox).toContainText('Cita sempre il file e la riga che hai letto.');
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

    // discarding the learned rule leaves the agent as it was
    const before = list.profiles.find(p => p.id === 'default-general');
    const rule = inbox.getByTestId('approval-card').filter({ hasText: 'Cita sempre' });
    await rule.getByRole('button', { name: 'Scarta', exact: true }).click();
    await rule.getByRole('button', { name: 'Conferma: Scarta' }).click();
    await expect(inbox.getByTestId('approval-card')).toHaveCount(1);
    list = await page.evaluate(() => window.sb.invoke('agents:list', undefined));
    expect(list.profiles.find(p => p.id === 'default-general')).toEqual(before);

    // a lifecycle suggestion is prepared in the editor; opening it changes nothing
    await inbox.getByRole('button', { name: 'Prepara nell’editor', exact: true }).click();
    await expect(page.getByTestId('agent-studio')).toBeVisible();
    expect((await page.evaluate(() => window.sb.invoke('agents:list', undefined))).profiles).toEqual(list.profiles);
  } finally { await app.close(); }
});
