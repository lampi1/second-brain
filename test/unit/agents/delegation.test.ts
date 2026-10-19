// Direct parent-to-child delegation (ADR 0083) on a real ChatManager with fake engines: a Strategist delegates a Scout
// and a Sentinel at once, each child gets only its contract (never the parent's history) and its result comes back to
// the parent as a message; three Scouts run in parallel; the depth and parallel limits refuse visibly; the slots are
// reserved atomically; permissions only go down (contract tools, the parent's ceiling and mode, its folder); a child's
// request beyond its parent's permissions and a hidden sub-agent are refused visibly; a skill works only when its
// launch gave it. Pins agents/delegation.ts, agents/role-gate.ts and the delegation part of chats/manager.ts.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import { delegationTools } from '../../../src/main/agents/delegation';
import { gateRequest } from '../../../src/main/agents/role-gate';
import { ROLE_DEFAULTS, ROLE_IDS, DELEGATION_DEFAULTS, isWorkRole, type DelegationSettings, type RoleId } from '../../../src/shared/roles';
import { checkContract, checkResult, delegationPrompt, depthOf } from '../../../src/shared/delegation';
import type { AgentCatalog } from '../../../src/shared/agents';
import type { NewChat } from '../../../src/shared/contract';
import type { McpTool } from '../../../src/main/mcp/server';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const catalog = (): AgentCatalog => ({ problem: null, archived: [], models: [], profiles: ROLE_IDS.map(id => {
  const r = ROLE_DEFAULTS[id];
  return { id, name: r.name, purpose: r.summary, scope: 'role', engine: 'claude', model: null, tier: r.tier, tierMax: r.tierMax, independent: false,
    launches: r.launches, skills: r.skills, tools: { allow: r.tools }, permissionCeiling: r.ceiling, activeVersion: 1, updatedAt: 1, instructions: r.instructions };
}) } as unknown as AgentCatalog);

function fixture(limits: Partial<DelegationSettings> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-delegation-'));
  roots.push(dir);
  const starts = new Map<string, SessionOptions>(), sinks = new Map<string, SessionSink>(), sent = new Map<string, string[]>(), answers: { chat: string; id: string; answer: { allow?: boolean; message?: string } }[] = [];
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0,
    resolveAgent: (req: NewChat) => {
      const id = req.roleId as RoleId | undefined;
      if (!id || !isWorkRole(id)) return { request: req, owner: { id: 'plain', name: 'Chat', purpose: '', engine: req.harness, model: null, revision: 0, source: 'plain' as const }, instructions: '', policy: null, skills: [], launches: [] };
      const r = ROLE_DEFAULTS[id];
      return { request: req, owner: { id, name: r.name, purpose: r.summary, engine: 'claude', model: null, revision: 1, source: 'catalog' as const, version: 1 }, instructions: r.instructions,
        policy: { tools: { allow: [...r.tools] }, ceiling: r.ceiling }, skills: [...r.skills, ...(req.skills ?? [])], launches: [...r.launches], assets: { pluginDir: path.join(dir, 'p'), skillRoot: path.join(dir, 'p', 'skills') } };
    },
    sessionFactory: (_h, o, s) => {
      starts.set(o.chatId, o); sinks.set(o.chatId, s);
      return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
        start() { s.changed({ state: 'idle' }); }, send(text: string) { sent.set(o.chatId, [...(sent.get(o.chatId) ?? []), text]); },
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {},
        answer: (id: string, answer: { allow?: boolean; message?: string }) => { answers.push({ chat: o.chatId, id, answer }); return true; },
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
      } as unknown as HarnessSession;
    } });
  managers.push(m);
  const tools = delegationTools({ chats: m, roles: catalog, settings: () => ({ ...DELEGATION_DEFAULTS, ...limits }), engineRefusal: () => null, label: '[agente]', runs: () => m.runs.list() });
  const tool = (name: string): McpTool => tools.find(t => t.name === name)!;
  const call = async (name: string, chatId: string, args: Record<string, unknown>) => JSON.parse(await tool(name).run(args, { mount: 'chat', params: { chatId }, sessionId: '', signal: new AbortController().signal } as never) as string);
  const root = (role: RoleId, cwd = dir) => m.create({ harness: 'claude', cwd, roleId: role, title: `${ROLE_DEFAULTS[role].name} root`, prompt: 'PARENT SECRET HISTORY' }, 'user');
  const task = (role: string, title: string, extra: Record<string, unknown> = {}) => ({ role, title, contract: { goal: `Goal of ${title}`, doneWhen: ['criterion A'], ...extra } });
  return { m, dir, starts, sinks, sent, answers, call, root, task };
}

describe('agent_delegate', () => {
  it('a Strategist launches a Scout and a Sentinel at once: two children under it, each with its contract only, and their results come back', async () => {
    const f = fixture();
    const parent = await f.root('strategist');
    const out = await f.call('agent_delegate', parent.id, { tasks: [f.task('scout', 'Ordini · Log'), f.task('sentinel', 'Ordini · Test')] });
    expect(out.children.map((c: { role: string }) => c.role)).toEqual(['scout', 'sentinel']);
    const kids = f.m.list().filter(c => c.parentId === parent.id);
    expect(kids.map(k => k.delegation?.role)).toEqual(['scout', 'sentinel']);
    for (const k of kids) {
      const first = f.sent.get(k.id)?.[0] ?? '';
      expect(first).toContain(`Goal of ${k.title}`);
      expect(first).toContain('criterion A');
      expect(first).toContain('agent_report');
      expect(first).not.toContain('PARENT SECRET HISTORY');
      expect(k.run?.parentRunId).toBe(parent.run?.runId);
      expect(k.run?.startedBy).toBe('parent');
    }
    const scout = kids[0]!;
    await expect(f.call('agent_report', scout.id, { outcome: 'done', summary: 'Trovati 3 errori', output: 'log…', doneWhen: [] })).rejects.toThrow(/criterion A/);
    const r = await f.call('agent_report', scout.id, { outcome: 'done', summary: 'Trovati 3 errori', output: 'log…', doneWhen: [{ criterion: 'criterion A', met: true, evidence: 'logs/x' }] });
    expect(r).toMatchObject({ reported: true, parentId: parent.id, delivered: true });
    await new Promise(res => setTimeout(res, 20));
    const back = f.sent.get(parent.id)!.at(-1)!;
    expect(back).toContain('[risultato · Scout «Ordini · Log»] Trovati 3 errori');
    expect(back).toContain('"criterion": "criterion A"');
    expect(f.m.list().find(c => c.id === scout.id)?.delegation?.result).toMatchObject({ outcome: 'done', summary: 'Trovati 3 errori' });
    expect(f.m.runs.get(scout.run!.runId)?.report).toMatchObject({ outcome: 'done', verified: 'yes' });
    await expect(f.call('agent_report', scout.id, { outcome: 'done', summary: 'again', output: 'x', doneWhen: [{ criterion: 'criterion A', met: true }] })).rejects.toThrow(/already/);
    const listed = await f.call('agent_children', parent.id, {});
    expect(listed.children).toHaveLength(2);
    expect(listed.children[0]).toMatchObject({ role: 'scout', result: { outcome: 'done' } });
  });

  it('three Scouts run in parallel, each a writable chat of its own', async () => {
    const f = fixture();
    const parent = await f.root('strategist');
    const out = await f.call('agent_delegate', parent.id, { tasks: [1, 2, 3].map(n => f.task('scout', `Fonte ${n}`)) });
    expect(out.children).toHaveLength(3);
    const ids: string[] = out.children.map((c: { chatId: string }) => c.chatId);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      await f.m.send(id, 'un messaggio dell’utente');
      expect(f.sent.get(id)?.at(-1)).toBe('un messaggio dell’utente');
    }
  });

  it('refuses beyond the parallel limit, visibly, and reserves the slots atomically', async () => {
    const f = fixture({ maxParallel: 5 });
    const parent = await f.root('strategist');
    const [a, b] = await Promise.allSettled([
      f.call('agent_delegate', parent.id, { tasks: [1, 2, 3].map(n => f.task('scout', `A${n}`)) }),
      f.call('agent_delegate', parent.id, { tasks: [1, 2, 3].map(n => f.task('scout', `B${n}`)) }),
    ]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(f.m.list().filter(c => c.parentId === parent.id)).toHaveLength(3);
    await expect(f.call('agent_delegate', parent.id, { tasks: [1, 2, 3].map(n => f.task('scout', `C${n}`)) })).rejects.toThrow(/3 of 5 children/);
    const p = f.m.list().find(c => c.id === parent.id)!;
    expect(p.limitHit).toMatchObject({ kind: 'parallel', limit: 5 });
    expect(f.m.items(parent.id).some(i => i.kind === 'system' && i.code === 'delegationParallel')).toBe(true);
  });

  it('refuses beyond the depth limit, visibly', async () => {
    const f = fixture({ maxDepth: 2 });
    const root = await f.root('strategist');
    const one = (await f.call('agent_delegate', root.id, { tasks: [f.task('artisan', 'Livello 1')] })).children[0].chatId;
    const two = (await f.call('agent_delegate', one, { tasks: [f.task('sentinel', 'Livello 2')] })).children[0].chatId;
    expect(depthOf(two, id => f.m.list().find(c => c.id === id)?.parentId)).toBe(2);
    await expect(f.call('agent_delegate', two, { tasks: [f.task('scout', 'Livello 3')] })).rejects.toThrow(/depth limit 2/);
    expect(f.m.list().filter(c => c.parentId === two)).toHaveLength(0);
    expect(f.m.list().find(c => c.id === two)?.limitHit).toMatchObject({ kind: 'depth', limit: 2 });
    expect(f.m.items(two).some(i => i.kind === 'system' && i.code === 'delegationDepth')).toBe(true);
  });

  it('permissions only go down: tools beyond the parent, a folder outside it and a role it may not launch are refused', async () => {
    const f = fixture();
    const sub = path.join(f.dir, 'repo'); fs.mkdirSync(sub);
    const parent = await f.root('strategist');
    await expect(f.call('agent_delegate', parent.id, { tasks: [f.task('artisan', 'Fix', { tools: ['edit'] })] })).rejects.toThrow(/edit goes beyond your own permissions/);
    await expect(f.call('agent_delegate', parent.id, { tasks: [{ ...f.task('scout', 'Fuori'), cwd: os.tmpdir() }] })).rejects.toThrow(/inside yours/);
    await expect(f.m.create({ harness: 'claude', cwd: os.tmpdir(), roleId: 'scout', parentId: parent.id }, 'agent')).rejects.toThrow(/dentro quella del genitore/);
    const ok = await f.call('agent_delegate', parent.id, { tasks: [{ ...f.task('artisan', 'Fix'), cwd: sub }] });
    const child = ok.children[0];
    expect(child.chatId).toBeTruthy();
    // the Artisan's own edit tools are cut to the Strategist's (read only), its ceiling to the Strategist's
    const start = f.starts.get(child.chatId)!;
    expect(start.toolPolicy?.allow).not.toContain('edit');
    expect(start.ceiling).toBe(ROLE_DEFAULTS.strategist.ceiling);
    const scout = (await f.call('agent_delegate', parent.id, { tasks: [f.task('scout', 'S')] })).children[0].chatId;
    await expect(f.call('agent_delegate', scout, { tasks: [f.task('artisan', 'X')] })).rejects.toThrow(/may not launch Artisan/);
  });

  it('a child asking for a permission beyond its parent is refused visibly; a hidden sub-agent too; a search is fine', async () => {
    const f = fixture();
    const parent = await f.root('strategist');
    const child = (await f.call('agent_delegate', parent.id, { tasks: [f.task('artisan', 'Fix')] })).children[0].chatId;
    f.sinks.get(child)!.pending({ id: 'e1', type: 'permission', tool: 'Edit', title: 'Edit src/a.ts', detail: '', input: { file_path: 'src/a.ts' }, at: 1 });
    expect(f.answers.find(a => a.id === 'e1')?.answer).toMatchObject({ allow: false });
    expect(f.m.pending().some(p => p.id === 'e1')).toBe(false);
    expect(f.m.items(child).some(i => i.kind === 'system' && i.code === 'aboveParent')).toBe(true);
    f.sinks.get(child)!.pending({ id: 't1', type: 'permission', tool: 'Agent', title: 'Agent', detail: '', input: { subagent_type: 'general-purpose', prompt: 'do the work' }, at: 2 });
    expect(f.answers.find(a => a.id === 't1')?.answer).toMatchObject({ allow: false });
    expect(f.m.items(child).some(i => i.kind === 'system' && i.code === 'subagentRefused')).toBe(true);
    f.sinks.get(child)!.pending({ id: 't2', type: 'permission', tool: 'Agent', title: 'Agent', detail: '', input: { subagent_type: 'Explore' }, at: 3 });
    expect(f.m.pending().some(p => p.id === 't2')).toBe(true); // the user decides, as for any request
  });

  it('a skill works only when the launch gave it', async () => {
    const f = fixture();
    const parent = await f.root('strategist');
    const child = (await f.call('agent_delegate', parent.id, { tasks: [f.task('scout', 'Log', { skills: ['log-search'] })] })).children[0].chatId;
    f.sinks.get(child)!.pending({ id: 's1', type: 'permission', tool: 'Skill', title: 'Skill', detail: '', input: { skill: 'log-search' }, at: 1 });
    expect(f.answers.find(a => a.id === 's1')?.answer).toMatchObject({ allow: true });
    f.sinks.get(child)!.pending({ id: 's2', type: 'permission', tool: 'Skill', title: 'Skill', detail: '', input: { skill: 'deploy-prod' }, at: 2 });
    expect(f.answers.find(a => a.id === 's2')?.answer).toMatchObject({ allow: false });
    expect(f.m.items(child).some(i => i.kind === 'system' && i.code === 'skillRefused')).toBe(true);
    const other = (await f.call('agent_delegate', parent.id, { tasks: [f.task('scout', 'Senza skill')] })).children[0].chatId;
    f.sinks.get(other)!.pending({ id: 's3', type: 'permission', tool: 'Skill', title: 'Skill', detail: '', input: { skill: 'log-search' }, at: 3 });
    expect(f.answers.find(a => a.id === 's3')?.answer).toMatchObject({ allow: false });
  });

  it('the parent and the delegation survive a restart', async () => {
    const f = fixture();
    const parent = await f.root('strategist');
    const child = (await f.call('agent_delegate', parent.id, { tasks: [f.task('scout', 'Persistente')] })).children[0].chatId;
    await f.m.shutdown();
    const again = new ChatManager({ userData: f.dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0 });
    managers.push(again);
    expect(again.list().find(c => c.id === child)).toMatchObject({ parentId: parent.id, delegation: { role: 'scout', goal: 'Goal of Persistente' } });
  });

  it('only a role chat delegates, never the Orchestrator or a plain chat', async () => {
    const f = fixture();
    const plain = await f.m.create({ harness: 'claude', cwd: f.dir, title: 'plain' }, 'user');
    await expect(f.call('agent_delegate', plain.id, { tasks: [f.task('scout', 'x')] })).rejects.toThrow(/only a role chat/);
    await expect(f.m.create({ harness: 'claude', cwd: f.dir, roleId: 'scout', parentId: plain.id }, 'user')).rejects.toThrow(/Delega rifiutata/);
  });
});

describe('questions go to the parent first; the user\'s own messages are known (ADR 0083)', () => {
  it('a child asks its parent; the parent answers it, or sends it on to the user; nobody else may answer', async () => {
    const f = fixture();
    const parent = await f.root('strategist');
    await f.call('agent_delegate', parent.id, { tasks: [f.task('scout', 'Ordini · Log')] });
    const kid = f.m.list().find(c => c.parentId === parent.id)!;
    const asked = await f.call('agent_ask_parent', kid.id, { question: 'Quale servizio: ordini o resi?', options: ['ordini', 'resi'], why: 'cambia i log da leggere' });
    expect(asked.asked).toBe(parent.title);
    const q = f.sent.get(parent.id)!.at(-1)!;
    expect(q).toContain(`[domanda · Scout «Ordini · Log» · chatId ${kid.id}] Quale servizio: ordini o resi?`);
    expect(q).toContain('Opzioni: 1) ordini · 2) resi');
    expect(q).toContain('askUser: true');
    await f.call('agent_answer_child', parent.id, { chatId: kid.id, answer: 'ordini, ultimi 7 giorni' });
    expect(f.sent.get(kid.id)!.at(-1)).toContain('[risposta di Strategist «Strategist root»] ordini, ultimi 7 giorni');
    await f.call('agent_answer_child', parent.id, { chatId: kid.id, askUser: true });
    expect(f.sent.get(kid.id)!.at(-1)).toContain("chiedilo all'utente");
    const other = await f.root('strategist');
    await expect(f.call('agent_answer_child', other.id, { chatId: kid.id, answer: 'x' })).rejects.toThrow(/YOUR delegated/);
    await expect(f.call('agent_ask_parent', parent.id, { question: 'x' })).rejects.toThrow(/only a delegated chat/);
    // the user never sees it as a request: no pending was opened
    expect(f.m.list().find(c => c.id === kid.id)?.pending).toBe(0);
  });

  it('the user writing in a child: the parent gets a line now and the note with its next message; the listener gets his words', async () => {
    const f = fixture();
    const parent = await f.root('strategist');
    await f.call('agent_delegate', parent.id, { tasks: [f.task('scout', 'Ordini · Log')] });
    const kid = f.m.list().find(c => c.parentId === parent.id)!;
    const notes: { text: string; parentTitle: string | null; role: string | null }[] = [];
    f.m.onUserWrote(n => notes.push(n));
    f.m.userWrote(kid.id, `Guarda solo marzo. ${'x'.repeat(400)}`);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ parentTitle: parent.title, role: 'Scout' });
    expect(notes[0]!.text.length).toBeLessThanOrEqual(300);
    expect(f.m.notesWaiting(parent.id)).toHaveLength(1);
    const items = f.m.items(parent.id);
    expect(items.some(i => i.kind === 'system' && i.code === 'userWroteChild')).toBe(true);
    await f.m.send(parent.id, 'vai avanti');
    const last = f.sent.get(parent.id)!.at(-1)!;
    expect(last).toContain("l'utente ha scritto direttamente");
    expect(last).toContain('Scout «Ordini · Log»');
    expect(last).toContain('Guarda solo marzo.');
    expect(last.endsWith('vai avanti')).toBe(true);
    expect(f.m.notesWaiting(parent.id)).toHaveLength(0);
    // the Orchestrator and a root chat give no parent note
    f.m.userWrote(parent.id, 'ciao');
    expect(notes.at(-1)).toMatchObject({ parentId: null });
  });

  it('a goal the user changed: the report says so, the card shows the user\'s goal and keeps the contract\'s', async () => {
    const f = fixture();
    const parent = await f.root('strategist');
    await f.call('agent_delegate', parent.id, { tasks: [f.task('scout', 'Ordini · Log')] });
    const kid = f.m.list().find(c => c.parentId === parent.id)!;
    await expect(f.call('agent_report', kid.id, { outcome: 'done', summary: 's', output: 'o', doneWhen: [], newGoal: 'x' })).rejects.toThrow(/goalChangedByUser/);
    await f.call('agent_report', kid.id, { outcome: 'done', summary: 'Resi di marzo letti', output: 'o', doneWhen: [], goalChangedByUser: true, newGoal: 'Leggere i resi di marzo' });
    const d = f.m.list().find(c => c.id === kid.id)!.delegation!;
    expect(d.goal).toBe('Leggere i resi di marzo');
    expect(d.originalGoal).toBe('Goal of Ordini · Log');
    await new Promise(res => setTimeout(res, 20));
    expect(f.sent.get(parent.id)!.at(-1)).toContain("obiettivo cambiato dall'utente nella chat figlia: «Leggere i resi di marzo»");
  });
});

describe('the pure parts', () => {
  it('checks a contract strictly and keeps the role output as default', () => {
    expect(checkContract({ goal: 'g', doneWhen: ['a'] }, 'scout').output).toBe(ROLE_DEFAULTS.scout.output);
    expect(() => checkContract({ goal: 'g', doneWhen: [] }, 'scout')).toThrow(/doneWhen/);
    expect(() => checkContract({ goal: 'g', doneWhen: ['a'], tools: ['root'] }, 'scout')).toThrow(/tools/);
    expect(() => checkContract({ goal: 'g', doneWhen: ['a'], extra: 1 }, 'scout')).toThrow(/unknown field/);
  });
  it('a result answers every criterion; done needs them all met', () => {
    expect(() => checkResult({ outcome: 'done', summary: 's', output: 'o', doneWhen: [{ criterion: 'a', met: false }] }, ['a'])).toThrow(/partial/);
    expect(checkResult({ outcome: 'partial', summary: 's', output: 'o', doneWhen: [{ criterion: 'a', met: false }] }, ['a']).outcome).toBe('partial');
  });
  it('the first message carries the contract and never more', () => {
    const text = delegationPrompt({ goal: 'G', output: 'O', doneWhen: ['D'], context: 'C' }, { role: 'judge', parentTitle: 'P', title: 'T', skills: ['s1'] });
    for (const part of ['«P»', 'Judge', 'Goal: G', 'Context: C', 'Output: O', '- D', 'Your skills: s1', 'agent_report']) expect(text).toContain(part);
  });
  it('the gate passes plain chats and non-permission requests', () => {
    expect(gateRequest({ type: 'permission', tool: 'Skill', input: { skill: 'x' } }, { skills: [] }).kind).toBe('pass');
    expect(gateRequest({ type: 'question', tool: 'AskUserQuestion' }, { role: { id: 'scout', name: 'Scout' }, skills: [] }).kind).toBe('pass');
    expect(gateRequest({ type: 'permission', tool: 'Skill', input: { skill: 'plug:brain-edit' } }, { role: { id: 'scribe', name: 'Scribe' }, skills: ['brain-edit'] }).kind).toBe('allow');
  });
  it('a broken parent chain counts as too deep', () => {
    expect(depthOf('a', id => (id === 'a' ? 'b' : id === 'b' ? 'a' : undefined))).toBe(Number.MAX_SAFE_INTEGER);
  });
});
