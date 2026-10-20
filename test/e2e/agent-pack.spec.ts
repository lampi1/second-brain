// Acceptance for the real pack IPC and review surfaces: a work role's pack exported and imported onto another built-in
// role as a trial, a stale editor draft never overwriting a newer role version, script review, guard findings.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchDemo, openAgents, shot } from './helpers';
import { emitPack } from '../../src/main/agents/pack/emit';
import { writeZip } from '../../src/main/agents/pack/zip';

test('exports a role pack and imports it onto another built-in role as a trial', async () => {
  const { app, page, userData } = await launchDemo();
  try {
    const destination = path.join(userData, 'roundtrip.sbagent');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
    }, destination);
    await openAgents(page, 'scout');
    await page.getByTestId('agent-studio').getByRole('button', { name: 'Esporta…', exact: true }).first().click();
    const dialog = page.getByTestId('agent-pack-dialog');
    await dialog.getByRole('button', { name: 'Prepara esportazione', exact: true }).click();
    await expect(dialog.getByLabel('Includi riepilogo anonimo dei risultati')).not.toBeChecked();
    await dialog.getByLabel('Includi riepilogo anonimo dei risultati').check();
    await expect(dialog.getByLabel('Includi riepilogo anonimo dei risultati')).toBeFocused();
    await dialog.getByLabel('Includi riepilogo anonimo dei risultati').uncheck();
    await dialog.getByRole('button', { name: 'Salva pacchetto', exact: true }).click();
    await expect(dialog).not.toBeVisible(); expect(fs.existsSync(destination)).toBe(true);
    await page.getByTestId('agent-studio').getByRole('button', { name: 'Tutti i ruoli', exact: true }).click();
    await page.getByRole('button', { name: 'Importa…', exact: true }).click();
    await expect(dialog).toContainText('Pacchetto già presente');
    await expect(dialog.getByTestId('pack-role')).toHaveValue('scout'); // the role the pack came from
    await dialog.getByTestId('pack-role').selectOption('sentinel');
    await dialog.getByRole('button', { name: 'Importa in prova', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId('catalog-card-sentinel')).toContainText('In prova');
    await shot(page, 'agent-pack-roundtrip-trial');
    const sentinel = await page.evaluate(async () => (await window.sb.invoke('agents:list', undefined)).profiles.find(p => p.id === 'sentinel')!);
    expect(sentinel.trial).toBeTruthy(); expect(sentinel.permissionCeiling).toBeNull(); // the role keeps its own permissions (every one by default, ADR 0085)
  } finally { await app.close(); }
});

test('an external role update cannot be overwritten by a stale editor draft', async () => {
  const { app, page } = await launchDemo();
  try {
    await openAgents(page, 'scout');
    await page.getByTestId('agent-edit').click();
    await page.getByTestId('agent-instructions').fill('My unsaved draft');
    await page.evaluate(async () => { const catalog = await window.sb.invoke('agents:list', undefined); const source = catalog.profiles.find(p => p.id === 'scout')!; await window.sb.invoke('agents:save', { id: source.id, profile: { ...source, instructions: 'New imported behavior.' } }); });
    await expect(page.getByTestId('agent-save')).toBeDisabled();
    await expect(page.getByTestId('agent-instructions')).toHaveValue('My unsaved draft');
    await page.getByRole('button', { name: 'Riparti dalla versione attuale', exact: true }).click();
    await expect(page.getByTestId('agent-instructions')).toHaveValue('New imported behavior.');
    await shot(page, 'agent-pack-stale-editor');
  } finally { await app.close(); }
});

test('a dropped pack shows complete scripts with approval off by default', async () => {
  const { app, page, userData } = await launchDemo();
  try {
    const file = path.join(userData, 'dropped.sbagent'), hash = 'a'.repeat(64);
    const files = new Map([['skills/reviewer/SKILL.md', Buffer.from('---\nname: reviewer\ndescription: Review changes\n---\nReview carefully.\n')], ['skills/reviewer/scripts/check.py', Buffer.from('print("review-only")')]]);
    fs.writeFileSync(file, writeZip(emitPack({ format: 1, packId: 'reviewer-0123456789abcdef', revision: 1, contentHash: hash,
      agent: { id: 'reviewer', name: 'Review fixture', role: 'sentinel', summary: 'Review changes', instructionsFile: 'agents/reviewer.md', engine: 'claude', model: null, tools: { allow: ['read'] }, permissionCeiling: 'default' },
      skills: [{ name: 'reviewer', ownership: 'owned', hash }], createdAt: '2026-10-18T00:00:00Z', exportedAt: '2026-10-18T00:00:00Z', appVersion: '0.1.0' }, 'Review changes.', files)));
    await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'pack-drop-fixture'; input.hidden = true; document.body.append(input); });
    await page.locator('#pack-drop-fixture').setInputFiles(file);
    await page.evaluate(() => { const input = document.querySelector<HTMLInputElement>('#pack-drop-fixture')!; const transfer = new DataTransfer(); transfer.items.add(input.files![0]!); window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })); input.remove(); });
    const dialog = page.getByTestId('agent-pack-dialog');
    await expect(dialog.getByLabel('Approvo questi script')).not.toBeChecked();
    await dialog.locator('summary').filter({ hasText: 'check.py' }).click();
    await expect(dialog).toContainText('print("review-only")'); await shot(page, 'agent-pack-script-review');
    await dialog.getByLabel('Approvo questi script').check(); await expect(dialog.getByLabel('Approvo questi script')).toBeChecked();
    await dialog.getByRole('button', { name: 'Importa in prova', exact: true }).click(); await expect(dialog).not.toBeVisible();
  } finally { await app.close(); }
});

test('a guard finding blocks export until the flagged file is excluded', async () => {
  const { app, page, userData } = await launchDemo();
  try {
    await openAgents(page, 'scout');
    await page.evaluate(async () => { const catalog = await window.sb.invoke('agents:list', undefined); const source = catalog.profiles.find(p => p.id === 'scout')!; return window.sb.invoke('agents:save', { id: source.id, profile: { ...source, instructions: `${source.instructions}\nCite the file.` } }); });
    const folder = path.join(userData, 'demo-agent-brain', 'agents', 'scout', 'skills', 'scout');
    fs.writeFileSync(path.join(folder, 'reference.md'), `Internal endpoint: ${[10, 23, 45, 67].join('.')}`);
    await page.getByTestId('agent-studio').getByRole('button', { name: 'Esporta…', exact: true }).first().click();
    const dialog = page.getByTestId('agent-pack-dialog'); await dialog.getByRole('button', { name: 'Prepara esportazione', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Salva pacchetto', exact: true })).toBeDisabled();
    await expect(dialog).toContainText('ipv4-private'); await shot(page, 'agent-pack-blocked-export');
    await dialog.getByRole('button', { name: 'Escludi', exact: true }).first().click();
    await expect(dialog.getByRole('button', { name: 'Salva pacchetto', exact: true })).toBeEnabled();
  } finally { await app.close(); }
});
