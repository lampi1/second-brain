// E2E of the user's own picture for a role (AgentImagePicker.tsx, owner 2026-10-20): on the Scout's page "Cambia
// immagine" takes a PNG, its centre square replaces the character on the page and on the Agenti cards, it survives a
// restart, and "Immagine predefinita" brings the character back. Screenshots: test-results/shots/agent-picture-*.png.
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { goPage, launchDemo, openAgents, shot, waitForExit } from './helpers';

/** a 480 × 320 PNG (wider than tall: the badge keeps its middle), drawn by the page itself */
const top = async (page: Page) => {
  await page.getByTestId('agent-studio').evaluate(el => { for (let e: Element | null = el; e; e = e.parentElement) e.scrollTop = 0; });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
};

const photo = (page: Page) => page.evaluate(async () => {
  const c = new OffscreenCanvas(480, 320), g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 480, 320); grad.addColorStop(0, '#ff7a59'); grad.addColorStop(1, '#3b5bdb');
  g.fillStyle = grad; g.fillRect(0, 0, 480, 320);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(240, 140, 70, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, 80, 320); g.fillRect(400, 0, 80, 320); // cut away by the crop
  return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())];
});

test('a role takes the user\'s own picture, keeps it across a restart, and "Immagine predefinita" brings the character back', async () => {
  test.setTimeout(90_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-picture-'));
  const first = await launchDemo({ userData, width: 1440, height: 1000 });
  try {
    await openAgents(first.page, 'scout');
    const hero = first.page.locator('.ad-hero');
    await expect(hero.locator('svg.agent-avatar.character')).toBeVisible();
    await expect(first.page.getByTestId('agent-picture-reset')).toHaveCount(0); // nothing to reset yet
    await first.page.getByTestId('agent-picture-input').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(await photo(first.page)) });
    const picture = hero.locator('img.agent-avatar.picture');
    await expect(picture).toBeVisible();
    expect(await picture.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(256);
    await expect(first.page.getByTestId('agent-picture-reset')).toBeVisible();
    await top(first.page);
    await shot(first.page, 'agent-picture-role-dark');
    // the same picture on the Agenti cards; the other roles keep their characters
    await goPage(first.page, 'agenti');
    const overview = first.page.getByTestId('agent-overview');
    await expect(overview.getByTestId('catalog-card-scout').locator('img.agent-avatar.picture').first()).toBeVisible();
    await expect(overview.getByTestId('catalog-card-artisan').locator('img.agent-avatar.picture')).toHaveCount(0);
    await shot(first.page, 'agent-picture-cards-dark');
  } finally { await first.app.close(); }

  const second = await launchDemo({ userData, width: 1440, height: 1000 });
  try {
    await second.page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await second.page.emulateMedia({ colorScheme: 'light' });
    await openAgents(second.page, 'scout');
    const hero = second.page.locator('.ad-hero');
    await expect(hero.locator('img.agent-avatar.picture')).toBeVisible();
    await top(second.page);
    await shot(second.page, 'agent-picture-role-light');
    await second.page.getByTestId('agent-picture-reset').click();
    await expect(hero.locator('svg.agent-avatar.character')).toBeVisible();
    await expect(hero.locator('img.agent-avatar.picture')).toHaveCount(0);
    await expect(second.page.getByTestId('agent-picture-reset')).toHaveCount(0);
  } finally { await second.app.close(); await waitForExit(userData); fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('a file that is not a picture is refused with a readable line', async () => {
  const { app, page } = await launchDemo();
  try {
    await openAgents(page, 'herald');
    await page.getByTestId('agent-picture-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('ciao') });
    await expect(page.getByTestId('agent-picture').getByRole('alert')).toContainText('PNG, JPG o WebP');
    await expect(page.locator('.ad-hero svg.agent-avatar.character')).toBeVisible();
  } finally { await app.close(); }
});
