// Main-only acceptance: packaged roles and customized update preview remain explicit, escaped and draft-only.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';
import { roleAgentPresets } from '../../src/shared/agent-presets';
import type { AgentProfile } from '../../src/shared/agents';

test('shows the ten presets and previews a customized upgrade without saving it', async () => {
  const first = await launchDemo();
  try {
    const catalog = await first.page.evaluate(() => window.sb.invoke('agents:list', undefined));
    for (const preset of roleAgentPresets()) expect(catalog.profiles.find(p => p.id === preset.id)?.model).toBeTruthy();
  } finally { await first.app.close(); }
  const file = path.join(first.userData, 'agents.v2.json');
  const body = JSON.parse(fs.readFileSync(file, 'utf8')) as { profiles: AgentProfile[] };
  const writer = body.profiles.find(p => p.id === 'default-writer')!;
  writer.origin = { kind: 'preset', presetId: writer.id, presetRevision: 0 };
  writer.userLocked = true;
  writer.instructions = '<script>My private writing style</script>';
  fs.writeFileSync(file, JSON.stringify(body));
  const second = await launchDemo({ userData: first.userData });
  try {
    await second.page.getByTestId('nav-home').click();
    await second.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await second.page.keyboard.press('g'); await second.page.keyboard.press('a');
    const card = second.page.getByTestId('catalog-card-default-writer');
    await card.getByRole('button', { name: 'Aggiornamento preset disponibile' }).click();
    const update = second.page.getByTestId('preset-update');
    await update.locator('summary').click();
    await expect(update).toContainText(writer.instructions);
    await expect(update.locator('script')).toHaveCount(0);
    await update.getByRole('button', { name: 'Usa aggiornamento nella bozza' }).click();
    const unchanged = await second.page.evaluate(() => window.sb.invoke('agents:list', undefined));
    expect(unchanged.profiles.find(p => p.id === 'default-writer')?.instructions).toBe(writer.instructions);
    await shot(second.page, 'role-preset-update-preview');
  } finally { await second.app.close(); }
});
