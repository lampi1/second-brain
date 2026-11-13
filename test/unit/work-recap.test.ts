// Routine recap invariants: independent freshness, QA identity, no double-counting and no fabricated success.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DevopsPr, QaReport, TasksState } from '../../src/shared/contract';
import { workRecap } from '../../src/shared/work-recap';
import { WorkRecap } from '../../src/renderer/components/WorkRecap';
const NOW = 10_000_000;
const pr = { id: 7, title: '<script>bad</script>', project: 'demo', repo: 'store', target: 'main', autoComplete: true, reviewers: [], workItems: [{ id: 42 }], build: null } as unknown as DevopsPr;
const report = (project = 'demo'): QaReport => ({ pr: { ...pr, project }, totals: { total: 3, failed: 1, blocked: 1, missing: 1, openBugs: 2 } }) as unknown as QaReport;
const task = (patch: Partial<TasksState> = {}): TasksState => ({ at: NOW, prs: [pr], qa: [], details: {}, qaAt: null, ...patch }) as TasksState;
describe('deterministic PR/QA recap', () => {
  it('does not borrow a PR refresh timestamp for stale QA or infer success from absent reports', () => {
    const result = workRecap(task({ qaAt: NOW - 3_600_001 }), NOW);
    expect(result.freshness).toBe('current'); expect(result.qaFreshness).toBe('stale');
    expect(result.prs[0]!.qaKnown).toBe(false);
    expect(workRecap(null, NOW).freshness).toBe('missing');
    expect(workRecap(task({ at: NOW + 1 }), NOW).freshness).toBe('missing');
  });
  it('keeps failed refreshes visible even with last known successful data', () => {
    const result = workRecap(task({ error: { kind: 'failed', message: 'unavailable' }, qaError: 'failed', qaAt: NOW }), NOW);
    expect(result.readAt).toBe(NOW); expect(result.freshness).toBe('error'); expect(result.qaFreshness).toBe('error');
  });
  it('uses full QA once, matches the entire PR identity and includes outstanding tests/bugs', () => {
    const tasks = task({ qa: [report()], details: { 42: { tests: [{ id: 1, outcome: 'Failed' }] } } as unknown as TasksState['details'] });
    const row = workRecap(tasks, NOW).prs[0]!;
    expect(row.failed).toBe(1); expect(row.blocked).toBe(1); expect(row.missing).toBe(1); expect(row.openBugs).toBe(2);
    expect(row.risks).toContain('2 bug QA aperti');
    expect(workRecap(task({ qa: [report('another-project')] }), NOW).prs[0]!.failed).toBe(0);
  });
  it('deduplicates linked test cases, and sorts observed risks before unknown QA', () => {
    const tasks = task({ prs: [{ ...pr, id: 1, workItems: [] }, { ...pr, workItems: [{ id: 42 }, { id: 43 }] as DevopsPr['workItems'] }], details: Object.fromEntries([42, 43].map(id => [id, { tests: [{ id: 1, outcome: 'Failed' }] }])) as TasksState['details'] });
    const rows = workRecap(tasks, NOW).prs;
    expect(rows[0]!.pr.id).toBe(7); expect(rows[0]!.failed).toBe(1);
  });
  it('flags never-run linked tests even without a full QA report', () => {
    const row = workRecap(task({ details: { 42: { tests: [{ id: 1, outcome: null }] } } as unknown as TasksState['details'] }), NOW).prs[0]!;
    expect(row.qaKnown).toBe(true); expect(row.missing).toBe(1); expect(row.risks).toContain('1 test da eseguire');
  });
  it('renders unknown checks, separate timestamps and refresh without a model action', () => {
    const html = renderToStaticMarkup(createElement(WorkRecap, { tasks: task(), refresh: () => {}, now: NOW }));
    expect(html).toContain('riepilogo senza modello'); expect(html).toContain('Aggiorna PR e QA');
    expect(html).toContain('QA non disponibili'); expect(html).toContain('QA: mai letti');
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;'); expect(html).not.toContain('<script>');
  });
  it('exposes failed QA reads in the collapsed summary', () => {
    const html = renderToStaticMarkup(createElement(WorkRecap, { tasks: task({ qaError: 'offline' }), refresh: () => {}, now: NOW }));
    expect(html.match(/<summary>(.*?)<\/summary>/)?.[1]).toContain('QA: aggiornamento fallito');
  });
});
