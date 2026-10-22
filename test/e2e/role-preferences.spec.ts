// Main-only regression: "Il mio profilo di lavoro" (WorkProfilePreferences.tsx, Impostazioni → Il mio spazio; it replaced
// the role preview/confirm of earlier releases): a choice shows its pages and reference page, is saved at once in the
// persistent preferences and its «Annulla» restores the previous choice. No live harness.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';
test('work profile selection shows its pages, persists and restores the previous choice', async () => {
  const { app, page } = await launchDemo();
  try {
    const setup = await page.evaluate(() => window.sb.invoke('setup:get', undefined));
    if (setup.status === 'new' || setup.status === 'draft') {
      await page.getByTestId('first-interview').getByRole('button', { name: 'Salta per ora', exact: true }).click();
    }
    await page.keyboard.press('Control+Comma');
    const work = page.getByTestId('work-profile');
    await work.scrollIntoViewIfNeeded();
    await expect(work).toBeVisible();
    await expect(work).toContainText('Vedi tutte le pagine.');
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('sb.prefs.v1') ?? '{}').workProfile);
    const before = await saved();
    const select = work.getByRole('button', { name: 'Profilo', exact: true });
    await select.click();
    await page.locator('.ui-select-list [data-value="qa"]').click();
    await expect(select).toHaveAttribute('data-value', 'qa');
    // what the choice means: its pages and the reference page
    const pages = work.getByTestId('work-profile-pages');
    await expect(pages).toContainText('Pagine:');
    await expect(pages).toContainText('Pagina di riferimento:');
    await expect(work.getByRole('status')).toHaveText('Profilo salvato.');
    await expect.poll(saved).toBe('qa');
    await page.mouse.move(2, 2);
    await shot(page, 'role-preview');
    await work.getByRole('button', { name: 'Annulla', exact: true }).click();
    await expect(work.getByRole('status')).toHaveText('Profilo precedente ripristinato.');
    await expect(select).toHaveAttribute('data-value', before ?? '');
    await expect(work).toContainText('Vedi tutte le pagine.');
    await expect(work.getByRole('button', { name: 'Annulla', exact: true })).toHaveCount(0);
    expect(await saved()).toEqual(before);
  } finally { await app.close(); }
});
