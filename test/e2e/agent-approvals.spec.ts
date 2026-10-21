// Acceptance for the "Da approvare" inbox on the Agenti page (ADR 0083): the loop's tier suggestions wait there with a
// sidebar count; each decision asks for a confirmation first; approving opens a trial version of the role on that tier,
// which the user then keeps or rolls back; Ignora sets a suggestion aside and changes no role. Role text and skills never
// wait here. The demo's Battito proposal (ADR 0102, pulse/demo.ts) waits in the same inbox and stays there untouched.
// Hidden window (helpers.launchDemo).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('tier suggestions gather in Da approvare, open a trial only after confirmation, and the trial is decided there', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-approvals-e2e-'));
  fs.writeFileSync(path.join(userData, 'agent-lifecycle.json'), JSON.stringify({ version: 1, lastDay: '', trials: [], proposals: [{
    key: 'tier:scout:top:[]', kind: 'tier', tier: 'top', skills: [], agentIds: ['scout'], reason: 'Le ricerche ripetute falliscono una volta su tre al livello medio', evidence: [{ kind: 'run', ref: 'r_000000000001', at: Date.now() - 86_400_000 }], at: Date.now() - 7_200_000, state: 'pending',
  }, {
    key: 'tier:artisan:light:[]', kind: 'tier', tier: 'light', skills: [], agentIds: ['artisan'], reason: 'Stessi esiti a un terzo del costo', evidence: [], at: Date.now() - 600_000, state: 'pending',
  }] }));
  const { app, page } = await launchDemo({ userData });
  try {
    // the two tier suggestions plus the demo Battito's learned rule
    await expect(page.getByTestId('nav-badge-approvals')).toHaveText('3');
    await page.getByTestId('nav-agenti').click();
    const inbox = page.getByTestId('agent-approvals');
    await expect(inbox.getByTestId('approval-card')).toHaveCount(3);
    await expect(inbox.locator('[data-testid="approval-card"][data-type="lifecycle"]')).toHaveCount(2);
    await shot(page, 'agent-approvals-inbox');

    // a decision asks first; Escape steps back without deciding
    const scout = inbox.getByTestId('approval-card').filter({ hasText: 'livello medio' });
    await scout.getByRole('button', { name: 'Avvia la prova', exact: true }).click();
    await expect(scout.getByRole('group', { name: 'Conferma la decisione' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(scout.getByRole('group', { name: 'Conferma la decisione' })).toHaveCount(0);
    await scout.getByRole('button', { name: 'Avvia la prova', exact: true }).click();
    await expect(scout.getByRole('button', { name: 'Conferma: Avvia la prova' })).toBeFocused();
    await shot(page, 'agent-approvals-confirm');
    await page.keyboard.press('Enter');
    await expect(inbox.getByRole('status')).toContainText('Scout: versione in prova avviata.');
    let list = await page.evaluate(() => window.sb.invoke('agents:list', undefined));
    const opened = list.profiles.find(p => p.id === 'scout')!;
    expect(opened.tier).toBe('top'); expect(opened.trial).toBeTruthy();
    const base = opened.trial!.baseline;

    // the trial is now its own card: keep it or go back
    const trial = inbox.locator('[data-testid="approval-card"][data-type="trial"]');
    await expect(trial).toHaveCount(1);
    await expect(trial).toContainText('Versione in prova');
    await trial.getByRole('button', { name: `Torna a v${base}`, exact: true }).click();
    await trial.getByRole('button', { name: `Conferma: Torna a v${base}` }).click();
    await expect(inbox.getByRole('status')).toContainText('Scout: tornato alla versione di riferimento.');
    list = await page.evaluate(() => window.sb.invoke('agents:list', undefined));
    expect(list.profiles.find(p => p.id === 'scout')).toMatchObject({ tier: 'mid', activeVersion: base });
    expect(list.profiles.find(p => p.id === 'scout')!.trial).toBeUndefined();
    await shot(page, 'agent-approvals-done');

    // Ignora sets a suggestion aside: it leaves the queue and nothing on the role changes
    const artisan = inbox.getByTestId('approval-card').filter({ hasText: 'Stessi esiti a un terzo del costo' });
    await artisan.getByRole('button', { name: 'Ignora', exact: true }).click();
    await expect(artisan.getByRole('group', { name: 'Conferma la decisione' })).toContainText('14 giorni');
    await shot(page, 'agent-approvals-dismiss');
    await artisan.getByRole('button', { name: 'Conferma: Ignora' }).click();
    // only the Battito's proposal is left: it is not a role change and none of these decisions touched it
    await expect(inbox.getByTestId('approval-card')).toHaveCount(1);
    await expect(inbox.getByTestId('approval-card')).toHaveAttribute('data-type', 'pulse');
    await expect(page.getByTestId('nav-badge-approvals')).toHaveText('1');
    expect((await page.evaluate(() => window.sb.invoke('agents:list', undefined))).profiles).toEqual(list.profiles);
  } finally { await app.close(); }
});
