// Main-only acceptance for selectable role identity, persistent tones and non-blocking duplicate warnings.
import { expect, test } from '@playwright/test';
import { launchDemo, openAgents, shot } from './helpers';

test('role glyphs and tones survive save and warn about exact duplicates', async () => {
  const { app, page } = await launchDemo();
  try {
    await openAgents(page);
    const studio = page.getByTestId('agent-studio');
    await studio.getByRole('button', { name: 'Crea agente', exact: true }).click();
    await page.getByTestId('agent-name').fill('Glyph test');
    await page.getByTestId('agent-purpose').fill('Verify a distinct role identity');
    await studio.getByRole('button', { name: 'Icona dell’agente Implementatore', exact: true }).click();
    await studio.getByRole('button', { name: 'Verde acqua', exact: true }).click();
    await page.getByTestId('agent-save').click();
    const card = studio.locator('article').filter({ has: page.getByRole('heading', { name: 'Glyph test', exact: true }) });
    await expect(card.locator('[data-tone=teal] [data-glyph=role-implementer]')).toHaveCount(1);
    await expect(page.getByTestId('agent-avatar-duplicate')).toHaveCount(0);
    await studio.getByRole('button', { name: 'Crea agente', exact: true }).click();
    await studio.getByRole('button', { name: 'Icona dell’agente Implementatore', exact: true }).click();
    await studio.getByRole('button', { name: 'Verde acqua', exact: true }).click();
    await expect(page.getByTestId('agent-avatar-duplicate')).toContainText('Glyph test');
    await shot(page, 'agent-glyph-duplicate');
    await studio.getByRole('button', { name: 'Ambra', exact: true }).click();
    await expect(page.getByTestId('agent-avatar-duplicate')).toHaveCount(0);
    await page.getByTestId('nav-devops').click();
    await openAgents(page);
    await expect(studio.getByRole('button', { name: 'Ambra', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await shot(page, 'agent-glyph-picker');
  } finally { await app.close(); }
});
