// Agent runs (A5): a chat started from a catalog agent is a run; it ends as completed, closed or stale, a parent's end
// closes its spawned runs downward, only the user reopens one, requests count once, cost and tokens follow the turns,
// and the record survives a restart (agent-runs.json is the source, chats.json keeps a mirror).
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { plainOwner } from '../../../src/main/agents/catalog';
import { DEMO_NOW, demoAgentRuns, demoFlashLog } from '../../../src/main/demo-agent-runs';
import { standings } from '../../../src/main/agents/standing';
import { emptyTally } from '../../../src/main/agents/run-metrics';
import { diagnoseFile } from '../../../src/main/agents/level-diagnosis';
import { delegationTools } from '../../../src/main/agents/delegation';
import { DELEGATION_DEFAULTS } from '../../../src/shared/roles';
import { STALE_MS } from '../../../src/main/agents/runs';
import type { AgentOwnerSnapshot } from '../../../src/shared/agents';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { vi.useRealTimers(); for (const m of managers.splice(0)) await m.shutdown(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture(extra: Partial<ChatManagerOptions> = {}) {
  const dir = extra.userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agent-runs-'));
  if (!extra.userData) roots.push(dir);
  const sinks = new Map<string, SessionSink>();
  let last!: SessionSink;
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') }, ...extra, sessionFactory: (_h, _o, s) => {
    last = s;
    return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { s.changed({ state: 'idle' }); }, send() {},
      close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession;
  } });
  managers.push(m);
  const create = async (by: 'user' | 'agent' = 'user', links = {}, owner: Partial<AgentOwnerSnapshot> = {}) => {
    const c = await m.create({ harness: 'claude', cwd: dir, prompt: 'Rivedi il PR' }, by,
      { owner: { ...plainOwner('claude', null), source: 'catalog', id: 'reviewer', version: 3, ...owner }, instructions: 'Sei un revisore.', policy: null }, links);
    sinks.set(c.id, last);
    return c;
  };
  const run = (id: string) => m.list().find(x => x.id === id)?.run;
  const file = () => JSON.parse(fs.readFileSync(path.join(dir, 'agent-runs.json'), 'utf8')) as { version: number; runs: { runId: string; endReason?: string }[] };
  return { m, dir, create, run, file, sink: (id: string) => sinks.get(id)! };
}

describe('agent runs on chats', () => {
  it('starts a run for a catalog agent only, with its version, goal and starter', async () => {
    const f = fixture();
    const c = await f.create('agent');
    expect(f.run(c.id)).toMatchObject({ chatId: c.id, agentId: 'reviewer', version: 3, goal: 'Rivedi il PR', startedBy: 'orchestrator', costUsd: 0, counters: { questions: 0, reopened: 0, contextPeak: null } });
    expect(f.file().runs.map(r => r.runId)).toEqual([f.run(c.id)!.runId]);
    const plain = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' });
    expect(f.run(plain.id)).toBeUndefined();
  });

  it('a role opened after recovering a mixed run store can report to its Orchestrator (#202)', async () => {
    const f = fixture(), old = await f.create('agent');
    const phrases = f.m.runs.start({ chatId: 'os_test', agentId: 'herald', version: 1,
      goal: 'phrases', startedBy: 'app', startedAt: 1000, costKnown: true });
    phrases.source = 'oneshot'; phrases.oneshot = { engine: 'claude', job: 'phrases', fallback: false, costBasis: 'reported' };
    f.m.runs.save();
    await f.m.shutdown(); managers.splice(managers.indexOf(f.m), 1);
    const file = path.join(f.dir, 'agent-runs.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved.runs.splice(1, 0, { ...phrases, runId: 'r_ffffffffffff', oneshot: { ...phrases.oneshot, job: 'future-job' } });
    fs.writeFileSync(file, JSON.stringify(saved));
    const recovered = fixture({ userData: f.dir });
    expect(recovered.m.runs.problem).toBeNull();
    expect(recovered.m.runs.get(old.run!.runId)).toBeDefined();
    expect(recovered.m.runs.get(phrases.runId)?.oneshot?.job).toBe('phrases');
    const orchestrator = await recovered.m.create({ harness: 'claude', cwd: f.dir, orchestrator: true });
    const role = await recovered.create('agent', {}, { id: 'herald' });
    expect(role.run?.startedBy).toBe('orchestrator');
    const report = delegationTools({ chats: recovered.m, roles: vi.fn(), settings: () => DELEGATION_DEFAULTS,
      engineRefusal: () => null, label: '[agente]', runs: () => recovered.m.runs.list() }).find(t => t.name === 'agent_report')!;
    const result = await report.run({ outcome: 'done', summary: 'Checked', output: 'Result', doneWhen: [] },
      { mount: 'chat', params: { chatId: role.id }, sessionId: '', signal: new AbortController().signal } as never);
    expect(JSON.parse(result as string)).toMatchObject({ reported: true, to: 'orchestrator', delivered: true });
    expect(recovered.m.runs.get(role.run!.runId)?.report?.via).toBe('agent_report');
    expect(recovered.m.items(orchestrator.id)).toContainEqual(expect.objectContaining({ code: 'resultReady' }));
  });

  it('restores the card levels, pruned XP, Orchestrator decisions and Flash after partial store recovery', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(DEMO_NOW);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-level-recovery-')); roots.push(dir);
    const runs = demoAgentRuns(DEMO_NOW), flash = demoFlashLog(DEMO_NOW);
    const phrases = { ...runs[0]!, runId: 'r_ffffffffffff', agentId: 'herald', source: 'oneshot' as const,
      oneshot: { engine: 'claude', job: 'phrases' as const, fallback: false, costBasis: 'reported' as const },
      outcome: { verdict: 'unknown' as const, basis: 'unknown' as const, at: DEMO_NOW, by: 'app' }, receipts: undefined, report: undefined };
    runs.push(phrases);
    const rollups = [{ ...emptyTally('artisan', 0), ended: 2, verdicts: { success: 2, partial: 0, fail: 0 }, xp: 6 }];
    const expected = standings(runs, rollups, DEMO_NOW, flash);
    expect(expected.get('artisan')!.level).toBeGreaterThan(1);
    expect(expected.get('orchestrator')!.level).toBeGreaterThan(1);
    expect(expected.get('flash')!.level).toBeGreaterThan(1);
    const raw = { version: 1, runs: [null, runs[0], runs[0], ...runs.slice(1), { runId: 'bad' }], rollups, flash };
    fs.writeFileSync(path.join(dir, 'agent-runs.json'), JSON.stringify(raw));
    const f = fixture({ userData: dir });
    const actual = new Map(f.m.runMetrics().map(m => [m.agentId, m.standing]));
    expect(actual).toEqual(expected);
    const diagnosed = diagnoseFile(raw, DEMO_NOW);
    expect(diagnosed.invalid).toBe(3);
    expect(new Map(diagnosed.roles.map(r => [r.agentId, r.standing]))).toEqual(expected);
    // Metrics flush repairs the file; reopening must keep exactly the same earned progress.
    expect(new Map(fixture({ userData: dir }).m.runMetrics().map(m => [m.agentId, m.standing]))).toEqual(expected);
  });

  it('ends as completed when its work is marked completed', async () => {
    const f = fixture();
    const c = await f.create();
    await f.m.set(c.id, { workStatus: 'completed' });
    expect(f.run(c.id)).toMatchObject({ endReason: 'completed' });
    expect(f.file().runs[0]!.endReason).toBe('completed');
  });

  it('ends as closed on archive and on close, and the first end wins', async () => {
    const f = fixture();
    const a = await f.create(), b = await f.create();
    await f.m.archive(a.id);
    expect(f.run(a.id)).toMatchObject({ endReason: 'closed' });
    await f.m.set(a.id, { workStatus: 'completed' });
    expect(f.run(a.id)?.endReason).toBe('closed');
    const id = f.run(b.id)!.runId;
    await f.m.close(b.id);
    expect(f.m.runs.get(id)).toMatchObject({ endReason: 'closed' });
  });

  it('the user’s verdict ends an open run as completed with a human basis', async () => {
    const f = fixture();
    const c = await f.create();
    f.m.markRun(c.id, 'partial', '  manca un test  ');
    expect(f.run(c.id)).toMatchObject({ endReason: 'completed', outcome: { verdict: 'partial', basis: 'human', by: 'user', note: 'manca un test' } });
    const plain = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' });
    expect(() => f.m.markRun(plain.id, 'success')).toThrow(/non è un’esecuzione/);
    expect(() => f.m.markRun(c.id, 'great' as never)).toThrow(/Esito non valido/);
  });

  it('goes stale after 72 h without a turn, but not while a request waits on the user', async () => {
    const f = fixture();
    const c = await f.create(), d = await f.create();
    const t0 = Date.now(); // after the start: its activity moved the clock
    f.sink(d.id).pending({ id: 'q1', type: 'question', tool: 'AskUserQuestion', title: 'Quale?', detail: '', input: {}, at: t0 });
    expect(f.m.staleRuns(t0 + STALE_MS - 60_000)).toBe(0);
    expect(f.m.staleRuns(t0 + STALE_MS + 60_000)).toBe(1);
    expect(f.run(c.id)?.endReason).toBe('stale');
    expect(f.run(d.id)?.endedAt).toBeUndefined();
    f.sink(d.id).resolved('q1'); // the clock starts again from the answer
    const answered = Date.now();
    expect(f.m.staleRuns(answered + STALE_MS - 60_000)).toBe(0);
    expect(f.m.staleRuns(answered + STALE_MS + 60_000)).toBe(1);
  });

  it('an open “Comando da eseguire” pauses the stale clock until it leaves', async () => {
    const f = fixture();
    const c = await f.create();
    f.m.commandAsked(c.id, 'cmd-a-0');
    expect(f.m.staleRuns(Date.now() + 10 * STALE_MS)).toBe(0);
    f.m.commandDone(c.id, 'cmd-a-0');
    const done = Date.now();
    expect(f.m.staleRuns(done + STALE_MS - 60_000)).toBe(0);
    expect(f.m.staleRuns(done + STALE_MS + 60_000)).toBe(1);
  });

  it('a reopen’s stale clock survives a restart', async () => {
    const f = fixture();
    vi.useFakeTimers({ toFake: ['Date'] });
    const c = await f.create();
    await f.m.archive(c.id);
    vi.setSystemTime(Date.now() + 4 * 24 * 3600_000); // reopened four days after its start: past 72 h from it
    await f.m.reopen(c.id);
    await f.m.send(c.id, 'continue');
    const reopened = Date.now();
    await f.m.shutdown(); managers.splice(managers.indexOf(f.m), 1);
    const g = fixture({ userData: f.dir });
    vi.useRealTimers();
    expect(g.run(c.id)).toMatchObject({ taskVersion: 2, counters: { reopened: 0 } });
    expect(g.m.staleRuns(reopened + STALE_MS - 60_000)).toBe(0);
    expect(g.m.staleRuns(reopened + STALE_MS + 60_000)).toBe(1);
  });

  it('a parent’s end closes its spawned runs, never the other way', async () => {
    const f = fixture();
    const p = await f.create('agent');
    const parent = f.run(p.id)!.runId;
    const k1 = await f.create('agent', { parentRunId: parent }), k2 = await f.create('agent', { parentRunId: parent });
    expect(f.run(k1.id)).toMatchObject({ parentRunId: parent });
    await f.m.archive(k1.id);
    expect(f.run(p.id)?.endedAt).toBeUndefined();
    await f.m.set(p.id, { workStatus: 'completed' });
    expect(f.run(p.id)?.endReason).toBe('completed');
    expect(f.run(k2.id)?.endReason).toBe('closed');
  });

  it('refuses links to an unknown run before the chat starts', async () => {
    const f = fixture();
    await expect(f.create('agent', { reviewOf: 'r_000000000000' })).rejects.toThrow(/Esecuzione collegata non trovata/);
    expect(f.m.list()).toHaveLength(0);
  });

  it('only the user reopens an ended run: an agent or app message does not', async () => {
    const f = fixture();
    const c = await f.create();
    await f.m.set(c.id, { workStatus: 'completed' });
    f.m.markRun(c.id, 'success');
    await f.m.send(c.id, 'continua', undefined, false, 'orchestrator');
    await f.m.send(c.id, 'notizia dell’app', undefined, true);
    expect(f.run(c.id)).toMatchObject({ endReason: 'completed', counters: { reopened: 0 } });
    await f.m.send(c.id, 'continue');
    const run = f.run(c.id)!;
    expect(run.endedAt).toBeUndefined();
    expect(run.outcome).toBeUndefined();
    expect(run.counters.reopened).toBe(0);
    await f.m.send(c.id, 'continue'); // already open: nothing to count
    expect(f.run(c.id)?.counters.reopened).toBe(0);
  });

  it('counts each request once by id, commands included', async () => {
    const f = fixture();
    const c = await f.create();
    const q = { id: 'p1', type: 'permission' as const, tool: 'Bash', title: 'ls', detail: 'ls', input: {}, at: Date.now() };
    f.sink(c.id).pending(q);
    f.sink(c.id).pending(q);
    f.sink(c.id).resolved('p1');
    f.sink(c.id).pending(q); // the engine reported it again after the answer
    f.sink(c.id).pending({ ...q, id: 'q1', type: 'question' });
    f.m.commandAsked(c.id, 'cmd-a-0');
    f.m.commandAsked(c.id, 'cmd-a-0');
    expect(f.run(c.id)?.counters).toMatchObject({ permissions: 1, questions: 1, commands: 1 });
  });

  it('adds the settled turns’ cost and tokens and keeps the context peak', async () => {
    const f = fixture();
    const c = await f.create();
    const tokens = { input: 10, cacheRead: 5, cacheWrite: 1, output: 2 };
    f.sink(c.id).changed({ contextTokens: 900 });
    f.sink(c.id).changed({ turnCostUsd: 0.25, turnTokens: tokens });
    f.sink(c.id).changed({ contextTokens: 400 });
    f.sink(c.id).changed({ turnCostUsd: 0.5, turnTokens: tokens });
    expect(f.run(c.id)).toMatchObject({ costUsd: 0.75, tokens: { input: 20, cacheRead: 10, cacheWrite: 2, output: 4 }, counters: { contextPeak: 900 } });
    f.sink(c.id).changed({ turnCostUsd: 0.1 }); // a turn without tokens: the total is unknown from now on
    f.sink(c.id).changed({ turnCostUsd: 0, costKnown: false });
    expect(f.run(c.id)).toMatchObject({ costUsd: null, tokens: null });
  });

  it('keeps the run across a restart, as the same record in the store and in the chat', async () => {
    const f = fixture();
    const c = await f.create();
    f.sink(c.id).changed({ contextTokens: 1234 });
    const id = f.run(c.id)!.runId;
    await f.m.shutdown(); managers.splice(managers.indexOf(f.m), 1);
    const g = fixture({ userData: f.dir });
    expect(g.run(c.id)).toMatchObject({ runId: id, counters: { contextPeak: 1234 } });
    await g.m.archive(c.id);
    expect(g.m.runs.get(id)?.endReason).toBe('closed');
    const stored = JSON.parse(fs.readFileSync(path.join(f.dir, 'chats.json'), 'utf8')) as { version: number; chats: { id: string; run?: { endReason?: string } }[] };
    expect(stored.version).toBe(2);
    expect(stored.chats.find(x => x.id === c.id)?.run?.endReason).toBe('closed');
  });

  it('takes back a mirror the store lost', async () => {
    const f = fixture();
    const c = await f.create();
    const id = f.run(c.id)!.runId;
    await f.m.archive(c.id);
    await f.m.shutdown(); managers.splice(managers.indexOf(f.m), 1);
    fs.rmSync(path.join(f.dir, 'agent-runs.json'));
    const g = fixture({ userData: f.dir });
    expect(g.m.runs.get(id)).toMatchObject({ endReason: 'closed' });
  });

  it('an unsupported runs file version is kept and no run is recorded, while chats still start', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agent-runs-')); roots.push(dir);
    fs.writeFileSync(path.join(dir, 'agent-runs.json'), '{"version":2,"runs":[]}');
    const f = fixture({ userData: dir });
    expect(f.m.runs.problem).toMatch(/non è leggibile/);
    const c = await f.create();
    expect(f.run(c.id)).toBeUndefined();
    await f.m.archive(c.id);
    expect(fs.readFileSync(path.join(dir, 'agent-runs.json'), 'utf8')).toBe('{"version":2,"runs":[]}');
  });
});

describe('agent run evidence (A6)', () => {
  const reply = (f: ReturnType<typeof fixture>, id: string, text: string, at = Date.now()) => {
    f.sink(id).item({ kind: 'user', id: `u${at}`, at, text: 'vai' }, false);
    f.sink(id).item({ kind: 'assistant', id: `a${at}`, at, text }, false);
    f.sink(id).item({ kind: 'result', id: `r${at}`, at, costUsd: 0, durationMs: 1, turns: 1, isError: false }, false);
  };
  const report = (o: object) => `Fatto.\n\n\`\`\`run-report\n${JSON.stringify(o)}\n\`\`\``;

  it('keeps the run-report of the latest turn that has a valid one', async () => {
    const f = fixture();
    const c = await f.create();
    reply(f, c.id, report({ outcome: 'partial', verified: 'no', summary: 'metà' }), 10);
    expect(f.run(c.id)?.report).toEqual({ at: 10, outcome: 'partial', verified: 'no', summary: 'metà' });
    reply(f, c.id, 'nessun report', 20);
    expect(f.run(c.id)?.report).toMatchObject({ at: 10 });
    reply(f, c.id, report({ outcome: 'done' }), 30); // out of shape: the last valid report stays
    expect(f.run(c.id)?.report).toMatchObject({ at: 10 });
    await f.m.set(c.id, { workStatus: 'completed' });
    reply(f, c.id, report({ outcome: 'done', verified: 'yes', summary: 'dopo' }), 40); // an ended run takes nothing
    expect(f.run(c.id)?.report).toMatchObject({ at: 10 });
  });

  it('a run ended during the turn (its Orchestrator marked it completed) still takes that turn’s report', async () => {
    const f = fixture();
    const c = await f.create();
    f.sink(c.id).changed({ state: 'running' });
    await f.m.set(c.id, { workStatus: 'completed' });
    reply(f, c.id, report({ outcome: 'done', verified: 'yes', summary: 'chiuso a metà turno', findings: 3 }), Date.now() + 1);
    expect(f.run(c.id)).toMatchObject({ endReason: 'completed', report: { findings: 3 } });
    expect(f.file().runs[0]).toMatchObject({ report: { findings: 3 } });
  });

  it('counts the user’s corrections: a tagged message, else a reopen after a report; the reopen drops the report', async () => {
    const f = fixture();
    const c = await f.create();
    f.m.resumedByUser(c.id, '[Reasoning correction]\nNo, il bug è nel parser.');
    f.m.resumedByUser(c.id, '[Correzione del ragionamento]\nAncora no.');
    f.m.resumedByUser(c.id, 'grazie');
    expect(f.run(c.id)?.corrections).toEqual({ tagged: 2, afterReport: 0 });
    await f.m.set(c.id, { workStatus: 'completed' });
    await f.m.send(c.id, 'riapro'); // no report: a reopen, not a correction
    expect(f.run(c.id)).toMatchObject({ corrections: { tagged: 0, afterReport: 0 }, taskVersion: 2, counters: { reopened: 0 } });
    reply(f, c.id, report({ outcome: 'done', verified: 'yes', summary: 'fatto' }));
    await f.m.set(c.id, { workStatus: 'completed' });
    await f.m.send(c.id, 'non va');
    const run = f.run(c.id)!;
    expect(run).toMatchObject({ corrections: { tagged: 0, afterReport: 0 }, taskVersion: 3, counters: { reopened: 0 } });
    expect(run.report).toBeUndefined();
    expect(f.m.runs.list().some(r => r.corrections?.tagged === 2)).toBe(true);
  });

  it('a run recorded before corrections were counted stays unknown', async () => {
    const f = fixture();
    const c = await f.create();
    delete f.m.runs.get(f.run(c.id)!.runId)!.corrections;
    f.m.resumedByUser(c.id, '[Reasoning correction]\nNo.');
    expect(f.run(c.id)?.corrections).toBeUndefined();
  });

  it('measures the time spent running while the run is open, settled at its end', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = fixture();
    const c = await f.create();
    const t0 = Date.now();
    f.sink(c.id).changed({ state: 'running' });
    vi.setSystemTime(t0 + 5000);
    f.sink(c.id).changed({ state: 'running' }); // still the same turn
    vi.setSystemTime(t0 + 6000);
    f.sink(c.id).changed({ state: 'waiting' });
    vi.setSystemTime(t0 + 60_000); // waiting on the user: not execution
    f.sink(c.id).changed({ state: 'running' });
    vi.setSystemTime(t0 + 62_000);
    await f.m.set(c.id, { workStatus: 'completed' });
    expect(f.run(c.id)?.executionMs).toBe(8000);
    f.sink(c.id).changed({ state: 'running' });
    vi.setSystemTime(t0 + 99_000);
    f.sink(c.id).changed({ state: 'idle' });
    expect(f.run(c.id)?.executionMs).toBe(8000);
  });

  it('the turn that reopens a run counts from the reopen (chat:send starts it first)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = fixture();
    const c = await f.create();
    await f.m.set(c.id, { workStatus: 'completed' });
    const t0 = Date.now();
    f.sink(c.id).changed({ state: 'running' }); // the ended run takes nothing yet
    await f.m.send(c.id, 'correggi X');
    vi.setSystemTime(t0 + 3000);
    f.sink(c.id).changed({ state: 'idle' });
    expect(f.run(c.id)?.executionMs).toBe(3000);
  });

  it('a hand-off continuation links the new run to the old one', async () => {
    const f = fixture();
    const c = await f.create();
    const old = f.run(c.id)!.runId;
    await f.m.ensureHandoff(c.id, { ask: false }); // the token-free note: the fake session writes none
    const n = await f.m.continueChat(c.id);
    expect(f.run(n.id)).toMatchObject({ agentId: 'reviewer', continuedFrom: old });
    expect(f.file().runs.find(r => r.runId === f.run(n.id)!.runId)).toMatchObject({ continuedFrom: old });
  });
});
