// Main-only acceptance: real IPC persistence and editable data, navigation draft retention and safe native-review cancellation.
import { test, expect } from '@playwright/test';
import { launchDemo, shot } from './helpers';
for (const language of ['it', 'en']) test(`data sections save, edit and undo (${language})`, async () => {
  const { app, page } = await launchDemo({ env: { SB_LANG: language } });
  try {
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
  } finally { await app.close(); }
});
