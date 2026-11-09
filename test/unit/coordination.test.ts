// Real SQLite races/restarts and scope rejection. No sleeps, wall-clock thresholds or engine/network dependencies.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CoordinationStore, proposalHash } from '../../src/main/coordination/store';
import { registerRequest, requestKey } from '../../src/main/coordination/requests';
import { projectWork } from '../../src/main/coordination/projection';
import { closeAppDbs, openAppDb } from '../../src/main/app-db';
import { RunsDb } from '../../src/main/agents/runs-db';
import type { AgentRun } from '../../src/shared/agents';
import { Workflows } from '../../src/main/workflows/service';
import { digest } from '../../src/main/appctl/digest';
import type { RequestKey } from '../../src/main/coordination/model';
import type { ChatSummary, PendingRequest } from '../../src/shared/contract';
import type { WorkThread } from '../../src/shared/workflows';

const dirs: string[] = [];
const key: RequestKey = { originalRequestId: 'ask-1', jobId: 'job-1', chatId: 'chat-1', runId: 'run-1', taskVersion: 1, proposalRevision: 10, proposalHash: proposalHash({ question: 'Proceed?' }) };
const actor = { kind: 'user', channel: 'phone' } as const;
afterEach(() => { closeAppDbs(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(withRequest = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-coordination-')); dirs.push(dir);
  const file = path.join(dir, 'app.db'), store = new CoordinationStore(file, () => 42);
  if (withRequest) store.register({ key, kind: 'question', at: 10, payload: { question: 'Proceed?' } });
  return { store, file, dir };
}

describe('coordination decision journal', () => {
  it.each([{ jobId: 'job-other' }, { chatId: 'chat-other' }, { runId: 'run-new' }, { taskVersion: 2 }, { proposalRevision: 11 }, { proposalHash: proposalHash('changed') }])('rejects a changed binding %j without consuming the pending question', patch => {
    const { store } = fixture();
    expect(() => store.resolve({ ...key, ...patch }, actor, true)).toThrow(/stale/);
    expect(store.requests()[0]!.state).toBe('pending');
  });
  it('never promotes agent text or reports to user consent; policy is independently labelled', () => {
    const { store } = fixture();
    expect(() => store.resolve(key, { kind: 'agent-relay', chatId: 'parent' }, true)).toThrow(/not user consent/);
    const decision = store.resolve(key, { kind: 'policy', policy: 'away' }, true);
    const report = store.recordExecution({ decisionId: decision.id, source: 'agent-report', reference: 'Reported completion; not independently verified' });
    expect(store.requests()[0]!.decision!.actor).toEqual({ kind: 'policy', policy: 'away' });
    expect(store.execution(decision.id)).toEqual([report]);
    expect(store.requests()[0]!.delivery).toBeUndefined();
  });
  it('recovers pending, accepted-undelivered and dispatch-uncertain records after reopening without replay', () => {
    const { store, file } = fixture();
    store.register({ key: { ...key, originalRequestId: 'ask-2' }, kind: 'question', at: 11, payload: {} });
    const decision = store.resolve(key, actor, true);
    store.close();
    const restart = new CoordinationStore(file);
    expect(restart.requests().map(r => r.state)).toEqual(['pending', 'accepted']);
    expect(restart.requests().find(r => r.state === 'accepted')!.decision).toEqual(decision);
    const delivery = restart.beginDelivery(decision.id); restart.close();
    const again = new CoordinationStore(file);
    expect(again.requests().find(r => r.state === 'accepted')!.delivery).toMatchObject({ id: delivery.id, state: 'dispatching' });
    expect(() => again.beginDelivery(decision.id)).toThrow(/already attempted/);
    expect(() => again.resolve(key, actor, true)).toThrow(/already answered/);
    expect(again.execution(decision.id)).toEqual([]);
  });
  it('keeps delivery receipts distinct from execution, including a failed submission', () => {
    const { store } = fixture(), decision = store.resolve(key, actor, true);
    const delivery = store.beginDelivery(decision.id);
    store.finishDelivery(delivery.id, 'failed');
    expect(store.requests()[0]!.decision).toEqual(decision);
    expect(store.requests()[0]!.delivery!.state).toBe('failed');
    expect(() => store.beginDelivery(decision.id)).toThrow(/already attempted/);
    expect(store.execution(decision.id)).toEqual([]);
  });
  it('supersedes a request revision but retains its original history', () => {
    const { store } = fixture(), next = { ...key, proposalRevision: 11, proposalHash: proposalHash('new') };
    store.register({ key: next, kind: 'question', at: 11, payload: {} });
    expect(() => store.resolve(key, actor, true)).toThrow(/stale/);
    store.resolve(next, actor, false);
    expect(store.requests().map(r => r.state)).toEqual(['accepted', 'cancelled']);
  });
  it('rolls back cancellation if replacement registration fails', () => {
    const { store } = fixture();
    expect(() => store.register({ key: { ...key, originalRequestId: 'replacement', taskVersion: 0 }, kind: 'plan', at: 11, payload: {} }, key.originalRequestId)).toThrow(/Invalid request identity/);
    expect(store.original(key.chatId, key.originalRequestId)!.state).toBe('pending');
  });
  it('an explicit new assignment cancels old pending callbacks, retaining accepted decisions', () => {
    const { store } = fixture();
    const accepted = { ...key, originalRequestId: 'accepted-old' }, current = { ...key, originalRequestId: 'current', runId: 'run-new', taskVersion: 2 };
    store.register({ key: accepted, kind: 'question', at: 11, payload: {} }); store.resolve(accepted, actor, true);
    store.register({ key: current, kind: 'question', at: 12, payload: {} });
    store.cancelOtherAssignments(key.chatId, current.runId!);
    expect(() => store.resolve(key, actor, true)).toThrow(/stale/);
    expect(store.original(key.chatId, 'accepted-old')!.state).toBe('accepted');
    expect(store.original(key.chatId, 'current')!.state).toBe('pending');
  });
  it('hashes proposal keys deterministically and does not archive raw permission inputs', () => {
    expect(proposalHash({ b: 2, a: 1 })).toBe(proposalHash({ a: 1, b: 2 }));
    const { store } = fixture();
    const chat = { id: 'tool-chat', run: { runId: 'run', taskId: 'job', taskVersion: 3 } } as ChatSummary;
    const req = { id: 'permission', type: 'permission', at: 12, tool: 'Bash', title: 'command', detail: 'private command', input: { command: 'sensitive input' } } as PendingRequest;
    registerRequest(store, chat, req);
    expect(JSON.stringify(store.requests().find(r => r.kind === 'permission')!.payload)).not.toContain('sensitive input');
    expect(requestKey(store, chat, req)).toMatchObject({ jobId: 'job', runId: 'run', taskVersion: 3 });
    expect(() => registerRequest(store, { ...chat, run: { ...chat.run!, taskVersion: 4 } }, req)).toThrow(/fresh request id/);
    expect(() => registerRequest(store, chat, { ...req, input: { command: 'a different command' } })).toThrow(/fresh request id/);
  });
  it('pins only the original job through workflow linking, never a changed run, version or proposal scope', () => {
    const { store, dir } = fixture(false);
    const chat = { id: 'link-chat', run: { runId: 'run', taskId: 'task', taskVersion: 1 } } as ChatSummary;
    const req = { id: 'before-link', type: 'permission', at: 10, tool: 'Bash', title: 'Read', detail: '', input: { command: 'git status' } } as PendingRequest;
    registerRequest(store, chat, req);
    const original = requestKey(store, chat, req);
    const works = new Workflows(path.join(dir, 'work.json'));
    const work = works.create({ title: 'Organize task', profile: 'investigation', priority: 'normal', chatIds: [chat.id] });
    expect(requestKey(store, chat, req)).toEqual(original);
    for (const run of [{ ...chat.run!, runId: 'new-run' }, { ...chat.run!, taskVersion: 2 }]) {
      expect(() => store.resolve(requestKey(store, { ...chat, run }, req), actor, true)).toThrow(/stale/);
    }
    for (const changed of [{ ...req, at: 11 }, { ...req, input: { command: 'git reset --hard' } }]) {
      expect(() => store.resolve(requestKey(store, chat, changed), actor, true)).toThrow(/stale/);
    }
    expect(() => store.resolve({ ...original, jobId: work.id }, actor, true)).toThrow(/stale/);
    expect(store.original(chat.id, req.id)!.state).toBe('pending');
    const next = { ...req, id: 'after-link', at: 12 };
    registerRequest(store, chat, next);
    expect(requestKey(store, chat, next).jobId).toBe(work.id);
    store.resolve(requestKey(store, chat, req), actor, true);
    expect(store.original(chat.id, req.id)!.decision!.key).toEqual(original);
  });
});

describe('authoritative work projection', () => {
  it('wires live bindings in both application composition roots', () => {
    for (const file of ['wiring.ts', 'index.ts']) {
      const source = fs.readFileSync(path.resolve('src/main', file), 'utf8');
      expect(/store: new CoordinationStore\(path.join\([^\n]+, 'app.db'\)\), chats: \(\) => [\w.]+\.list\(\), pending: \(\) => [\w.]+\.pending\(\)/.test(source), file).toBe(true);
    }
  });
  it('blocks a workflow after all linked chats close and rejects a gate after reassignment', () => {
    const { store, dir } = fixture(false);
    let chats = [{ id: 'worker', state: 'idle', run: { runId: 'run-one', taskVersion: 1 } }] as ChatSummary[];
    const service = new Workflows(path.join(dir, 'work.json'), undefined, undefined, undefined, { store, chats: () => chats, pending: () => [] });
    const row = service.create({ title: 'Live workflow', profile: 'investigation', priority: 'normal', chatIds: ['worker'] });
    chats = [{ ...chats[0]!, closedAt: 20, state: 'closed' }];
    expect(service.list()[0]!.status).toBe('blocked');
    chats = [{ ...chats[0]!, closedAt: undefined, state: 'idle' }];
    const proposed = service.report({ id: row.id, expectedVersion: row.version, action: 'propose', summary: 'Approve exact assignment' });
    chats = [{ ...chats[0]!, run: { ...chats[0]!.run!, runId: 'run-two', taskVersion: 2 } }];
    expect(() => service.decide({ id: row.id, expectedVersion: proposed.version, proposalId: proposed.proposal!.id, approve: true })).toThrow(/stale/);
    expect(store.requests(row.id)[0]!.state).toBe('pending');
  });
  it('refreshes both instances from SQLite and accepts the version actually read', () => {
    const { dir } = fixture(false), file = path.join(dir, 'work.json');
    const first = new Workflows(file), second = new Workflows(file);
    const row = first.create({ title: 'Shared work', profile: 'investigation', priority: 'normal', chatIds: [] });
    expect(second.list()).toEqual(first.list());
    const updated = second.report({ id: row.id, expectedVersion: row.version, action: 'update', summary: 'Second writer' });
    expect(first.list()).toEqual(second.list());
    expect(first.report({ id: row.id, expectedVersion: updated.version, action: 'update', summary: 'First writer' }).version).toBe(updated.version + 1);
    expect(() => second.report({ id: row.id, expectedVersion: updated.version, action: 'update', summary: 'Stale writer' })).toThrow(/cambiato/);
  });
  it('recovers plain-chat questions and accepted-undelivered answers in the same list and digest', () => {
    const { store, dir } = fixture();
    const service = new Workflows(path.join(dir, 'work.json'));
    expect(service.projection()[0]).toMatchObject({ id: key.jobId, coordination: { state: 'waiting-user', requests: [{ key }] } });
    const decision = store.resolve(key, actor, true); store.close();
    const restarted = new Workflows(path.join(dir, 'work.json'));
    const works = restarted.projection();
    expect(works[0]).toMatchObject({ coordination: { state: 'blocked', requests: [{ decision }] } });
    expect(digest({ works, chats: [], pending: [], runs: [], tasks: null, now: 100, since: null, warnTokens: 1000 })).toContain('Consegna da verificare');
  });
  it('keeps an old pending request in the bounded projection despite newer completed policy traffic', () => {
    const { store } = fixture();
    for (let i = 0; i < 3; i++) {
      const next = { ...key, originalRequestId: `policy-${i}` };
      store.register({ key: next, kind: 'permission', at: 20 + i, payload: {} });
      const receipt = store.resolve(next, { kind: 'policy', policy: 'auto-permit' }, true);
      const delivery = store.beginDelivery(receipt.id); store.finishDelivery(delivery.id, 'delivered');
    }
    expect(store.projectionRequests(2).map(r => r.key.originalRequestId)).toContain(key.originalRequestId);
  });
  it('keeps unlinked assignments after chat/run pruning, without equating closed with done', () => {
    const { file, dir } = fixture(false), db = openAppDb(file).db, runs = new RunsDb(db, file);
    const run = { runId: 'run-orphan', taskId: 'task-orphan', taskVersion: 2, chatId: 'forgotten-chat', goal: 'Continue investigation', agentId: 'artisan', startedAt: 1, endedAt: 2 } as AgentRun;
    runs.write({ upsert: [{ id: run.runId, agentId: run.agentId, startedAt: 1, endedAt: 2, json: JSON.stringify(run) }], remove: [], meta: new Map() });
    runs.write({ upsert: [], remove: [run.runId], meta: new Map() });
    runs.close();
    const works = new Workflows(path.join(dir, 'work.json')).projection();
    expect(works).toHaveLength(1);
    expect(works[0]).toMatchObject({ id: 'task-orphan', status: 'blocked', coordination: { state: 'blocked', assignments: [{ runId: 'run-orphan', taskVersion: 2, closed: true }] } });
    expect(works[0]!.coordination.evidence[0]!.detail).toContain('without a completion verdict');
  });
  it('does not rewrite the semantic job projection for token/cost-only updates', () => {
    const { file } = fixture(false), db = openAppDb(file).db, runs = new RunsDb(db, file);
    const run = { runId: 'run-meter', chatId: 'chat-meter', goal: 'Observe', agentId: 'scout', startedAt: 1, costUsd: 1 } as AgentRun;
    const write = () => runs.write({ upsert: [{ id: run.runId, agentId: run.agentId, startedAt: 1, endedAt: null, json: JSON.stringify(run) }], remove: [], meta: new Map() });
    write();
    const before = (db.prepare('select total_changes() n').get() as { n: number }).n;
    run.costUsd = 2; write();
    expect((db.prepare('select total_changes() n').get() as { n: number }).n - before).toBe(1); // agent_runs only
  });
  it('imports valid legacy JSON once with original bytes and history unchanged', () => {
    const { store, dir } = fixture(false), file = path.join(dir, 'legacy.json');
    const legacy: WorkThread = { id: 'legacy-job', version: 4, title: 'Legacy investigation', profile: 'investigation', priority: 'normal', chatIds: ['legacy-worker'],
      stage: 'analysis', status: 'approval', summary: 'Scoped request', waitingOn: 'Te', nextAction: 'Review scope', evidence: 'Original evidence', cycles: 0,
      createdAt: 1, updatedAt: 4, proposal: { id: 'legacy-proposal', text: 'Read original scope' }, events: [
        { at: 1, stage: 'analysis', kind: 'created', text: 'Original title' },
        { at: 2, stage: 'analysis', kind: 'approved', text: 'Historical consent only' },
        { at: 4, stage: 'analysis', kind: 'proposed', text: 'Read original scope' },
      ] };
    const original = JSON.stringify([legacy], null, 2) + '\n'; fs.writeFileSync(file, original);
    const service = new Workflows(file);
    expect(store.work(legacy.id)).toEqual(legacy);
    expect(service.list()[0]!.events).toEqual(legacy.events);
    expect(store.history(legacy.id).map(h => h.event)).toEqual(legacy.events);
    expect(store.requests(legacy.id)[0]!.state).toBe('pending');
    expect(store.requests(legacy.id)[0]!.decision).toBeUndefined();
    store.close();
    const restarted = new Workflows(file);
    expect(restarted.coordination.history(legacy.id).map(h => h.event)).toEqual(legacy.events);
    expect(restarted.coordination.requests(legacy.id)).toHaveLength(1);
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });
  it('preserves pending proposals on restart; chat closure is not completion', () => {
    const { store, dir } = fixture(false);
    const file = path.join(dir, 'legacy.json');
    const service = new Workflows(file, undefined, () => 100);
    const row = service.create({ title: 'Investigate', profile: 'investigation', priority: 'normal', chatIds: ['worker'] });
    const pending = service.report({ id: row.id, expectedVersion: row.version, action: 'propose', summary: 'Read the selected source' });
    const persisted = store.work(row.id)!;
    const closed = { id: 'worker', closedAt: 101, state: 'closed', run: { runId: 'r1', taskVersion: 1 } } as ChatSummary;
    const projection = projectWork(persisted, [closed], [], store.requests());
    expect(projection.coordination.state).toBe('waiting-user');
    expect(projection.status).not.toBe('done');
    expect(new Workflows(file).list()[0]!.events).toEqual(pending.events);
    expect(projection.coordination.evidence).toContainEqual({ source: 'chat', id: 'worker', detail: 'Chat chiusa: non prova il completamento del lavoro.' });
  });
  it('digest renders the exact list state, next action and evidence instead of inventing completion from chat state', () => {
    const { store, dir } = fixture(false);
    const chats = [{ id: 'worker', title: 'Implementation', state: 'closed', closedAt: 11, updatedAt: 11, harness: 'claude' }] as ChatSummary[];
    const service = new Workflows(path.join(dir, 'work.json'), undefined, () => 100, undefined, { store, chats: () => chats, pending: () => [] });
    service.create({ title: 'Unfinished feature', profile: 'feature', priority: 'normal', chatIds: ['worker'] });
    const works = service.projection(); expect(service.list()).toEqual(works);
    const text = digest({ works, chats, pending: [], runs: [], tasks: null, now: 100, since: null, warnTokens: 1000 });
    expect(works[0]!.coordination.state).toBe('blocked');
    expect(text).toContain('blocked'); expect(text).toContain(works[0]!.coordination.nextAction);
    expect(text).toContain('Chat chiusa: non prova il completamento del lavoro.'); expect(text).not.toContain('da sola, finita');
  });
  it('atomically commits workflow consent and transition; losing CAS leaves no accepted decision', () => {
    const { store, dir } = fixture(false);
    const service = new Workflows(path.join(dir, 'work.json'), undefined, () => 100);
    const row = service.create({ title: 'Scope', profile: 'investigation', priority: 'normal', chatIds: [] });
    const proposed = service.report({ id: row.id, expectedVersion: row.version, action: 'propose', summary: 'Exact proposal' });
    const req = store.requests(row.id)[0]!;
    expect(() => store.resolve(req.key, actor, true, { row: { ...store.work(row.id)!, version: proposed.version + 1 }, expected: 999 })).toThrow(/cambiato/);
    expect(store.request(req.id)!.state).toBe('pending');
    const decided = service.decide({ id: row.id, expectedVersion: proposed.version, proposalId: proposed.proposal!.id, approve: true });
    expect(store.request(req.id)!.state).toBe('accepted');
    expect(new Workflows(path.join(dir, 'work.json')).list()[0]).toEqual(decided);
  });
});
