// E2E of the one read-only file viewer (SPEC 22): any local file opens in the app (outside the brain, a dotfile too),
// code is highlighted, CSV is a table with its source a click away, JSON is pretty-printed, a big file is paged at line
// ends (next, last, a cited line on its own page), a PDF is drawn by pdf.js, and "Show in folder" only selects the file
// (a hidden run records it, nothing opens).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, setSize, shot } from './helpers';

const opened = (app: ElectronApplication) => app.evaluate(() => [...((globalThis as unknown as { __sbOpened: string[] }).__sbOpened)]);
const open = async (page: Page, file: string) => { await page.keyboard.press('Control+K'); await page.getByTestId('palette-input').fill('sb://esplora/' + file.replace(/\\/g, '/')); await page.keyboard.press('Enter'); };
/** A one-page PDF with a line of text, its cross-reference table computed so pdf.js reads it without repairs. */
function pdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let body = '%PDF-1.4\n'; const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  return Buffer.from(`${body}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1');
}

test('file viewer: any local file, highlighted code, CSV table, pretty JSON, paged big file, PDF, show in folder', async () => {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-viewer-brain-'));
  fs.writeFileSync(path.join(brain, 'AGENTS.md'), '# Brain\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-viewer-files-'));
  fs.writeFileSync(path.join(dir, 'app.ts'), 'export const answer = 42;\n// the end\n');
  fs.writeFileSync(path.join(dir, 'people.csv'), 'name;city\nAda;"London, UK"\n');
  fs.writeFileSync(path.join(dir, 'conf.json'), '{"a":{"b":[1,2]}}');
  fs.writeFileSync(path.join(dir, '.env'), 'TOKEN=shown-on-purpose\n');
  // 300,000 lines of 8 bytes: three pages of 1 MB
  fs.writeFileSync(path.join(dir, 'big.log'), Array.from({ length: 300_000 }, (_, i) => `L${String(i + 1).padStart(6, '0')}\n`).join(''));
  fs.writeFileSync(path.join(dir, 'doc.pdf'), pdf('Hello from a PDF'));
  const { app, page } = await launch({ SB_BRAIN: brain });
  try {
    await setSize(app, 1600, 1000);
    await expect(page.getByTestId('app')).toBeVisible();
    const viewer = page.getByTestId('cited-file-viewer');

    await open(page, path.join(dir, 'app.ts'));
    await expect(viewer.getByTestId('bx-code')).toHaveAttribute('data-highlighted', 'true');
    await expect(viewer.locator('[data-l="1"] .hljs-keyword').first()).toHaveText('export');
    await shot(page, 'file-viewer-code');

    await open(page, path.join(dir, 'people.csv'));
    await expect(viewer.getByTestId('viewer-csv')).toContainText('London, UK');
    await shot(page, 'file-viewer-csv');
    await viewer.getByRole('button', { name: 'Sorgente' }).click();
    await expect(viewer.locator('[data-l="2"]')).toContainText('Ada;"London, UK"');

    await open(page, path.join(dir, 'conf.json'));
    await expect(viewer.locator('[data-l="3"]')).toContainText('"b": [');

    await open(page, path.join(dir, '.env'));
    await expect(viewer).toContainText('TOKEN=shown-on-purpose');

    await open(page, path.join(dir, 'big.log'));
    const pager = viewer.getByTestId('viewer-pager');
    await expect(pager).toContainText('righe 1–125000');
    await viewer.getByTestId('viewer-page-next').click();
    await expect(pager).toContainText('righe 125001–250000');
    await expect(viewer.getByTestId('bx-code')).toContainText('L125001');
    await viewer.getByTestId('viewer-page-last').click();
    await expect(viewer.getByTestId('viewer-page-next')).toBeDisabled();
    await expect(viewer.getByTestId('bx-code')).toContainText('L300000');
    await shot(page, 'file-viewer-paged');
    await viewer.getByTestId('viewer-page-previous').click();
    await expect(pager).toContainText('righe 125001–250000');

    await open(page, path.join(dir, 'big.log') + ':280000');
    await expect(pager).toContainText('righe 279900–');
    await expect(viewer.locator('[data-l="280000"]')).toHaveText(/L280000/);

    await open(page, path.join(dir, 'doc.pdf'));
    await expect(viewer.getByTestId('viewer-pdf')).toHaveAttribute('data-pages', '1');
    await expect(viewer.getByTestId('viewer-pdf-page')).toHaveAttribute('data-rendered', 'true');
    await shot(page, 'file-viewer-pdf');

    await open(page, path.join(dir, 'big.log'));
    await viewer.getByTestId('viewer-show-in-folder').click();
    await expect.poll(() => opened(app)).toEqual([`folder ${fs.realpathSync.native(path.join(dir, 'big.log'))}`]);
  } finally { await app.close(); }
});
