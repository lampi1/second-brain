// The unified Orchestrator (SPEC point 16): one coordinator for work and app improvements. Pinned here: the migration of
// persisted Regie (choice, idempotency, histories and children kept, mail aliases), the singleton in ChatManager and in
// OrchestratorService (concurrent ensure), the tool scope only for the authenticated canonical caller, app-space news
// and mail reaching it, and the updater's apply staying hard off.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import type { StoredChat } from '../../../src/main/chats/store';
import { migrateOrchestrator, ORCHESTRATOR_ROLE } from '../../../src/main/chats/orchestrator';
import { OrchestratorService } from '../../../src/main/chats/orchestrator-service';
import { RegiaWake } from '../../../src/main/chats/regia-wake';
import { ChatMail, inboxDir, mailTools } from '../../../src/main/chats/mail';
import { appControlTools } from '../../../src/main/appctl/tools';
import { routeChat, type RouteRequest } from '../../../src/main/brain/routing';
import type { BrainService, BrowserService, ChatService } from '../../../src/main/services';
import type { ChatSummary } from '../../../src/shared/contract';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-orch-')); roots.push(d); return d; };

const row = (p: Partial<StoredChat> & { id: string }): StoredChat => ({
  harness: 'claude', cwd: 'C:/brain', sessionId: null, title: p.id, model: null, effort: null, permissionMode: null, isRegia: false, createdAt: 1, ...p,
});
const summary = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  harness: 'claude', origin: 'app', title: p.id, cwd: 'C:/x', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});

describe('migrateOrchestrator', () => {
  const legacy = (): StoredChat[] => [
    row({ id: 'appR', title: "Regia dell'app", space: 'app', appRegia: true, createdAt: 9, sessionId: '11111111-1111-4111-8111-111111111111' }),
    row({ id: 'w2', title: 'Regia · Due', isRegia: true, regiaName: 'Due', regiaSince: 5, createdAt: 5 }),
    row({ id: 'w1', title: 'Nuova chat', isRegia: true, regiaSince: 2, createdAt: 2, sessionId: '22222222-2222-4222-8222-222222222222' }),
    row({ id: 'child2', regiaOf: 'w2' }),
    row({ id: 'appWorker', space: 'app', cwd: 'C:/repo' }),
    row({ id: 'loose' }),
  ];

  it('keeps the first work Regia as the Orchestrator, demotes the others and reassigns every child', () => {
    const out = migrateOrchestrator(legacy());
    const by = Object.fromEntries(out.map(c => [c.id, c]));
    expect(by.w1).toMatchObject({ isRegia: true, orchestrator: true, title: 'Orchestrator', regiaName: 'Orchestrator', regiaSince: 2, sessionId: '22222222-2222-4222-8222-222222222222' });
    expect(by.w1!.mailAliases).toEqual(expect.arrayContaining(['Nuova chat', 'Regia · Due', "Regia dell'app"]));
    for (const id of ['w2', 'appR']) {
      expect(by[id]).toMatchObject({ isRegia: false, regiaOf: 'w1' });
      expect(by[id]).not.toHaveProperty('appRegia');
      expect(by[id]).not.toHaveProperty('orchestrator');
      expect(by[id]).not.toHaveProperty('regiaName');
    }
    // history kept: the demoted app Regia keeps its session and title; app workers keep their scope
    expect(by.appR).toMatchObject({ sessionId: '11111111-1111-4111-8111-111111111111', title: "Regia dell'app" });
    expect(by.appWorker).toMatchObject({ space: 'app', cwd: 'C:/repo', regiaOf: 'w1' });
    expect(by.child2!.regiaOf).toBe('w1');
    expect(by.loose!.regiaOf).toBe('w1');
    expect(out.filter(c => c.orchestrator)).toHaveLength(1);
  });

  it('falls back to the newest app Regia when there is no work Regia', () => {
    const out = migrateOrchestrator([
      row({ id: 'oldApp', space: 'app', appRegia: true, createdAt: 1 }),
      row({ id: 'newApp', space: 'app', appRegia: true, createdAt: 3, cwd: 'C:/repo' }),
    ]);
    const o = out.find(c => c.orchestrator)!;
    expect(o.id).toBe('newApp');
    expect(o).not.toHaveProperty('space');
    // known limit: the cwd stays where the session was started (resume needs it)
    expect(o.cwd).toBe('C:/repo');
    expect(out.find(c => c.id === 'oldApp')).toMatchObject({ isRegia: false, regiaOf: 'newApp' });
  });

  it('is idempotent and leaves rows without any coordinator untouched', () => {
    const once = migrateOrchestrator(legacy());
    expect(migrateOrchestrator(once)).toEqual(once);
    const none = [row({ id: 'a' }), row({ id: 'b' })];
    expect(migrateOrchestrator(none)).toBe(none);
  });
});

function fixture(stored?: StoredChat[]) {
  const dir = tmp();
  if (stored) fs.writeFileSync(path.join(dir, 'chats.json'), JSON.stringify({ version: 2, chats: stored }));
  const sent: string[] = [];
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, unifiedOrchestrator: true, sessionFactory: (_h, _o, s: SessionSink) => {
    let state = 'idle';
    return { harness: 'anthropic', sessionId: null, pid: null, root: null, alive: true, get busy() { return state === 'running'; },
      start() { s.changed({ state: 'idle' }); },
      send(text: string) { sent.push(text); state = 'idle'; },
      close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession;
  } });
  managers.push(m);
  return { m, dir, sent, file: () => JSON.parse(fs.readFileSync(path.join(dir, 'chats.json'), 'utf8')) as { chats: StoredChat[] } };
}

describe('ChatManager with the unified Orchestrator', () => {
  it('migrates persisted Regie before restoring, persists once, and a second start changes nothing', async () => {
    const f = fixture([row({ id: 'w1', harness: 'anthropic', title: 'Nuova chat', isRegia: true, regiaSince: 1 }), row({ id: 'appR', harness: 'anthropic', space: 'app', appRegia: true, createdAt: 4 })]);
    expect(f.m.list().filter(c => c.orchestrator).map(c => c.id)).toEqual(['w1']);
    expect(f.m.list().find(c => c.id === 'w1')!.mailAliases).toContain('Nuova chat');
    const first = f.file();
    expect(first.chats.find(c => c.id === 'w1')).toMatchObject({ orchestrator: true, title: 'Orchestrator' });
    await f.m.shutdown(); managers.splice(managers.indexOf(f.m), 1);
    const again = new ChatManager({ userData: f.dir, emitter: { emit() {} }, coldEveryMs: 0, unifiedOrchestrator: true }); managers.push(again);
    expect(again.list().filter(c => c.orchestrator).map(c => c.id)).toEqual(['w1']);
    const roles = (rows: StoredChat[]) => rows.map(c => [c.id, c.title, c.isRegia, c.orchestrator, c.regiaOf, c.mailAliases, c.space, c.appRegia, c.sessionId]);
    expect(roles(f.file().chats)).toEqual(roles(first.chats));
  });

  it('is a singleton: a second request returns it, an agent cannot create it, concurrent creations share one', async () => {
    const f = fixture(), cwd = tmp();
    const [a, b] = await Promise.all([f.m.create({ harness: 'anthropic', cwd, regia: true }), f.m.create({ harness: 'anthropic', cwd, space: 'app', appRegia: true })]);
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ orchestrator: true, isRegia: true, title: 'Orchestrator' });
    expect(a).not.toHaveProperty('space');
    await expect(f.m.create({ harness: 'anthropic', cwd, regia: true }, 'agent')).rejects.toThrow(/Only the user/);
    // replacing another chat id does not sneak in a second one
    expect((await f.m.create({ harness: 'anthropic', cwd, regia: true, replaces: 'c_nope' })).id).toBe(a.id);
    expect(f.m.list().filter(c => c.orchestrator)).toHaveLength(1);
  });

  it('a replacement takes the role and the aliases; the old one gives up the name', async () => {
    const f = fixture([row({ id: 'w1', harness: 'anthropic', title: 'Nuova chat', isRegia: true, regiaSince: 1 }), row({ id: 'kid', harness: 'anthropic', regiaOf: 'w1' })]);
    const n = await f.m.create({ harness: 'anthropic', cwd: tmp(), regia: true, replaces: 'w1' });
    const by = Object.fromEntries(f.m.list().map(c => [c.id, c]));
    expect(by[n.id]).toMatchObject({ orchestrator: true, title: 'Orchestrator', mailAliases: ['Nuova chat'], regiaSince: 1 });
    expect(by.w1).toMatchObject({ isRegia: false });
    expect(by.w1!.title).not.toBe('Orchestrator');
    expect(by.w1).not.toHaveProperty('mailAliases');
    expect(by.kid!.regiaOf).toBe(n.id);
  });

  it('primes the first message with the Orchestrator role', async () => {
    const f = fixture();
    await f.m.create({ harness: 'anthropic', cwd: tmp(), regia: true, prompt: 'Ciao' });
    expect(f.sent[0]!.startsWith(ORCHESTRATOR_ROLE)).toBe(true);
    expect(ORCHESTRATOR_ROLE).toMatch(/Updater apply is disabled/);
  });
});

describe('OrchestratorService', () => {
  it('get never starts anything; concurrent ensure creates once in the brain folder', async () => {
    const rows: ChatSummary[] = [];
    let release!: () => void;
    const create = vi.fn(async (req: Record<string, unknown>) => {
      await new Promise<void>(r => { release = r; });
      const c = summary({ id: 'o1', isRegia: true, orchestrator: true, title: String(req.title) });
      rows.push(c); return c;
    });
    const s = new OrchestratorService({ list: () => rows, create } as unknown as Pick<ChatService, 'list' | 'create'>, () => 'C:/brain');
    expect(s.get()).toBeNull();
    const p1 = s.ensure({ harness: 'claude' }), p2 = s.ensure({ harness: 'cursor' });
    release();
    expect((await p1).id).toBe('o1');
    expect((await p2).id).toBe('o1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({ cwd: 'C:/brain', regia: true, harness: 'claude' });
    expect(await s.ensure({ harness: 'claude' })).toBe(rows[0]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('without a brain folder it refuses and creates nothing', async () => {
    const create = vi.fn();
    const s = new OrchestratorService({ list: () => [], create } as unknown as Pick<ChatService, 'list' | 'create'>, () => null);
    await expect(s.ensure({ harness: 'claude' })).rejects.toThrow(/brain/);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('app control scope', () => {
  const ROUTED = { routingInfo: () => ({ registry: null }), route: (req: RouteRequest) => routeChat(req, null, null, null, 7) };
  function tools(list: ChatSummary[], unified: boolean, caller: string) {
    const made: Record<string, unknown>[] = [];
    const chats = { list: () => list, create: async (req: Record<string, unknown>) => { made.push(req); return summary({ id: `n${made.length}`, title: String(req.title) }); } } as unknown as ChatService;
    const regiaChats = { harness: 'claude', claudeModel: '', cursorModel: '', claudeEffort: '', cursorReasoning: 'medium', cursorFast: false };
    const brain = { ...ROUTED, settings: () => ({ messaging: { crossHarness: true }, engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true }, regiaChats }), info: () => ({ brainRoot: 'C:/brain' }) } as unknown as BrainService;
    const improve = { repo: () => 'C:/repo', state: async () => ({}) as never, inRepo: async (d: string) => d.replace(/\\/g, '/').startsWith('C:/repo') };
    const all = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0', unified, improve }, caller);
    return { made, create: all.find(t => t.name === 'app_create_chat')!, all };
  }
  const orch = summary({ id: 'o', isRegia: true, orchestrator: true, title: 'Orchestrator' });
  const work = summary({ id: 'w', regiaOf: 'o' });

  it('the authenticated Orchestrator creates work and app chats; app chats keep the source-folder gate', async () => {
    const t = tools([orch, work], true, 'o');
    expect(await t.create.run({ title: 'A', prompt: 'p' })).toMatchObject({ cwd: 'C:/brain' });
    expect(await t.create.run({ title: 'B', prompt: 'p', space: 'app' })).toMatchObject({ cwd: 'C:/repo' });
    expect(t.made[1]).toMatchObject({ space: 'app', regiaOf: 'o', regia: false });
    expect(t.made[0]).not.toHaveProperty('space');
    await expect(Promise.resolve(t.create.run({ title: 'C', prompt: 'p', space: 'app', cwd: 'C:/elsewhere' }))).rejects.toThrow(/cartella non ammessa/);
    await expect(Promise.resolve(t.create.run({ title: 'D', prompt: 'p', space: 'root' }))).rejects.toThrow(/Invalid chat space/);
    await expect(Promise.resolve(t.create.run({ title: 'E', prompt: 'p', regia: true }))).rejects.toThrow(/Regia/);
    expect(t.made).toHaveLength(2);
  });

  it('another chat on the same mount gets no union scope', async () => {
    const t = tools([orch, work], true, 'w');
    await expect(Promise.resolve(t.create.run({ title: 'B', prompt: 'p', space: 'app' }))).rejects.toThrow(/outside this endpoint scope/);
    expect(t.made).toHaveLength(0);
    expect(t.all.some(x => x.name === 'app_improve_state')).toBe(false);
  });

  it('a new chat may not take a former Regia\'s title (the Orchestrator\'s mail box)', async () => {
    const t = tools([{ ...orch, mailAliases: ['Nuova chat'] }, work], true, 'o');
    await expect(Promise.resolve(t.create.run({ title: 'nuova  CHAT', prompt: 'p' }))).rejects.toThrow(/reserved/);
    expect(t.made).toHaveLength(0);
  });

  it('a generic endpoint never offers the space parameter', () => {
    const t = tools([orch], false, 'o');
    expect(JSON.stringify(t.create.inputSchema)).not.toContain('"space"');
  });
});

describe('news and mail reach the Orchestrator', () => {
  it('app-space turns wake the Orchestrator, not a legacy work Regia', async () => {
    vi.useFakeTimers();
    try {
      for (const orchestrator of [true, false]) {
        const sent: string[] = [];
        const regia = summary({ id: 'r', isRegia: true, title: 'Orchestrator', ...(orchestrator ? { orchestrator: true as const } : {}) });
        const w = new RegiaWake({ send: async (_id, text) => { sent.push(text); }, enabled: () => true, list: () => [regia], groupMs: 10, perChatMs: 0, now: () => Date.now() });
        w.observe('chat:updated', summary({ id: 'fix', space: 'app', state: 'running' }));
        w.observe('chat:updated', summary({ id: 'fix', space: 'app', state: 'idle', lastText: 'PR pronta' }));
        await vi.advanceTimersByTimeAsync(20);
        expect(sent.some(t => t.includes('«fix»'))).toBe(orchestrator);
        w.stop();
      }
    } finally { vi.useRealTimers(); }
  });

  it('a migrated Regia\'s mailbox is served by the Orchestrator unless a live chat still holds that title', async () => {
    const root = tmp(), dir = inboxDir(root);
    fs.mkdirSync(path.join(dir, 'nuova-chat'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'nuova-chat', '1.json'), JSON.stringify({ id: '1', thread: '1', hop: 1, replyTo: null, from: 'x', to: 'Nuova chat', at: new Date().toISOString(), text: 'stato?' }));
    const o = summary({ id: 'o', isRegia: true, orchestrator: true, title: 'Orchestrator', mailAliases: ['Nuova chat'], state: 'running' });
    let list = [o];
    const got: string[] = [];
    const mail = new ChatMail({ root: () => root, instance: 't', chats: { list: () => list, send: async id => { got.push(id); } } });
    expect(mail.hasWork('o')).toBe(true);
    expect(mail.liveChats().get('nuova-chat')?.id).toBe('o');
    // a live chat still titled "Nuova chat" keeps its own box
    const old = summary({ id: 'old', title: 'Nuova chat', state: 'idle' });
    list = [o, old];
    expect(mail.liveChats().get('nuova-chat')?.id).toBe('old');
    expect(mail.hasWork('o')).toBe(false);
    // so does an open one that is not live (send_to_chat still targets it); a closed one gives the box up
    for (const state of ['starting', 'error', 'closed'] as const) {
      list = [o, summary({ id: 'old', title: 'Nuova chat', state })];
      expect(mail.liveChats().get('nuova-chat')?.id).not.toBe('o');
      expect(mail.hasWork('o')).toBe(false);
    }
    list = [o, summary({ id: 'old', title: 'Nuova chat', state: 'closed', closedAt: 1 })];
    expect(mail.liveChats().get('nuova-chat')?.id).toBe('o');
    list = [o];
    expect(await mail.tick()).toBe(1);
    expect(got).toEqual(['o']);
    mail.stop();
  });

  it('send_to_chat to an old Regia title lands in the Orchestrator\'s box', () => {
    const root = tmp();
    const o = summary({ id: 'o', isRegia: true, orchestrator: true, title: 'Orchestrator', mailAliases: ['Nuova chat'] });
    const me = summary({ id: 'w', title: 'Worker', regiaOf: 'o' });
    const send = mailTools({ root: () => root, chats: () => [o, me], crossRefusal: () => null, deliver: () => {}, chainOf: () => null }).find(t => t.name === 'send_to_chat')!;
    expect(send.run({ to: 'Nuova chat', text: 'finito' }, { params: { chatId: 'w' } })).toContain('inviato a "Orchestrator"');
    expect(fs.readdirSync(path.join(inboxDir(root), 'orchestrator')).filter(n => n.endsWith('.json'))).toHaveLength(1);
  });
});

describe('updater', () => {
  it('apply stays hard off', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../src/main/update/wiring.ts'), 'utf8');
    expect(src).toMatch(/const RESTART_LIFECYCLE_VERIFIED = false;/);
  });
});
