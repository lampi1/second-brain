// End-to-end: Settings → Aggiornamenti (components/AppUpdateSettings.tsx, ADR 0075) on the demo with a temp code folder
// (SB_IMPROVE_REPO) whose scripts/pull.mjs only prints: the card counts what GitHub has and lists it, "Aggiorna" asks
// once (no tests, chats resume, local work kept), then pulls and restarts the dev build on it (recorded, never real in
// tests). Screenshots: test-results/shots/settings-update-*.png.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { goPage, launchDemo, shot } from './helpers';

function fakeCodeFolder(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-update-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'scripts', 'pull.mjs'), "const c = process.argv.includes('--check'); console.log(JSON.stringify(c ? { ok: true, check: true, behind: 2, canUpdate: true, commits: ['a1b2c3d Agenti più chiari', 'e4f5a6b DevOps più pulito'], message: '2 aggiornamenti su GitHub.' } : { ok: true, upToDate: false, from: 'a1b2c3d', to: 'e4f5a6b', message: 'ok' }));\n");
  return dir;
}

test('Settings → Aggiornamenti: the GitHub count, one confirm, then the restart on the new version', async () => {
  const { app, page } = await launchDemo({ env: { SB_IMPROVE_REPO: fakeCodeFolder() } });
  try {
    await goPage(page, 'impostazioni');
    const card = page.getByTestId('st-update');
    await expect(card.getByTestId('st-update-status')).toContainText('2 aggiornamenti su GitHub.', { timeout: 15_000 });
    await expect(card.getByTestId('st-update-commits')).toContainText('Agenti più chiari');
    await shot(page, 'settings-update-available');

    await card.getByTestId('st-update-now').click();
    await expect(page.getByTestId('confirm-ok')).toHaveText(/Aggiorna e riavvia/);
    await expect(page.getByRole('dialog')).toContainText('Nessun test');
    await shot(page, 'settings-update-confirm');
    await page.getByTestId('confirm-ok').click();

    await expect(card.getByTestId('st-update-status')).toHaveAttribute('data-state', 'restarting', { timeout: 15_000 });
    await expect(card.getByTestId('st-update-now')).toBeDisabled();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __sbImprove: { restarts: number } }).__sbImprove.restarts), { timeout: 5000 }).toBe(1);
    await shot(page, 'settings-update-restarting');
  } finally { await app.close(); }
});
