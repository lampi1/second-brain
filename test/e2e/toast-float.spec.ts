// Toasts float (#169): showing one moves nothing (the workspace and the top bar keep their boxes), it sits under the
// top bar, never over its buttons or the Orchestrator's input. Screenshot in test-results/shots/toast-float.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('a toast floats under the top bar and never moves the layout', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  const workspace = page.getByTestId('workspace'), topbar = page.getByTestId('topbar');
  await expect(workspace).toBeVisible();
  const before = { ws: await workspace.boundingBox(), top: await topbar.boundingBox() };
  // Pulisci on the Orchestrator ends with a toast ("Chiusa: Orchestrator precedente · …")
  await page.getByTestId('orchestrator-menu').click();
  await page.getByTestId('chat-clear-orchestrator').click();
  await page.getByTestId('confirm-ok').click();
  const toast = page.getByTestId('toast').first();
  await expect(toast).toBeVisible();
  expect(await workspace.boundingBox()).toEqual(before.ws);
  expect(await topbar.boundingBox()).toEqual(before.top);
  const t = (await toast.boundingBox())!, top = before.top!;
  expect(t.y).toBeGreaterThanOrEqual(top.y + top.height); // under the top bar, never over its buttons
  const input = await page.getByTestId('orchestrator-input').boundingBox();
  if (input) expect(t.x + t.width <= input.x || t.y + t.height <= input.y).toBe(true); // never over the Orchestrator's input
  await shot(page, 'toast-float');
  await page.getByTestId('toast-close').first().click();
  await expect(page.getByTestId('toast')).toHaveCount(0);
  expect(await workspace.boundingBox()).toEqual(before.ws);
  await app.close();
});
