// Direct parent-to-child delegation in the real app (ADR 0083), with the fake Claude CLI calling the chat's own MCP
// endpoint (agent_delegate, agent_report) as the real CLI would: a Strategist launches a Scout and a Judge, both show
// as thread cards under it in the Grindhouse (expanding in place into their chat, "Vai alla chat" opening focus mode)
// and in the sidebar tree (a row brings its card on screen), their results come back to it as messages,
// and the fold of the tree survives a restart; a child's question shows in the parent's open chat and the child goes on
// after the answer; a child's permission above its parent's (a Strategist the user narrowed) is refused visibly; three Scouts run at once, each one
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

async function start(userData?: string, env: Record<string, string> = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-claude-'));
  const l = await launch({ SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: home, ...env }, userData);
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

test('a Strategist launches a Scout and a Judge: indented children, results back, the fold survives a restart', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
  const first = await start();
  const userData = first.userData;
  let { app, page, home } = first;
  const homes = [home];
  try {
    await closeSetup(page);
    const parent = await strategist(page, cwd, delegate([
      task('scout', 'Log errori', reportGoal('Cerca nei log di ieri.', 'Trovati 3 errori nel servizio ordini', 'Elenco degli errori con la riga'), 'Elenco degli errori con la riga'),
      task('judge', 'Controllo test', reportGoal('Controlla la suite.', 'La suite passa: 42 su 42', 'Esito della suite'), 'Esito della suite'),
    ]));
    expect(parent.agent).toMatchObject({ id: 'strategist', name: 'Strategist' });
    await expect.poll(async () => (await childrenOf(page, parent.id)).length, { timeout: 20000 }).toBe(2);
    const kids = await childrenOf(page, parent.id);
    const scout = kids.find(c => c.agent?.id === 'scout')!, judge = kids.find(c => c.agent?.id === 'judge')!;
    expect(scout).toMatchObject({ title: 'Log errori', delegation: { role: 'scout', doneWhen: ['Elenco degli errori con la riga'] } });
    expect(scout.run?.startedBy).toBe('parent');
    expect(judge.title).toBe('Controllo test');

    // both results come back to the parent as messages, and each child carries its own
    await expect.poll(async () => (await items(page, parent.id)).filter(i => i.kind === 'user' && textOf(i).includes('[risultato · ')).length, { timeout: 20000 }).toBe(2);
    const back = (await items(page, parent.id)).filter(i => i.kind === 'user').map(textOf).join('\n');
    expect(back).toContain('[risultato · Scout «Log errori»] Trovati 3 errori nel servizio ordini');
    expect(back).toContain('[risultato · Judge «Controllo test»] La suite passa: 42 su 42');
    await expect.poll(async () => (await childrenOf(page, parent.id)).map(c => c.delegation?.result?.outcome).sort()).toEqual(['done', 'done']);

    // the Grindhouse: the children right under the parent, on thread lines, as thread cards with their result
    await page.getByTestId('nav-home').click();
    const card = page.getByTestId(`delegation-card-${scout.id}`);
    await expect(card).toBeVisible();
    await expect(page.getByTestId(`delegation-state-${scout.id}`)).toHaveText('finito');
    await expect(page.getByTestId(`delegation-res-${scout.id}`)).toContainText('Trovati 3 errori nel servizio ordini');
    await expect(card).toContainText('esito inviato a Strategist');
    await expect(card).toContainText('Scout');
    await expect(page.getByTestId(`delegation-card-${judge.id}`)).toContainText('La suite passa');
    const pBox = (await page.getByTestId(`tile-chat-${parent.id}`).boundingBox())!, cBox = (await card.boundingBox())!;
    expect(cBox.x).toBeGreaterThan(pBox.x + 8);
    expect(cBox.y).toBeGreaterThan(pBox.y);
    await expect(page.getByTestId(`tree-toggle-${parent.id}`)).toContainText('2 figli');
    await expect(page.getByTestId(`tree-toggle-${parent.id}`)).toContainText('2 finiti');
    // the sidebar tree: the same shape, the children one level in
    await expect(page.getByTestId(`nav-tree-${parent.id}`)).toHaveAttribute('data-depth', '0');
    await expect(page.getByTestId(`nav-tree-${scout.id}`)).toHaveAttribute('data-depth', '1');
    await expect(page.getByTestId(`nav-tree-${judge.id}`)).toHaveAttribute('data-depth', '1');
    await page.mouse.move(2, 2);
    await shot(page, 'delegation-tree-dark');
    await theme(page, 'light');
    await shot(page, 'delegation-tree-light');
    await theme(page, 'dark');

    // a click on a card expands it in place into the whole child chat, writable like any strip; on its head, folds it
    await card.locator('.dc-title').click();
    await expect(page.getByTestId(`delegation-chat-${scout.id}`)).toBeVisible();
    await expect(page.getByTestId(`chat-input-${scout.id}`)).toBeVisible();
    await card.locator('.dc-title').click();
    await expect(page.getByTestId(`delegation-chat-${scout.id}`)).toHaveCount(0);
    // a row of the sidebar tree brings its card on screen, expanded
    await page.getByTestId(`nav-tree-${judge.id}`).locator('.tn-main').click();
    await expect(page.getByTestId(`delegation-card-${judge.id}`)).toHaveAttribute('data-open', 'true');
    await expect(page.getByTestId(`chat-input-${judge.id}`)).toBeVisible();
    // "Vai alla chat" opens it in focus mode
    await page.getByTestId(`delegation-open-${scout.id}`).click();
    await expect(page.getByTestId('focus-view')).toBeVisible();
    await expect(page.getByTestId('focus-view').getByTestId(`chat-input-${scout.id}`)).toBeVisible();
    await page.getByTestId('focus-exit').click();

    // folding the parent hides its children in both views
    await page.getByTestId(`tree-toggle-${parent.id}`).click();
    await expect(page.getByTestId(`tile-chat-${scout.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`delegation-card-${judge.id}`)).toHaveCount(0);
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
    await expect(page.getByTestId(`delegation-card-${judge.id}`)).toBeVisible();
  } finally {
    await app.close();
    for (const h of homes) fs.rmSync(h, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('a child\'s question waits in the parent\'s open chat; a permission above the parent\'s is refused visibly', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-brain-')); // the catalog is saved in a brain
  const { app, page, home } = await start(undefined, { SB_BRAIN: brain });
  try {
    await skipSetup(page);
    // every role may do everything by default (ADR 0085): the user narrows the Strategist to reading, in plan mode, and
    // its two children to what fits under it (a Scout's read-only shell is not a gap), so both launch
    await page.evaluate(async () => {
      const narrow = { strategist: [['read', 'web'], 'plan'], judge: [['read'], 'plan'], scout: [['read', 'web', 'browser-read', 'shell-read'], 'default'] } as const;
      for (const [id, [allow, ceiling]] of Object.entries(narrow)) {
        const p = (await window.sb.invoke('agents:list', undefined)).profiles.find(x => x.id === id)!;
        await window.sb.invoke('agents:save', { id, profile: { ...p, tools: { allow: [...allow] }, permissionCeiling: ceiling } });
      }
    });
    const parent = await strategist(page, cwd, delegate([
      task('judge', 'Scelta ambiente', reportGoal('Prima ask, poi riferisci.', 'Ambiente scelto e verificato', 'Ambiente scelto'), 'Ambiente scelto'),
      task('scout', 'Comando', reportGoal('Lancia bash, poi riferisci.', 'Fatto senza shell', 'Esito'), 'Esito'),
    ]));
    await expect.poll(async () => (await childrenOf(page, parent.id)).length, { timeout: 20000 }).toBe(2);
    const kids = await childrenOf(page, parent.id);
    const asker = kids.find(c => c.agent?.id === 'judge')!, shell = kids.find(c => c.agent?.id === 'scout')!;

    // the Scout's Bash is above the narrowed Strategist's permissions: refused by the app, said in its chat, never asked
    await expect.poll(async () => (await items(page, shell.id)).some(i => i.kind === 'system' && i.code === 'aboveParent' && (i.params as { parent?: string } | undefined)?.parent === 'Piano rilascio'), { timeout: 20000 }).toBe(true);
    const pending: PendingRequest[] = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
    expect(pending.filter(p => p.chatId === shell.id)).toEqual([]);

    // the Judge's question shows in the parent's open chat, tagged with who asks; the child waits
    await page.getByTestId('nav-home').click();
    // shown once: with no chat open it is on the child's card only
    await expect(page.getByTestId(`delegation-ask-${asker.id}`)).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId(`child-request-${asker.id}`)).toHaveCount(0);
    await expandChats(page, parent.id);
    const ask = page.getByTestId(`child-request-${asker.id}`);
    await expect(ask).toBeVisible({ timeout: 20000 });
    // the parent's open chat holds it now: not the card, not the Orchestrator, one answerable panel in the whole window
    await expect(page.getByTestId(`delegation-ask-${asker.id}`)).toHaveCount(0);
    const key = (await ask.locator('[data-request-key]').first().getAttribute('data-request-key'))!;
    await expect(page.locator(`[data-request-key="${key}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-orchestrator-overlay] [data-request-key="${key}"], [data-testid^="tile-orchestrator"] [data-request-key="${key}"]`)).toHaveCount(0);
    await expect(ask).toContainText('Judge');
    await expect(ask).toContainText('Che colore?');
    await page.mouse.move(2, 2);
    await shot(page, 'delegation-child-question');
    const panel = ask.locator('[data-request-key]').first();
    const base = (await panel.getAttribute('data-testid'))!;
    await page.getByTestId(`${base}-opt-1`).click();
    await expect(ask).toHaveCount(0);
    // it goes on after the answer and reports to its parent
    await expect.poll(async () => (await items(page, parent.id)).some(i => i.kind === 'user' && textOf(i).includes('[risultato · Judge «Scelta ambiente»] Ambiente scelto e verificato')), { timeout: 20000 }).toBe(true);
    expect(JSON.stringify((await items(page, asker.id)).filter(i => i.kind === 'tool'))).toContain('Blu');
    // the refusal is in the Scout's own chat, in words
    await page.getByTestId(`delegation-card-${shell.id}`).locator('.dc-title').click();
    await expect(page.getByTestId(`tile-chat-${shell.id}`)).toContainText('va oltre i permessi di «Piano rilascio»');
    await page.getByTestId(`tile-chat-${shell.id}`).getByText('va oltre i permessi', { exact: false }).scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await shot(page, 'delegation-above-parent');
  } finally {
    await app.close();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(brain, { recursive: true, force: true });
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
    await expect(page.getByTestId(`tree-toggle-${parent.id}`)).toContainText('3 figli');
    await expect(page.getByTestId(`tree-toggle-${parent.id}`)).toContainText('3 in corso');
    // each one is a chat of its own: open it and write to it
    const first = kids[0]!;
    await page.getByTestId(`delegation-card-${first.id}`).locator('.dc-title').click();
    const input = page.getByTestId(`chat-input-${first.id}`);
    await input.fill('Aggiungi anche gli ordini di marzo');
    await input.press('Enter');
    await expect.poll(async () => (await items(page, first.id)).some(i => i.kind === 'user' && textOf(i).includes('ordini di marzo')), { timeout: 15000 }).toBe(true);
    // the parent learns it (a line now, the note with its next message), so its plan stays consistent
    await expect.poll(async () => (await items(page, parent.id)).some(i => i.kind === 'system' && i.code === 'userWroteChild'), { timeout: 15000 }).toBe(true);

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
