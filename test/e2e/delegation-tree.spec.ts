// Direct parent-to-child delegation in the real app (ADR 0083), with the fake Claude CLI calling the chat's own MCP
// endpoint (agent_delegate, agent_report) as the real CLI would: a Strategist launches a Scout and a Sentinel, both show
// as thread cards under it in the Grindhouse (expanding in place into their chat, "Vai alla chat" opening focus mode)
// and in the sidebar tree (a row brings its card on screen), their results come back to it as messages,
// and the fold of the tree survives a restart; a child's question shows in the questions window (its card points to it) and the child goes on
// after the answer; a child's permission above its parent's (a Strategist the user narrowed) is refused visibly; three Scouts run at once, each one
// writable; the parallel limit refuses a call over it and shows on the parent. Hidden window (SB_HIDDEN).
// Screenshots: test-results/shots/delegation-*.png (dark and light).
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatItem, ChatSummary, PendingRequest } from '../../src/shared/contract';
import { closeSetup, launch, openAsk, setSize, shot } from './helpers';

const FAKE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-claude.mjs');

/** The child's whole turn: what the fake CLI reads in its goal (the words before, then one MCP call on the line). */
const reportGoal = (words: string, summary: string, criterion: string) =>
  `${words} mcpcall second-brain agent_report ${JSON.stringify({ outcome: 'done', summary, output: `${summary} (dettagli)`, doneWhen: [{ criterion, met: true, evidence: 'visto' }] })}`;
const task = (role: string, title: string, goal: string, criterion: string) => ({ role, title, contract: { goal, doneWhen: [criterion], tools: ['read'] } });
const delegate = (tasks: object[]) => `Pianifico.\nmcpcall second-brain agent_delegate ${JSON.stringify({ tasks })}`;

const list = (page: Page): Promise<ChatSummary[]> => page.evaluate(() => window.sb.invoke('chat:list', undefined));
const items = (page: Page, chatId: string): Promise<ChatItem[]> => page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), chatId);
const childrenOf = async (page: Page, id: string) => (await list(page)).filter(c => c.parentId === id && !c.closedAt);
const textOf = (i: ChatItem) => ('text' in i && typeof i.text === 'string' ? i.text : '');

async function start(userData?: string, env: Record<string, string> = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-claude-'));
  // Delegation behavior is independent of runner contention; admission.spec.ts covers the busy-machine queue.
  const l = await launch({ SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: home, SB_LOAD_FORCE: '10,60', ...env }, userData);
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
    const scout = kids.find(c => c.agent?.id === 'scout')!, sentinelChat = kids.find(c => c.agent?.id === 'sentinel')!;
    expect(scout).toMatchObject({ title: 'Log errori', delegation: { role: 'scout', doneWhen: ['Elenco degli errori con la riga'] } });
    expect(scout.run?.startedBy).toBe('parent');
    expect(sentinelChat.title).toBe('Controllo test');

    // both results come back to the parent as messages (siblings' results ride together in one message, manager.ts
    // queueChildResult), and each child carries its own
    await expect.poll(async () => (await items(page, parent.id)).filter(i => i.kind === 'user').map(textOf).join('\n').split('[risultato · ').length - 1, { timeout: 20000 }).toBe(2);
    const back = (await items(page, parent.id)).filter(i => i.kind === 'user').map(textOf).join('\n');
    expect(back).toContain('[risultato · Scout «Log errori»] Trovati 3 errori nel servizio ordini');
    expect(back).toContain('[risultato · Sentinel «Controllo test»] La suite passa: 42 su 42');
    await expect.poll(async () => (await childrenOf(page, parent.id)).map(c => c.delegation?.result?.outcome).sort()).toEqual(['done', 'done']);

    // the Grindhouse: the children stand at the parent's bench, its foot counts them (ADR 0311, 0312)
    await page.getByTestId('nav-home').click();
    const helper = page.getByTestId(`bench-helper-${scout.id}`);
    await expect(helper).toBeVisible();
    await expect(helper).toHaveAttribute('data-child-state', 'done');
    await expect(page.getByTestId(`bench-helper-${sentinelChat.id}`)).toHaveAttribute('data-child-state', 'done');
    await expect(page.getByTestId(`bench-kids-sum-${parent.id}`)).toContainText('2 figli');
    await expect(page.getByTestId(`bench-kids-sum-${parent.id}`)).toContainText('2 finiti');
    const pBox = (await page.getByTestId(`tile-chat-${parent.id}`).boundingBox())!, hBox = (await helper.boundingBox())!;
    expect(hBox.y).toBeGreaterThan(pBox.y);
    expect(hBox.y + hBox.height).toBeLessThanOrEqual(pBox.y + pBox.height + 1);
    // every bench is as tall as the others, the one with helpers too (ADR 0312)
    const heights = await page.locator('.bench-grid .chat-tile.is-strip').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
    expect(new Set(heights).size).toBe(1);
    // its name tag shows under the pointer, and opens it
    const tag = page.getByTestId(`bench-helper-open-${scout.id}`);
    await expect(tag).toHaveCount(0);
    await helper.hover();
    await expect(tag).toBeVisible();
    // the tag stays inside the bench, never cut at an edge (ADR 0314)
    const tBox = (await tag.boundingBox())!;
    expect(tBox.x).toBeGreaterThanOrEqual(pBox.x);
    expect(tBox.x + tBox.width).toBeLessThanOrEqual(pBox.x + pBox.width + 1);
    await expect(tag).toContainText('Scout');
    const row = tag;
    // the sidebar tree: the same shape, the children one level in
    await expect(page.getByTestId(`nav-tree-${parent.id}`)).toHaveAttribute('data-depth', '0');
    await expect(page.getByTestId(`nav-tree-${scout.id}`)).toHaveAttribute('data-depth', '1');
    await expect(page.getByTestId(`nav-tree-${sentinelChat.id}`)).toHaveAttribute('data-depth', '1');
    await page.mouse.move(2, 2);
    await shot(page, 'delegation-tree-dark');
    await theme(page, 'light');
    await shot(page, 'delegation-tree-light');
    await theme(page, 'dark');

    // a click on the tag opens the child's chat, writable, with the whole result and the team as tabs
    await helper.hover();
    await helper.hover();
    await row.click();
    await expect(page.getByTestId(`chat-input-${scout.id}`)).toBeVisible();
    await expect(page.getByTestId(`delegation-res-${scout.id}`)).toContainText('Trovati 3 errori nel servizio ordini');
    await expect(page.getByTestId(`delegation-card-${scout.id}`)).toContainText('esito inviato a Strategist');
    await expect(page.getByTestId(`bench-tab-${parent.id}`)).toBeVisible();
    await page.getByTestId(`bench-tab-${sentinelChat.id}`).click();
    await expect(page.getByTestId(`chat-input-${sentinelChat.id}`)).toBeVisible();
    await page.getByTestId('bench-back').click();
    await expect(helper).toBeVisible();
    // a row of the sidebar tree opens that chat too
    await page.getByTestId(`nav-tree-${sentinelChat.id}`).locator('.tn-main').click();
    await expect(page.getByTestId(`chat-input-${sentinelChat.id}`)).toBeVisible();
    // "Vai alla chat" opens it in focus mode
    await page.getByTestId(`delegation-open-${sentinelChat.id}`).click();
    await expect(page.getByTestId('maximized')).toBeVisible();
    await expect(page.getByTestId('maximized').getByTestId(`chat-input-${sentinelChat.id}`)).toBeVisible();
    await page.getByTestId('focus-exit').click();
    await page.getByTestId('bench-back').click(); // back to the benches

    // folding the parent in the sidebar hides its children there; the bench keeps its helpers
    await page.getByTestId(`nav-tree-fold-${parent.id}`).click();
    await expect(page.getByTestId(`nav-tree-${scout.id}`)).toHaveCount(0);
    await page.waitForTimeout(600); // the fold is saved a moment later

    // after a restart the fold is still there, and the tree is rebuilt from the saved chats
    await app.close();
    ({ app, page, home } = await start(userData));
    homes.push(home);
    await skipSetup(page);
    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId(`nav-tree-fold-${parent.id}`)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId(`nav-tree-${scout.id}`)).toHaveCount(0);
    await page.getByTestId(`nav-tree-fold-${parent.id}`).click();
    await expect(page.getByTestId(`nav-tree-${scout.id}`)).toHaveAttribute('data-depth', '1');
    await expect(page.getByTestId(`bench-helper-${sentinelChat.id}`)).toBeVisible();
  } finally {
    await app.close();
    for (const h of homes) fs.rmSync(h, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('a child\'s question waits as a row in the Orchestrator; a permission above the parent\'s is refused visibly', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-brain-')); // the catalog is saved in a brain
  const { app, page, home } = await start(undefined, { SB_BRAIN: brain });
  try {
    await skipSetup(page);
    // every role may do everything by default (ADR 0085): the user narrows the Strategist to reading, in plan mode, and
    // its two children to what fits under it (a Scout's read-only shell is not a gap), so both launch
    await page.evaluate(async () => {
      const narrow = { strategist: [['read', 'web'], 'plan'], sentinel: [['read'], 'plan'], scout: [['read', 'web', 'browser-read', 'shell-read'], 'default'] } as const;
      for (const [id, [allow, ceiling]] of Object.entries(narrow)) {
        const p = (await window.sb.invoke('agents:list', undefined)).profiles.find(x => x.id === id)!;
        await window.sb.invoke('agents:save', { id, profile: { ...p, tools: { allow: [...allow] }, permissionCeiling: ceiling } });
      }
    });
    const parent = await strategist(page, cwd, delegate([
      task('sentinel', 'Scelta ambiente', reportGoal('Prima ask, poi riferisci.', 'Ambiente scelto e verificato', 'Ambiente scelto'), 'Ambiente scelto'),
      task('scout', 'Comando', reportGoal('Lancia bash, poi riferisci.', 'Fatto senza shell', 'Esito'), 'Esito'),
    ]));
    await expect.poll(async () => (await childrenOf(page, parent.id)).length, { timeout: 20000 }).toBe(2);
    const kids = await childrenOf(page, parent.id);
    const asker = kids.find(c => c.agent?.id === 'sentinel')!, shell = kids.find(c => c.agent?.id === 'scout')!;

    // the Scout's Bash is above the narrowed Strategist's permissions: refused by the app, said in its chat, never asked
    await expect.poll(async () => (await items(page, shell.id)).some(i => i.kind === 'system' && i.code === 'aboveParent' && (i.params as { parent?: string } | undefined)?.parent === 'Piano rilascio'), { timeout: 20000 }).toBe(true);
    const pending: PendingRequest[] = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
    expect(pending.filter(p => p.chatId === shell.id)).toEqual([]);

    // the Sentinel's question is a row in the Orchestrator (ADR 0269), opened as its card; the child waits
    const win = await openAsk(page, `${asker.id}/`);
    await expect(win).toContainText('Che colore?', { timeout: 20000 });
    const key = (await page.getByTestId('qwin-card').getAttribute('data-request-key'))!;
    expect(key.startsWith(`${asker.id}/`)).toBe(true);
    // one answerable panel in the whole window: never the Orchestrator, never a tile
    await expect(page.locator(`[data-request-key="${key}"]`)).toHaveCount(1);
    await page.getByTestId('qwin-later').click(); // set aside: one folded line in the Orchestrator's column
    await page.getByTestId('nav-home').click();
    // the child's card says it waits for the user and hosts no second answer surface (lib/child-requests.ts requestHost)
    const kid = page.getByTestId(`bench-helper-${asker.id}`); // it stands at the parent's bench (ADR 0311, 0312)
    await expect(kid).toHaveAttribute('data-child-state', 'wait', { timeout: 20000 });
    await kid.hover(); // its name tag shows under the pointer, kept inside the row (ADR 0314)
    await expect(page.getByTestId(`bench-helper-open-${asker.id}`)).toContainText('Ti aspetta');
    await page.mouse.move(2, 2);
    await expect(page.getByTestId(`delegation-ask-${asker.id}`)).toHaveCount(0);
    await expect(page.locator(`[data-request-key="${key}"]`)).toHaveCount(0);
    await page.mouse.move(2, 2);
    await shot(page, 'delegation-child-question');
    await page.getByTestId('orchestrator-asks-later').click(); // «1 da rispondere dopo»: its row again
    await openAsk(page, key);
    await expect(page.getByTestId('qwin-card')).toHaveAttribute('data-request-key', key);
    await page.getByTestId('qwin-card-opt-1').click();
    await expect(page.locator(`[data-request-key="${key}"]`)).toHaveCount(0);
    // it goes on after the answer and reports to its parent
    await expect.poll(async () => (await items(page, parent.id)).some(i => i.kind === 'user' && textOf(i).includes('[risultato · Sentinel «Scelta ambiente»] Ambiente scelto e verificato')), { timeout: 20000 }).toBe(true);
    expect(JSON.stringify((await items(page, asker.id)).filter(i => i.kind === 'tool'))).toContain('Blu');
    // the refusal is in the Scout's own chat, in words
    await page.getByTestId(`bench-helper-${shell.id}`).hover(); // its name tag shows under the pointer
    await page.getByTestId(`bench-helper-open-${shell.id}`).click();
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

test('three Scouts run at once, each one writable; more in a second call start too (no limit at once)', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
  const { app, page, home } = await start(undefined, { FAKE_CLAUDE_TASK_MS: '60000' });
  try {
    await closeSetup(page);
    // Real background work keeps their slots occupied while allowing another user message. An idle fake turn
    // without a report would instead trigger the app's missing-report recovery and its decision window.
    const three = ['Ordini', 'Clienti', 'Fatture'].map(a => task('scout', `${a} · ricerca`, `Cerca in ${a}. background`, 'Elenco'));
    const parent = await strategist(page, cwd, delegate(three));
    await expect.poll(async () => (await childrenOf(page, parent.id)).length, { timeout: 20000 }).toBe(3);
    const kids = await childrenOf(page, parent.id);
    await expect.poll(async () => (await childrenOf(page, parent.id)).map(c => c.background), { timeout: 20000 }).toEqual([1, 1, 1]);
    await page.getByTestId('nav-home').click();
    // each one at the parent's bench, its foot counts them (ADR 0311, 0312)
    for (const k of kids) await expect(page.getByTestId(`bench-helper-${k.id}`)).toBeVisible();
    await expect(page.getByTestId(`bench-kids-sum-${parent.id}`)).toContainText('3 figli');
    await expect(page.getByTestId(`bench-kids-sum-${parent.id}`)).toContainText('3 in corso');
    // each one is a chat of its own: open it and write to it
    const first = kids[0]!;
    await page.getByTestId(`bench-helper-${first.id}`).hover();
    await page.getByTestId(`bench-helper-open-${first.id}`).click();
    const input = page.getByTestId(`chat-input-${first.id}`);
    await input.fill('Aggiungi anche gli ordini di marzo');
    await input.press('Enter');
    await expect.poll(async () => (await items(page, first.id)).some(i => i.kind === 'user' && textOf(i).includes('ordini di marzo')), { timeout: 15000 }).toBe(true);
    // the parent learns it (a line now, the note with its next message), so its plan stays consistent
    await expect.poll(async () => (await items(page, parent.id)).some(i => i.kind === 'system' && i.code === 'userWroteChild'), { timeout: 15000 }).toBe(true);

    // two more make five: no limit on children at once (the owner, 2026-11-23), both start and no limit mark shows
    await page.getByTestId('bench-back').click();
    await page.evaluate(([id, text]) => window.sb.invoke('chat:send', { chatId: id, text }), [parent.id, delegate([task('scout', 'Resi', 'Cerca nei resi.', 'Elenco'), task('scout', 'Spedizioni', 'Cerca nelle spedizioni.', 'Elenco')])] as const);
    await expect.poll(async () => (await childrenOf(page, parent.id)).length, { timeout: 20000 }).toBe(5);
    await expect(page.getByTestId(`tree-limit-${parent.id}`)).toHaveCount(0);
    await page.mouse.move(2, 2);
    await shot(page, 'delegation-five-at-once');
  } finally {
    await app.close();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
