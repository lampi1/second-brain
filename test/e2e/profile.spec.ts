// End-to-end: Settings → Il mio profilo (components/ProfileSettings.tsx) on a temporary fixture brain (SB_BRAIN, never
// the user's): the me.md fields as the agents read them, the growth notes (rules, journal days), an edit saved through
// 'profile:save' that changes only the managed lines of me.md, and a concurrent edit that is refused with the user's
// draft kept. Screenshot: test-results/shots/profile-settings.png.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, shot } from './helpers';

const ME = ['# Giulia', '', '## Who', '', 'Giulia, product manager. Language: italiano in chat; code, commits and PR texts in English.', '',
  '- **Main work**: (one line per area; the agents learn the rest from `now.md` and the journal)', '', '## How to work with Giulia', '',
  '- **Reply style**: first line = the answer.', '- **Name things, not numbers**: say what a ticket is.', '', '## Machine', '', '- Windows.', ''].join('\n');

test('Il mio profilo: shows me.md, saves only the managed lines, refuses a concurrent edit', async () => {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-profile-'));
  fs.writeFileSync(path.join(brain, 'me.md'), ME);
  fs.mkdirSync(path.join(brain, 'journal'));
  fs.writeFileSync(path.join(brain, 'journal', '2026-10-16.md'), '# 2026-10-16\n');
  const { app, page } = await launch({ SB_BRAIN: brain });
  try {
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    const p = page.getByTestId('profile-settings');
    await expect(p).toContainText('Giulia');
    await expect(p).toContainText('product manager');
    await expect(p).toContainText('Ancora da indicare');
    await expect(p).toContainText('2 regole su come lavorare con te');
    await expect(p.getByTestId('profile-growth')).toContainText('Diario: 1 giorno');
    await shot(page, 'profile-settings');

    await p.getByTestId('profile-edit').click();
    await p.getByTestId('profile-mainWork').fill('Checkout\nApp mobile');
    await p.getByTestId('profile-replyStyle').fill('Breve, la decisione per prima.');
    await p.getByTestId('profile-save').click();
    await expect(p.getByTestId('profile-edit')).toBeVisible();
    await expect(p).toContainText('App mobile');
    const saved = fs.readFileSync(path.join(brain, 'me.md'), 'utf8');
    expect(saved).toContain('- **Main work**:\n  - Checkout\n  - App mobile\n');
    expect(saved).toContain('- **Reply style**: Breve, la decisione per prima.\n- **Name things, not numbers**');
    expect(saved.endsWith('## Machine\n\n- Windows.\n')).toBe(true);

    // a chat with the brain-edit skill adds a rule while the form is open: the save is refused, the draft stays, the next save lands
    await p.getByTestId('profile-edit').click();
    await p.getByTestId('profile-role').fill('head of product');
    fs.appendFileSync(path.join(brain, 'me.md'), '- **New rule**: added meanwhile\n');
    await p.getByTestId('profile-save').click();
    await expect(p.getByRole('alert')).toContainText('me.md è cambiato nel frattempo');
    await expect(p.getByTestId('profile-role')).toHaveValue('head of product');
    await p.getByTestId('profile-save').click();
    await expect(p).toContainText('head of product');
    const after = fs.readFileSync(path.join(brain, 'me.md'), 'utf8');
    expect(after).toContain('Giulia, head of product. Language: italiano');
    expect(after).toContain('- **New rule**: added meanwhile');
  } finally {
    await app.close();
    fs.rmSync(brain, { recursive: true, force: true });
  }
});
