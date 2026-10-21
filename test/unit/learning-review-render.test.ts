// Render the real memory/candidate review UI: unknown evidence, historical immutability and promotion gates.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn() } }));
import type { EvaluationMeasure, MemoryReviewRecord, ReplayComparison, SkillCandidateView } from '../../src/shared/learning-review';
import { MemoryReviewCard } from '../../src/renderer/components/brain-model/MemoryReview';
import { CandidateReview, candidateCanPromote, ComparisonTable, promotionProblemText } from '../../src/renderer/components/brain-model/LearningReview';
import { EvidenceRun } from '../../src/renderer/components/brain-model/LearningEvidence';
import { setLang } from '../../src/renderer/i18n';
const record: MemoryReviewRecord = { memoryId: 'm1', scope: { roleId: 'scout', project: 'demo' }, subject: '<script>Fact</script>', predicate: 'uses', value: 'sandbox', sourceEventId: 'event-1', sourceRunId: 'run-1', observedAt: '2026-01-01T10:00:00Z', validFrom: '2026-01-01T10:00:00Z', validTo: null, status: 'proposed', supersedes: null };
const candidate: SkillCandidateView = { name: 'review-notes', text: '## Steps\n1. Inspect sources\n2. Summarize evidence', digest: 'v1', stepsReady: true, sourceRunIds: ['source-run'], verifiedExampleRunIds: ['verified-run'], eligibleReplayIds: ['replay-1'], promotionProblems: [], promoted: false };
const refresh = async () => {};
afterEach(() => setLang('it'));
describe('memory and learning review', () => {
  it('shows provenance, escapes facts and hides every mutation on historical snapshots', () => {
    const html = renderToStaticMarkup(createElement(MemoryReviewCard, { root: '/fixture', record, historical: true, onRefresh: refresh }));
    expect(html).toContain('event-1'); expect(html).toContain('run-1'); expect(html).toContain('2026-01-01');
    expect(html).toContain('&lt;script&gt;Fact&lt;/script&gt;');
    expect(html).not.toContain('<button'); expect(html).not.toContain('<input');
    const current = renderToStaticMarkup(createElement(MemoryReviewCard, { root: '/fixture', record, historical: false, onRefresh: refresh }));
    expect(current).toContain('Conferma il fatto'); expect(current).toContain('Rifiuta proposta');
    expect(current.match(/disabled=""/g)).toHaveLength(2); // evidence is required for both decisions
  });
  it('requires all backend gates, verified examples and passed replay, then still waits for explicit inspection', () => {
    expect(candidateCanPromote(candidate)).toBe(true);
    for (const patch of [{ stepsReady: false }, { promoted: true }, { promotionProblems: ['Synthetic replay'] }, { verifiedExampleRunIds: [] }, { eligibleReplayIds: [] }]) expect(candidateCanPromote({ ...candidate, ...patch })).toBe(false);
    const html = renderToStaticMarkup(createElement(CandidateReview, { root: '/fixture', candidate, refresh }));
    expect(html).toContain('maxLength="24000"'); expect(html).toContain('Apri il risultato completo');
    expect(html).toContain('source-run'); expect(html).toContain('verified-run'); expect(html).toContain('replay-1');
    expect(html).toMatch(/disabled=""[^>]*>Promuovi questa versione/);
  });
  it('shows actual deliverables and review criteria, but identifies a legacy summary as incomplete', () => {
    const run = { runId: 'r1', agentId: 'scout', goal: 'Check evidence', startedAt: 1, report: { at: 1, outcome: 'done' as const, verified: 'yes' as const, summary: 'Legacy summary' } };
    const legacy = renderToStaticMarkup(createElement(EvidenceRun, { run }));
    expect(legacy).toContain('Risultato completo non conservato');
    expect(legacy).not.toContain('Consegna completa');
    const full = renderToStaticMarkup(createElement(EvidenceRun, { run: { ...run, report: { ...run.report, canonical: { at: 1, taskId: 't1', runId: 'r1', taskVersion: 1, outcome: 'done', summary: 'Summary', output: '<script>actual evidence</script>', doneWhen: [{ criterion: 'Checked source', met: true }] } } } }));
    expect(full).toContain('Consegna completa'); expect(full).toContain('Checked source');
    expect(full).toContain('&lt;script&gt;actual evidence&lt;/script&gt;');
  });
  it('localizes every promotion reason and guards unknown backend strings', () => {
    expect(promotionProblemText('missing-provenance')).toContain('Origine');
    expect(promotionProblemText('missing-holdout-replay')).toContain('verifica separata');
    expect(promotionProblemText('untranslated backend reason')).not.toContain('untranslated');
    setLang('en'); expect(promotionProblemText('missing-provenance')).toContain('provenance');
  });
  it('preserves unknown measurements and denominators instead of claiming zero cost or savings', () => {
    const unknown: EvaluationMeasure = { value: null, n: 0, total: 3 };
    const summary = { tasks: 3, quality: unknown, turns: unknown, costUsd: unknown, elapsedMs: unknown, tokens: { input: unknown, output: unknown, cacheRead: unknown, cacheWrite: unknown } };
    const comparison: ReplayComparison = { before: summary, after: summary, pairedCases: 3, comparable: true, note: 'Historical data' };
    setLang('en');
    const html = renderToStaticMarkup(createElement(ComparisonTable, { comparison }));
    expect(html).toContain('Not measured (0/3)'); expect(html).toContain('no causal or savings claims');
    expect(html).not.toContain('>0 (');
    expect(renderToStaticMarkup(createElement(ComparisonTable, { comparison: { ...comparison, comparable: false } }))).not.toContain('<table');
  });
});
