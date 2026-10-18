// Main-only visual gate for provider children under collapsed/expanded parents and the Orchestrator.
// Uses frozen demo telemetry; the unit suites separately exercise provider event parsing and lifecycle updates.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('child activity stays visible beneath each parent strip and the Orchestrator', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    const work = page.getByTestId('child-strips-fix');
    await expect(page.getByTestId('chat-expand-fix')).toHaveAttribute('aria-expanded', 'false');
    await expect(work.getByTestId('child-strip')).toHaveCount(3);
    await expect(work.locator('[data-child-kind="shell"]')).toContainText('dotnet test');
    await expect(work.locator('[data-child-state="completed"]')).toContainText('Concluso');
    await expect(work.getByTestId('child-time').first()).toBeVisible();
    const parentBox = (await page.getByTestId('tile-chat-fix').boundingBox())!;
    const childBox = (await work.boundingBox())!;
    expect(childBox.x).toBeGreaterThan(parentBox.x);
    expect(childBox.y).toBeGreaterThanOrEqual(parentBox.y + parentBox.height - 1);
    await expect(page.getByTestId('child-strips-regia').getByTestId('child-strip')).toHaveCount(3);
    await expect(page.getByTestId('child-strips-sms')).toContainText('Riproduci il bug');
    await shot(page, 'child-strips-collapsed');
    await page.getByTestId('chat-expand-fix').click();
    await expect(work.getByTestId('child-strip')).toHaveCount(3);
    await work.scrollIntoViewIfNeeded();
    await shot(page, 'child-strips-expanded');
    await page.getByTestId('chat-max-fix').click();
    await expect(work.getByTestId('child-strip')).toHaveCount(3);
  } finally { await app.close(); }
});
