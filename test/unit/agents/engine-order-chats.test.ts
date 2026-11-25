// The one order of the engines on real chats (ADR 0355): AgentCatalogService's pick, ChatManager's start, reuse and
// «Riprendi» (agents/engine-now.ts, manager-work.ts assignElsewhere), and the settings and panels that change the order
// (app_config, appctl/pending-config.ts, appctl/user-words.ts). Fake engines; no process, no clock to wait for.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService, NoEngine } from '../../../src/main/agents/catalog';
import { engineNowOf } from '../../../src/main/agents/engine-now';
import { delegationTools } from '../../../src/main/agents/delegation';
import { configTool, changedDraft, roleReason, type ConfigDeps } from '../../../src/main/appctl/config';
import { PendingConfig, CONFIG_TOOL } from '../../../src/main/appctl/pending-config';
import { answeredText, noteUserAnswered, userAsked } from '../../../src/main/appctl/user-words';
import { ConfigStore } from '../../../src/main/brain/config';
import { closeAppDbs } from '../../../src/main/app-db';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import type { AgentModelChoice } from '../../../src/shared/agents';
import type { Answer, Harness, PendingRequest } from '../../../src/shared/contract';
import type { Room } from '../../../src/shared/model-levels';
import { DELEGATION_DEFAULTS } from '../../../src/shared/roles';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => {
  try { for (const m of managers.splice(0)) await m.shutdown(); }
  finally { closeAppDbs(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});
const tmp = () => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-engine-order-'))); roots.push(d); return d; };

function world() {
  const dir = tmp(), room: Record<string, Room['state']> = {}, connected: Record<string, boolean> = {}, trouble = new Set<string>();
  const store = new ConfigStore(path.join(dir, 'cfg'), {});
  fs.mkdirSync(path.join(dir, 'cfg'), { recursive: true });
  const engine = (id: Harness, label: string, models: { id: string; name: string }[]): AgentModelChoice => ({ engine: id, label, enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models, installed: true, authenticated: connected[id] !== false });
  const c = new AgentCatalogService({ userData: dir,
    models: () => [engine('claude', 'Claude', [{ id: 'opus', name: 'Opus' }]), engine('opencode', 'OpenCode', [{ id: 'openai/sol', name: 'Sol' }]), engine('antigravity', 'Antigravity', [{ id: 'neon', name: 'Neon' }])],
    tierModel: () => 'opus', engineOrder: () => store.get().engineOrder ?? [], engineTrouble: e => trouble.has(e),
    room: e => ({ state: room[e] ?? 'ok', why: '', resetsAt: null }) });
  const lists = { base: [{ engine: 'claude', model: 'opus', effort: 'high' as const }, { engine: 'antigravity', model: 'neon', effort: 'medium' as const }, { engine: 'opencode', model: 'openai/sol', effort: 'low' as const }] };
  for (const id of ['artisan', 'scout', 'strategist']) { const p = c.list().profiles.find(x => x.id === id)!; c.save(changedDraft(p, 'levels', lists), id); }
  const harnesses = new Map<string, Harness>(), sinks = new Map<string, SessionSink>(), sent = new Map<string, string[]>();
  const m: ChatManager = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, resolveAgent: req => c.resolve(req),
    engineNow: x => engineNowOf(x, { cardNow: (r, a, d) => c.cardNow(r, a, d), chat: id => m.list().find(y => y.id === id) }),
    startFailed: x => { trouble.add(x.harness); try { return engineNowOf(x, { cardNow: (r, a, d) => c.cardNow(r, a, d), chat: id => m.list().find(y => y.id === id) }) !== null; } catch { return false; } },
    sessionFactory: (h, o, s) => {
      harnesses.set(o.chatId, h); sinks.set(o.chatId, s);
      return { harness: h, sessionId: null, pid: null, root: null, alive: true, busy: false, start() { s.changed({ state: 'idle' }); }, send(t: string) { sent.set(o.chatId, [...(sent.get(o.chatId) ?? []), t]); },
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => true,
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null } as unknown as HarnessSession;
    } });
  managers.push(m);
  const start = (roleId = 'artisan', extra: Record<string, unknown> = {}) => m.create({ harness: 'claude', cwd: dir, roleId, title: `Chat ${Math.random()}`, prompt: 'x', ...extra } as never, 'user');
  const get = (id: string) => m.list().find(x => x.id === id)!;
  const why = (id: string) => get(id).run!.presetChoice!.route;
  const order = (...ids: Harness[]) => { const r = store.request('engineOrder', ids, { by: 'user' }); if ('error' in r) throw new Error(r.error); };
  // app_config with the app's own panels, as wiring.ts makes them
  const events: { ch: string; p: unknown }[] = [];
  const pending = new PendingConfig({ file: path.join(dir, 'config-pending.json'), emit: (ch, p) => { events.push({ ch, p }); },
    apply: x => { if (x.area === 'setting') { const r = store.request(x.key, x.value, { by: 'user', direct: true }); if ('error' in r) throw new Error(r.error); return; } c.save(changedDraft(c.list().profiles.find(p => p.id === x.agentId)!, x.key, x.value), x.agentId!, roleReason(x.reason)); } });
  let asked = false;
  const config = (over: Partial<ConfigDeps> = {}) => configTool({ callerId: 'orch', userAsked: () => asked, held: pending,
    brain: { settings: () => store.get(), settingsSchema: () => store.schema(), settingsHistory: n => store.history(n), undoSetting: (id, by = 'user', o) => store.undo(id, { by, ...o }), requestSetting: (k, v, o) => store.request(k, v, o) },
    agents: { list: () => c.list(), save: (d, id, r) => c.save(d, id, r), history: id => c.history(id), restore: (id, v) => c.restoreVersion(id, v), presetsOf: p => c.presetsOf(p), levelsOf: p => c.levelsFor(p) }, ...over });
  const set = (a: Record<string, unknown>, over?: Partial<ConfigDeps>) => Promise.resolve().then(() => config(over).run({ action: 'set', ...a }));
  const yes: Answer = { kind: 'question', answers: { q: 'Sì (consigliato)' } } as Answer;
  return { dir, c, m, room, connected, trouble, store, start, get, why, order, harnesses, sinks, sent, pending, events, set, yes, ask: (v: boolean) => { asked = v; } };
}

describe('the one order of the engines (ADR 0355)', () => {
  it('1 · OpenAI first and available: the Artisan starts on OpenAI, whatever its list says first', async () => {
    const w = world();
    expect((await w.start()).harness).toBe('claude'); // no order yet: the list's own
    w.order('opencode', 'antigravity', 'claude');
    const a = await w.start();
    expect([a.harness, a.model]).toEqual(['opencode', 'openai/sol']);
    expect(w.why(a.id)).toBe('OpenAI Sol: primo disponibile');
    // for every role, with one order; a role's own exception is the only other way
    expect((await w.start('scout')).harness).toBe('opencode');
    w.c.save(changedDraft(w.c.list().profiles.find(p => p.id === 'scout')!, 'engineOrder', ['antigravity', 'opencode', 'claude']), 'scout');
    expect((await w.start('scout')).harness).toBe('antigravity');
    expect((await w.start('artisan')).harness).toBe('opencode');
  });

  it('2 · OpenAI at its limit: it starts on the second one, and the chat says why', async () => {
    const w = world(); w.order('opencode', 'antigravity', 'claude');
    w.room.opencode = 'out';
    const a = await w.start();
    expect(a.harness).toBe('antigravity');
    expect(w.why(a.id)).toBe('Antigravity Neon: OpenAI al limite');
    // past the user's threshold: the next one before the credits end
    w.room.opencode = 'over';
    const b = await w.start();
    expect(w.why(b.id)).toBe('Antigravity Neon: OpenAI oltre la soglia');
    // the reason stays on the run
    expect(w.m.runs.get(b.run!.runId)!.presetChoice!.route).toBe('Antigravity Neon: OpenAI oltre la soglia');
  });

  it('3 · an engine not connected is passed over, and the chat says why; Claude only because the others cannot', async () => {
    const w = world(); w.order('opencode', 'antigravity', 'claude');
    w.room.opencode = 'out'; w.connected.antigravity = false;
    const a = await w.start();
    expect(a.harness).toBe('claude');
    expect(w.why(a.id)).toBe('Claude Opus: OpenAI al limite, Antigravity non collegato');
    // an engine in error is passed over too while another one may start
    w.room.opencode = 'ok'; w.trouble.add('opencode'); w.connected.antigravity = true;
    expect(w.why((await w.start()).id)).toBe('Antigravity Neon: OpenAI in errore');
  });

  it('3 · an engine that fails at its start: the chat waits and goes to the next one by itself', async () => {
    const w = world(); w.order('opencode', 'antigravity', 'claude');
    const a = await w.start();
    w.sinks.get(a.id)!.exit({ code: 1, error: 'login scaduto' });
    expect(w.get(a.id).creditWait).toMatchObject({ why: 'start', card: 'opencode:openai/sol' });
    const on = w.c.cardNow('artisan', {});
    expect(on).toMatchObject({ engine: 'antigravity', route: 'Antigravity Neon: OpenAI in errore' });
    expect(await w.m.creditContinue(a.id, on)).toBe(true);
    const next = w.get(w.get(a.id).continuedBy!.id);
    expect(next.harness).toBe('antigravity');
    expect(next.run!.presetChoice!.route).toBe('Antigravity Neon: OpenAI in errore');
  });

  it('4 · every engine at its limit: nothing starts, and the refusal says so', async () => {
    const w = world(); w.order('opencode', 'antigravity', 'claude');
    for (const e of ['opencode', 'antigravity', 'claude']) w.room[e] = 'out';
    const before = w.m.list().length;
    await expect(w.start()).rejects.toThrow('Tutti i motori di Artisan (livello base) sono al limite: OpenAI al limite, Antigravity al limite, Claude al limite. Niente è partito.');
    await expect(w.start()).rejects.toBeInstanceOf(NoEngine);
    expect(w.m.list()).toHaveLength(before);
    expect(w.harnesses.size).toBe(0);
    // the user's own pick for one job is refused the same way, never started in silence
    expect(() => w.c.resolve({ harness: 'claude', cwd: w.dir, roleId: 'artisan', userModel: { engine: 'claude', model: 'opus' } } as never)).toThrow(/opus non può partire: Claude al limite/);
  });

  it('5 · yes on the panel: the order is saved and the next start uses it', async () => {
    const w = world();
    // not asked in words: not applied, kept «da applicare», on a panel that names the exact change
    await expect(w.set({ area: 'setting', key: 'engineOrder', value: ['opencode', 'antigravity', 'claude'] })).rejects.toThrow(/bloccato: .*Non persa: è «da applicare»/);
    expect(w.store.get().engineOrder).toEqual([]);
    const [panel] = w.pending.pending() as [PendingRequest];
    expect(panel).toMatchObject({ tool: CONFIG_TOOL, type: 'question', chatId: 'orch' });
    expect(panel.title).toBe('Ordine dei motori per tutti i ruoli: OpenAI, poi Antigravity, poi Claude. Applico?');
    w.pending.answer(panel.id, w.yes);
    expect(w.store.get().engineOrder).toEqual(['opencode', 'antigravity', 'claude']);
    expect(w.pending.pending()).toEqual([]);
    expect((await w.start()).harness).toBe('opencode');
  });

  it('5 · a yes to the Orchestrator\'s own card that names the change is enough, also when news lands right after it', async () => {
    const w = world(), at = Date.now();
    // what happened on 2026-11-24: the held news reached the chat 0,1 s after the yes, so the old proof is gone
    expect(userAsked({ answered: at, lastUserItem: at + 117, now: at + 5_000, freshMs: 600_000, turnMs: 7_200_000 })).toBe(false);
    noteUserAnswered('orch', at, 'Claude per ultimo?\nPrima OpenAI, poi Antigravity, Claude per ultimo, per tutti i ruoli.');
    const said = { saidYesTo: () => answeredText('orch', at - 600_000) };
    expect(await w.set({ area: 'setting', key: 'engineOrder', value: ['opencode', 'antigravity', 'claude'] }, said)).toMatchObject({ changed: 'engineOrder' });
    // the same yes is no ok for another order, nor for another change
    await expect(w.set({ area: 'setting', key: 'engineOrder', value: ['claude', 'opencode', 'antigravity'] }, said)).rejects.toThrow(/da applicare/);
    await expect(w.set({ area: 'agent', agentId: 'artisan', key: 'model', value: 'opus' }, said)).rejects.toThrow(/da applicare/);
    // an old yes, or one with no words, proves nothing
    expect(answeredText('orch', at + 1)).toBeNull();
    noteUserAnswered('orch2', at);
    expect(answeredText('orch2', 0)).toBeNull();
  });

  it('6 · a refused change: its reason is shown and it stays «da applicare», over a restart too; No drops it', async () => {
    const w = world();
    w.ask(true); // the user did ask
    const levels = { base: [{ engine: 'opencode', model: 'openai/nuovo' }, { engine: 'claude', model: 'opus' }] };
    await expect(w.set({ area: 'agent', agentId: 'artisan', key: 'levels', value: levels })).rejects.toThrow(/«openai\/nuovo» non è tra quelli noti.*Non persa: è «da applicare»/);
    const panel = w.pending.pending()[0]!;
    expect(panel.detail).toMatch(/Da applicare: .*«openai\/nuovo» non è tra quelli noti/);
    expect(panel.title).toMatch(/Artisan, modelli per livello\. Base: OpenAI openai\/nuovo, poi Claude Opus/);
    // yes while it still cannot be applied: not lost, the reason again
    expect(() => w.pending.answer(panel.id, w.yes)).toThrow(/non è tra quelli noti/);
    expect(w.pending.pending()).toHaveLength(1);
    // his own words are a clarification, never an ok
    w.pending.answer(panel.id, { kind: 'question', answers: { q: 'aspetta domani' } } as Answer);
    expect(w.pending.pending()).toHaveLength(1);
    // a restart keeps it
    const again = new PendingConfig({ file: path.join(w.dir, 'config-pending.json'), emit: () => {}, apply: () => {} });
    expect(again.pending()).toHaveLength(1);
    expect(again.owns(panel.id)).toBe(true);
    w.pending.answer(panel.id, { kind: 'question', answers: { q: 'No' } } as Answer);
    expect(w.pending.pending()).toEqual([]);
    expect(w.c.list().profiles.find(p => p.id === 'artisan')!.levels!.base![0]!.engine).toBe('claude');
  });

  it('7 · reuse and «Riprendi» follow the new order; a chat under way never changes engine by itself', async () => {
    const w = world();
    const s = await w.start('strategist', { title: 'Piano' });
    const tools = delegationTools({ chats: w.m, roles: () => w.c.list(), settings: () => DELEGATION_DEFAULTS, engineRefusal: () => null, label: '[agente]', runs: () => w.m.runs.list(),
      presetChoice: (r, a, d) => w.c.presetChoice(r, a, d), roleEngines: p => w.c.levelsFor(p).base.map(x => x.engine) });
    const call = async (name: string, args: Record<string, unknown>, id = s.id) => JSON.parse(await tools.find(t => t.name === name)!.run(args, { mount: 'chat', params: { chatId: id }, sessionId: '', signal: new AbortController().signal } as never) as string);
    const child = (await call('agent_delegate', { tasks: [{ role: 'artisan', title: 'Parte', contract: { goal: 'g', doneWhen: ['d'] } }] })).children[0];
    expect(child).toMatchObject({ harness: 'claude', engineWhy: 'Claude Opus: primo disponibile' });
    const alone = await w.start('artisan', { title: 'Da riprendere' });
    w.order('opencode', 'antigravity', 'claude');
    // nothing moved by itself
    expect([w.get(child.chatId).harness, w.get(alone.id).harness]).toEqual(['claude', 'claude']);
    expect(w.get(alone.id).continuedBy).toBeUndefined();
    // «Riprendi»
    const next = await w.m.continueChat(alone.id, { ask: false });
    expect(next.harness).toBe('opencode');
    expect(w.get(next.id).run!.presetChoice!.route).toBe('OpenAI Sol: primo disponibile');
    // reuse
    await call('agent_report', { outcome: 'done', summary: 's', output: 'o', doneWhen: [{ criterion: 'd', met: true, evidence: 'e' }] }, child.chatId);
    w.sinks.get(child.chatId)!.item({ kind: 'result', id: 'r', at: Date.now(), costUsd: 0, durationMs: 1, turns: 1, isError: false }, false);
    w.sinks.get(child.chatId)!.changed({ state: 'idle' });
    const out = await call('agent_assign_task', { chatId: child.chatId, roleId: 'artisan', mode: 'continue', contract: { goal: 'ancora', doneWhen: ['d2'] } });
    expect(out).toMatchObject({ continuedFrom: child.chatId, harness: 'opencode' });
    expect(w.get(out.chatId).parentId).toBe(s.id);
    // a model the user asked for that work is kept by «Riprendi»
    const asked = await w.start('artisan', { title: 'Su Claude', userModel: { engine: 'claude', model: 'opus' } });
    expect(w.why(asked.id)).toBe('Claude Opus: chiesto da te per questo lavoro');
    expect((await w.m.continueChat(asked.id, { ask: false })).harness).toBe('claude');
  });

  it('no change of the order raises an effort or a permission', async () => {
    const w = world();
    const before = { claude: w.c.resolve({ harness: 'claude', cwd: w.dir, roleId: 'artisan' } as never) };
    w.order('opencode', 'antigravity', 'claude');
    const after = w.c.resolve({ harness: 'claude', cwd: w.dir, roleId: 'artisan' } as never);
    expect(after.request.effort).toBe('low'); // the effort its own list gives that model, not the first one's
    expect(after.policy).toEqual(before.claude.policy);
    expect(after.launches).toEqual(before.claude.launches);
    // the Orchestrator and a Strategist pick the level, never the engine: the tool has no field for it
    const t = delegationTools({ chats: w.m, roles: () => w.c.list(), settings: () => DELEGATION_DEFAULTS, engineRefusal: () => null, label: 'x', runs: () => [] }).find(x => x.name === 'agent_delegate')!;
    expect(JSON.stringify(t.inputSchema)).not.toMatch(/"(engine|harness|model)"/);
  });
});
