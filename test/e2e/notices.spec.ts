// The one notice card (ADR 0151): a background job's notice and the end of the maintenance show as the same card in
// every tone, each rings its own sound once (counted on <html data-chimes>, the kind on <html data-sound>; a hidden
// run is muted), and the celebrate one carries its summary chips and its action. Screenshots in
// test-results/shots/notices-*.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type Spec = { tone: string; title: string; label?: string; detail?: string; chips?: string[]; act?: string };
// runs in the page: functions cannot cross page.evaluate, so the action is built there
const notify = (s: Spec) => (globalThis as unknown as { __sbNotify: (s: unknown) => number }).__sbNotify({ ...s, ...(s.act ? { action: { label: s.act, run: () => {} } } : {}) });

for (const scheme of ['dark', 'light'] as const) {
  test(`notices: one card for every tone, each with its own sound (${scheme})`, async () => {
    const { app, page } = await launchDemo({ orchestrator: true, scheme });
    await expect(page.getByTestId('workspace')).toBeVisible();
    await page.evaluate(t => window.sb.invoke('settings:set', { theme: t }), scheme);
    const chimes = () => page.evaluate(() => Number(document.documentElement.dataset.chimes ?? 0));
    const before = await chimes();
    await page.evaluate(notify, { tone: 'ok', label: 'Chat finita', title: 'Artisan ha finito «Fix export Safari»', detail: '4 file cambiati · 2 min', act: 'Apri' });
    await expect.poll(chimes).toBe(before + 1);
    expect(await page.evaluate(() => document.documentElement.dataset.sound)).toBe('success');
    await page.evaluate(notify, { tone: 'err', label: 'Errore', title: 'Scout si è fermato', detail: 'Login Claude scaduto' });
    await expect.poll(chimes).toBe(before + 2);
    expect(await page.evaluate(() => document.documentElement.dataset.sound)).toBe('error');
    await expect(page.getByTestId('toast')).toHaveCount(2);
    await expect(page.locator('.notif.tone-ok .notif-label')).toHaveText('Chat finita');
    await shot(page, `notices-${scheme}`);

    await page.getByTestId('toast-close').first().click();
    await expect(page.getByTestId('toast')).toHaveCount(1);
    await page.getByTestId('toast-close').first().click();
    await expect(page.getByTestId('toast')).toHaveCount(0);
    await page.evaluate(notify, { tone: 'celebrate', label: 'Manutenzione finita', title: 'Il tuo brain è in ordine', chips: ['3 proposte da guardare', '2 idee nuove', '5 note sistemate'], act: 'Apri Memoria' });
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.sound)).toBe('celebrate');
    const card = page.locator('.notif.tone-celebrate');
    await expect(card).toBeVisible();
    await expect(card.locator('.notif-chip')).toHaveCount(3);
    await expect(card.getByTestId('toast-action')).toHaveText('Apri Memoria');
    await page.waitForTimeout(1000); // the sparkle burst is over
    await shot(page, `notices-celebrate-${scheme}`);
    await app.close();
  });
}
