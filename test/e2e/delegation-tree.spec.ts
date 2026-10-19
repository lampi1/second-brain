// Direct parent-to-child delegation in the real app (ADR 0083), with the fake Claude CLI calling the chat's own MCP
// endpoint (agent_delegate, agent_report) as the real CLI would: a Strategist launches a Scout and a Sentinel, both show
// as indented children under it in the Grindhouse and in the sidebar tree, their results come back to it as messages,
// and the fold of the tree survives a restart; a child's question shows in the parent's open chat and the child goes on
// after the answer; a child's permission above its parent's is refused visibly; three Scouts run at once, each one
// writable; the parallel limit refuses a call over it and shows on the parent. Hidden window (SB_HIDDEN).
// Screenshots: test-results/shots/delegation-*.png (dark and light).
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatItem, ChatSummary, PendingRequest } from '../../src/shared/contract';
import { closeSetup, expandChats, launch, setSize, shot } from './helpers';

const FAKE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-claude.mjs');

/** The child's whole turn: what the fake CLI reads in its goal (the words before, then one MCP call on the line). */
const reportGoal = (words: string, summary: string, criterion: string) =>
  `${words} mcpcall second-brain agent_report ${JSON.stringify({ outcome: 'done', summary, output: `${summary} (dettagli)`, doneWhen: [{ criterion, met: true, evidence: 'visto' }] })}`;
const task = (role: string, title: string, goal: string, criterion: string) => ({ role, title, contract: { goal, doneWhen: [criterion] } });
const delegate = (tasks: object[]) => `Pianifico.\nmcpcall second-brain agent_delegate ${JSON.stringify({ tasks })}`;

const list = (page: Page): Promise<ChatSummary[]> => page.evaluate(() => window.sb.invoke('chat:list', undefined));
const items = (page: Page, chatId: string): Promise<ChatItem[]> => page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), chatId);
const childrenOf = async (page: Page, id: string) => (await list(page)).filter(c => c.parentId === id && !c.closedAt);
const textOf = (i: ChatItem) => ('text' in i && typeof i.text === 'string' ? i.text : '');

async function start(userData?: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-claude-'));
  const l = await launch({ SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: home }, userData);
  await setSize(l.app, 1500, 950);
  await l.page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  return { ...l, home };
}
async function theme(page: Page, scheme: 'dark' | 'light') {
  await page.evaluate(t => window.sb.invoke('settings:set', { theme: t }), scheme);
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.waitForTimeout(250);
}
/** The first-run setup comes back until it is done or skipped for good: closed when it shows. */
async function skipSetup(page: Page) {
  const gate = page.getByTestId('first-interview');
  if (await gate.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) { await page.keyboard.press('Escape'); await expect(gate).toBeHidden(); }
}
const strategist = (page: Page, cwd: string, prompt: string, title = 'Piano rilascio'): Promise<ChatSummary> =>
  page.evaluate(([dir, p, t]) => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: p, title: t, roleId: 'strategist' }), [cwd, prompt, title] as const);

test('a Strategist launches a Scout and a Sentinel: indented children, results back, the fold survives a restart', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
  const first = await start();
  const userData = first.userData;
  let { app, page, home } = first;
  const homes = [home];
  try {
    await closeSetup(page);
    const parent = await strategist(page, cwd, delegate([
      task('scout', 'Log errori', reportGoal('Cerca nei log di ieri.', 'Trovati 3 errori nel servizio ordini', 'Elenco degli errori con la riga'), 'Elenco degli errori con la riga'),
      task('sentinel', 'Controllo test', reportGoal('Controlla la suite.', 'La suite passa: 42 su 42', 'Esito della suite'), 'Esito della suite'),
    ]));
    expect(parent.agent).toMatchObject({ id: 'strategist', name: 'Strategist' });
    await expect.poll(async () => (await childrenOf(page, parent.id)).length, { timeout: 20000 }).toBe(2);
    const kids = await childrenOf(page, parent.id);
    const scout = kids.find(c => c.agent?.id === 'scout')!, sentinel = kids.find(c => c.agent?.id === 'sentinel')!;
    expect(scout).toMatchObject({ title: 'Log errori', delegation: { role: 'scout', doneWhen: ['Elenco degli errori con la riga'] } });
    expect(scout.run?.startedBy).toBe('parent');
    expect(sentinel.title).toBe('Controllo test');

    // both results come back to the parent as messages, and each child carries its own
    await expect.poll(async () => (await items(page, parent.id)).filter(i => i.kind === 'user' && textOf(i).startsWith('[risultato · ')).length, { timeout: 20000 }).toBe(2);
    const back = (await items(page, parent.id)).filter(i => i.kind === 'user').map(textOf).join('\n');
    expect(back).toContain('[risultato · Scout «Log errori»] Trovati 3 errori nel servizio ordini');
    expect(back).toContain('[risultato · Sentinel «Controllo test»] La suite passa: 42 su 42');
    await expect.poll(async () => (await childrenOf(page, parent.id)).map(c => c.delegation?.result?.outcome).sort()).toEqual(['done', 'done']);

    // the Grindhouse: the children right under the parent, indented, as thread-like cards with their result
    await page.getByTestId('nav-home').click();
    const card = page.getByTestId(`delegation-card-${scout.id}`);
    await expect(card).toBeVisible();
    await expect(page.getByTestId(`delegation-result-${scout.id}`)).toHaveText('Consegnato');
    await expect(card).toContainText('Trovati 3 errori nel servizio ordini');
    await expect(card).toContainText('Scout');
    await expect(page.getByTestId(`delegation-card-${sentinel.id}`)).toContainText('La suite passa');
    const pBox = (await page.getByTestId(`tile-chat-${parent.id}`).boundingBox())!, cBox = (await card.boundingBox())!;
    expect(cBox.x).toBeGreaterThan(pBox.x + 8);
    expect(cBox.y).toBeGreaterThan(pBox.y);
    await expect(page.getByTestId(`tree-toggle-${parent.id}`)).toContainText('2');
    // the sidebar tree: the same shape, the children one level in
    await expect(page.getByTestId(`nav-tree-${parent.id}`)).toHaveAttribute('data-depth', '0');
    await expect(page.getByTestId(`nav-tree-${scout.id}`)).toHaveAttribute('data-depth', '1');
    await expect(page.getByTestId(`nav-tree-${sentinel.id}`)).toHaveAttribute('data-depth', '1');
    await page.mouse.move(2, 2);
    await shot(page, 'delegation-tree-dark');
    await theme(page, 'light');
    await shot(page, 'delegation-tree-light');
    await theme(page, 'dark');

    // a card opens the whole child chat in place, writable like any strip
    await card.click();
    await expect(page.getByTestId(`chat-input-${scout.id}`)).toBeVisible();

    // folding the parent hides its children in both views
    await page.getByTestId(`tree-toggle-${parent.id}`).click();
    await expect(page.getByTestId(`tile-chat-${scout.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`delegation-card-${sentinel.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`nav-tree-${scout.id}`)).toHaveCount(0);
    await shot(page, 'delegation-tree-folded');

    // after a restart the fold is still there, and the tree is rebuilt from the saved chats
    await app.close();
    ({ app, page, home } = await start(userData));
    homes.push(home);
    await skipSetup(page);
    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId(`tree-toggle-${parent.id}`)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId(`nav-tree-fold-${parent.id}`)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId(`nav-tree-${scout.id}`)).toHaveCount(0);
    await page.getByTestId(`nav-tree-fold-${parent.id}`).click();
    await expect(page.getByTestId(`nav-tree-${scout.id}`)).toHaveAttribute('data-depth', '1');
    await expect(page.getByTestId(`delegation-card-${sentinel.id}`)).toBeVisible();
  } finally {
    await app.close();
    for (const h of homes) fs.rmSync(h, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('a child\'s question waits in the parent\'s open chat; a permission above the parent\'s is refused visibly', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
  const { app, page, home } = await start();
  try {
    await closeSetup(page);
    const parent = await strategist(page, cwd, delegate([
      task('sentinel', 'Scelta ambiente', reportGoal('Prima ask, poi riferisci.', 'Ambiente scelto e verificato', 'Ambiente scelto'), 'Ambiente scelto'),
      task('scout', 'Comando', reportGoal('Lancia bash, poi riferisci.', 'Fatto senza shell', 'Esito'), 'Esito'),
    ]));
    await expect.poll(async () => (await childrenOf(page, parent.id)).length, { timeout: 20000 }).toBe(2);
    const kids = await childrenOf(page, parent.id);
    const asker = kids.find(c => c.agent?.id === 'sentinel')!, shell = kids.find(c => c.agent?.id === 'scout')!;

    // the Scout's Bash is above the Strategist's own permissions: refused by the app, said in its chat, never asked
    await expect.poll(async () => (await items(page, shell.id)).some(i => i.kind === 'system' && i.code === 'aboveParent' && (i.params as { parent?: string } | undefined)?.parent === 'Piano rilascio'), { timeout: 20000 }).toBe(true);
    const pending: PendingRequest[] = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
    expect(pending.filter(p => p.chatId === shell.id)).toEqual([]);

    // the Sentinel's question shows in the parent's open chat, tagged with who asks; the child waits
    await page.getByTestId('nav-home').click();
    await expandChats(page, parent.id);
    const ask = page.getByTestId(`child-request-${asker.id}`);
    await expect(ask).toBeVisible({ timeout: 20000 });
    await expect(ask).toContainText('Sentinel');
    await expect(ask).toContainText('Che colore?');
    await page.mouse.move(2, 2);
    await shot(page, 'delegation-child-question');
    const panel = ask.locator('[data-request-key]').first();
    const base = (await panel.getAttribute('data-testid'))!;
    await page.getByTestId(`${base}-opt-1`).click();
    await expect(ask).toHaveCount(0);
    // it goes on after the answer and reports to its parent
    await expect.poll(async () => (await items(page, parent.id)).some(i => i.kind === 'user' && textOf(i).startsWith('[risultato · Sentinel «Scelta ambiente»] Ambiente scelto e verificato')), { timeout: 20000 }).toBe(true);
    expect(JSON.stringify((await items(page, asker.id)).filter(i => i.kind === 'tool'))).toContain('Blu');
    // the refusal is in the Scout's own chat, in words
    await page.getByTestId(`delegation-card-${shell.id}`).click();
    await expect(page.getByTestId(`tile-chat-${shell.id}`)).toContainText('va oltre i permessi di «Piano rilascio»');
    await page.getByTestId(`tile-chat-${shell.id}`).getByText('va oltre i permessi', { exact: false }).scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await shot(page, 'delegation-above-parent');
  } finally {
    await app.close();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('three Scouts run at once, each one writable; a call over the parallel limit is refused and shown', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
  const { app, page, home } = await start();
  try {
    await closeSetup(page);
    await page.evaluate(() => window.sb.invoke('settings:set', { delegation: { maxParallel: 4 } }));
    // the Scouts do not report: they stay running, holding their slots
    const three = ['Ordini', 'Clienti', 'Fatture'].map(a => task('scout', `${a} · ricerca`, `Cerca in ${a}.`, 'Elenco'));
    const parent = await strategist(page, cwd, delegate(three));
    await expect.poll(async () => (await childrenOf(page, parent.id)).length, { timeout: 20000 }).toBe(3);
    const kids = await childrenOf(page, parent.id);
    await page.getByTestId('nav-home').click();
    for (const k of kids) await expect(page.getByTestId(`delegation-card-${k.id}`)).toBeVisible();
    await expect(page.getByTestId(`tree-toggle-${parent.id}`)).toContainText('3');
    // each one is a chat of its own: open it and write to it
    const first = kids[0]!;
    await page.getByTestId(`delegation-card-${first.id}`).click();
    const input = page.getByTestId(`chat-input-${first.id}`);
    await input.fill('Aggiungi anche gli ordini di marzo');
    await input.press('Enter');
    await expect.poll(async () => (await items(page, first.id)).some(i => i.kind === 'user' && textOf(i).includes('ordini di marzo')), { timeout: 15000 }).toBe(true);

    // two more would make five, over the limit of four: refused, and the parent shows the limit it hit
    await page.evaluate(([id, text]) => window.sb.invoke('chat:send', { chatId: id, text }), [parent.id, delegate([task('scout', 'Resi', 'Cerca nei resi.', 'Elenco'), task('scout', 'Spedizioni', 'Cerca nelle spedizioni.', 'Elenco')])] as const);
    await expect(page.getByTestId(`tree-limit-${parent.id}`)).toContainText('4', { timeout: 20000 });
    expect((await childrenOf(page, parent.id)).length).toBe(3);
    await expect.poll(async () => (await items(page, parent.id)).some(i => i.kind === 'system' && i.code === 'delegationParallel'), { timeout: 15000 }).toBe(true);
    await page.mouse.move(2, 2);
    await shot(page, 'delegation-parallel-limit');
  } finally {
    await app.close();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
