// E2E tests of the Orchestrator on the demo (SB_DEMO=1, frozen): the Orchestrator's ⋯ menu (the chat menu plus "Ricomincia da
// capo" and "Cambia motore"), the Nuovo Orchestrator confirm (engine, "porta un riassunto") opened from the menu, Ctrl+Shift+R
// and the palette, the old Orchestrator staying as a normal chat, and the new agent dialog never offering a second
// Orchestrator. Screenshots, dark and light, in test-results/shots/.
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

async function lightTheme(page: Page): Promise<void> {
  await page.getByTestId('settings').click();
  await page.getByTestId('theme-light').click();
  await expect(page.locator('html[data-theme="light"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.mouse.move(2, 2);
}

const orchestratorIdOf = (page: Page) => page.getByTestId('tile-orchestrator').getAttribute('data-chat-id');

test('the Orchestrator menu, Ricomincia da capo (Ctrl+Shift+R) and Cambia motore Claude → Cursor, the old ones kept', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  await expect(page.getByTestId('orchestrator-engine')).toHaveAttribute('data-engine', 'claude');
  // keyboard: the ⋯ button opens the menu
  await page.getByTestId('orchestrator-menu').focus();
  await page.keyboard.press('Enter');
  const pop = page.getByTestId('chat-menu-pop-orchestrator');
  await expect(pop).toBeVisible();
  await expect(page.getByTestId('orchestrator-menu')).toHaveAttribute('aria-expanded', 'true');
  for (const id of ['chat-clear-orchestrator', 'chat-renew-orchestrator', 'chat-engine-orchestrator', 'chat-effort-orchestrator-high', 'chat-perm-orchestrator-plan', 'chat-rename-orchestrator']) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId('chat-close-orchestrator')).toHaveCount(0); // the Orchestrator never closes
  await expect(page.getByTestId('chat-focusmode-orchestrator')).toHaveCount(0); // focus mode is for work chats
  await expect(page.getByTestId('chat-engine-orchestrator')).toContainText('Cambia motore → Cursor');
  await shot(page, 'orchestrator-menu');

  // Cambia motore opens the confirm with Cursor chosen; Esc cancels and nothing changes
  await page.getByTestId('chat-engine-orchestrator').click();
  const dlg = page.getByTestId('orchestrator-renew');
  await expect(dlg).toBeVisible();
  await expect(page.getByTestId('orchestrator-renew-cursor')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('orchestrator-renew-go')).toHaveText('Passa a Cursor');
  await expect(page.getByTestId('orchestrator-renew-go')).toBeFocused();
  await expect(page.getByTestId('orchestrator-renew-summary')).toBeChecked();
  await expect(page.getByTestId('orchestrator-renew-note')).toContainText('«Orchestrator» resta tra le chat');
  await shot(page, 'orchestrator-renew-engine');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  expect(await orchestratorIdOf(page)).toBe('orchestrator');

  // Ctrl+Shift+R: same engine = Ricomincia da capo; Enter confirms; the new Orchestrator starts from the summary
  await page.keyboard.press('Control+Shift+R');
  await expect(page.getByTestId('orchestrator-renew-claude')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('orchestrator-renew-go')).toHaveText('Ricomincia da capo');
  await shot(page, 'orchestrator-renew-restart');
  await page.keyboard.press('Enter');
  await expect(dlg).toHaveCount(0);
  await expect.poll(() => orchestratorIdOf(page)).not.toBe('orchestrator');
  await expect(page.getByTestId('orchestrator-engine')).toHaveAttribute('data-engine', 'claude');
  await expect(page.getByTestId('tile-orchestrator')).toContainText('Passaggio di consegne');
  await expect(page.getByTestId('tile-orchestrator')).toContainText('Che si fa adesso?'); // the last exchanges travel
  const first = page.getByTestId('tile-chat-orchestrator');
  await expect(first).toBeVisible(); // the old one is a normal chat, history kept
  await expect(first).toContainText('Orchestrator precedente · Claude');
  await expect(page.getByTestId('toasts')).toContainText('Orchestrator nuovo su Claude');
  await expect(page.getByTestId('orchestrator-input')).toBeFocused();
  // through the routing table (ADR 0032): an Orchestrator's work is 'orchestrator', its route reaches the ledger
  const renewed = await orchestratorIdOf(page);
  const listed = await page.evaluate(() => window.sb.invoke('chat:list', undefined));
  expect(listed.find(c => c.id === renewed)).toMatchObject({ harness: 'claude', route: { policy: 'routing', kind: 'orchestrator' } });

  // from the menu: Cambia motore → Cursor, without the summary (starts empty)
  const second = await orchestratorIdOf(page);
  await page.getByTestId('orchestrator-menu').click();
  await page.getByTestId(`chat-engine-${second}`).click();
  await page.getByTestId('orchestrator-renew-summary').uncheck();
  await page.getByTestId('orchestrator-renew-go').click();
  await expect(page.getByTestId('orchestrator-engine')).toHaveAttribute('data-engine', 'cursor');
  await expect(page.getByTestId(`tile-chat-${second}`)).toBeVisible();
  // the frozen demo minute (main/demo.ts FROZEN_EPOCH) as the app writes it, in the app's own time zone (any machine)
  const when = await page.evaluate(() => new Date(Date.UTC(2026, 9, 11, 8, 30)).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ''));
  expect(when).toMatch(/^\d\d\/10 \d\d:30$/);
  await expect(page.getByTestId(`tile-chat-${second}`)).toContainText(`Orchestrator precedente · Claude · ${when} (2)`); // same minute: never two equal names
  await expect(page.getByTestId('tile-orchestrator')).not.toContainText('Passaggio di consegne');
  await expect(page.locator('[data-testid="tile-orchestrator"]')).toHaveCount(1);
  // the Cursor Orchestrator's menu: Cursor models, no effort/permissions, the way back
  const third = await orchestratorIdOf(page);
  await page.getByTestId('orchestrator-menu').click();
  await expect(page.getByTestId(`chat-engine-${third}`)).toContainText('Cambia motore → Claude Code');
  await expect(page.getByTestId(`chat-effort-${third}-high`)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.mouse.move(2, 2);
  await shot(page, 'orchestrator-cursor');

  // the palette: both actions, and the engine of every chat in its line
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('orchestrator');
  await expect(page.getByTestId('palette-item-orchestratorrenew')).toContainText('ricomincia da capo');
  await expect(page.getByTestId('palette-item-orchestratorengine')).toContainText('passa a Claude Code');
  await expect(page.getByTestId(`palette-item-chat:${third}`)).toContainText('Cursor');
  await expect(page.getByTestId(`palette-item-chat:${second}`)).toContainText('Claude Code');
  await shot(page, 'orchestrator-palette');
  // Enter on a palette entry opens the confirm with its button focused: a second Enter confirms
  await page.keyboard.press('ArrowDown');
  await page.getByTestId('palette-item-orchestratorengine').click();
  await expect(page.getByTestId('orchestrator-renew-go')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('orchestrator-renew')).toHaveCount(0);
  await expect(page.getByTestId('orchestrator-engine')).toHaveAttribute('data-engine', 'claude');
  await app.close();
});

test('Ctrl+N and the palette give the Orchestrator\'s input the keyboard for a new request; no start dialog (ADR 0083)', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Control+N');
  const input = page.getByTestId('orchestrator-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('placeholder', 'Cosa vuoi fare?');
  await expect(page.getByTestId('newchat')).toHaveCount(0);
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Nuova richiesta');
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await expect(page.locator('[data-testid="tile-orchestrator"]')).toHaveCount(1);
  await app.close();
});

test('light theme: the Orchestrator menu and the Nuovo Orchestrator confirm', async () => {
  const { app, page } = await launchDemo({ scheme: 'light', orchestrator: true });
  await lightTheme(page);
  await page.getByTestId('orchestrator-menu').click();
  await expect(page.getByTestId('chat-menu-pop-orchestrator')).toBeVisible();
  await shot(page, 'orchestrator-menu-light');
  await page.getByTestId('chat-engine-orchestrator').click();
  await expect(page.getByTestId('orchestrator-renew-go')).toBeFocused();
  await shot(page, 'orchestrator-renew-engine-light');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('orchestrator-renew')).toHaveCount(0);
  await app.close();
});
