// E2E test of the folded messages the user did not type (renderer lib/foreign.ts) on the demo (SB_DEMO=1, frozen): in
// the Orchestrator, mail from a work chat and an Esegui result show as one muted line each (sender + first words), the
// user's own message stays a bubble, a click opens the whole text and a second click folds it again; the input never
// gets their text. Screenshots in test-results/shots/.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('mail and Esegui results fold to one line in the Regia, a click opens them', async () => {
  const { app, page } = await launchDemo({ regia: true });
  const tile = page.getByTestId('tile-regia');
  const mail = tile.getByTestId('item-regia-mail1');
  const run = tile.getByTestId('item-regia-run1');

  await expect(mail).toHaveAttribute('data-foreign', 'mail');
  await expect(mail).toContainText('Messaggio · «QA rimborsi»');
  await expect(mail).toContainText('Test case 7 fallisce anche su master');
  await expect(mail.locator('.bubble')).toHaveCount(0);
  await expect(mail).not.toContainText('Rispondi solo se'); // folded: no body
  await expect(run).toHaveAttribute('data-foreign', 'run');
  await expect(run).toContainText('Esito di Esegui');
  await expect(run).toContainText('git -C');
  await expect(tile.getByTestId('item-regia-u1').locator('.bubble')).toHaveText('Che si fa adesso?'); // the user's own: unchanged
  await shot(page, 'foreign-folded');

  await tile.getByTestId('item-regia-run1-toggle').click();
  await expect(tile.getByTestId('item-regia-run1-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(tile.getByTestId('item-regia-run1-body')).toContainText('Already up to date.');
  await expect(tile.getByTestId('item-regia-run1-body')).toContainText('Non scritto da te');
  await expect(tile.getByTestId('item-regia-mail1-body')).toHaveCount(0); // only the clicked one opens
  await shot(page, 'foreign-one-open');

  await tile.getByTestId('item-regia-run1-toggle').click();
  await expect(tile.getByTestId('item-regia-run1-body')).toHaveCount(0);
  await expect(page.getByTestId('regia-input')).toHaveValue('');
  await app.close();
});
