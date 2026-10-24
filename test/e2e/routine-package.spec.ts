// The routine package (ADR 0156): «Esporta pacchetto» shows what the zip will carry (cited brain files, roles, skills,
// pinned scripts, rules, the agents' memory switch) before saving; importing a .zip lists what it would write into the
// brain, new items ticked, a file that differs from the user's kept unless ticked, each with its content. The demo has no
// routine service in main, so the two read-only answers are stubbed in main (the zip itself: test/unit/agents/routine-share.test.ts).
import { test, expect } from '@playwright/test';
import type { RoutineImportPreview, RoutinePackageSummary } from '../../src/shared/contract';
import type { FlowDefinition, FlowSnapshot } from '../../src/shared/flows';
import { launchDemo, shot, publishFlows } from './helpers';

const definition: FlowDefinition = { id: 'bugfix-devops', title: 'Bugfix da DevOps', description: 'Dal bug al fix verificato, con il tag deciso prima.', aliases: [], scope: {}, steps: [
  { id: 'tag', title: 'Analisi e tag', kind: 'agent', role: 'scout', instructions: 'Leggi rules/air-dev-qa.md e i contratti in reviews/, poi metti ai-fixable o ai-needs-human.', inputs: ['workspace'], workspaceInput: 'workspace', evidence: ['tag'], timeoutMs: 5000, maxAttempts: 1, effect: 'read-only' },
  { id: 'fix', title: 'Fix', kind: 'agent', role: 'artisan', instructions: 'Correggi il bug con un test.', inputs: ['workspace'], workspaceInput: 'workspace', evidence: ['pr'], timeoutMs: 5000, maxAttempts: 1, effect: 'code' },
] };
const summary: RoutinePackageSummary = { title: definition.title, cited: ['rules/air-dev-qa.md', 'reviews/contratto-firma.md', 'reviews/bugfix-v12.json'], missing: ['reviews/v7.json'], rules: ['rules/air-dev-qa.md', 'rules/codice.md', 'rules/devops.md'],
  skills: ['code-investigation', 'devops-tag'], roles: ['scout', 'artisan'], memory: ['scout', 'artisan'], scripts: ['scripts/crea-dati-test.ps1'], skipped: ['me.md'] };
const preview: RoutineImportPreview = { digest: 'd'.repeat(64), title: definition.title, steps: 2, version: 12, exportedAt: '2026-10-24', memory: [{ role: 'scout', lines: 4, sample: ['Il login di test usa la firma semplice.'] }, { role: 'artisan', lines: 2, sample: [] }], items: [
  { key: 'file:rules/air-dev-qa.md', kind: 'cited', label: 'rules/air-dev-qa.md', status: 'different', text: '# QA\n\nai-fixable quando i dati si creano dalla UI, in locale o in test.\n' },
  { key: 'file:reviews/contratto-firma.md', kind: 'cited', label: 'reviews/contratto-firma.md', status: 'new', text: '# Firma semplice\n\nCome crearla dalla UI in test.\n' },
  { key: 'skill:devops-tag', kind: 'skill', label: 'devops-tag', status: 'new', files: ['SKILL.md'], text: '---\nname: devops-tag\n---\nMetti il tag giusto.\n' },
  { key: 'script:scripts/crea-dati-test.ps1', kind: 'script', label: 'scripts/crea-dati-test.ps1', status: 'new', text: 'param([int]$Id)\nWrite-Output "Dati di test per $Id"\n' },
  { key: 'file:rules/devops.md', kind: 'rule', label: 'rules/devops.md', status: 'new', text: '# DevOps\n' },
  { key: 'skill:code-investigation', kind: 'skill', label: 'code-investigation', status: 'elsewhere', text: '---\nname: code-investigation\n---\n' },
] };

test('export shows what the package carries; a .zip import lists what it would write, with the content', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  try {
    const snapshot: FlowSnapshot = { contextKey: 'package-fixture', drafts: [], active: { [definition.id]: 12 }, versions: [{ definition, version: 12, draftRevision: 12, digest: 'digest-12', activatedAt: 1 }], runs: [] };
    await publishFlows(app, snapshot);
    await app.evaluate(({ ipcMain }, [s, p]) => {
      ipcMain.removeHandler('flows:packagePreview'); ipcMain.handle('flows:packagePreview', () => s);
      ipcMain.removeHandler('flows:packageInspect'); ipcMain.handle('flows:packageInspect', () => p);
    }, [summary, preview] as const);
    await page.getByTestId('nav-flussi').click();
    await page.getByTestId('rt-tab-routines').click();
    await page.getByTestId('rt-routine-card').filter({ hasText: definition.title }).click();
    await page.getByTestId('rt-export-package').click();
    const pack = page.getByTestId('rt-package');
    await expect(pack.getByTestId('rt-package-cited')).toContainText('reviews/contratto-firma.md');
    await expect(pack.getByTestId('rt-package-missing')).toContainText('reviews/v7.json');
    await expect(pack.getByTestId('rt-package-memory')).toContainText('scout, artisan');
    await expect(pack.getByTestId('rt-package-memory').locator('input')).toBeChecked();
    await shot(page, 'routine-package-export');
    await page.keyboard.press('Escape');
    await expect(pack).toHaveCount(0);

    await page.getByTestId('rt-tab-routines').click();
    await page.getByTestId('flow-import-open').click();
    const importer = page.getByTestId('flow-import');
    await importer.getByTestId('flow-import-file').setInputFiles({ name: 'bugfix-devops-v12.zip', mimeType: 'application/zip', buffer: Buffer.from('PK\u0005\u0006' + '\0'.repeat(18)) });
    const list = importer.getByTestId('flow-import-package');
    await expect(list).toContainText(definition.title);
    const row = (key: string) => list.locator('li', { hasText: key }).locator('input');
    await expect(row('reviews/contratto-firma.md')).toBeChecked();
    await expect(row('rules/air-dev-qa.md')).not.toBeChecked(); // different from the user's: kept unless ticked
    await expect(row('rules/devops.md')).not.toBeChecked(); // another rule of the exporter's brain: only on a tick
    await expect(row('code-investigation')).toBeDisabled();
    await list.locator('li', { hasText: 'crea-dati-test.ps1' }).locator('summary').click();
    await expect(list).toContainText('Dati di test per $Id');
    await expect(importer.getByTestId('flow-import-memory').locator('input')).toBeChecked();
    await expect(importer.getByTestId('flow-import-submit')).toHaveText('Importa');
    await shot(page, 'routine-package-import');
  } finally { await app.close(); }
});
