// Replay adapter contracts with synthetic runs only: fresh sessions, full reviewer evidence and fail-closed exits.
import { describe, expect, it, vi } from 'vitest';
import type { AgentRun } from '../../../src/shared/agents';
import type { ChatSummary, NewChat } from '../../../src/shared/contract';
import { replayExecutor } from '../../../src/main/brainmodel/replay-executor';

const request = { replayId: 'replay-1', test: { id: 'case-1', family: 'one', input: 'State the supplied fact', criteria: ['States the fact'], split: 'holdout' as const } };
function setup() {
  const runs: AgentRun[] = [], requests: NewChat[] = [];
  const feedback = vi.fn(async () => undefined);
  const create = vi.fn(async (req: NewChat) => {
    requests.push(req); const runId = `r_${requests.length.toString().padStart(12, '0')}`;
    const run: AgentRun = { runId, chatId: runId, agentId: req.roleId!, version: 1, goal: req.goal!, startedBy: 'app', startedAt: 1, endedAt: 2, endReason: 'completed',
      counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: 0, tokens: null,
      ...(req.reviewOf ? { reviewOf: req.reviewOf } : {}), report: { at: 2, outcome: 'done', verified: 'yes', summary: 'Checked', ...(req.reviewOf ? { verdict: 'success' as const } : {}),
        canonical: { runId, taskId: runId, taskVersion: 1, at: 2, outcome: 'done', summary: 'Checked', output: 'Full answer distinct from preview', doneWhen: [{ criterion: 'States the fact', met: true, evidence: 'Provided source' }] } } };
    runs.push(run);
    return { id: runId, title: req.title, cwd: req.cwd, lastText: 'Preview', run } as ChatSummary;
  });
  return { runs, requests, feedback, create, execute: replayExecutor({ root: () => '/brain', runs: () => runs, roleEngine: () => 'claude', create, feedback }) };
}
describe('explicit replay executor', () => {
  it('creates a fresh measured contract and a separate Sentinel with the exact canonical output', async () => {
    const w = setup(); const runId = await w.execute(request);
    expect(w.requests).toHaveLength(2);
    expect(w.requests[0]).toMatchObject({ roleId: 'scout', deliveryPolicy: 'display', doneWhen: request.test.criteria });
    expect(w.requests[1]).toMatchObject({ roleId: 'sentinel', reviewOf: runId, deliveryPolicy: 'display' });
    expect(w.requests[1]!.prompt).toContain('Full answer distinct from preview');
    expect(w.feedback).toHaveBeenCalledWith(expect.objectContaining({ runId, evidence: [expect.objectContaining({ ref: w.runs[1]!.runId })] }));
  });
  it('keeps trial text unactivated and uses the verified source role without granting permissions', async () => {
    const w = setup(); await w.execute({ ...request, candidate: { name: 'candidate', text: 'Trial steps', digest: 'digest', roleId: 'artisan' } });
    expect(w.requests[0]).toMatchObject({ roleId: 'artisan' });
    expect(w.requests[0]!.prompt).toContain('not an active or verified skill');
    expect(w.requests[0]!.permissionMode).toBeUndefined();
    expect(w.requests[0]!.skills).toBeUndefined();
  });
  it('does not launch a reviewer after a failed run', async () => {
    const w = setup(), original = w.create.getMockImplementation()!;
    w.create.mockImplementation(async req => { const chat = await original(req); w.runs[0]!.endReason = 'closed'; return chat; });
    await expect(w.execute(request)).rejects.toThrow('stopped');
    expect(w.create).toHaveBeenCalledTimes(1); expect(w.feedback).not.toHaveBeenCalled();
  });
  it('gives the independent reviewer source constraints beyond the short run goal', async () => {
    const w = setup(); const input = `${'Context '.repeat(300)}The authoritative release date is unknown.`;
    await w.execute({ ...request, test: { ...request.test, input } });
    expect(w.requests[0]!.goal).toHaveLength(2000);
    expect(w.requests[1]!.prompt).toContain(input);
  });
});
