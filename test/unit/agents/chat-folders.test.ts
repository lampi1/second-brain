// A chat's folder is chosen by whoever opens it (ADR 0358; src/main/agents/worktrees.ts, agents/delegation.ts, chats/
// manager*.ts, appctl/tools.ts): any existing folder, in place unless a copy is asked, the parent's folder never limits the
// child's; uncommitted changes and another writer are told, never refused nor touched; reuse and «Riprendi» in another
// folder open a linked chat; a folder that is missing is the one refusal, before anything exists; read-only stays read-only.
// Real ChatManager and DelegateWorktrees, fake engines, a scripted git (no process): it records every command, so a
// command that changes a checkout would show.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ChildProcess from 'node:child_process';
import type { BrainService, ChatService } from '../../../src/main/services';
import type { BrowserService } from '../../../src/main/services';
import type { AgentModelChoice } from '../../../src/shared/agents';
import type { ChatSummary, NewChat } from '../../../src/shared/contract';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';

const git = vi.hoisted(() => ({ dirty: new Set<string>(), repos: new Map<string, string>(), ran: [] as string[][] }));
vi.mock('node:child_process', async original => ({
  ...await original<typeof ChildProcess>(),
  execFile: (_file: string, args: string[], _options: unknown, done: (error: (Error & { code?: number }) | null, stdout: string) => void) => {
    const at = args.indexOf('-C'), cwd = args[at + 1]!, rest = args.slice(at + 2);
    while (rest[0] === '-c') rest.splice(0, 2);
    git.ran.push(rest);
    const repo = [...git.repos.keys()].find(r => cwd === r || cwd.startsWith(r + path.sep));
    const ok = (out = '') => queueMicrotask(() => done(null, out));
    const fail = (code: number) => queueMicrotask(() => done(Object.assign(new Error(`git exit ${code}`), { code }), ''));
    switch (rest[0]) {
      case 'config': fail(1); break;
      case 'rev-parse': if (repo) ok(`${repo}\n${git.repos.get(repo)!}\n${'a'.repeat(40)}\n`); else fail(128); break;
      case 'status': if (repo) ok(git.dirty.has(repo) ? ' M src/a.ts\n?? nota.txt\n' : ''); else fail(128); break;
      case 'worktree': git.repos.set(rest[4]!, git.repos.get(repo!)!); ok(); break;
      default: fail(129);
    }
    return { stdin: null };
  },
}));
const { ChatManager } = await import('../../../src/main/chats/manager');
const { DelegateWorktrees } = await import('../../../src/main/agents/worktrees');
const { delegationTools } = await import('../../../src/main/agents/delegation');
const { appControlTools } = await import('../../../src/main/appctl/tools');
const { AgentCatalogService } = await import('../../../src/main/agents/catalog');
const { routeChat } = await import('../../../src/main/brain/routing');
const { ROLE_DEFAULTS, DELEGATION_DEFAULTS, isWorkRole } = await import('../../../src/shared/roles');
const { closeAppDbs } = await import('../../../src/main/app-db');

const roots: string[] = [], managers: InstanceType<typeof ChatManager>[] = [];
afterEach(async () => {
  try { for (const m of managers.splice(0)) await m.shutdown(); }
  finally { closeAppDbs(); git.dirty.clear(); git.repos.clear(); git.ran.length = 0; for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

function world() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-folders-'))); roots.push(root);
  const brain = path.join(root, 'brain'), air = path.join(root, 'air'), slot = path.join(root, 'air-wt-1'), data = path.join(root, 'data');
  for (const d of [brain, air, slot, data]) fs.mkdirSync(d);
  for (const d of [brain, air, slot]) git.repos.set(d, path.join(d, '.git'));
  const starts = new Map<string, SessionOptions>(), sent = new Map<string, string[]>(), sinks = new Map<string, SessionSink>();
  const cat = new AgentCatalogService({ userData: data, models: () => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: true, authenticated: true } satisfies AgentModelChoice] });
  const worktrees = new DelegateWorktrees(path.join(data, 'isolation.json'), () => brain);
  const m = new ChatManager({ userData: data, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, prepareDelegation: worktrees.prepare,
    resolveAgent: (req: NewChat) => {
      const id = req.roleId;
      if (!id || !isWorkRole(id)) return { request: req, owner: { id: 'plain', name: 'Chat', purpose: '', engine: req.harness, model: null, revision: 0, source: 'plain' as const }, instructions: '', policy: null, skills: [], launches: [] };
      const r = ROLE_DEFAULTS[id], p = cat.list().profiles.find(x => x.id === id)!;
      return { request: req, owner: { id, name: r.name, purpose: r.summary, engine: 'claude', model: null, revision: p.updatedAt, source: 'catalog' as const, version: p.activeVersion }, instructions: r.instructions, policy: null, skills: [], launches: [...r.launches], assets: { pluginDir: path.join(data, 'p'), skillRoot: path.join(data, 'p', 's') } };
    },
    sessionFactory: (_h, o, s) => {
      starts.set(o.chatId, o); sinks.set(o.chatId, s);
      return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
        start() { s.changed({ state: 'idle' }); }, send(text: string) { sent.set(o.chatId, [...(sent.get(o.chatId) ?? []), text]); },
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => true,
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null } as unknown as HarnessSession;
    } });
  managers.push(m);
  const tools = delegationTools({ chats: m, roles: () => cat.list(), settings: () => DELEGATION_DEFAULTS, engineRefusal: () => null, label: '[agente]', runs: () => m.runs.list(), isolated: c => worktrees.isolated(c),
    integrate: async () => { throw new Error('integrated'); } });
  const call = async (name: string, chatId: string, args: Record<string, unknown>) => JSON.parse(await tools.find(t => t.name === name)!.run(args, { mount: 'chat', params: { chatId }, sessionId: '', signal: new AbortController().signal } as never) as string);
  const get = (id: string) => m.list().find(c => c.id === id)!;
  const strategist = (cwd: string) => m.create({ harness: 'claude', cwd, roleId: 'strategist', title: `Piano ${path.basename(cwd)}`, prompt: 'x' }, 'user');
  const part = (role: string, title: string, extra: Record<string, unknown> = {}, contract: Record<string, unknown> = {}) => ({ role, title, contract: { goal: `Goal of ${title}`, doneWhen: ['done'], ...contract }, ...extra });
  const delegate = async (parent: string, t: Record<string, unknown>) => (await call('agent_delegate', parent, { tasks: [t] })).children[0] as Record<string, unknown>;
  // the Orchestrator's own tools on the same manager
  const orchestrator = async () => {
    const o = await m.create({ harness: 'claude', cwd: brain, orchestrator: true }, 'user');
    const service = { modelRegistry: () => null, route: (req: never) => routeChat(req, null, null, 7), settings: () => ({ messaging: { crossHarness: true }, engineOn: { claude: true }, engines: { claude: true }, orchestratorChats: { harness: 'claude' } }), info: () => ({ brainRoot: brain }) } as unknown as BrainService;
    const app = appControlTools({ chats: m as unknown as ChatService, browser: {} as BrowserService, brain: service, window: () => null, emitUi: () => {}, version: '0', agents: () => cat.list(), resolveRole: req => cat.resolve(req) }, o.id);
    return { o, run: async (name: string, a: Record<string, unknown>) => await app.find(t => t.name === name)!.run(a) as Record<string, unknown> };
  };
  const report = (id: string) => call('agent_report', id, { outcome: 'done', summary: 's', output: 'o', doneWhen: [{ criterion: 'done', met: true, evidence: 'e' }] });
  return { m, root, brain, air, slot, data, starts, sent, sinks, worktrees, call, get, strategist, part, delegate, orchestrator, report };
}
const made = () => git.ran.filter(r => r[0] === 'worktree');
/** commands that would change a checkout */
const touched = () => git.ran.filter(r => ['stash', 'checkout', 'reset', 'clean', 'add', 'commit', 'switch', 'restore', 'worktree'].includes(r[0]!));

describe('a chat works where whoever opens it says (ADR 0358)', () => {
  it('1 · a Strategist born in the brain opens an Artisan in place in a slot: no new worktree', async () => {
    const w = world(), s = await w.strategist(w.brain);
    const child = await w.delegate(s.id, w.part('artisan', 'Slot', { cwd: w.slot, place: 'here' }));
    expect(child).toMatchObject({ cwd: w.slot });
    expect(w.starts.get(child.chatId as string)!.cwd).toBe(w.slot);
    expect(w.get(child.chatId as string).place).toBeUndefined();
    // the same with no place: in place is the default, a copy is never made by itself
    const other = await w.delegate(s.id, w.part('artisan', 'Aria', { cwd: w.air }));
    expect(other).toMatchObject({ cwd: w.air });
    expect(made()).toEqual([]);
    // asked in so many words, a copy is made
    const copy = await w.delegate(s.id, w.part('artisan', 'Copia', { cwd: w.air, place: 'copy' }));
    expect(copy.place).toBe('copy');
    expect(copy.cwd).not.toBe(w.air);
    expect(made()).toHaveLength(1);
  });

  it('2 · a Strategist born in a product repository opens a chat in the brain', async () => {
    const w = world(), s = await w.strategist(w.air);
    git.dirty.add(w.air); // the parent's folder never limits the child's
    const child = await w.delegate(s.id, w.part('artisan', 'Note', { cwd: w.brain }));
    expect(child).toMatchObject({ cwd: w.brain });
    expect(w.starts.get(child.chatId as string)!.cwd).toBe(w.brain);
  });

  it('3 · the Orchestrator and a Strategist get the same with the same parameters', async () => {
    const w = world(), { run } = await w.orchestrator(), s = await w.strategist(w.brain);
    git.dirty.add(w.slot);
    for (const place of ['here', undefined, 'copy'] as const) {
      if (place === 'copy') git.dirty.clear();
      const p = { cwd: w.slot, ...(place ? { place } : {}) };
      const byStrategist = await w.delegate(s.id, w.part('artisan', `S ${place}`, p));
      await w.report(byStrategist.chatId as string);
      const byOrchestrator = await run('app_create_chat', { title: `O ${place}`, roleId: 'artisan', prompt: 'p', ...p });
      const a = w.get(byStrategist.chatId as string), b = w.get(byOrchestrator.chatId as string);
      expect(b.place).toBe(a.place);
      expect(byOrchestrator.place).toBe(byStrategist.place);
      if (place === 'copy') { expect(b.cwd).not.toBe(w.slot); expect(a.cwd).not.toBe(w.slot); }
      else { expect([a.cwd, b.cwd]).toEqual([w.slot, w.slot]); expect(b.folderNotes).toEqual(a.folderNotes); }
      await w.report(b.id);
    }
    // and the same refusal
    const missing = path.join(w.root, 'nope');
    await expect(w.delegate(s.id, w.part('artisan', 'X', { cwd: missing }))).rejects.toThrow(`Cartella non valida: ${missing}: non esiste.`);
    await expect(run('app_create_chat', { title: 'Y', roleId: 'artisan', prompt: 'p', cwd: missing })).rejects.toThrow(`Cartella non valida: ${missing}: non esiste.`);
  });

  it('4 · «Riprendi» starts in the last folder, or in another one when asked; nothing is moved', async () => {
    const w = world(), s = await w.strategist(w.brain);
    const first = w.get((await w.delegate(s.id, w.part('artisan', 'Lavoro', { cwd: w.slot }))).chatId as string);
    const next = await w.m.continueChat(first.id, { ask: false });
    expect(next.cwd).toBe(w.slot);
    const elsewhere = await w.m.continueChat(next.id, { ask: false, cwd: w.air });
    expect(elsewhere.cwd).toBe(w.air);
    expect(elsewhere.continuedFrom).toMatchObject({ id: next.id });
    expect(w.sent.get(elsewhere.id)!.join('\n')).toMatch(/la chat precedente lavorava in .*air-wt-1.*niente viene spostato/);
    expect(touched()).toEqual([]);
    // through the Orchestrator's tool too (a root chat)
    const { run } = await w.orchestrator();
    const root = await run('app_create_chat', { title: 'Radice', roleId: 'artisan', prompt: 'p', cwd: w.slot });
    const goOn = vi.spyOn(w.m, 'continueChat').mockImplementation(async () => ({ ...w.get(root.chatId as string), cwd: w.brain }));
    expect(await run('app_continue_chat', { chatId: root.chatId, cwd: w.brain })).toMatchObject({ cwd: w.brain, continuedFrom: root.chatId });
    expect(goOn).toHaveBeenCalledWith(root.chatId, expect.objectContaining({ cwd: w.brain }));
  });

  it('5 · a slot with uncommitted changes: the chat starts, is told, and nothing is lost', async () => {
    const w = world(), s = await w.strategist(w.brain);
    git.dirty.add(w.slot);
    const before = fs.readdirSync(w.slot);
    const child = await w.delegate(s.id, w.part('artisan', 'Sporco', { cwd: w.slot }));
    expect(child.error).toBeUndefined();
    expect((child.warnings as string[]).join(' ')).toMatch(/2 modifiche non committate \(src\/a\.ts, nota\.txt\).*niente stash/);
    expect(w.sent.get(child.chatId as string)![0]).toMatch(/2 modifiche non committate/);
    expect(touched()).toEqual([]);
    expect(fs.readdirSync(w.slot)).toEqual(before);
  });

  it('6 · reuse in another folder opens a linked chat with its context, plan step and history', async () => {
    const w = world(), s = await w.strategist(w.brain);
    const child = w.get((await w.delegate(s.id, w.part('artisan', 'Parte', { cwd: w.slot }))).chatId as string);
    await w.report(child.id);
    w.sinks.get(child.id)!.item({ kind: 'result', id: 'r1', at: Date.now(), costUsd: 0, durationMs: 1, turns: 1, isError: false }, false);
    w.sinks.get(child.id)!.changed({ state: 'idle' });
    const out = await w.call('agent_assign_task', s.id, { chatId: child.id, roleId: 'artisan', mode: 'continue', cwd: w.air, contract: { goal: 'Prosegui altrove', doneWhen: ['provato'] } });
    const linked = w.get(out.chatId as string);
    expect(out).toMatchObject({ continuedFrom: child.id, cwd: w.air });
    expect(linked).toMatchObject({ cwd: w.air, parentId: s.id, continuedFrom: { id: child.id } });
    expect(linked.delegation).toMatchObject({ role: 'artisan', doneWhen: ['provato'] });
    expect(linked.delegation!.result).toBeUndefined();
    expect(linked.run!.continuedFrom).toBe(child.run!.runId);
    const told = w.sent.get(linked.id)!.join('\n');
    expect(told).toMatch(/Parte/); // the hand-off of the chat it goes on from
    expect(told).toMatch(/Nuovo compito:[\s\S]*Prosegui altrove/);
    expect(w.get(child.id).continuedBy).toMatchObject({ id: linked.id });
    // the Orchestrator's reuse does the same
    const { run } = await w.orchestrator();
    const root = await run('app_create_chat', { title: 'Radice', roleId: 'artisan', prompt: 'p', cwd: w.slot });
    const moved = await run('app_assign_task', { chatId: root.chatId, roleId: 'artisan', mode: 'continue', cwd: w.brain, prompt: 'Vai avanti nel cervello' }).catch((e: Error) => ({ error: e.message }));
    expect(moved).toMatchObject({ continuedFrom: root.chatId, cwd: w.brain });
  });

  it('6 · the plan step moves to the linked chat', async () => {
    const w = world(), s = await w.strategist(w.brain);
    const child = w.get((await w.delegate(s.id, w.part('artisan', 'Passo', { cwd: w.slot }))).chatId as string);
    const rec = (w.m as unknown as { chats: Map<string, { s: ChatSummary }> }).chats.get(s.id)!;
    rec.s.plan = { phase: 'running', at: 1, clarified: [], steps: [{ title: 'Passo', state: 'now', chatIds: [child.id] }] } as unknown as ChatSummary['plan'];
    const linked = await w.m.continueChat(child.id, { ask: false, cwd: w.air });
    expect(w.get(s.id).plan!.steps[0]!.chatIds).toEqual([linked.id]);
  });

  it('7 · a read-only chat writes nowhere, whatever its folder', async () => {
    const w = world(), s = await w.strategist(w.brain);
    for (const cwd of [w.brain, w.air, w.slot]) {
      const child = await w.delegate(s.id, w.part('artisan', `Legge ${path.basename(cwd)}`, { cwd }, { tools: ['read'] }));
      expect(w.m.agentPolicy(child.chatId as string)).toMatchObject({ tools: { allow: ['read'] } });
      expect(w.starts.get(child.chatId as string)!.cwd).toBe(cwd);
    }
    // a linked chat in another folder keeps exactly that policy
    const one = await w.delegate(s.id, w.part('artisan', 'Solo lettura', { cwd: w.slot }, { tools: ['read'] }));
    const linked = await w.m.continueChat(one.chatId as string, { ask: false, cwd: w.air });
    expect(w.m.agentPolicy(linked.id)).toEqual(w.m.agentPolicy(one.chatId as string));
    expect(touched()).toEqual([]);
  });

  it('8 · a folder that is not there, or is a file, is refused by name, and no chat is left half made', async () => {
    const w = world(), s = await w.strategist(w.brain), before = w.m.list().length, runs = w.m.runs.list().length;
    const missing = path.join(w.root, 'sparita'), file = path.join(w.root, 'file.txt');
    fs.writeFileSync(file, 'x');
    await expect(w.delegate(s.id, w.part('artisan', 'A', { cwd: missing }))).rejects.toThrow(`Cartella non valida: ${missing}: non esiste.`);
    await expect(w.delegate(s.id, w.part('artisan', 'B', { cwd: file }))).rejects.toThrow(`Cartella non valida: ${file}: è un file, non una cartella.`);
    await expect(w.m.create({ harness: 'claude', cwd: missing, prompt: 'x' }, 'user')).rejects.toThrow('non esiste');
    const chat = w.get((await w.delegate(s.id, w.part('artisan', 'C', { cwd: w.slot }))).chatId as string);
    await expect(w.m.continueChat(chat.id, { ask: false, cwd: missing })).rejects.toThrow(`Cartella non valida: ${missing}: non esiste.`);
    expect(w.get(chat.id).continuedBy).toBeUndefined();
    expect(w.m.list()).toHaveLength(before + 1);
    expect(w.m.runs.list()).toHaveLength(runs + 1);
  });

  it('two chats that write in the same folder: the second one and who opened it are told, never in silence', async () => {
    const w = world(), s = await w.strategist(w.brain);
    const first = await w.delegate(s.id, w.part('artisan', 'Prima', { cwd: w.slot }));
    const sub = path.join(w.slot, 'src'); fs.mkdirSync(sub);
    const second = await w.delegate(s.id, w.part('artisan', 'Seconda', { cwd: sub }));
    expect((second.warnings as string[]).join(' ')).toContain(`sta già scrivendo «Prima» (${first.chatId as string})`);
    expect(w.sent.get(second.chatId as string)![0]).toMatch(/Non scrivere sugli stessi file/);
    // a reader is not a writer, and once both reported nobody is in the way
    expect((await w.delegate(s.id, w.part('scout', 'Legge', { cwd: w.slot }))).warnings ?? []).not.toEqual(expect.arrayContaining([expect.stringMatching(/sta già scrivendo/)]));
    await w.report(first.chatId as string); await w.report(second.chatId as string);
    expect(((await w.delegate(s.id, w.part('artisan', 'Terza', { cwd: w.slot }))).warnings as string[] | undefined ?? []).join(' ')).not.toMatch(/sta già scrivendo/);
  });

  it('a child that worked in place has nothing to integrate: its commits are already in the folder', async () => {
    const w = world(), s = await w.strategist(w.brain);
    const child = await w.delegate(s.id, w.part('artisan', 'In place', { cwd: w.slot }));
    await w.report(child.chatId as string);
    expect(await w.call('agent_integrate_child', s.id, { chatId: child.chatId })).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/worked in place, its commits are already in that folder/) });
  });
});
