// E2E tests of the Regia on the demo (SB_DEMO=1, frozen): the Regia's ⋯ menu (the chat menu plus "Ricomincia da
// capo" and "Cambia motore"), the Nuova Regia confirm (engine, "porta un riassunto") opened from the menu, Ctrl+Shift+R
// and the palette, the old Regia staying as a normal chat, and the new chat dialog adding a named Regia tab when a
// Regia already exists (ADR 0021). Screenshots, dark and light, in test-results/shots/.
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

async function lightTheme(page: Page): Promise<void> {
  await page.getByTestId('settings').click();
  await page.getByTestId('theme-light').click();
  await expect(page.locator('html[data-theme="light"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.mouse.move(2, 2);
}

const regiaIdOf = (page: Page) => page.getByTestId('tile-regia').getAttribute('data-chat-id');

test('the Regia menu, Ricomincia da capo (Ctrl+Shift+R) and Cambia motore Claude → Cursor, the old ones kept', async () => {
  const { app, page } = await launchDemo({ regia: true });
  await expect(page.getByTestId('regia-engine')).toHaveAttribute('data-engine', 'claude');
  // keyboard: the ⋯ button opens the menu
  await page.getByTestId('regia-menu').focus();
  await page.keyboard.press('Enter');
  const pop = page.getByTestId('chat-menu-pop-regia');
  await expect(pop).toBeVisible();
  await expect(page.getByTestId('regia-menu')).toHaveAttribute('aria-expanded', 'true');
  for (const id of ['chat-clear-regia', 'chat-renew-regia', 'chat-engine-regia', 'chat-effort-regia-high', 'chat-perm-regia-plan', 'chat-rename-regia']) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId('chat-close-regia')).toHaveCount(0); // the first Regia never closes (ADR 0021)
  await expect(page.getByTestId('chat-focusmode-regia')).toHaveCount(0); // focus mode is for work chats
  await expect(page.getByTestId('chat-engine-regia')).toContainText('Cambia motore → Cursor');
  await shot(page, 'regia-menu');

  // Cambia motore opens the confirm with Cursor chosen; Esc cancels and nothing changes
  await page.getByTestId('chat-engine-regia').click();
  const dlg = page.getByTestId('regia-renew');
  await expect(dlg).toBeVisible();
  await expect(page.getByTestId('regia-renew-cursor')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('regia-renew-go')).toHaveText('Passa a Cursor');
  await expect(page.getByTestId('regia-renew-go')).toBeFocused();
  await expect(page.getByTestId('regia-renew-summary')).toBeChecked();
  await expect(page.getByTestId('regia-renew-note')).toContainText('«Orchestrator» resta tra le chat');
  await shot(page, 'regia-renew-engine');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  expect(await regiaIdOf(page)).toBe('regia');

  // Ctrl+Shift+R: same engine = Ricomincia da capo; Enter confirms; the new Regia starts from the summary
  await page.keyboard.press('Control+Shift+R');
  await expect(page.getByTestId('regia-renew-claude')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('regia-renew-go')).toHaveText('Ricomincia da capo');
  await shot(page, 'regia-renew-restart');
  await page.keyboard.press('Enter');
  await expect(dlg).toHaveCount(0);
  await expect.poll(() => regiaIdOf(page)).not.toBe('regia');
  await expect(page.getByTestId('regia-engine')).toHaveAttribute('data-engine', 'claude');
  await expect(page.getByTestId('tile-regia')).toContainText('Passaggio di consegne');
  await expect(page.getByTestId('tile-regia')).toContainText('Che si fa adesso?'); // the last exchanges travel
  const first = page.getByTestId('tile-chat-regia');
  await expect(first).toBeVisible(); // the old one is a normal chat, history kept
  await expect(first).toContainText('Orchestrator precedente · Claude');
  await expect(page.getByTestId('toasts')).toContainText('Orchestrator nuovo su Claude');
  await expect(page.getByTestId('regia-input')).toBeFocused();
  // through the routing table (ADR 0032): a Regia's work is 'regia', its route reaches the ledger
  const renewed = await regiaIdOf(page);
  const listed = await page.evaluate(() => window.sb.invoke('chat:list', undefined));
  expect(listed.find(c => c.id === renewed)).toMatchObject({ harness: 'claude', route: { policy: 'routing', kind: 'regia' } });

  // from the menu: Cambia motore → Cursor, without the summary (starts empty)
  const second = await regiaIdOf(page);
  await page.getByTestId('regia-menu').click();
  await page.getByTestId(`chat-engine-${second}`).click();
  await page.getByTestId('regia-renew-summary').uncheck();
  await page.getByTestId('regia-renew-go').click();
  await expect(page.getByTestId('regia-engine')).toHaveAttribute('data-engine', 'cursor');
  await expect(page.getByTestId(`tile-chat-${second}`)).toBeVisible();
  // the frozen demo minute (main/demo.ts FROZEN_EPOCH) as the app writes it, in the app's own time zone (any machine)
  const when = await page.evaluate(() => new Date(Date.UTC(2026, 9, 11, 8, 30)).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ''));
  expect(when).toMatch(/^\d\d\/10 \d\d:30$/);
  await expect(page.getByTestId(`tile-chat-${second}`)).toContainText(`Regia precedente · Claude · ${when} (2)`); // same minute: never two equal names
  await expect(page.getByTestId('tile-regia')).not.toContainText('Passaggio di consegne');
  await expect(page.locator('[data-testid="tile-regia"]')).toHaveCount(1);
  // the Cursor Regia's menu: Cursor models, no effort/permissions, the way back
  const third = await regiaIdOf(page);
  await page.getByTestId('regia-menu').click();
  await expect(page.getByTestId(`chat-engine-${third}`)).toContainText('Cambia motore → Claude Code');
  await expect(page.getByTestId(`chat-effort-${third}-high`)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.mouse.move(2, 2);
  await shot(page, 'regia-cursor');

  // the palette: both actions, and the engine of every chat in its line
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('regia');
  await expect(page.getByTestId('palette-item-regiarenew')).toContainText('ricomincia da capo');
  await expect(page.getByTestId('palette-item-regiaengine')).toContainText('passa a Claude Code');
  await expect(page.getByTestId(`palette-item-chat:${third}`)).toContainText('Cursor');
  await expect(page.getByTestId(`palette-item-chat:${second}`)).toContainText('Claude Code');
  await shot(page, 'regia-palette');
  // Enter on a palette entry opens the confirm with its button focused: a second Enter confirms
  await page.keyboard.press('ArrowDown');
  await page.getByTestId('palette-item-regiaengine').click();
  await expect(page.getByTestId('regia-renew-go')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('regia-renew')).toHaveCount(0);
  await expect(page.getByTestId('regia-engine')).toHaveAttribute('data-engine', 'claude');
  await app.close();
});

test('new chat dialog: "È la Regia" with a Regia already there asks a name and adds a tab; the others stay', async () => {
  const { app, page } = await launchDemo({ regia: true });
  await page.keyboard.press('Control+N');
  await expect(page.getByTestId('newchat')).toBeVisible();
  await expect(page.getByTestId('newchat-regia')).not.toBeChecked(); // a Regia exists: off by default
  await expect(page.getByTestId('newchat-regia-note')).toHaveCount(0);
  await page.getByTestId('newchat-regia').check();
  await expect(page.getByTestId('newchat-regia-note')).toContainText('Si aggiunge come nuova tab accanto agli altri Orchestrator');
  await page.getByTestId('newchat-prompt').fill('Coordina la ricerca');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('newchat').locator('.field-error')).toContainText('Dai un nome a questo Orchestrator');
  await page.getByTestId('newchat-regia-name').fill('Ricerca');
  await shot(page, 'newchat-regia-note');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('newchat')).toHaveCount(0);
  await expect.poll(() => regiaIdOf(page)).not.toBe('regia');
  await expect(page.getByTestId('regia-overlay').getByRole('tab', { name: /Ricerca/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('regia-overlay').getByRole('tab')).toHaveCount(2); // Lavoro, Ricerca
  await expect(page.getByTestId('tile-chat-regia')).toHaveCount(0); // the first one is still a Regia
  await expect(page.locator('[data-testid="tile-regia"]')).toHaveCount(1);
  await app.close();
});

test('light theme: the Regia menu, the Nuova Regia confirm and the new chat note', async () => {
  const { app, page } = await launchDemo({ scheme: 'light', regia: true });
  await lightTheme(page);
  await page.getByTestId('regia-menu').click();
  await expect(page.getByTestId('chat-menu-pop-regia')).toBeVisible();
  await shot(page, 'regia-menu-light');
  await page.getByTestId('chat-engine-regia').click();
  await expect(page.getByTestId('regia-renew-go')).toBeFocused();
  await shot(page, 'regia-renew-engine-light');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('regia-renew')).toHaveCount(0);
  await page.keyboard.press('Control+N');
  await page.getByTestId('newchat-regia').check();
  await expect(page.getByTestId('newchat-regia-note')).toBeVisible();
  await shot(page, 'newchat-regia-note-light');
  await app.close();
});
