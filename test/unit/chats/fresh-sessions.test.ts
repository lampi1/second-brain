// Budget-based continuation preserves chat/task identity and exact user decisions across idle engine replacement.
// Controlled harnesses exercise real manager persistence and races without tokens, real processes, or e2e.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { contextBudgetDue, FRESH_HANDOFF_MARK, FRESH_IDLE_MS, protectedHandoff } from '../../../src/main/chats/handoff';
import { plainOwner } from '../../../src/main/agents/catalog';
import { tmp } from './helpers';
import { exportRuns } from '../../../src/main/agents/runs-db';

const managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); vi.restoreAllMocks(); });
function fixture(extra: Partial<ChatManagerOptions> = {}) {
  let now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const userData = tmp('fresh-ud'), cwd = tmp('fresh-cwd');
  const sent: string[] = [], engines: { sink: SessionSink; session: HarnessSession }[] = [];
  let failSend = false, beforeClose = () => {};
  const workflow = { id: 'thread-stable', version: 7, approvedProposal: { id: 'proposal-stable', text: 'Local changes only' }, waitingOn: 'Which environment?', events: [{ kind: 'rejected', text: 'Do not deploy' }] };
  const make = () => {
    const m = new ChatManager({ userData, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0,
      freshSessions: () => true, continuationContext: () => JSON.stringify(workflow), ...extra,
      sessionFactory: (_h, options, sink) => {
        let alive = true, busy = false;
        const session: HarnessSession = {
          harness: 'claude', sessionId: options.sessionId ?? null, pid: null, root: null,
          get alive() { return alive; }, get busy() { return busy; }, get state() { return !alive ? 'closed' as const : busy ? 'running' as const : 'idle' as const; },
          start() { sink.changed({ state: 'idle' }); sink.childrenCoverage?.('partial'); },
          send(text) {
            if (failSend && engines.length > 1) throw new Error('submission unavailable');
            sent.push(text); busy = true; sink.changed({ state: 'running' });
            sink.item({ kind: 'assistant', id: `a${sent.length}`, at: now, text: 'Changes checked. Which environment?' }, false);
            sink.item({ kind: 'result', id: `r${sent.length}`, at: now, durationMs: 1, turns: 1, costUsd: 0, isError: false }, false);
            busy = false; sink.changed({ state: 'idle', contextTokens: 90_000, contextMaxTokens: 100_000, contextEstimated: false });
          },
          async close() { beforeClose(); alive = false; sink.exit({ code: 0, error: null }); },
          killNow() {}, async interrupt() {}, answer(id) { sink.resolved(id); return true; },
          async rename() {}, async setModel() {}, async setEffort() {}, async setPermissionMode() {}, async contextUsage() { return null; }, async usage() { return null; },
        };
        engines.push({ sink, session }); return session;
      },
    });
    managers.push(m); return m;
  };
  const m = make();
  const create = () => m.create({ harness: 'claude', cwd, title: 'Stable job', prompt: 'Keep all edits local. Never push or deploy.' }, 'user', {
    owner: { ...plainOwner('claude', null), source: 'catalog', id: 'artisan', version: 1 }, instructions: 'Keep the approved task.', policy: null,
  });
  return { m, make, create, sent, engines, userData, workflow, advance: () => { now += FRESH_IDLE_MS + 1; }, fail: (value: boolean) => { failSend = value; }, onClose: (fn: () => void) => { beforeClose = fn; } };
}

describe('protected continuation', () => {
  it('requires an actual finite context budget, not an estimate or fixed long-chat label', () => {
    expect(contextBudgetDue({ contextTokens: 80_000, contextMaxTokens: 100_000 })).toBe(true);
    for (const sample of [{ contextTokens: 79_999, contextMaxTokens: 100_000 }, { contextTokens: 90_000 }, { contextTokens: 90_000, contextMaxTokens: 100_000, contextEstimated: true }, { contextTokens: Infinity, contextMaxTokens: 100_000 }, { contextTokens: 90_000, contextMaxTokens: NaN }]) expect(contextBudgetDue(sample)).toBe(false);
  });
  it('refuses oversized protected state instead of truncating an early directive', () => {
    expect(protectedHandoff({ title: 't', cwd: '/x', harness: 'claude', lastText: '' }, [], { instruction: 'x'.repeat(32_000) }, '')).toBeNull();
  });
  it('rotates a normal partial-census idle Claude without changing the chat, task, ledger or workflow', async () => {
    const f = fixture(), c = await f.create(), runId = c.run!.runId, taskId = c.run!.taskId;
    expect(f.m.coldTick()).toBe(0);
    f.advance(); expect(f.m.coldTick()).toBe(1); expect(f.m.coldTick()).toBe(0);
    expect(f.sent).toHaveLength(1); // Preparing costs no model turn.
    const workflowBefore = structuredClone(f.workflow);
    await f.m.send(c.id, 'Continue locally.');
    const current = f.m.list()[0]!;
    expect(current.id).toBe(c.id); expect(current.title).toBe(c.title); expect(current.cwd).toBe(c.cwd);
    expect(current.sessionId).not.toBe(c.sessionId); expect(current.run!.runId).toBe(runId); expect(current.run!.taskId).toBe(taskId);
    expect(f.m.list()).toHaveLength(1); expect(f.workflow).toEqual(workflowBefore);
    expect(f.sent[1]).toContain(FRESH_HANDOFF_MARK); expect(f.sent[1]).toContain('Never push or deploy.');
    expect(f.sent[1]).toContain('Which environment?'); expect(f.sent[1]).toContain('proposal-stable'); expect(f.sent[1]).toContain('Do not deploy');
    expect(f.sent[1]).not.toContain('ferma da più'); expect(f.m.userEvents(c.id).events).toHaveLength(2);
    expect(f.m.items(c.id).filter(i => i.kind === 'system' && i.continued)).toHaveLength(1);
    expect(current.run!.report).toBeUndefined();
  });
  it.each(['running', 'unknown'] as const)('does not replace a session with an observed %s child', async state => {
    const f = fixture(), c = await f.create();
    f.engines[0]!.sink.children?.({ key: 'child', nativeId: 'child', toolCallId: null, parentNativeId: null, kind: 'agent', state, task: 'work', observedAt: Date.now(), source: 'live' });
    f.advance(); expect(f.m.coldTick()).toBe(0); await f.m.send(c.id, 'more');
    expect(f.engines).toHaveLength(1); expect(f.m.list()[0]!.sessionId).toBe(c.sessionId);
  });
  it('preserves a pending question, then records its exact answer before a later continuation', async () => {
    const f = fixture(), c = await f.create();
    f.engines[0]!.sink.pending({ id: 'q1', type: 'question', tool: 'AskUserQuestion', title: 'Target?', detail: '', input: {}, questions: [{ question: 'Target?', options: [], multiSelect: false }], at: Date.now() });
    f.advance(); expect(f.m.coldTick()).toBe(0);
    await f.m.answer(c.id, 'q1', { kind: 'question', answers: { 'Target?': 'Local only, never production' } });
    expect(f.m.userEvents(c.id).events.at(-1)!.text).toContain('Local only, never production');
    await f.m.send(c.id, 'Continue'); expect(f.engines).toHaveLength(2); expect(f.sent.at(-1)).toContain('Local only, never production');
  });
  it('rechecks activity when teardown races with a pending question', async () => {
    const f = fixture(), c = await f.create(); f.advance();
    f.onClose(() => f.engines[0]!.sink.pending({ id: 'late', type: 'question', tool: 'AskUserQuestion', title: 'Wait?', detail: '', input: {}, at: Date.now() }));
    await f.m.send(c.id, 'Continue');
    expect(f.m.list()[0]!.sessionId).toBe(c.sessionId); expect(f.m.pending().some(p => p.id === 'late')).toBe(true);
  });
  it('keeps a failed first-submission handoff through restart, with no second task or report', async () => {
    const f = fixture(), c = await f.create(); f.advance(); f.fail(true);
    await expect(f.m.send(c.id, 'Continue')).rejects.toThrow('submission unavailable');
    const saved = JSON.parse(fs.readFileSync(path.join(f.userData, 'chats.json'), 'utf8')) as { chats: { continuationPending?: string }[] };
    expect(saved.chats[0]!.continuationPending).toBe(c.sessionId);
    const freshId = f.m.list()[0]!.sessionId; await f.m.shutdown(); f.fail(false);
    const restored = f.make(); await restored.send(c.id, 'Retry');
    expect(f.sent.at(-1)).toContain('Never push or deploy.'); expect(f.sent.at(-1)).toContain('proposal-stable');
    expect(restored.list()[0]!.sessionId).toBe(freshId); expect(restored.list()[0]!.run!.runId).toBe(c.run!.runId);
    expect(restored.list()[0]!.run!.report).toBeUndefined(); expect(restored.list()).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(f.userData, 'chats.json'), 'utf8')).chats[0].continuationPending).toBeUndefined();
  });
  it.each([{ context: null }, { context: 'x'.repeat(33_000) }])('keeps the old session when authoritative context is unavailable or too large', async ({ context }) => {
    const f = fixture({ continuationContext: () => context }), c = await f.create(); f.advance();
    expect(f.m.coldTick()).toBe(0); await f.m.send(c.id, 'Continue'); expect(f.engines).toHaveLength(1); expect(f.m.list()[0]!.sessionId).toBe(c.sessionId);
  });
  it('passes narrowed delegation policy to host preparation and binds isolation before the child starts', async () => {
    const isolated = tmp('isolated-child');
    const bind = vi.fn();
    const prepare = vi.fn<NonNullable<ChatManagerOptions['prepareDelegation']>>(async parent => ({ cwd: isolated, parentRunId: parent.run?.runId, parentTaskVersion: parent.run?.taskVersion, bind }));
    const f = fixture({ prepareDelegation: prepare }), parent = await f.create();
    const child = await f.m.create({ harness: 'claude', cwd: parent.cwd, parentId: parent.id, delegation: { role: 'scout', goal: 'Review only', at: Date.now(), doneWhen: [], tools: ['read'] } }, 'agent');
    expect(prepare).toHaveBeenCalledOnce(); expect(prepare.mock.calls[0]![2]?.tools?.allow).toEqual(['read']);
    expect(child.cwd).toBe(isolated); expect(bind).toHaveBeenCalledExactlyOnceWith(child.id);
  });
  it('refuses delegation when parent permission mode changes during worktree preparation', async () => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const prepare = vi.fn<NonNullable<ChatManagerOptions['prepareDelegation']>>(async parent => { await waiting; return { cwd: parent.cwd, parentRunId: parent.run?.runId, parentTaskVersion: parent.run?.taskVersion }; });
    const f = fixture({ prepareDelegation: prepare }), parent = await f.create();
    const child = f.m.create({ harness: 'claude', cwd: parent.cwd, parentId: parent.id }, 'agent');
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    await f.m.set(parent.id, { permissionMode: 'plan' }); release();
    await expect(child).rejects.toThrow('Parent permissions changed'); expect(f.m.list()).toHaveLength(1);
  });

  it('keeps child-generated question context private while preserving the user choice for continuation', async () => {
    const f = fixture(), c = await f.create(), notices: unknown[] = [];
    f.m.onUserWrote(note => notices.push(note));
    f.engines[0]!.sink.pending({ id: 'private-q', type: 'question', tool: 'AskUserQuestion', title: 'PRIVATE_CHILD_MARKER', detail: 'PRIVATE_CHILD_MARKER', input: {}, questions: [{ question: 'PRIVATE_CHILD_MARKER?', options: [{ label: 'Local', description: 'PRIVATE_CHILD_MARKER' }], multiSelect: false }], at: Date.now() });
    await f.m.answer(c.id, 'private-q', { kind: 'question', answers: { 'PRIVATE_CHILD_MARKER?': 'Local' } });
    expect(JSON.stringify(notices)).not.toContain('PRIVATE_CHILD_MARKER'); expect(JSON.stringify(f.m.userEvents(c.id))).not.toContain('PRIVATE_CHILD_MARKER');
    expect(JSON.stringify(notices)).toContain('Local'); f.advance(); await f.m.send(c.id, 'Continue');
    expect(f.sent.at(-1)).toContain('PRIVATE_CHILD_MARKER'); expect(f.sent.at(-1)).toContain('Local');
  });
  it('keeps a permission denial with no message as a scoped private decision', async () => {
    const f = fixture(), c = await f.create();
    f.engines[0]!.sink.pending({ id: 'permit', type: 'permission', tool: 'UnknownExternalAction', title: 'PRIVATE_PERMISSION_TARGET', detail: 'Specific target', input: {}, at: Date.now() });
    await f.m.answer(c.id, 'permit', { kind: 'permission', allow: false });
    expect(JSON.stringify(f.m.userEvents(c.id))).not.toContain('PRIVATE_PERMISSION_TARGET');
    f.advance(); await f.m.send(c.id, 'Continue'); expect(f.sent.at(-1)).toContain('PRIVATE_PERMISSION_TARGET'); expect(f.sent.at(-1)).toContain('non autorizza nuove azioni');
    const rows = JSON.parse(fs.readFileSync(path.join(f.userData, 'chats.json'), 'utf8')) as { chats: { continuationDecisions: string }[] };
    expect(rows.chats[0]!.continuationDecisions).toContain('"allow":false');
  });
  it('retains an irreversible blocker after history is trimmed and after app restart', async () => {
    const f = fixture({ maxItems: 3 }), c = await f.create();
    await f.m.send(c.id, 'Later request'); expect(f.m.items(c.id).some(i => i.kind === 'user' && i.text.includes('Never push'))).toBe(false);
    f.advance(); expect(f.m.coldTick()).toBe(0); await f.m.send(c.id, 'Continue'); expect(f.engines).toHaveLength(1);
    await f.m.shutdown();
    const saved = JSON.parse(fs.readFileSync(path.join(f.userData, 'chats.json'), 'utf8')) as { chats: { continuityUnsafe: boolean }[] };
    expect(saved.chats[0]!.continuityUnsafe).toBe(true);
    const restored = f.make(); await restored.send(c.id, 'Restore'); f.advance(); expect(restored.coldTick()).toBe(0);
  });
  it('refreshes at an explicit continued-assignment boundary without creating an extra run', async () => {
    const f = fixture(), c = await f.create(); await f.m.set(c.id, { workStatus: 'completed' }); f.advance();
    await f.m.assignTask(c.id, 'Second phase, still local', { mode: 'continue' });
    const current = f.m.list()[0]!;
    expect(current.sessionId).not.toBe(c.sessionId); expect(current.run!.taskId).toBe(c.run!.taskId); expect(current.run!.taskVersion).toBe(2);
    expect(current.run!.continuedFrom).toBe(c.run!.runId); expect(f.sent.at(-1)).toContain('Second phase, still local');
    expect(f.sent.at(-1)).toContain('Never push or deploy'); expect(exportRuns(path.join(f.userData, 'app.db'))!.runs).toHaveLength(2);
  });
  it('does not rotate a restored historical session whose provider transcript is missing', async () => {
    const f = fixture(), c = await f.create();
    await f.m.shutdown(); f.advance();
    const restored = f.make();
    await restored.send(c.id, 'Continue with the original provider session');
    expect(restored.list()[0]!.sessionId).toBe(c.sessionId);
    expect(f.sent.at(-1)).not.toContain(FRESH_HANDOFF_MARK);
    const saved = JSON.parse(fs.readFileSync(path.join(f.userData, 'chats.json'), 'utf8')) as { chats: { continuityUnsafe: boolean }[] };
    expect(saved.chats[0]!.continuityUnsafe).toBe(true);
  });
  it('refuses a child when its parent finishes during worktree preparation', async () => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const prepare = vi.fn<NonNullable<ChatManagerOptions['prepareDelegation']>>(async parent => { await waiting; return { cwd: parent.cwd, parentRunId: parent.run?.runId, parentTaskVersion: parent.run?.taskVersion }; });
    const f = fixture({ prepareDelegation: prepare }), parent = await f.create();
    const child = f.m.create({ harness: 'claude', cwd: parent.cwd, parentId: parent.id }, 'agent');
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    await f.m.set(parent.id, { workStatus: 'completed' }); release();
    await expect(child).rejects.toThrow('Parent assignment changed'); expect(f.m.list()).toHaveLength(1); expect(f.engines).toHaveLength(1);
  });

});
