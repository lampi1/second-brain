// Approved work goes on by itself (ADR 0238): a work thread with a recorded decision that nothing moves for STALL_MS is
// told to the Orchestrator (again after 2x and 4x, then no more); a closed linked chat with unread mail is reopened
// instead; a thread waiting for the user, blocked or with an uncertain delivery is never touched. Fake clock, fake deps.
import { expect, it } from 'vitest';
import type { ChatSummary } from '../../../src/shared/contract';
import type { WorkThread } from '../../../src/shared/workflows';
import { projectWork } from '../../../src/main/coordination/projection';
import type { RequestRecord } from '../../../src/main/coordination/model';
import { MAIL_WAKE, STALL_MS, WorkDriver } from '../../../src/main/workflows/driver';

const T0 = 1_000_000;
const thread = (o: Partial<WorkThread> = {}): WorkThread => ({ id: 'w1', version: 3, title: 'Esportazione CSV', profile: 'feature', priority: 'normal',
  chatIds: ['c1'], stage: 'develop', status: 'active', summary: 's', waitingOn: '', nextAction: 'Implementare l’esportazione', evidence: '', cycles: 0,
  createdAt: T0 - 10, updatedAt: T0, events: [{ at: T0 - 5, stage: 'plan', kind: 'approved', text: 'piano' }], ...o });
const chat = (): ChatSummary => ({ id: 'c1', title: 'Dev', state: 'idle', pending: 0, updatedAt: T0 }) as ChatSummary;

function world(rows: WorkThread[], chats: ChatSummary[], o: { mail?: boolean; orchestrator?: boolean; requests?: RequestRecord[] } = {}) {
  const told: { threadId: string; detail: string }[] = [], woken: { chatId: string; text: string }[] = [], withdrawn: string[] = [];
  let now = T0;
  const driver = new WorkDriver({
    works: () => rows.map(r => projectWork(r, chats, [], o.requests ?? [])), chats: () => chats, withdraw: id => { withdrawn.push(id); },
    tell: n => { if (o.orchestrator === false) return false; told.push(n); return true; },
    mailWaiting: () => !!o.mail, wake: async (chatId, text) => { woken.push({ chatId, text }); },
    now: () => now,
  });
  return { driver, told, woken, withdrawn, at: (t: number) => { now = t; } };
}

it('tells the Orchestrator about approved work nothing moves, then again after 2x and 4x, then stops', () => {
  const w = world([thread()], [{ ...chat(), updatedAt: T0 }]);
  expect(w.driver.tick(T0 + STALL_MS - 1)).toBe(0);
  expect(w.driver.tick(T0 + STALL_MS)).toBe(1);
  expect(w.told[0]!.detail).toContain('Prossima azione: Implementare l’esportazione');
  expect(w.told[0]!.detail).toContain('senza chiedere all’utente');
  expect(w.driver.tick(T0 + STALL_MS + 60_000)).toBe(0);           // once per wait
  expect(w.driver.tick(T0 + 2 * STALL_MS)).toBe(1);
  expect(w.driver.tick(T0 + 4 * STALL_MS)).toBe(1);
  expect(w.driver.tick(T0 + 64 * STALL_MS)).toBe(0);               // three nudges, then the thread is the Orchestrator's to report
  expect(w.told).toHaveLength(3);
});

it('starts counting again when the thread or its chats move', () => {
  const chats = [chat()];
  const w = world([thread()], chats);
  w.driver.tick(T0 + STALL_MS); w.driver.tick(T0 + 2 * STALL_MS); w.driver.tick(T0 + 4 * STALL_MS);
  chats[0] = { ...chats[0]!, updatedAt: T0 + 5 * STALL_MS };        // its chat did something
  expect(w.driver.tick(T0 + 6 * STALL_MS)).toBe(1);
});

it('leaves alone work that is moving, waits for the user, is blocked, has no decision or an uncertain delivery', () => {
  const late = T0 + 10 * STALL_MS;
  const cases: [WorkThread, ChatSummary[]][] = [
    [thread(), [{ ...chat(), state: 'running' }]],                                   // a chat works on it
    [thread(), [{ ...chat(), pending: 1 }]],                                         // a question or command for the user
    [thread({ status: 'approval', proposal: { id: 'p', text: 'deploy' } }), [chat()]],  // a proposal waits for the user
    [thread({ events: [...thread().events, { at: T0, stage: 'develop', kind: 'blocked', text: 'b' }] }), [chat()]],
    [thread({ cycles: 3 }), [chat()]],                                               // three failed reviews: a new proposal
    [thread({ events: [{ at: T0, stage: 'analysis', kind: 'created', text: 'c' }] }), [chat()]],   // never approved
    [thread({ status: 'done' }), [chat()]],
    // blocked, then updated: the status stays blocked although the last event is not
    [thread({ status: 'blocked', events: [...thread().events, { at: T0, stage: 'develop', kind: 'blocked', text: 'b' }, { at: T0, stage: 'develop', kind: 'updated', text: 'u' }] }), [chat()]],
    [thread(), [{ ...chat(), waitsOn: 'user' }]],                                    // asked the user in plain text
    [thread(), [{ ...chat(), background: 1 }]],                                      // a background task still runs
    [thread(), [{ ...chat(), waitsOnWork: true }]],                                  // waits on a build, CI, an agent
  ];
  for (const [row, chats] of cases) expect(world([row], chats).driver.tick(late)).toBe(0);
  // an accepted request with no delivery receipt yet: uncertain, never re-executed (projection.ts needsDeliveryReview)
  const key = { jobId: 'w1', chatId: 'c1', taskVersion: 3, originalRequestId: 'r1' } as RequestRecord['key'];
  const accepted: RequestRecord = { id: 'q1', key, kind: 'permission', at: T0, payload: null, state: 'accepted' };
  expect(world([thread()], [chat()], { requests: [accepted] }).driver.tick(late)).toBe(0);
  expect(world([thread()], [chat()], { requests: [{ ...accepted, kind: 'workflow' }] }).driver.tick(late)).toBe(1);  // a workflow approval never gets a receipt
});

it('withdraws the stalled news still waiting when the thread moves again', () => {
  const rows = [thread()];
  const w = world(rows, [chat()]);
  expect(w.driver.tick(T0 + STALL_MS)).toBe(1);
  rows[0] = { ...rows[0]!, status: 'done' };
  w.driver.tick(T0 + STALL_MS + 60_000);
  expect(w.withdrawn).toEqual(['w1']);
});

it('reopens a closed linked chat that has unread mail instead of telling the Orchestrator', () => {
  const w = world([thread()], [{ ...chat(), state: 'closed', closedAt: T0, closedBy: 'auto' }], { mail: true });
  expect(w.driver.tick(T0 + STALL_MS)).toBe(1);
  expect(w.woken).toEqual([{ chatId: 'c1', text: MAIL_WAKE('Esportazione CSV') }]);
  expect(w.told).toEqual([]);
  // a chat the user closed himself is never reopened by the app: the Orchestrator hears about the thread
  const u = world([thread()], [{ ...chat(), state: 'closed', closedAt: T0, closedBy: 'user' }], { mail: true });
  u.driver.tick(T0 + STALL_MS);
  expect(u.woken).toEqual([]);
  expect(u.told).toHaveLength(1);
});

it('tries again on the next pass when no Orchestrator took the news', () => {
  const w = world([thread()], [chat()], { orchestrator: false });
  expect(w.driver.tick(T0 + STALL_MS)).toBe(0);
  expect(w.driver.tick(T0 + STALL_MS + 60_000)).toBe(0);
});
