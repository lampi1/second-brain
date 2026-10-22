// The loop's tier suggestions and the role trials they open are cards of Memoria → Proposte (ADR 0083, ADR 0123): the
// suggestions wait there with the sidebar count and survive a reload; Rifiuta sets one aside and changes no role; Approva
// opens a trial version on that tier, which comes back as a «già applicata» card: Annulla rolls it back. The Agenti page
// only points to the deck. Hidden window (helpers.launchDemo).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

const roles = (page: Page) => page.evaluate(() => window.sb.invoke('agents:list', undefined)).then(l => l.profiles);
const tiers = (page: Page) => page.evaluate(() => window.sb.invoke('proposals:list', undefined)).then(s => s.items.filter(c => c.source === 'tier'));

test('tier suggestions and their trials are decided in the Proposte deck', async () => {
  test.setTimeout(90_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-approvals-e2e-'));
  fs.writeFileSync(path.join(userData, 'agent-lifecycle.json'), JSON.stringify({ version: 1, lastDay: '', trials: [], proposals: [{
    key: 'tier:scout:top:[]', kind: 'tier', tier: 'top', skills: [], agentIds: ['scout'], reason: 'Le ricerche ripetute falliscono una volta su tre al livello medio', evidence: [{ kind: 'run', ref: 'r_000000000001', at: Date.now() - 86_400_000 }], at: Date.now() - 7_200_000, state: 'pending',
  }, {
    key: 'tier:artisan:light:[]', kind: 'tier', tier: 'light', skills: [], agentIds: ['artisan'], reason: 'Stessi esiti a un terzo del costo', evidence: [], at: Date.now() - 600_000, state: 'pending',
  }] }));
  const { app, page } = await launchDemo({ userData });
  try {
    expect((await tiers(page)).map(c => c.id)).toEqual(['tier:tier:artisan:light:[]', 'tier:tier:scout:top:[]']);
    // the Agenti page has no decision buttons: a line points to the deck; the suggestions survive a reload
    await page.getByTestId('nav-agenti').click();
    await expect(page.getByTestId('proposals-pointer')).toBeVisible();
    await page.reload();
    expect(await tiers(page)).toHaveLength(2);
    await page.getByTestId('nav-agenti').click();
    await page.getByTestId('proposals-pointer-open').click();
    await expect(page.getByTestId('proposals-deck')).toBeVisible();
    await page.getByTestId('pd-chip-role').click();
    await expect(page.getByTestId('pd-chip-role')).toContainText('2');
    const top = page.getByTestId('pd-card-top');
    await expect(top).toHaveAttribute('data-card', 'tier:tier:artisan:light:[]');
    await expect(top).toContainText('Stessi esiti a un terzo del costo');
    await shot(page, 'agent-approvals-deck');
    const before = await roles(page);

    // Rifiuta sets the artisan suggestion aside; Approva on Scout's opens its trial (the next decision sends the first)
    await page.getByTestId('pd-reject').click();
    await expect(top).toHaveAttribute('data-card', 'tier:tier:scout:top:[]');
    await page.getByTestId('pd-approve').click();
    await expect.poll(async () => ((await roles(page)).find(p => p.id === 'scout')?.trial ? 'trial' : 'none'), { timeout: 15_000 }).toBe('trial');
    const opened = (await roles(page)).find(p => p.id === 'scout')!;
    expect(opened.tier).toBe('top');
    expect((await roles(page)).find(p => p.id === 'artisan')).toEqual(before.find(p => p.id === 'artisan'));
    expect(await tiers(page)).toHaveLength(0);

    // the trial is a «già applicata» card: Annulla goes back to the baseline
    await expect(top).toHaveAttribute('data-card', /^trial:/);
    await expect(top).toHaveAttribute('data-applied', 'true');
    await page.getByTestId('pd-reject').click();
    await expect.poll(async () => ((await roles(page)).find(p => p.id === 'scout')?.trial ? 'trial' : 'none'), { timeout: 15_000 }).toBe('none');
    expect((await roles(page)).find(p => p.id === 'scout')).toMatchObject({ tier: 'mid', activeVersion: opened.trial!.baseline });
  } finally { await app.close(); }
});
