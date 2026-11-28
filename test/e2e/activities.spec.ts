// E2E of «Attività pianificate» (ADR 0374), the page that took Task's place in ☰: on the demo's in-memory catalog (four
// activities, ipc-handlers/activities-demo.ts) it opens from the menu and from the old G O key; a row shows the switch, the
// schedule in words and the last run «letti · tenuti · proposte · costo»; the switch turns an activity on; «Esegui ora» adds
// a run to the detail, which lists them; the global pause clears the next runs; a wrong form shows the validator's errors and
// a right one adds a row; Gmail wears the token-cost note; delete asks first. Screenshots: test-results/shots/activities-*.png.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, navMenu, shot } from './helpers';

test('Attività pianificate: list, switch, run now, detail, pause, form errors, new activity, delete', async () => {
  const { page } = await launchDemo();
  await navMenu(page, 'attivita');
  const ac = page.getByTestId('activities-page');
  await expect(ac).toBeVisible();
  await expect(page.getByTestId('nav-task')).toHaveCount(0); // Task is gone from the menu
  const rows = ac.getByTestId('ac-row');
  await expect(rows).toHaveCount(4);
  const dev = rows.filter({ hasText: 'DevOps: novità sui miei lavori' });
  await expect(dev.getByTestId('ac-sched')).toContainText('ogni 30 min');
  await expect(dev.getByTestId('ac-last')).toContainText('letti 14 · tenuti 3 · proposte 2');
  await expect(dev.getByTestId('ac-src-devops')).toBeVisible();
  await expect(ac.getByTestId('ac-gmail-note')).toHaveCount(1);
  await shot(page, 'activities-list');

  // the switch of an off activity
  const teams = rows.filter({ hasText: 'Teams: menzioni' });
  await expect(teams.getByTestId('ac-switch')).toHaveAttribute('aria-checked', 'false');
  await teams.getByTestId('ac-switch').click();
  await expect(teams.getByTestId('ac-switch')).toHaveAttribute('aria-checked', 'true');

  // «Esegui ora» adds a manual run, the detail lists the history
  await dev.getByTestId('ac-run-now').click();
  await expect(dev.getByTestId('ac-last')).toContainText('letti 6');
  await dev.getByTestId('ac-details').click();
  const detail = ac.getByTestId('ac-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId('ac-run')).toHaveCount(5);
  await expect(detail.getByTestId('ac-run').first()).toContainText('Esegui ora');
  await shot(page, 'activities-detail');
  await detail.getByTestId('ac-detail-close').click();
  await expect(detail).toHaveCount(0);

  // the global pause: no next run is announced
  await expect(dev.getByTestId('ac-sched')).toContainText('prossimo');
  await ac.getByTestId('ac-pause-switch').click();
  await expect(dev.getByTestId('ac-sched')).not.toContainText('prossimo');
  await ac.getByTestId('ac-pause-switch').click();

  // a wrong form shows the validator's errors and saves nothing; a right one adds a row
  await ac.getByTestId('ac-new').click();
  await ac.getByTestId('ac-f-name').fill('Posta del cliente');
  await ac.getByTestId('ac-save').click();
  await expect(ac.getByTestId('ac-errors')).toContainText('cosa proporre');
  await expect(rows).toHaveCount(4);
  await ac.getByTestId('ac-f-propose').fill('Se scrive il cliente, proponimi la risposta.');
  await ac.getByTestId('ac-save').click();
  await expect(rows).toHaveCount(5);
  await expect(rows.filter({ hasText: 'Posta del cliente' })).toBeVisible();

  // a template fills the form
  await ac.getByTestId('ac-template-teams').click();
  await expect(ac.getByTestId('ac-f-propose')).not.toHaveValue('');
  await ac.getByTestId('ac-cancel').click();

  // delete asks first
  const mine = rows.filter({ hasText: 'Posta del cliente' });
  await mine.getByTestId('ac-remove').click();
  await mine.getByTestId('ac-remove-yes').click();
  await expect(rows).toHaveCount(4);

  // the old G O key opens the same page
  await page.getByTestId('nav-home').click();
  await goPage(page, 'task');
  await expect(page.getByTestId('activities-page')).toBeVisible();
});
