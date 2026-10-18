// E2E of the file viewer's Compare (SPEC 22 V3): a file in a git repository against HEAD, a commit, another file, and
// a ref that does not exist; read-only (the repository is unchanged afterwards).
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, setSize, shot } from './helpers';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

test('file viewer compare: against HEAD, a commit, another file, a missing ref', async () => {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-diff-brain-'));
  fs.writeFileSync(path.join(brain, 'AGENTS.md'), '# Brain\n');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-diff-repo-'));
  git(repo, 'init', '-q', '-b', 'main');
  const file = path.join(repo, 'app.ts');
  fs.writeFileSync(file, 'export const a = 1;\nexport const b = 2;\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'first');
  fs.writeFileSync(file, 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n'); git(repo, 'commit', '-qam', 'second');
  fs.writeFileSync(file, 'export const a = 1;\nexport const b = 20;\nexport const c = 3;\n');
  fs.writeFileSync(path.join(repo, 'other.ts'), 'export const a = 1;\n');
  // thousands of changed lines: computed in the worker within its time limit, not "too many differences"
  fs.writeFileSync(path.join(repo, 'many.ts'), Array.from({ length: 3000 }, (_, i) => `export const v${i} = ${i};\n`).join(''));
  const status = git(repo, 'status', '--porcelain');
  const { app, page } = await launch({ SB_BRAIN: brain });
  try {
    await setSize(app, 1600, 1000);
    await expect(page.getByTestId('app')).toBeVisible();
    await page.keyboard.press('Control+K'); await page.getByTestId('palette-input').fill('sb://esplora/' + file.replace(/\\/g, '/')); await page.keyboard.press('Enter');
    const viewer = page.getByTestId('cited-file-viewer');
    await viewer.getByTestId('viewer-compare').click();
    const diff = viewer.getByTestId('viewer-diff');
    await expect(diff).toHaveAttribute('data-added', '1');
    await expect(diff).toHaveAttribute('data-removed', '1');
    await expect(diff.locator('[data-kind="add"]')).toContainText('export const b = 20;');
    await expect(diff).toContainText(/HEAD · [0-9a-f]{7}/);
    await shot(page, 'file-viewer-diff');

    await viewer.getByRole('button', { name: 'Con un commit o ramo' }).click();
    await viewer.getByTestId('viewer-compare-input').fill('HEAD~1');
    await viewer.getByTestId('viewer-compare-run').click();
    await expect(diff).toHaveAttribute('data-added', '2');

    await viewer.getByTestId('viewer-compare-input').fill('no-such-branch');
    await viewer.getByTestId('viewer-compare-run').click();
    await expect(viewer.getByTestId('viewer-compare-panel')).toContainText('Commit o ramo non trovato.');

    await viewer.getByRole('button', { name: 'Con un altro file' }).click();
    await viewer.getByTestId('viewer-compare-input').fill(path.join(repo, 'other.ts'));
    await viewer.getByTestId('viewer-compare-run').click();
    await expect(diff).toHaveAttribute('data-added', '2');
    await expect(diff).toHaveAttribute('data-removed', '0');

    await viewer.getByTestId('viewer-compare-input').fill(path.join(repo, 'many.ts'));
    await viewer.getByTestId('viewer-compare-run').click();
    await expect(diff).toHaveAttribute('data-removed', '3000');

    expect(git(repo, 'status', '--porcelain')).toBe(status);
  } finally { await app.close(); }
});
