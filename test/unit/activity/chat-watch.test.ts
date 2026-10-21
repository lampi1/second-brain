// The Log's task chain from the chats' own events (main/activity/chat-watch.ts): an opened chat names who chose it
// and why, plus the classifier's pick; a turn's tools, errors, cost, input and answer; requests and who closed them;
// the result, the verdict and the close; the Orchestrator's turns are no task; chats open at start are not replayed.
import { describe, expect, it } from 'vitest';
import { ChatWatch } from '../../../src/main/activity/chat-watch';
import type { ChatSummary } from '../../../src/shared/contract';

const chat = (id: string, extra: Partial<ChatSummary> = {}): ChatSummary => ({
  id, title: `Chat ${id}`, harness: 'claude', origin: 'app', cwd: '/x', sessionId: null, model: 'claude-sonnet-4-5', effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...extra,
}) as ChatSummary;
const scout = { id: 'scout', name: 'Scout' } as ChatSummary['agent'];

describe('chat watch', () => {
  it('logs the choice, the classifier, the work, the result, the verdict and the close', () => {
    const w = new ChatWatch();
    const c = chat('c1', { agent: scout, title: 'Analizza la PR', route: { policy: 'routing', version: 1, source: 'table', reason: 'review veloci', kind: 'review', area: 'shop', at: 1 },
      run: { runId: 'r1', chatId: 'c1', agentId: 'scout', version: 1, goal: 'Analizza la PR #1', startedBy: 'orchestrator', startedAt: 1, costUsd: null, tokens: null, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null } } });
    const opened = w.updated(c);
    expect(opened.map(e => e.title)).toEqual(['Orchestrator sceglie Scout', 'Classificatore: review / shop → claude · claude-sonnet-4-5']);
    expect(opened[0]).toMatchObject({ step: 'open', rootId: 'c1', task: 'Analizza la PR', text: 'review veloci', input: 'Analizza la PR #1' });
    expect(w.updated(c)).toEqual([]);

    w.item('c1', { kind: 'user', id: 'u', at: 1, text: 'Analizza la PR #1' }, c);
    w.item('c1', { kind: 'tool', id: 't1', at: 1, name: 'Read', summary: '', input: {}, status: 'running' }, c);
    w.item('c1', { kind: 'tool', id: 't2', at: 1, name: 'Bash', summary: 'gh', input: {}, status: 'error', output: 'not found' }, c);
    w.item('c1', { kind: 'assistant', id: 'a', at: 1, text: 'Si può unire.' }, c);
    const [work] = w.item('c1', { kind: 'result', id: 'r', at: 1, costUsd: 0.12, durationMs: 4000, turns: 1, isError: false }, c);
    expect(work).toMatchObject({ step: 'work', level: 'warn', costUsd: 0.12, ms: 4000, tools: ['Read', 'Bash'], toolErrors: 1, input: 'Analizza la PR #1', output: 'Si può unire.', error: 'Bash: not found' });

    const reported = { ...c, run: { ...c.run!, report: { at: 5, outcome: 'done' as const, verified: 'yes' as const, summary: 'Si può unire' }, outcome: { verdict: 'success' as const, basis: 'human' as const, at: 6, by: 'user' } } };
    expect(w.updated(reported).map(e => [e.step, e.title])).toEqual([['result', 'Scout: risultato consegnato (completato)'], ['verdict', 'Verifica: riuscito da te']]);
    expect(w.updated({ ...reported, closedAt: 9, closedBy: 'auto' }).map(e => e.title)).toEqual(['Scout: chiusa da sola, finito il lavoro']);
  });

  it('puts a delegated chat under its root and a review under the reviewed task', () => {
    const w = new ChatWatch();
    w.seed([chat('root', { agent: { id: 'strategist', name: 'Strategist' } as ChatSummary['agent'], run: { runId: 'rr' } as ChatSummary['run'] })]);
    const [child] = w.updated(chat('kid', { agent: scout, parentId: 'root', delegation: { role: 'scout', goal: 'Trova i punti', doneWhen: [], at: 1 } }));
    expect(child).toMatchObject({ rootId: 'root', parentId: 'root', title: 'Strategist sceglie Scout', text: 'Delegato: Trova i punti' });
    const [rev] = w.updated(chat('rev', { agent: { id: 'sentinel', name: 'Sentinel' } as ChatSummary['agent'], run: { runId: 'rv', reviewOf: 'rr', goal: 'Rivedi' } as ChatSummary['run'] }));
    expect(rev).toMatchObject({ step: 'review', rootId: 'root', reviewOf: 'rr' });
  });

  it('says who closed a request', () => {
    const w = new ChatWatch(), c = chat('c', { agent: scout });
    w.seed([c]);
    const p = { id: 'q1', chatId: 'c', type: 'permission' as const, tool: 'Bash', title: 'Bash · rm', detail: 'rm x', input: {}, at: 1 };
    expect(w.pendingAdded(p, c)[0]).toMatchObject({ step: 'request', reqType: 'permission', title: 'Scout chiede il permesso: Bash' });
    expect(w.pendingResolved('c', 'q1', c)[0]).toMatchObject({ by: 'other', level: 'warn' });
    w.pendingAdded({ ...p, id: 'q2' }, c);
    w.answeredByUser('c', 'q2');
    expect(w.pendingResolved('c', 'q2', c)[0]).toMatchObject({ by: 'user', level: 'ok' });
    expect(w.pendingAdded({ ...p, id: 'cmd', type: 'command' }, c)).toEqual([]);
  });

  it('keeps the Orchestrator out of the tasks and does not replay the chats open at start', () => {
    const w = new ChatWatch(), o = chat('o', { isOrchestrator: true });
    expect(w.updated(o)).toEqual([]);
    const [turn] = w.item('o', { kind: 'result', id: 'r', at: 1, costUsd: 0.01, durationMs: 1, turns: 1, isError: false }, o);
    expect(turn!.rootId).toBeUndefined();
    expect(turn!.title).toBe('Orchestrator ha lavorato');
    const old = chat('old', { agent: scout });
    w.seed([old]);
    expect(w.updated(old)).toEqual([]);
  });
});
