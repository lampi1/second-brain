// Portable companion exports preserve observed counts and unknowns without leaking private run payloads or active HTML.
import { expect, it } from 'vitest';
import { routineObservations, routineObservationsHtml } from '../../src/shared/routine-observations';
import type { RoutineWorkbenchResult } from '../../src/shared/routine-workbench';
const data: RoutineWorkbenchResult = { comparison: { flowId: 'sample', comparableSubjects: 0, caveats: ['Not a quality score'], versions: [{ version: 1, digest: 'a'.repeat(64), runs: 3, completed: 1, blocked: 1, cancelled: 0, skipped: 1, needsHuman: 0, retries: 2, observedDecisions: 1, terminalElapsedMs: null, completeEvidence: 0 }] }, evaluation: { suiteId: 'private-case-collection', suiteDigest: 'b'.repeat(64), flowVersion: 1, definitionDigest: 'a'.repeat(64), at: 1, coverage: ['Recorded results only'], cases: [{ id: 'private-case', runId: 'private-run', split: 'holdout', state: 'unknown', reasons: ['private detail'] }] } };
it('projects only aggregates and explicit identities; unknowns never turn into successes', () => {
  const result = routineObservations({ ...data, readiness: { flowId: 'sample', version: 1, digest: '', at: 1, ready: false, coverage: [], checks: [{ id: 'path', state: 'fail', detail: 'private workspace' }] } }, '2026-01-01');
  expect(result.evaluation!.splits).toContainEqual({ split: 'holdout', pass: 0, fail: 0, unknown: 1 });
  expect(result.comparison!.versions[0]!.terminalElapsedMs).toBeNull();
  expect(JSON.stringify(result)).not.toMatch(/private|workspace|runId|suiteId|reasons/);
  expect(routineObservations({}).evaluation).toBeNull();
});
it('renders hostile labels inert and ships no scripts, remote assets or app controls', () => {
  const hostile = structuredClone(data); hostile.comparison!.flowId = '</title><script>attack()</script>';
  hostile.comparison!.caveats = ['<img src="https://example.invalid" onerror="attack()">'];
  const html = routineObservationsHtml(hostile, 'fixture');
  expect(html).toContain('&lt;script&gt;'); expect(html).toContain('&lt;img');
  expect(html).not.toMatch(/<script|<img|<iframe|<form|<a\s|private-case|private-run|private detail/);
  expect(html).toContain("default-src 'none'"); expect(html).toContain('Evidence complete');
});
