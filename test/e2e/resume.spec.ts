// E2E of the resume after a restart (frozen demo): a chat the app resumed by itself shows "ripresa dopo il riavvio" on
// its tile until the user writes to it. The resume itself (saved turn, automatic message, --resume) had unit tests against
// the fake CLI, removed on 2026-11-09 (docs/tests/load-sensitive-removed.md). Screenshot: test-results/shots/resume-1-mark.
import { expect, test } from '@playwright/test';
import { expandChats, launchDemo, shot } from './helpers';

test('a chat resumed after a restart carries its mark until the user writes', async () => {
  const { app, page } = await launchDemo();
  await expect(page.getByTestId('tile-chat-fix')).toBeVisible();
  // the resumed turn is over (a busy chat would only queue the message in the UI, leaving the mark until it is sent)
  await app.evaluate(() => {
    const demo = (globalThis as unknown as { __sbDemo: { finish(id: string, agoMs: number): void; resumed(id: string): void } }).__sbDemo;
    demo.finish('fix', 0);
    demo.resumed('fix');
  });
  const mark = page.getByTestId('chat-resumed-fix');
  await expect(mark).toHaveText('ripresa dopo il riavvio');
  await shot(page, 'resume-1-mark');
  await expandChats(page, 'fix'); // the input is on the open strip
  const input = page.getByTestId('chat-input-fix');
  await input.fill('ok, continua');
  await input.press('Enter');
  await expect(mark).toHaveCount(0);
  await app.close();
});
