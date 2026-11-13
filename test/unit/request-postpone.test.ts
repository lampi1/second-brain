// Regression coverage for renderer request-local postponement: preserving pending data, new arrivals, explicit
// queue navigation above dialogs and restoring popups. These tests use the normal stores with a fake IPC bridge.
import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkThread } from '../../src/shared/workflows';
import type { PendingRequest } from '../../src/shared/contract';
const invoke = vi.fn().mockImplementation((channel: string) => Promise.resolve(channel === 'work:list' || channel === 'work:lessons' ? [] : undefined));
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: (...args:unknown[]) => invoke(...args), on: () => () => {} } }));
const { app } = await import('../../src/renderer/store/store');
const { initialState } = await import('../../src/renderer/store/state');
const { ui, openModal } = await import('../../src/renderer/store/ui');
const { answerLater, openQueue, requestPostponed, resumeQuestions } = await import('../../src/renderer/lib/later');
const { workflowState, durableAskKeys } = await import('../../src/renderer/store/workflows');
const req = (id:string):PendingRequest => ({id,chatId:'c',type:'permission',tool:'Bash',title:id,detail:'',input:{},at:1});
beforeEach(() => {
  resumeQuestions();
  app.set({...initialState,pending:[req('one'),req('two')]});
  invoke.mockClear();
});
it('postpones only the chosen request without answering or removing any pending request', () => {
  answerLater('c/two');
  app.set(s=>({...s,pending:[...s.pending,req('new')]}));
  expect(requestPostponed('c/two')).toBe(true);
  expect(requestPostponed('c/one')).toBe(false);
  expect(requestPostponed('c/new')).toBe(false);
  expect(app.get().pending.map(r=>r.id)).toEqual(['one','two','new']);
  expect(invoke).not.toHaveBeenCalled();
});
it('explicit queue navigation removes the covering dialog and selects the actual request', () => {
  answerLater('c/two');
  openModal('settings');
  openQueue('c/two');
  expect(ui.get().modal).toBe(null);
  expect(ui.get().qwin).toMatchObject({open:true,first:'c/two'});
  expect(requestPostponed('c/two')).toBe(false);
  expect(app.get().pending).toHaveLength(2);
});
it('reenabling popups can restore all postponed requests without resolving them', () => {
  answerLater('c/one');
  answerLater('c/two');
  resumeQuestions();
  expect(app.get().pending.filter(r=>!requestPostponed(`${r.chatId}/${r.id}`))).toHaveLength(2);
  expect(ui.get().later).toBe(false);
});

it('postpones a durable proposal without losing it; a changed version is a new request and reopening restores the old one', () => {
  const row = { id: 'durable', version: 1, status: 'approval', updatedAt: 1, proposal: { id: 'p', text: 'Do the scoped action' } } as unknown as WorkThread;
  workflowState.set({ rows: [row], lessons: [], error: null, lessonError: null });
  const key = durableAskKeys()[0]!;
  answerLater(key);
  expect(requestPostponed(key)).toBe(true);
  app.set(s => ({ ...s, pending: [...s.pending, req('new')] }));
  expect(requestPostponed(key)).toBe(true);
  workflowState.set(s => ({ ...s, rows: [{ ...row, version: 2 }] }));
  expect(requestPostponed(durableAskKeys()[0]!)).toBe(false);
  resumeQuestions();
  expect(requestPostponed(key)).toBe(false);
  expect(workflowState.get().rows).toHaveLength(1);
});
