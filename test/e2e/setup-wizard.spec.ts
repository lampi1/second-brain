// End-to-end: the first-run setup wizard (components/FirstInterview.tsx) on a temporary fixture brain (SB_BRAIN, never
// the user's) rendered from the real me.md template with the default brain's placeholders: seven steps in one modal, the
// answers land in me.md on confirm (name, role, work areas, reply style; the chat language already known is prefilled),
// the connectors sit in the tools step and no separate connectors modal follows. Screenshot: test-results/shots/setup-wizard-*.png.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, shot } from './helpers';
import { REPLY_PRESETS } from '../../src/shared/profile';

const VALUES: Record<string, string> = { OWNER: 'Tu', ROLE: 'Da conoscere insieme', LANG: 'italiano', TODAY: '2026-10-17', SHELL: 'PowerShell', BRAIN_NAME: 'memory', OS: 'Windows', REPOS_WIN: 'C:/r', BRAIN_WIN: 'C:/b', HARNESSES: 'Claude Code' };
const ME = fs.readFileSync(path.resolve('brain-template/me.template.md'), 'utf8').replace(/\{\{([A-Z_]+)\}\}/g, (_, k: string) => VALUES[k]!);

test('setup wizard: seven steps, answers written into me.md on confirm', async () => {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-wizard-'));
  fs.writeFileSync(path.join(brain, 'me.md'), ME);
  const { app, page } = await launch({ SB_BRAIN: brain });
  try {
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    await page.getByRole('button', { name: 'Configura il mio lavoro', exact: true }).click();
    const setup = page.getByTestId('first-interview');
    const next = () => setup.getByRole('button', { name: 'Continua', exact: true }).click();
    await expect(setup.getByText('Passo 1 di 7')).toBeVisible();
    await next(); await next();
    await expect(setup.getByTestId('app-connectors')).toBeVisible();
    await next();
    await expect(setup.getByText('Passo 4 di 7')).toBeVisible();
    await expect(setup.getByTestId('setup-language')).toHaveValue('italiano');
    await expect(setup.getByTestId('setup-role')).toHaveValue('');
    await setup.getByTestId('setup-name').fill('Giulia');
    await setup.getByTestId('setup-role').fill('product manager');
    await shot(page, 'setup-wizard-who');
    await next();
    await setup.getByTestId('setup-areas').fill('Checkout\nApp mobile');
    await setup.getByTestId('setup-style').click();
    await page.locator('.ui-select-list [data-value="concise"]').click();
    await shot(page, 'setup-wizard-how');
    await next(); await next();
    await expect(setup).toContainText('Giulia');
    await expect(setup).toContainText('Checkout, App mobile');
    await page.getByTestId('setup-complete').click();
    await expect(setup).not.toBeVisible();
    await expect(page.getByTestId('connector-setup')).toHaveCount(0);
    const saved = fs.readFileSync(path.join(brain, 'me.md'), 'utf8');
    expect(saved).toMatch(/^# Giulia\n/);
    expect(saved).toContain('Giulia, product manager. Language: italiano in chat');
    expect(saved).toContain('- **Main work**:\n  - Checkout\n  - App mobile\n');
    expect(saved).toContain(`- **Reply style**: ${REPLY_PRESETS.concise}\n`);
    expect(saved).toContain('## How to work with Giulia');
    // a later edit (Settings, the brain-edit skill) survives running the interview again: the old answers are not re-written
    fs.writeFileSync(path.join(brain, 'me.md'), saved.replace('Giulia, product manager.', 'Giulia, team lead.'));
    await page.getByRole('button', { name: 'Configura il mio lavoro', exact: true }).click();
    for (let step = 0; step < 3; step++) await next();
    await expect(setup.getByTestId('setup-known-name')).toContainText('Giulia');
    await expect(setup.getByTestId('setup-role')).toHaveValue('team lead');
    for (let step = 3; step < 6; step++) await next();
    await page.getByTestId('setup-complete').click();
    await expect(setup).not.toBeVisible();
    expect(fs.readFileSync(path.join(brain, 'me.md'), 'utf8')).toBe(saved.replace('Giulia, product manager.', 'Giulia, team lead.'));
  } finally {
    await app.close();
    fs.rmSync(brain, { recursive: true, force: true });
  }
});
