// E2E of code blocks in a Markdown file opened in the file viewer (SPEC 22): a 300-character line wraps inside the block
// (no horizontal overflow, nothing cut off on the right, indentation kept), the text is selectable, and each block has a
// Copia button, reachable from the keyboard, that copies the block exactly and says "Copiato". The page's clipboard
// writes are recorded instead of reaching the system clipboard (shared with every app on the machine).
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, setSize, shot } from './helpers';

const open = async (page: Page, file: string) => { await page.keyboard.press('Control+K'); await page.getByTestId('palette-input').fill('sb://esplora/' + file.replace(/\\/g, '/')); await page.keyboard.press('Enter'); };
const copies = (page: Page) => page.evaluate(() => (window as unknown as { __sbCopies: string[] }).__sbCopies);

const LONG = `echo "${'a'.repeat(120)}<&>${'b'.repeat(120)}" | tee out.txt # TAIL-OF-THE-LINE`.padEnd(300, '-');
const BLOCK = `function go() {\n    ${LONG.slice(4)}\n}`;

test('file viewer: a long line in a Markdown code block wraps fully visible, and Copia copies the block', async () => {
  expect(LONG).toHaveLength(300);
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-wrap-brain-'));
  fs.writeFileSync(path.join(brain, 'AGENTS.md'), '# Brain\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-wrap-files-'));
  const file = path.join(dir, 'prompts.md');
  fs.writeFileSync(file, `# Prompts\n\nThe one to paste:\n\n\`\`\`bash\n${LONG}\n\`\`\`\n\nIndented:\n\n\`\`\`js\n${BLOCK}\n\`\`\`\n`);
  const { app, page } = await launch({ SB_BRAIN: brain });
  try {
    await setSize(app, 1100, 900);
    await expect(page.getByTestId('app')).toBeVisible();
    await page.evaluate(() => {
      const w = window as unknown as { __sbCopies: string[] };
      w.__sbCopies = [];
      Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (t: string) => { w.__sbCopies.push(t); } });
    });
    await open(page, file);
    const md = page.getByTestId('cited-file-viewer').getByTestId('viewer-markdown');
    const pre = md.locator('pre').first();
    await expect(pre).toContainText('TAIL-OF-THE-LINE');

    // the whole line is inside the block: nothing scrolls sideways, the block ends inside the viewer, and it wraps
    const box = await pre.evaluate(el => {
      const r = el.getBoundingClientRect(), v = el.closest('[data-testid="cited-file-viewer"]')!.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(el.querySelector('code')!);
      const text = range.getBoundingClientRect();
      return { scroll: el.scrollWidth, client: el.clientWidth, right: r.right, viewerRight: v.right, textRight: text.right,
        lineHeight: parseFloat(getComputedStyle(el).lineHeight), height: text.height, select: getComputedStyle(el).userSelect };
    });
    expect(box.scroll).toBeLessThanOrEqual(box.client);
    expect(box.right).toBeLessThanOrEqual(box.viewerRight);
    expect(box.textRight).toBeLessThanOrEqual(box.right);
    expect(box.height).toBeGreaterThan(box.lineHeight * 1.5);
    expect(box.select).toBe('text');
    expect(await pre.textContent()).toBe(`${LONG}\n`);
    await shot(page, 'file-viewer-code-wrap');

    // Copia with the mouse: the exact line, and the button says so
    const copy = md.getByRole('button', { name: 'Copia' });
    await expect(copy).toHaveCount(2);
    await copy.first().click();
    await expect.poll(() => copies(page)).toEqual([LONG]);
    await expect(md.locator('.bx-pre-copy').first()).toHaveText('Copiato');
    await expect(md.locator('.bx-pre-copy').first()).toHaveText('Copia');

    // from the keyboard on the second block: indentation and line ends kept
    const second = md.locator('.bx-pre-copy').nth(1);
    await second.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => copies(page)).toEqual([LONG, BLOCK]);
    await expect(second).toHaveText('Copiato');
  } finally {
    await app.close();
  }
});
