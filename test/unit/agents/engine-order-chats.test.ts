// The one order of the engines on real chats (ADR 0359): AgentCatalogService's pick, ChatManager's start, reuse and
// «Riprendi» (agents/engine-now.ts, manager-work.ts assignElsewhere), and the settings and panels that change the order
// (app_config, appctl/pending-config.ts, appctl/user-words.ts). Fake engines; no process, no clock to wait for.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService, NoEngine } from '../../../src/main/agents/catalog';
import { engineNowOf, startElsewhere } from '../../../src/main/agents/engine-now';
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
  const now = { cardNow: c.cardNow.bind(c), ordered: (id: string) => c.followsOrder(id) };
  const m: ChatManager = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, resolveAgent: req => c.resolve(req),
    engineNow: x => engineNowOf(x, now), startFailed: x => { trouble.add(x.harness); return startElsewhere(x, now); },
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
  return { dir, c, m, room, connected, trouble, store, start, get, why, order, harnesses, sinks, sent, pending, events, set, yes, now, ask: (v: boolean) => { asked = v; } };
}

describe('the one order of the engines (ADR 0359)', () => {
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
    expect(await w.m.creditContinue(a.id, on, { from: 'openai/sol (opencode)', to: 'neon (antigravity)', level: 'Base', why: 'non è partito' })).toBe(true);
    const next = w.get(w.get(a.id).continuedBy!.id);
    expect(next.harness).toBe('antigravity');
    expect(next.run!.presetChoice!.route).toBe('Antigravity Neon: OpenAI in errore');
  });

  it('4 · every engine at its limit: never in silence, the chat and its reason say it; no engine on: nothing starts', async () => {
    const w = world(); w.order('opencode', 'antigravity', 'claude');
    for (const e of ['opencode', 'antigravity', 'claude']) w.room[e] = 'out';
    // the launch waits for the renewal on the first one (ADR 0354): the order's first, with a warning in the chat
    const a = await w.start();
    expect(a.harness).toBe('opencode');
    expect(a.pick).toMatchObject({ allOut: true });
    expect(w.why(a.id)).toBe('OpenAI Sol: tutti i motori del livello sono al limite');
    expect((w.m.items(a.id)).some(i => i.kind === 'system' && i.level === 'warn' && i.text.includes('tutti i motori del livello sono al limite'))).toBe(true);
    // a reuse never jumps onto another spent plan
    expect(engineNowOf(w.get(a.id), w.now)).toBeNull();
    // no engine of the level can start: nothing starts, and the refusal names each one
    for (const e of ['opencode', 'antigravity', 'claude']) w.connected[e] = false;
    const before = w.m.list().length, started = w.harnesses.size;
    await expect(w.start()).rejects.toThrow(/Nessun modello del livello base di Artisan può partire: .*non collegato.*Niente è partito/);
    await expect(w.start()).rejects.toBeInstanceOf(NoEngine);
    expect([w.m.list().length, w.harnesses.size]).toEqual([before, started]);
    expect(() => w.c.resolve({ harness: 'claude', cwd: w.dir, roleId: 'artisan', userModel: { engine: 'claude', model: 'opus' } } as never)).toThrow(/opus non può partire: non collegato/);
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

  it('a chat that failed mid-turn started: it is not moved as if it never had (finding 4)', async () => {
    const w = world(); w.order('opencode', 'antigravity', 'claude');
    const a = await w.start();
    w.sinks.get(a.id)!.item({ kind: 'tool', id: 't', at: Date.now(), name: 'Write', summary: 'scrive', input: {}, status: 'ok' }, false);
    w.sinks.get(a.id)!.exit({ code: 1, error: 'processo caduto' });
    expect(w.get(a.id).creditWait).toBeUndefined();
    expect(w.get(a.id).state).toBe('error');
  });

  it('a chat that never started begins on the next engine with its whole first message (finding 5)', async () => {
    const w = world(); w.order('opencode', 'antigravity', 'claude');
    const prompt = `Contratto\n${'riga lunga del contratto\n'.repeat(400)}Fatto quando: l'ultima riga arriva intera`;
    const a = await w.start('artisan', { prompt });
    w.sinks.get(a.id)!.exit({ code: 1, error: 'login scaduto' });
    expect(await w.m.creditContinue(a.id, w.c.cardNow('artisan', {}), { from: 'a', to: 'b', level: 'Base', why: 'non è partito' })).toBe(true);
    const next = w.get(w.get(a.id).continuedBy!.id);
    expect(w.sent.get(next.id)!.join('\n')).toContain(prompt);
  });

  it('a new task in a linked chat goes through every check of an assignment and a Strategist asks again (finding 3)', async () => {
    const w = world();
    await w.m.create({ harness: 'claude', cwd: w.dir, orchestrator: true } as never, 'user');
    const s = await w.start('strategist', { title: 'Lavoro' }), other = path.join(w.dir, 'altra'); fs.mkdirSync(other);
    const old = w.get(s.id).run!.runId;
    (w.m as unknown as { need(id: string): { s: { plan?: unknown } } }).need(s.id).s.plan = { phase: 'running', at: 1, steps: [{ text: 'a', role: 'artisan' }], clarified: 1, stopped: true };
    // refused before anything changes: an unknown review, a wrong cursor, a wrong delivery
    await expect(w.m.assignElsewhere(s.id, 'Nuovo', { mode: 'new-task', reviewOf: 'run_no' }, { cwd: other })).rejects.toThrow();
    await expect(w.m.assignElsewhere(s.id, 'Nuovo', { mode: 'new-task', deliveryPolicy: 'boh' as never }, { cwd: other })).rejects.toThrow();
    expect(w.get(s.id).continuedBy).toBeUndefined();
    const next = await w.m.assignElsewhere(s.id, 'Nuovo lavoro', { mode: 'new-task' }, { cwd: other });
    expect(next).toMatchObject({ cwd: other, continuedFrom: { id: s.id } });
    expect(w.get(next.id).plan).toMatchObject({ phase: 'asking' });
    expect(w.sent.get(next.id)!.join('\n')).toContain('Nuovo lavoro');
    // one task, one chain of runs: the old run is over, the new one is the next version
    expect(w.m.runs.get(old)!.endedAt).toBeDefined();
    expect(w.get(next.id).run).toMatchObject({ taskVersion: 2 });
    expect(w.m.runs.list().filter(r => r.chatId === next.id)).toHaveLength(1);
  });

  it('a «Ferma» stays after any move but «Riprendi» (finding 3)', async () => {
    const w = world(), s = await w.start('strategist', { title: 'Fermo' }), other = path.join(w.dir, 'altra'); fs.mkdirSync(other);
    const rec = (w.m as unknown as { need(id: string): { s: { plan?: unknown } } }).need(s.id);
    rec.s.plan = { phase: 'running', at: 1, steps: [{ text: 'a', role: 'artisan' }], clarified: 1, stopped: true };
    const moved = await w.m.continueChat(s.id, { ask: false, cwd: other });
    expect(w.get(moved.id).plan).toMatchObject({ phase: 'running', stopped: true });
    await w.m.planResume(moved.id, w.dir);
    const again = w.get(w.get(moved.id).continuedBy!.id);
    expect(again.plan).toMatchObject({ phase: 'running' });
    expect(again.plan!.stopped).toBeUndefined();
    // the plan moved: it is not in two chats
    expect(w.get(s.id).plan).toBeUndefined();
  });

  it('a chat with chats at work under it stays where they report (finding 9); one already going on takes no second task (finding 10)', async () => {
    const w = world(), s = await w.start('strategist', { title: 'Padre' }), other = path.join(w.dir, 'altra'); fs.mkdirSync(other);
    const tools = delegationTools({ chats: w.m, roles: () => w.c.list(), settings: () => DELEGATION_DEFAULTS, engineRefusal: () => null, label: '[agente]', runs: () => w.m.runs.list() });
    await tools.find(t => t.name === 'agent_delegate')!.run({ tasks: [{ role: 'artisan', title: 'Figlia', contract: { goal: 'g', doneWhen: ['d'] } }] }, { mount: 'chat', params: { chatId: s.id }, sessionId: '', signal: new AbortController().signal } as never);
    await expect(w.m.assignElsewhere(s.id, 'x', { mode: 'continue' }, { cwd: other })).rejects.toThrow(/chats at work under it/);
    await expect(w.m.planResume(s.id, other)).rejects.toThrow(/altre chat al lavoro/);
    w.order('opencode', 'claude');
    expect((await w.m.continueChat(s.id, { ask: false })).harness).toBe('claude');
    const a = await w.start('artisan', { title: 'Sola' });
    const going = w.m.continueChat(a.id, { ask: false });
    await expect(w.m.assignElsewhere(a.id, 'secondo', { mode: 'continue' }, { cwd: other })).rejects.toThrow(/already going on|goes on in/);
    await going;
  });

  it('a reuse in another folder runs on the preset it asks for (finding 11)', async () => {
    const w = world();
    const s = await w.start('strategist', { title: 'P' }), other = path.join(w.dir, 'altra'); fs.mkdirSync(other);
    const tools = delegationTools({ chats: w.m, roles: () => w.c.list(), settings: () => DELEGATION_DEFAULTS, engineRefusal: () => null, label: '[agente]', runs: () => w.m.runs.list(), ordered: r => w.c.followsOrder(r),
      presetChoice: (_r, a) => ({ preset: a.preset ?? 'base', model: a.preset === 'max' ? 'opus-max' : 'opus', effort: a.preset === 'max' ? 'max' : 'high', engine: 'claude', warnings: [] }) as never });
    const call = async (name: string, args: Record<string, unknown>, id = s.id) => JSON.parse(await tools.find(t => t.name === name)!.run(args, { mount: 'chat', params: { chatId: id }, sessionId: '', signal: new AbortController().signal } as never) as string);
    const child = (await call('agent_delegate', { tasks: [{ role: 'artisan', title: 'Parte', contract: { goal: 'g', doneWhen: ['d'] } }] })).children[0];
    await call('agent_report', { outcome: 'done', summary: 's', output: 'o', doneWhen: [{ criterion: 'd', met: true, evidence: 'e' }] }, child.chatId);
    w.sinks.get(child.chatId)!.item({ kind: 'result', id: 'r', at: Date.now(), costUsd: 0, durationMs: 1, turns: 1, isError: false }, false);
    w.sinks.get(child.chatId)!.changed({ state: 'idle' });
    const out = await call('agent_assign_task', { chatId: child.chatId, roleId: 'artisan', cwd: other, mode: 'continue', preset: 'max', presetWhy: 'difficile', contract: { goal: 'ancora', doneWhen: ['d2'] } });
    const next = w.get(out.chatId);
    expect(next).toMatchObject({ cwd: other, model: 'opus-max', effort: 'max' });
    expect(next.run).toMatchObject({ model: 'opus-max', presetChoice: { preset: 'max' }, taskVersion: 2 });
    expect(next.delegation).toMatchObject({ doneWhen: ['d2'] });
    expect(next.delegation!.result).toBeUndefined();
  });

  it('7 · reuse and «Riprendi» follow the new order; a chat under way never changes engine by itself', async () => {
    const w = world();
    const s = await w.start('strategist', { title: 'Piano' });
    const tools = delegationTools({ chats: w.m, roles: () => w.c.list(), settings: () => DELEGATION_DEFAULTS, engineRefusal: () => null, label: '[agente]', runs: () => w.m.runs.list(),
      presetChoice: (r, a, d) => w.c.presetChoice(r, a, d), ordered: r => w.c.followsOrder(r) });
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
