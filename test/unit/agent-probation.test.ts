// Agent probation (A7b, AGENTS-DESIGN §4.7): the catalog's probation field, Brother's keep/retire/edit, the Generale agent of
// agentless chats, the keep/retire evaluator (one test per rule) and the cap / no-recreate helpers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentCatalogService } from '../../src/main/agents/catalog';
import { decide, judge, PROBATION_CAP, probationCapReached, recentlyRetired } from '../../src/main/agents/probation';
import { log } from '../../src/main/log';
import { INVOKE_CHANNELS } from '../../src/shared/contract';
import { UpdateActivity } from '../../src/main/update/activity';
import { stamp, KINDS } from '../../src/main/brain/live';
import { GENERAL_AGENT_ID, inProbation, type AgentDraft, type AgentModelChoice, type AgentProfile, type AgentRun, type AgentRunOutcome, type AgentVersion } from '../../src/shared/agents';

const dirs: string[] = [];
const tmp = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agent-probation-')); dirs.push(p); return p; };
afterEach(() => { vi.restoreAllMocks(); for (const p of dirs.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });
const choices = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [{ id: 'known-model', name: 'Known model' }], installed: null, authenticated: null }];
const draft = (over: Partial<AgentDraft> = {}): AgentDraft => ({ name: 'Revisore', purpose: 'Rivedere PR', instructions: 'Rivedi il diff.', engine: 'claude', model: 'known-model', avatar: { kind: 'symbol', value: 'search' }, ...over });
const service = (dir: string, models: () => AgentModelChoice[] = choices) => new AgentCatalogService({ userData: dir, models });
const read = (dir: string, name = 'agents.v2.json') => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as { profiles: Record<string, unknown>[]; entries?: AgentVersion[] };
const write = (dir: string, body: unknown, name = 'agents.v2.json') => fs.writeFileSync(path.join(dir, name), `${JSON.stringify(body, null, 2)}\n`);
const patchProfile = (dir: string, id: string, patch: (p: Record<string, unknown>) => void) => { const body = read(dir); patch(body.profiles.find(p => p.id === id)!); write(dir, body); };
const history = (dir: string, id: string) => (read(dir, 'agent-history.json').entries ?? []).filter(e => e.agentId === id);
const DAY = 86_400_000;

describe('probation IPC contract', () => {
  it('exposes keep and retire as writes tracked by the update barrier', () => {
    const activity = new UpdateActivity();
    for (const channel of ['agents:keep', 'agents:retire'] as const) {
      expect(INVOKE_CHANNELS).toContain(channel);
      expect(activity.tracks(channel)).toBe(true);
    }
    expect(activity.tracks('agents:metrics')).toBe(false);
  });
});

/** A catalog with one agent in probation since `since`. */
function withProbation(since = 1000, requestItemId = 'u_task1') {
  const dir = tmp();
  const p = service(dir).save(draft());
  patchProfile(dir, p.id, x => { x.probation = { since, requestItemId }; });
  return { dir, id: p.id, c: service(dir) };
}

describe('probation field in the catalog', () => {
  it('validates and persists probation, and refuses a malformed one (file kept, problem shown)', () => {
    const { dir, id, c } = withProbation();
    expect(c.list().problem).toBeNull();
    expect(c.list().profiles.find(p => p.id === id)!.probation).toEqual({ since: 1000, requestItemId: 'u_task1' });
    for (const bad of [{ since: 'x', requestItemId: 'u' }, { since: 1, requestItemId: '' }, { since: 1, requestItemId: 'u'.repeat(201) }, { since: 1, requestItemId: 'u', keptBy: 'orchestrator' }, { since: Infinity, requestItemId: 'u' }]) {
      patchProfile(dir, id, x => { x.probation = bad; });
      const text = fs.readFileSync(path.join(dir, 'agents.v2.json'), 'utf8');
      expect(service(dir).list().problem).toMatch(/non è leggibile/);
      expect(fs.readFileSync(path.join(dir, 'agents.v2.json'), 'utf8')).toBe(text);
    }
    patchProfile(dir, id, x => { x.probation = { since: 5, requestItemId: 'u'.repeat(200), keptBy: 'brother' }; });
    expect(service(dir).list().profiles.find(p => p.id === id)!.probation).toEqual({ since: 5, requestItemId: 'u'.repeat(200), keptBy: 'brother' });
  });

  it('Brother’s edit ends the probation as kept and locks the agent', () => {
    const { dir, id, c } = withProbation();
    const saved = c.save(draft({ instructions: 'Rivedi il diff e i test.' }), id);
    expect(saved).toMatchObject({ userLocked: true, lastEditedBy: 'user', probation: { keptBy: 'brother' }, version: 2 });
    expect(inProbation(saved)).toBe(false);
    expect(history(dir, id).find(e => e.version === 1)!.probation).toMatchObject({ decision: 'kept', by: 'brother' });
    // a cosmetic edit ends it too
    const other = withProbation();
    expect(other.c.save(draft({ name: 'Revisore PR' }), other.id)).toMatchObject({ version: 1, probation: { keptBy: 'brother' } });
  });

  it('Brother’s Tieni sets keptBy; the evaluator’s keep removes the probation; both write the decision on the history', () => {
    const a = withProbation();
    expect(a.c.keep(a.id)).toMatchObject({ probation: { since: 1000, keptBy: 'brother' }, status: 'active' });
    expect(history(a.dir, a.id)[0]!.probation).toMatchObject({ decision: 'kept', by: 'brother', reason: 'Tenuto da Brother' });
    expect(() => a.c.keep(a.id)).toThrow(/non è in prova/);
    const b = withProbation();
    const kept = b.c.keep(b.id, 'evaluator', 'Esito positivo confermato (r_000000000001)');
    expect(kept.probation).toBeUndefined();
    expect(service(b.dir).list().profiles.find(p => p.id === b.id)!.probation).toBeUndefined();
    expect(history(b.dir, b.id)[0]!.probation).toMatchObject({ decision: 'kept', by: 'evaluator', reason: 'Esito positivo confermato (r_000000000001)' });
  });

  it('retire archives at once, keeps the probation for the no-recreate check and records the decision; a restore keeps it', () => {
    const { dir, id, c } = withProbation();
    const retired = c.retire(id, 'Non serve più');
    expect(retired).toMatchObject({ status: 'archived', probation: { since: 1000, requestItemId: 'u_task1' } });
    expect(retired.probation!.keptBy).toBeUndefined();
    expect(history(dir, id)[0]!.probation).toMatchObject({ decision: 'retired', by: 'brother', reason: 'Non serve più' });
    expect(c.list().archived.map(p => p.id)).toEqual([id]);
    const back = c.restore(id);
    expect(back).toMatchObject({ status: 'active', probation: { keptBy: 'brother' } });
    expect(history(dir, id)[0]!.probation).toMatchObject({ decision: 'kept', by: 'brother', reason: 'Ripristinato da Brother' });
    // an agent that was never in probation is archived, not retired
    const plain = c.save(draft({ name: 'Altro' }));
    expect(() => c.retire(plain.id, 'x')).toThrow(/non è in prova/);
  });

  it('an empty retire reason gets a default one', () => {
    const { dir, id, c } = withProbation();
    c.retire(id, '  ', 'evaluator');
    expect(history(dir, id)[0]!.probation).toMatchObject({ decision: 'retired', by: 'evaluator', reason: 'Prova non superata' });
  });

  it('a history entry with a malformed probation decision makes the history unreadable', () => {
    const { dir, id } = withProbation();
    const h = read(dir, 'agent-history.json') as unknown as { version: number; entries: Record<string, unknown>[] };
    h.entries.find(e => e.agentId === id)!.probation = { decision: 'maybe', by: 'brother', reason: '', at: 1 };
    write(dir, h, 'agent-history.json');
    expect(service(dir).list().problem).toMatch(/cronologia/);
  });
});

describe('Generale', () => {
  it('the seed default-general is named Generale on a new catalog, and can never be archived or retired', () => {
    const dir = tmp(), c = service(dir);
    const g = c.list().profiles.find(p => p.id === GENERAL_AGENT_ID)!;
    expect(g).toMatchObject({ name: 'Generale', userLocked: false, lastEditedBy: 'preset', permissionCeiling: null, tools: null });
    expect(() => c.archive(GENERAL_AGENT_ID)).toThrow('Il Generale non si può archiviare: è l’Agente delle chat avviate senza sceglierne uno.');
    expect(() => c.retire(GENERAL_AGENT_ID, 'x')).toThrow(/Il Generale non si può archiviare/);
    expect(c.list().profiles.some(p => p.id === GENERAL_AGENT_ID)).toBe(true);
  });

  it('renames a pristine stored "Assistente" once, with no version, no lock and no user edit', () => {
    const dir = tmp();
    service(dir);
    patchProfile(dir, GENERAL_AGENT_ID, x => { x.name = 'Assistente'; });
    const before = history(dir, GENERAL_AGENT_ID);
    const g = service(dir).list().profiles.find(p => p.id === GENERAL_AGENT_ID)!;
    expect(g).toMatchObject({ name: 'Generale', userLocked: false, lastEditedBy: 'preset', version: 1 });
    expect(history(dir, GENERAL_AGENT_ID)).toEqual(before);
    const written = fs.readFileSync(path.join(dir, 'agents.v2.json'), 'utf8');
    expect(JSON.parse(written).profiles.find((p: { id: string }) => p.id === GENERAL_AGENT_ID).name).toBe('Generale');
    // idempotent: a second load does not write again
    const mtime = fs.statSync(path.join(dir, 'agents.v2.json')).mtimeMs;
    service(dir);
    expect(fs.readFileSync(path.join(dir, 'agents.v2.json'), 'utf8')).toBe(written);
    expect(fs.statSync(path.join(dir, 'agents.v2.json')).mtimeMs).toBe(mtime);
  });

  it('keeps a name Brother chose (locked) and migrates a pristine v1 "Assistente" as Generale', () => {
    const dir = tmp();
    service(dir);
    patchProfile(dir, GENERAL_AGENT_ID, x => { x.name = 'Assistente'; x.userLocked = true; x.lastEditedBy = 'user'; });
    expect(service(dir).list().profiles.find(p => p.id === GENERAL_AGENT_ID)!.name).toBe('Assistente');
    const v1 = tmp();
    write(v1, { version: 1, profiles: [{ id: GENERAL_AGENT_ID, name: 'Assistente', purpose: 'Organizzare il lavoro e preparare risultati utili', instructions: 'Chiarisci il risultato atteso. Distingui fatti, ipotesi e proposte. Rispetta permessi e dati personali.', engine: 'claude', model: null, avatar: { kind: 'symbol', value: 'briefcase' }, createdAt: 10, updatedAt: 10 }] }, 'agents.json');
    expect(service(v1).list().profiles.find(p => p.id === GENERAL_AGENT_ID)).toMatchObject({ name: 'Generale', userLocked: false, lastEditedBy: 'migration' });
  });

  it('an agentless chat resolves to Generale with the chat’s own engine and model; the Orchestrator stays unassigned', () => {
    const c = service(tmp());
    const r = c.resolve({ harness: 'codex', cwd: '/unused', model: 'gpt-x', prompt: 'ciao' });
    expect(r.owner).toMatchObject({ id: GENERAL_AGENT_ID, name: 'Generale', source: 'catalog', version: 1, engine: 'codex', model: 'gpt-x' });
    expect(r.request).toMatchObject({ harness: 'codex', model: 'gpt-x' });
    expect(r.instructions).toMatch(/Chiarisci il risultato atteso/);
    // ceiling null = Brother's settings: no policy
    expect(r.policy).toBeNull();
    expect(c.resolve({ harness: 'claude', cwd: '/unused', regia: true }).owner.source).toBe('routed');
    expect(c.resolve({ harness: 'claude', cwd: '/unused', space: 'app', appRegia: true }).owner.source).toBe('routed');
  });

  it('restores an archived Generale and recreates a missing one', () => {
    const dir = tmp();
    service(dir);
    patchProfile(dir, GENERAL_AGENT_ID, x => { x.status = 'archived'; x.archivedAt = 5; });
    expect(service(dir).list().profiles.find(p => p.id === GENERAL_AGENT_ID)).toMatchObject({ status: 'active' });
    const body = read(dir);
    write(dir, { ...body, profiles: body.profiles.filter(p => p.id !== GENERAL_AGENT_ID) });
    const c = service(dir);
    expect(c.list().profiles.find(p => p.id === GENERAL_AGENT_ID)).toMatchObject({ name: 'Generale', version: 1, activeVersion: 1 });
    expect(history(dir, GENERAL_AGENT_ID).map(e => e.version)).toEqual([1]);
    expect(c.resolve({ harness: 'claude', cwd: '/unused' }).owner.id).toBe(GENERAL_AGENT_ID);
  });

  it('falls back to a routed owner with a warning when Generale cannot be restored', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    // no default engine: no seed can be built
    const c = service(tmp(), () => []);
    expect(c.resolve({ harness: 'claude', cwd: '/unused' }).owner.source).toBe('routed');
    expect(warn).toHaveBeenCalledWith('agents', expect.stringMatching(/Generale is unavailable/), expect.anything());
    // an unreadable catalog: same
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'agents.v2.json'), '{ broken');
    expect(service(dir).resolve({ harness: 'claude', cwd: '/unused' }).owner.source).toBe('routed');
  });
});

// ---- evaluator ----

let seq = 0;
const AGENT = 'agent-x';
function run(over: Partial<AgentRun> & { outcome?: AgentRunOutcome } = {}): AgentRun {
  seq++;
  return { runId: `r_${seq.toString(16).padStart(12, '0')}`, chatId: `c_${seq}`, agentId: AGENT, version: 1, goal: 'g', startedBy: 'orchestrator', startedAt: 2000 + seq, endedAt: 3000 + seq, endReason: 'completed',
    counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: 0, tokens: null, corrections: { tagged: 0, afterReport: 0 }, ...over };
}
const outcome = (verdict: AgentRunOutcome['verdict'], basis: AgentRunOutcome['basis']): AgentRunOutcome => ({ verdict, basis, at: 4000, by: 'user' });
function agent(over: Partial<AgentProfile> = {}): AgentProfile {
  return { id: AGENT, name: 'X', purpose: 'p', instructions: 'i', engine: 'claude', model: null, avatar: { kind: 'symbol', value: 'search' }, createdAt: 1, updatedAt: 1, role: 'p', category: 'other', tools: null, permissionCeiling: null,
    origin: { kind: 'orchestrator', reason: 'r', evidence: [] }, version: 1, activeVersion: 1, lastEditedBy: 'orchestrator', userLocked: false, status: 'active', probation: { since: 1000, requestItemId: 'u_1' }, ...over };
}
const NOW = 10_000;

describe('probation evaluator', () => {
  it('keeps on a success with basis human', () => {
    expect(judge(agent(), [run({ outcome: outcome('success', 'human') })], NOW)).toMatchObject({ decision: 'keep' });
  });
  it('keeps on a success with basis reviewed-evidence', () => {
    expect(decide(agent(), [run({ outcome: outcome('success', 'reviewed-evidence') })], NOW)).toBe('keep');
  });
  it('a self-reported success never keeps', () => {
    expect(decide(agent(), [run({ outcome: outcome('success', 'self-report') })], NOW)).toBe('wait');
  });
  it('an Orchestrator-opinion success never keeps', () => {
    expect(decide(agent(), [run({ outcome: outcome('success', 'orchestrator-opinion') })], NOW)).toBe('wait');
  });
  it('a success on a run with no corrections field counts as 0 corrections but does not keep on its own', () => {
    const { corrections: _c, ...noCorrections } = run({ outcome: outcome('success', 'human') });
    void _c;
    expect(decide(agent(), [noCorrections as AgentRun], NOW)).toBe('wait');
    // with a counted run next to it, a run with no field adds 0 to the per-run ratio
    expect(decide(agent(), [noCorrections as AgentRun, run({ outcome: outcome('success', 'human'), corrections: { tagged: 1, afterReport: 0 } })], NOW)).toBe('keep');
  });
  it('retires on a fail with a qualifying basis, even next to a success', () => {
    expect(decide(agent(), [run({ outcome: outcome('success', 'human') }), run({ outcome: outcome('fail', 'reviewed-evidence') })], NOW)).toBe('retire');
    // a self-reported fail is no qualifying outcome
    expect(decide(agent(), [run({ outcome: outcome('fail', 'self-report') })], NOW)).toBe('wait');
  });
  it('retires on Brother’s reopen (the reopened run is open again)', () => {
    const reopened = run({ counters: { questions: 0, permissions: 0, commands: 0, reopened: 1, contextPeak: null } });
    delete reopened.endedAt; delete reopened.endReason;
    expect(judge(agent(), [run({ outcome: outcome('success', 'human') }), reopened], NOW)).toMatchObject({ decision: 'retire', reason: expect.stringMatching(/riaperto/) });
  });
  it('retires on a reworkOf within 7 days of the run’s end, not after', () => {
    const done = run({ outcome: outcome('success', 'human') });
    const within = run({ agentId: 'other', reworkOf: done.runId, startedAt: done.endedAt! + 7 * DAY });
    expect(decide(agent(), [done, within], NOW)).toBe('retire');
    const late = run({ agentId: 'other', reworkOf: done.runId, startedAt: done.endedAt! + 7 * DAY + 1 });
    expect(decide(agent(), [done, late], NOW)).toBe('keep');
  });
  it('retires on a continuedFrom within 7 days', () => {
    const done = run({ outcome: outcome('success', 'human') });
    expect(decide(agent(), [done, run({ continuedFrom: done.runId, startedAt: done.endedAt! + 1, endedAt: undefined, endReason: undefined })], NOW)).toBe('retire');
  });
  it('does not treat a linked run started before completion as subsequent rework', () => {
    const done = run({ outcome: outcome('success', 'human') });
    for (const link of ['reworkOf', 'continuedFrom'] as const) {
      expect(decide(agent(), [done, run({ agentId: 'other', [link]: done.runId, startedAt: done.endedAt! - 1 })], NOW)).toBe('keep');
      expect(decide(agent(), [done, run({ agentId: 'other', [link]: done.runId, startedAt: done.endedAt! })], NOW)).toBe('retire');
    }
  });
  it('retires above 1 correction per run, keeps at exactly 1', () => {
    expect(decide(agent(), [run({ outcome: outcome('success', 'human'), corrections: { tagged: 1, afterReport: 1 } })], NOW)).toBe('retire');
    expect(decide(agent(), [run({ outcome: outcome('success', 'human'), corrections: { tagged: 1, afterReport: 0 } })], NOW)).toBe('keep');
    expect(decide(agent(), [run({ outcome: outcome('success', 'human'), corrections: { tagged: 2, afterReport: 0 } }), run({ corrections: { tagged: 0, afterReport: 0 } })], NOW)).toBe('keep');
  });
  it('retires after 3 ended runs with no qualifying outcome', () => {
    const unknown = () => run({ outcome: outcome('success', 'self-report') });
    expect(decide(agent(), [unknown(), unknown()], NOW)).toBe('wait');
    expect(judge(agent(), [unknown(), unknown(), run()], NOW)).toMatchObject({ decision: 'retire', reason: '3 esecuzioni senza un esito confermato' });
  });
  it('retires after 14 days with no run since the last one ended, or since the probation began', () => {
    const r = run();
    expect(decide(agent(), [r], r.endedAt! + 14 * DAY - 1)).toBe('wait');
    expect(decide(agent(), [r], r.endedAt! + 14 * DAY)).toBe('retire');
    expect(decide(agent(), [], 1000 + 14 * DAY)).toBe('retire');
    expect(decide(agent(), [], 1000 + 14 * DAY - 1)).toBe('wait');
    // an open run is activity
    expect(decide(agent(), [run({ endedAt: undefined, endReason: undefined })], 1000 + 30 * DAY)).toBe('wait');
  });
  it('only judges runs since the probation began, of this agent, and never an agent out of probation', () => {
    expect(decide(agent(), [run({ startedAt: 10, endedAt: 20, outcome: outcome('fail', 'human') })], NOW)).toBe('wait');
    expect(decide(agent(), [run({ agentId: 'other', outcome: outcome('fail', 'human') })], NOW)).toBe('wait');
    expect(decide(agent({ probation: { since: 1000, requestItemId: 'u_1', keptBy: 'brother' } }), [run({ outcome: outcome('fail', 'human') })], NOW)).toBe('wait');
    expect(decide(agent({ probation: undefined }), [], NOW + 100 * DAY)).toBe('wait');
    expect(decide(agent({ status: 'archived', archivedAt: 5 }), [], NOW + 100 * DAY)).toBe('wait');
  });
});

describe('probation helpers for A7', () => {
  it('probationCapReached counts active agents still in probation', () => {
    const many = (n: number, over: Partial<AgentProfile> = {}) => Array.from({ length: n }, (_, i) => agent({ id: `agent-${i}`, ...over }));
    expect(probationCapReached({ profiles: many(PROBATION_CAP - 1) })).toBe(false);
    expect(probationCapReached({ profiles: many(PROBATION_CAP) })).toBe(true);
    expect(probationCapReached({ profiles: [...many(PROBATION_CAP - 1), agent({ id: 'agent-kept', probation: { since: 1, requestItemId: 'u', keptBy: 'brother' } }), agent({ id: 'agent-plain', probation: undefined })] })).toBe(false);
  });
  it('recentlyRetired lists probation agents archived in the last 14 days', () => {
    const at = 50 * DAY;
    const archived = [agent({ id: 'agent-new', status: 'archived', archivedAt: at - 14 * DAY + 1 }), agent({ id: 'agent-old', status: 'archived', archivedAt: at - 14 * DAY }),
      agent({ id: 'agent-plain', status: 'archived', archivedAt: at - 1, probation: undefined }), agent({ id: 'agent-kept', status: 'archived', archivedAt: at - 1, probation: { since: 1, requestItemId: 'u', keptBy: 'brother' } })];
    expect(recentlyRetired({ archived }, at).map(p => p.id)).toEqual(['agent-new']);
  });
  it('the catalog’s own lists feed both helpers', () => {
    const { c, id } = withProbation();
    expect(probationCapReached(c.list())).toBe(false);
    c.retire(id, 'x');
    expect(recentlyRetired(c.list(), Date.now()).map(p => p.id)).toEqual([id]);
  });
});

describe('probation feed kinds', () => {
  it('agent-kept is quiet, agent-retired is normal and carries its Restore action', () => {
    expect(KINDS['agent-kept']!.priority).toBe('quiet');
    expect(KINDS['agent-retired']!.priority).toBe('normal');
    const e = stamp({ kind: 'agent-retired', title: 'Agente ritirato', action: { kind: 'agent-restore', agentId: 'agent-x' } });
    expect(e).toMatchObject({ priority: 'normal', label: 'Agente ritirato', action: { kind: 'agent-restore', agentId: 'agent-x' } });
    expect(stamp({ kind: 'agent-retired', title: 't', action: { kind: 'agent-restore', agentId: '../x' } }).action).toBeUndefined();
    expect(stamp({ kind: 'agent-retired', title: 't', action: { kind: 'run-command', agentId: 'agent-x' } as never }).action).toBeUndefined();
  });
});
