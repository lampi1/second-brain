// Rich-choice interaction regression for main's full check: disclosures and their keyboard never answer a request.
// Branch reviewers use the standalone preview; this real Electron spec follows the repo's main-only e2e rule.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';
import { richQuestion } from '../../src/renderer/components/genui/fixtures';

test('inspect a rich option without answering, then answer with a digit', async () => {
  const { app, page } = await launchDemo({ width: 1440, height: 1000 });
  await app.evaluate((_e, req) => {
    (globalThis as unknown as { __sbDemo: { ask(id: string, req: object): void } }).__sbDemo.ask('fix', req);
  }, { ...richQuestion, chatId: 'fix' });
  await page.getByTestId('chat-max-fix').click();
  const panel = page.locator('[data-testid^="request-fix-"]').filter({ has: page.locator('.gu-choice') }).first();
  const preview = panel.locator('[data-option-preview]').first();
  await preview.locator('summary').click();
  await expect(preview).toHaveAttribute('open', '');
  await preview.locator('summary').press('1');
  await expect(panel).toBeVisible();
  await preview.locator('summary').press('Escape');
  await expect(preview).not.toHaveAttribute('open', '');
  await expect(panel).toBeVisible();
  await shot(page, 'genui-rich-choices');
  await panel.focus();
  await panel.press('1');
  await expect(panel).toHaveCount(0);
  await app.close();
});
