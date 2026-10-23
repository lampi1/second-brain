// The approval surface distinguishes source provenance from effectiveness and disables unsupported lessons.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn() } }));
import type { LearnedRuleProposal } from '../../src/shared/agent-pack';
import { LessonEvidence, lessonCanApprove } from '../../src/renderer/components/LessonEvidence';
it('shows evidence and unmeasured effect, with legacy/insufficient approval refused', () => {
  const proposal: LearnedRuleProposal = { id: 'lesson', agentId: 'artisan', rule: 'Use stable IDs', evidence: 'run-1', createdAt: 1, status: 'pending' };
  expect(lessonCanApprove(proposal)).toBe(false);
  expect(renderToStaticMarkup(createElement(LessonEvidence, { proposal }))).toContain('Evidenze insufficienti');
  proposal.assessment = { state: 'supported', reason: 'One independently checked run', checkedAt: 1, proposalHash: 'hash', causal: false, sources: [{ runId: 'run-1', verdict: 'fail', basis: 'human', endedAt: 1, outcomeAt: 1, projectRoot: 'demo', fingerprint: 'source' }] };
  const html = renderToStaticMarkup(createElement(LessonEvidence, { proposal, brainRoot: '/fixture' }));
  expect(lessonCanApprove(proposal)).toBe(true); expect(html).toContain('run-1'); expect(html).toContain('fallimento'); expect(html).toContain('verdetto utente'); expect(html).toContain('non è ancora misurato');
  expect(html).toContain('data-testid="learning-evidence-run-1"');
  proposal.assessment.state = 'insufficient'; expect(lessonCanApprove(proposal)).toBe(false);
});
