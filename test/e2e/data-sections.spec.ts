// Main-only acceptance: real IPC persistence and editable data, navigation draft retention and safe native-review cancellation.
import { test, expect } from '@playwright/test';
import { launchDemo, shot } from './helpers';
for (const language of ['it', 'en']) test(`data sections save, edit and undo (${language})`, async () => {
  const { app, page } = await launchDemo({ env: { SB_LANG: language } });
  try {
    // This explicitly exercises adopted-copy recovery; ordinary fresh drafts are session-only by design.
    await page.evaluate(() => localStorage.setItem('sb.update.chat-drafts.v1', JSON.stringify({ version: 1, entries: [] })));
    await page.reload(); await page.getByTestId('app').waitFor();
    await page.getByTestId('nav-sezioni').click();
    const view = page.getByTestId('data-sections');
    await expect(view).toBeVisible();
    await page.getByTestId('section-name').fill('Synthetic cases');
    await view.getByRole('button', { name: language === 'it' ? 'Nuova tabella' : 'New table', exact: true }).click();
    await view.getByLabel(language === 'it' ? 'Attività' : 'Task', { exact: true }).fill('First case');
    await page.getByTestId('nav-home').click(); await page.getByTestId('nav-sezioni').click();
    await expect(view.getByLabel(language === 'it' ? 'Attività' : 'Task', { exact: true })).toHaveValue('First case');
    await view.getByRole('button', { name: language === 'it' ? 'Aggiungi riga' : 'Add row', exact: true }).click();
    await view.getByRole('button', { name: language === 'it' ? 'Salva tabella' : 'Save table', exact: true }).click();
    await expect(view.getByRole('cell', { name: 'First case', exact: true })).toBeVisible();
    await shot(page, `data-sections-${language}`);
    await view.getByRole('button', { name: language === 'it' ? 'Modifica dati' : 'Edit data', exact: true }).click();
    const editor = view.locator('table input').first(); await editor.fill('Corrected case');
    await view.getByRole('button', { name: language === 'it' ? 'Salva tabella' : 'Save table', exact: true }).click();
    await expect(view.getByRole('cell', { name: 'Corrected case', exact: true })).toBeVisible();
    await page.reload(); await page.getByTestId('nav-sezioni').click();
    await view.getByRole('button', { name: language === 'it' ? 'Annulla ultima modifica' : 'Undo last change', exact: true }).click();
    await expect(view.getByRole('cell', { name: 'First case', exact: true })).toBeVisible();
    await view.getByTestId('shared-memory').locator('summary').first().click();
    await view.getByTestId('memory-goals').fill('Private synthetic draft');
    await page.getByTestId('nav-home').click(); await page.getByTestId('nav-sezioni').click();
    await view.getByTestId('shared-memory').locator('summary').first().click();
    await expect(view.getByTestId('memory-goals')).toHaveValue('Private synthetic draft');
    await app.evaluate(({ dialog }) => {
      if (process.env.SB_DEMO !== '1') throw Error('Synthetic demo only');
      Object.defineProperty(dialog, 'showMessageBox', { value: async (_owner: unknown, options: { title: string }) => {
        if (!['Rivedi il contesto personale', 'Review personal context'].includes(options.title)) throw Error('Unexpected native dialog');
        return { response: 1, checkboxChecked: false };
      } });
    });
    await view.getByTestId('shared-memory').getByRole('button', { name: language === 'it' ? 'Rivedi e conferma' : 'Review and confirm', exact: true }).click();
    await expect(view.getByTestId('shared-memory').getByRole('status')).toBeVisible();
    const context = view.locator('details').filter({ has: page.locator('summary', { hasText: language === 'it' ? 'Contesto disponibile' : 'Available context' }) }).last();
    await context.locator('summary').first().click();
    await context.getByRole('button', { name: language === 'it' ? 'Prepara per la Regia' : 'Prepare for Regia', exact: true }).click();
    const preview = page.getByTestId('reviewed-context-preview'); await expect(preview).toBeVisible();
    await expect(preview).toContainText('Private synthetic draft');
    expect(await page.locator('textarea').evaluateAll(nodes => nodes.some(node => node instanceof HTMLTextAreaElement && node.value.includes('[User-reviewed data only;')))).toBe(false);
    const durable = await page.evaluate(() => localStorage.getItem('sb.update.chat-drafts.v1'));
    expect(durable).toContain('untrusted-user-context');
    await shot(page, `reviewed-context-human-preview-${language}`);
    await preview.getByRole('button', { name: language === 'it' ? 'Rimuovi dati' : 'Remove context', exact: true }).click();
    await expect(preview).not.toBeVisible();
  } finally { await app.close(); }
});
