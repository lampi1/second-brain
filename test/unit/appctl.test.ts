import { describe, expect, it } from 'vitest';
import { AGENT_LABEL, appControlTools } from '../../src/main/appctl/tools';
import { log } from '../../src/main/log';
import type { BrainService, BrowserService, ChatService } from '../../src/main/services';

function deps() {
  const sent: { chatId: string; text: string }[] = [];
  const ui: unknown[] = [];
  const chats = {
    list: () => [], items: () => [], pending: () => [{ id: 'r1', chatId: 'c1', type: 'permission', tool: 'Bash', title: 'git commit', detail: '', input: {}, at: 0 }],
    send: async (chatId: string, text: string) => { sent.push({ chatId, text }); },
  } as unknown as ChatService;
  const browser = { list: () => [] } as unknown as BrowserService;
  const brain = { feed: () => [], usage: () => ({ todayUsd: 1, fiveHourPct: null, fiveHourResetsAt: null, weekPct: null }), info: () => ({ brainRoot: null }) } as unknown as BrainService;
  const tools = appControlTools({ chats, browser, brain, window: () => null, emitUi: c => ui.push(c), version: '0.0.0' });
  const tool = (n: string) => tools.find(t => t.name === n)!;
  return { sent, ui, tools, tool };
}

describe('app control tools', () => {
  it('can never answer questions or permissions', () => {
    const { tools } = deps();
    expect(tools.map(t => t.name).some(n => /answer|approve|allow|permission/i.test(n))).toBe(false);
  });

  it('labels every message sent to a chat as written by an agent', async () => {
    const { tool, sent } = deps();
    await tool('app_send_to_chat').run({ chatId: 'c1', text: 'controlla i test' });
    expect(sent[0]!.text.startsWith(AGENT_LABEL)).toBe(true);
    await expect(Promise.resolve(tool('app_send_to_chat').run({ chatId: 'c1', text: '' }))).rejects.toThrow(/empty/);
  });

  it('a Cursor chat gets agent messages only with the switch on and only while it runs', async () => {
    const sent: string[] = [];
    let cross = true;
    const list = [{ id: 'cur', harness: 'cursor', state: 'idle' }, { id: 'off', harness: 'cursor', state: 'closed' }];
    const chats = { list: () => list, send: async (id: string) => { sent.push(id); } } as unknown as ChatService;
    const brain = { settings: () => ({ messaging: { crossHarness: cross } }) } as unknown as BrainService;
    const t = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0' }).find(x => x.name === 'app_send_to_chat')!;
    await t.run({ chatId: 'cur', text: 'ciao' });
    expect(sent).toEqual(['cur']);
    await expect(Promise.resolve(t.run({ chatId: 'off', text: 'ciao' }))).rejects.toThrow(/non è attiva/);
    cross = false;
    await expect(Promise.resolve(t.run({ chatId: 'cur', text: 'ciao' }))).rejects.toThrow(/bloccato/);
    expect(sent).toEqual(['cur']);
  });

  it('the Regia creates work chats in the brain folder, labelled, and obeys the engine switches', async () => {
    const made: Record<string, unknown>[] = [];
    let cross = true, cursorOn = true;
    const chats = { create: async (req: Record<string, unknown>) => { made.push(req); return { id: 'n1', title: req.title }; } } as unknown as ChatService;
    const brain = { settings: () => ({ messaging: { crossHarness: cross }, engines: { claude: true, cursor: cursorOn } }), info: () => ({ brainRoot: 'C:/brain' }) } as unknown as BrainService;
    const t = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0' }).find(x => x.name === 'app_create_chat')!;
    expect(await t.run({ title: 'Ordini · Fix', prompt: 'correggi il totale' })).toMatchObject({ chatId: 'n1', harness: 'claude', cwd: 'C:/brain' });
    expect(String(made[0]!.prompt).startsWith(AGENT_LABEL)).toBe(true);
    cross = false;
    await expect(Promise.resolve(t.run({ title: 'X', prompt: 'y', harness: 'cursor' }))).rejects.toThrow(/bloccato/);
    cross = true; cursorOn = false;
    await expect(Promise.resolve(t.run({ title: 'X', prompt: 'y', harness: 'cursor' }))).rejects.toThrow(/spento/);
  });

  it('filters logs by level and text and steers the UI', async () => {
    const { tool, ui } = deps();
    log.warn('chats', 'session slow', { chat: 'c9' });
    log.info('browser', 'tab opened');
    const out = await tool('app_logs').run({ level: 'warn', grep: 'slow' }) as { msg: string }[];
    expect(out.map(e => e.msg)).toContain('session slow');
    expect(out.every(e => e.msg !== 'tab opened')).toBe(true);
    await tool('app_ui').run({ action: 'view', value: 'corsie' });
    expect(ui).toEqual([{ action: 'view', value: 'corsie' }]);
  });
});
