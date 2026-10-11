// End to end: the real app with SB_CLAUDE_PATH = the fake CLI (test/fixtures/fake-claude.mjs, run with Electron as
// Node). Drives chat:create / chat:pending / chat:answer / chat:items / chat:close through window.sb from the page
// (no chat UI yet) and checks that the contract events arrive in the renderer.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatItem, ChatSummary, PendingRequest } from '../../src/shared/contract';
import { launch, shot } from './helpers';

declare global { interface Window { __ev: { ch: string; p: unknown }[] } }

const FAKE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-claude.mjs');

test('a Claude chat runs a turn, asks a question, takes the answer and streams events to the page', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-claude-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
  const { app, page, userData } = await launch({ SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: home });
  await page.evaluate(() => {
    window.__ev = [];
    for (const ch of ['chat:updated', 'chat:item', 'pending:added', 'pending:resolved', 'chat:removed'] as const) window.sb.on(ch, p => { window.__ev.push({ ch, p }); });
  });
  const count = (ch: string) => page.evaluate(c => window.__ev.filter(e => e.ch === c).length, ch);
  expect(await page.evaluate(() => window.sb.invoke('cli:status', { harness: 'claude' }))).toMatchObject({ found: true, version: '0.0.0-fake' });

  const chat: ChatSummary = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'ask me something', title: 'E2E' }), cwd);
  expect(chat).toMatchObject({ title: 'E2E', harness: 'claude', origin: 'app' });
  await expect.poll(() => count('pending:added')).toBe(1);
  const pending: PendingRequest[] = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
  expect(pending[0]).toMatchObject({ chatId: chat.id, type: 'question', title: 'Che colore?' });
  expect((await page.evaluate(() => window.sb.invoke('chat:list', undefined)))[0]?.state).toBe('waiting');

  await page.evaluate(([id, rid]) => window.sb.invoke('chat:answer', { chatId: id, requestId: rid, answer: { kind: 'question', answers: { 'Che colore?': 'Blu' } } }), [chat.id, pending[0]!.id] as const);
  await expect.poll(() => count('pending:resolved')).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__ev.some(e => e.ch === 'chat:item' && (e.p as { item: ChatItem }).item.kind === 'result'))).toBe(true);
  expect(await page.evaluate(() => window.__ev.some(e => e.ch === 'chat:item' && (e.p as { replace?: boolean }).replace === true))).toBe(true);

  const items: ChatItem[] = await page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), chat.id);
  expect(items.map(i => i.kind)).toEqual(expect.arrayContaining(['user', 'tool', 'assistant', 'result']));
  expect(items.some(i => i.kind === 'assistant' && i.text === 'Hai scelto Blu')).toBe(true);
  await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('chat:list', undefined)))[0]?.state).toBe('idle');
  expect(await page.evaluate(() => window.sb.invoke('chat:stopAll', undefined))).toBe(0);

  // persisted for the next start
  const stored = JSON.parse(fs.readFileSync(path.join(userData, 'chats.json'), 'utf8')) as { chats: { id: string; title: string }[] };
  expect(stored.chats[0]).toMatchObject({ id: chat.id, title: 'E2E' });
  await shot(page, 'chats-protocol');

  await page.evaluate(id => window.sb.invoke('chat:close', { chatId: id }), chat.id);
  await expect.poll(() => count('chat:removed')).toBe(1);
  expect(await page.evaluate(() => window.sb.invoke('chat:list', undefined))).toEqual([]);
  // without SB_CURSOR_PATH the real Cursor engine would be the one: under tests it is refused before any spawn
  const guarded: ChatSummary = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'cursor', cwd: dir }), cwd);
  expect(guarded).toMatchObject({ harness: 'cursor', state: 'error', lastError: expect.stringMatching(/Nei test il motore Cursor reale non parte mai/) });
  await app.close();
});

test('a Cursor chat (fake ACP agent) asks permission, takes the answer, ends the turn with the cost unknown', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cur-')), 'cursor.jsonl');
  const FAKE_CURSOR = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-cursor-acp.mjs');
  const userCursor = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cursor-user-')); // never the real ~/.cursor
  const { app, page, userData } = await launch({ SB_CURSOR_PATH: FAKE_CURSOR, FAKE_CURSOR_LOG: logFile, CURSOR_CONFIG_DIR: userCursor });
  await page.evaluate(() => { window.__ev = []; for (const ch of ['pending:added', 'pending:resolved', 'chat:item'] as const) window.sb.on(ch, p => { window.__ev.push({ ch, p }); }); });
  const chat: ChatSummary = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'cursor', cwd: dir, prompt: 'perm', title: 'Regia Cursor', regia: true }), cwd);
  expect(chat).toMatchObject({ harness: 'cursor', isRegia: true, costKnown: false });
  await expect.poll(() => page.evaluate(() => window.__ev.filter(e => e.ch === 'pending:added').length)).toBe(1);
  const pending: PendingRequest[] = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
  expect(pending[0]).toMatchObject({ chatId: chat.id, type: 'permission', tool: 'Shell', noAlways: true });
  await page.evaluate(([id, rid]) => window.sb.invoke('chat:answer', { chatId: id, requestId: rid, answer: { kind: 'permission', allow: true } }), [chat.id, pending[0]!.id] as const);
  await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('chat:list', undefined))).find(c => c.id === chat.id)?.state).toBe('idle');
  const items: ChatItem[] = await page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), chat.id);
  expect(items.some(i => i.kind === 'tool' && i.status === 'ok' && i.output === '3 passed (allow-once)')).toBe(true);
  expect(items.some(i => i.kind === 'assistant' && i.text === 'Test verdi.')).toBe(true);
  expect(items.find(i => i.kind === 'result')).toMatchObject({ costUsd: 0, isError: false });
  // the engine started is the fake one, and the app never asked Cursor to log in by itself
  const log = fs.readFileSync(logFile, 'utf8');
  expect(log).toContain('"argv":["acp"]');
  expect(log).not.toContain('"method":"authenticate"');
  expect(log).not.toContain('"method":"session/set_model"'); // it would write the user's global Cursor config
  // Cursor runs with the app's own config folder, never the user's
  expect((JSON.parse(log.split('\n')[0] ?? '{}') as { configDir?: string }).configDir).toBe(path.join(userData, 'cursor-config'));
  await shot(page, 'chats-cursor');
  await app.close();
});

// The page sees answers being written, like in Claude desktop: several replace events for one assistant item before
// the result (coalesced to ≤ ~30 per second), and tool rows that go running → ok in order. Both engines, fakes only.
for (const engine of ['claude', 'cursor'] as const) {
  test(`${engine}: answers stream gradually and tool rows change status live, in order`, async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-claude-'));
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'a\nb\nc');
    const fakes = { SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_DELAY: '40', SB_CURSOR_PATH: path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-cursor-acp.mjs'), FAKE_CURSOR_DELAY: '40', CURSOR_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cursor-user-')) };
    const { app, page } = await launch(fakes);
    await page.evaluate(() => { window.__ev = []; window.sb.on('chat:item', p => { window.__ev.push({ ch: `${Date.now()}`, p }); }); });
    const chat: ChatSummary = await page.evaluate(([h, dir]) => window.sb.invoke('chat:create', { harness: h, cwd: dir, prompt: 'edit stream' }), [engine, cwd] as const);
    await expect.poll(() => page.evaluate(() => window.__ev.some(e => (e.p as { item: ChatItem }).item.kind === 'result')), { timeout: 20000 }).toBe(true);
    const ev = (await page.evaluate(() => window.__ev)).map(e => ({ at: Number(e.ch), ...(e.p as { chatId: string; item: ChatItem; replace?: boolean }) })).filter(e => e.chatId === chat.id);
    const resultAt = ev.findIndex(e => e.item.kind === 'result');
    // the longest assistant item: its first event creates it (streaming), then several replaces, all before the result
    const ids = [...new Set(ev.filter(e => e.item.kind === 'assistant').map(e => e.item.id))];
    const longest = ids.map(id => ev.filter(e => e.item.id === id)).sort((a, b) => b.length - a.length)[0] ?? [];
    expect(longest[0]).toMatchObject({ replace: false, item: { streaming: true } });
    const replaces = longest.filter(e => e.replace);
    expect(replaces.length).toBeGreaterThanOrEqual(3);
    expect(ev.indexOf(longest.at(-1)!)).toBeLessThan(resultAt);
    expect(longest.at(-1)?.item).toMatchObject({ streaming: false });
    expect((longest.at(-1)?.item as { text: string }).text).toContain('parola23');
    // coalesced: never more than ~30 events a second for one item
    const span = Math.max(1, (longest.at(-1)!.at - longest[0]!.at) / 1000);
    expect(longest.length / span).toBeLessThan(40);
    // tool rows: created running at once, then ok, in this order
    const toolIds = [...new Set(ev.filter(e => e.item.kind === 'tool').map(e => e.item.id))];
    expect(toolIds.length).toBeGreaterThanOrEqual(1);
    for (const id of toolIds) {
      const st = ev.filter(e => e.item.id === id).map(e => (e.item as { status: string }).status);
      expect(st[0]).toBe('running');
      expect(st.at(-1)).toBe('ok');
      expect(st.lastIndexOf('running')).toBeLessThan(st.indexOf('ok'));
    }
    await app.close();
  });
}

test('quitting the app leaves no claude process behind, even mid-turn', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-claude-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-cwd-'));
  const logFile = path.join(home, 'fake.jsonl');
  const { app, page, userData } = await launch({ SB_CLAUDE_PATH: FAKE, CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_LOG: logFile, FAKE_CLAUDE_DELAY: '100' });
  const busy: ChatSummary = await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir, prompt: 'slow' }), cwd); // a 20 s turn
  await page.evaluate(dir => window.sb.invoke('chat:create', { harness: 'claude', cwd: dir }), cwd); // an idle one
  const lines = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { pid: number; argv?: string[]; grandchild?: number }) : []);
  const pids = async () => [...lines().filter(l => l.argv).map(l => l.pid), ...lines().flatMap(l => (l.grandchild ? [l.grandchild] : []))];
  // two CLIs + the busy one's own child (a tool or MCP server: outside the app's job, it would outlive a plain exit)
  await expect.poll(async () => (await pids()).length).toBe(3);
  await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('chat:list', undefined))).find(c => c.id === busy.id)?.state).toBe('running');
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const started = await pids();
  expect(started.every(alive)).toBe(true);
  // The user closes the window (the X): that quits twice (our 'closed' handler + Electron's window-all-closed). Let
  // Electron exit by itself: Playwright's own close() would tree-kill the app on Windows and hide the bug.
  const electronPid = app.process().pid ?? 0;
  const exited = new Promise<void>(r => app.process().once('exit', () => r()));
  const t0 = Date.now();
  await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0]?.close(), 50); }).catch(() => {});
  await exited;
  expect(Date.now() - t0).toBeLessThan(12000); // shutdown is capped at 6 s, plus one sync taskkill if needed
  expect(alive(electronPid)).toBe(false);
  await expect.poll(() => started.filter(alive).length, { timeout: 6000 }).toBe(0);
  // the clean path really ran: the idle CLI ended on its own (stdin closed) and the manager finished its shutdown
  expect(lines().some(l => (l as { exit?: string }).exit === 'stdin closed')).toBe(true);
  const logDir = path.join(userData, 'logs');
  const appLog = fs.readdirSync(logDir).map(f => fs.readFileSync(path.join(logDir, f), 'utf8')).join('\n');
  expect(appLog).toContain('"msg":"manager stopped"');
  await app.close().catch(() => {});
});
