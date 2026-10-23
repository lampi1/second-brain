// Renderer decision transport retains exact proposal versions and free response; stale reads never resurrect answers.
import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkThread } from '../../src/shared/workflows';
import type { LearnedRuleProposal } from '../../src/shared/agent-pack';
const invoke = vi.fn();
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: (...args: unknown[]) => invoke(...args), on: vi.fn() } }));
vi.mock('../../src/renderer/store/ui', () => ({ toast: vi.fn() }));
import { workflowState, decideWork, decideLesson, reloadLessons } from '../../src/renderer/store/workflows';
const row = { id: 'thread', version: 4, status: 'approval', proposal: { id: 'exact', text: 'Only staging' } } as WorkThread;
const lesson = { id: 'lesson', rule: 'Exact rule', status: 'pending' } as LearnedRuleProposal;
beforeEach(() => {
  invoke.mockReset();
  workflowState.set({ rows: [row], lessons: [lesson], error: null, lessonError: null });
});
it('sends the displayed proposal identity and preserves correction text without approval', async () => {
  invoke.mockResolvedValue({ ...row, version: 5, status: 'blocked', proposal: undefined });
  expect(await decideWork(row, false, 'Narrow the scope')).toBe(true);
  expect(invoke).toHaveBeenCalledWith('work:decide', { id: 'thread', expectedVersion: 4, proposalId: 'exact', approve: false, feedback: 'Narrow the scope' });
  expect(workflowState.get().rows[0]!.status).toBe('blocked');
});
it('a failed decision is not removed, and the projection refreshes for a newer proposal', async () => {
  invoke.mockImplementation((channel: string) => channel === 'work:decide' ? Promise.reject(new Error('stale version')) : Promise.resolve([row]));
  expect(await decideWork(row, true)).toBe(false);
  expect(workflowState.get().rows).toEqual([row]);
  expect(invoke).toHaveBeenCalledWith('work:list', undefined);
});
it('an older lesson read cannot resurrect a rejected rule after a successful free response', async () => {
  let finish!: (value: LearnedRuleProposal[]) => void;
  invoke.mockImplementation((channel: string) => channel === 'work:lessons' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve());
  const read = reloadLessons();
  expect(await decideLesson(lesson, false, 'Only for accessibility work')).toBe(true);
  expect(invoke).toHaveBeenCalledWith('work:lessonDecide', { id: 'lesson', rule: 'Exact rule', approve: false, feedback: 'Only for accessibility work' });
  finish([lesson]); await read;
  expect(workflowState.get().lessons).toEqual([]);
});

it('keeps a free-answer draft across remounts but never transfers it to a replacement proposal', async () => {
  const { decisionDraft, saveDecisionDraft } = await import('../../src/renderer/lib/decision-drafts');
  saveDecisionDraft('workflow/thread@4:exact', 'Only for staging');
  expect(decisionDraft('workflow/thread@4:exact')).toBe('Only for staging');
  expect(decisionDraft('workflow/thread@5:new')).toBe('');
  saveDecisionDraft('workflow/thread@4:exact', '');
  expect(decisionDraft('workflow/thread@4:exact')).toBe('');
});
