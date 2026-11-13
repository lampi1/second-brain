// Acceptance for "Condividi il brain" (ADR 0088): Settings → Il mio spazio saves a zip a colleague opens in Claude
// Code, Cursor or Codex without the app (AGENTS.md, CLAUDE.md, the roles as each tool's subagents), with what went in.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';
import { BRAIN_ZIP_LIMITS, readZip } from '../../src/main/agents/pack/zip';

test('Impostazioni: exports the shareable brain zip', async () => {
  const { app, page, userData } = await launchDemo();
  try {
    const destination = path.join(userData, 'brain-condiviso.zip');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
    }, destination);
    await goPage(page, 'impostazioni');
    const row = page.getByTestId('st-brain-share');
    await row.scrollIntoViewIfNeeded();
    await row.getByRole('button', { name: 'Esporta zip…', exact: true }).click();
    await expect(row.getByTestId('st-brain-share-done')).toContainText('Zip salvato');
    await shot(page, 'brain-share-done');
    const files = readZip(fs.readFileSync(destination), BRAIN_ZIP_LIMITS);
    for (const name of ['AGENTS.md', 'CLAUDE.md', 'README.md', '.claude/agents/scout.md', '.cursor/agents/scout.md', '.codex/agents/scout.toml']) expect(files.has(name)).toBe(true);
    expect([...files.keys()].some(n => /(^|\/)(me|now)\.md$/.test(n))).toBe(false);
  } finally { await app.close(); }
});
