// Deterministic PR/QA observations shared by the cockpit and app_digest. Cached facts never grant merge authority.
import type { DevopsPr, TasksState } from './contract';

export interface PrObservation {
  pr: DevopsPr;
  failed: number; blocked: number; missing: number; openBugs: number;
  qaKnown: boolean;
  risks: string[];
}
export interface WorkRecap {
  readAt: number | null; qaAt: number | null;
  freshness: 'missing' | 'stale' | 'current' | 'error';
  qaFreshness: 'missing' | 'stale' | 'current' | 'error';
  prs: PrObservation[];
}
const HOUR = 3_600_000;
function freshness(at: number | null | undefined, error: unknown, now: number): WorkRecap['freshness'] {
  if (error) return 'error';
  if (!at || !Number.isFinite(at) || at > now) return 'missing';
  return now - at > HOUR ? 'stale' : 'current';
}
/** Join by project + repository + PR id: DevOps PR ids alone are not a cross-project identity. */
export function workRecap(tasks: TasksState | null, now = Date.now()): WorkRecap {
  return {
    readAt: tasks?.at ?? null, qaAt: tasks?.qaAt ?? null,
    freshness: freshness(tasks?.at, tasks?.error, now), qaFreshness: freshness(tasks?.qaAt, tasks?.qaError, now),
    prs: (tasks?.prs ?? []).map(pr => {
      const qa = tasks?.qa?.filter(q => q.pr?.id === pr.id && q.pr.repo === pr.repo && q.pr.project === pr.project) ?? [];
      const tests = new Map(pr.workItems.flatMap(w => tasks?.details[String(w.id)]?.tests ?? []).map(t => [t.id, t]));
      // A full QA report supersedes item-level summaries; combining them would double-count the same test cases.
      const failed = qa.length ? qa.reduce((n, q) => n + q.totals.failed, 0) : [...tests.values()].filter(t => t.outcome === 'Failed').length;
      const blocked = qa.length ? qa.reduce((n, q) => n + q.totals.blocked, 0) : [...tests.values()].filter(t => t.outcome === 'Blocked').length;
      const missing = qa.length ? qa.reduce((n, q) => n + q.totals.missing, 0)
        : [...tests.values()].filter(t => t.outcome === null || /^(notexecuted|notrun|unspecified)$/i.test(t.outcome)).length;
      const openBugs = qa.reduce((n, q) => n + q.totals.openBugs, 0);
      const risks = [failed ? `${failed} test falliti` : '', blocked ? `${blocked} test bloccati` : '', missing ? `${missing} test da eseguire` : '', openBugs ? `${openBugs} bug QA aperti` : '',
        pr.build && ['failed', 'canceled', 'partiallySucceeded'].includes(pr.build.result ?? '') ? `build ${pr.build.result}` : '',
        pr.reviewers.some(r => r.vote < 0) ? 'review con modifiche richieste' : '', pr.activeThreads ? `${pr.activeThreads} discussioni aperte` : ''].filter(Boolean);
      return { pr, failed, blocked, missing, openBugs, qaKnown: qa.some(q => q.totals.total > 0) || tests.size > 0, risks };
    }).sort((a, b) => Number(b.risks.length > 0) - Number(a.risks.length > 0) || a.pr.id - b.pr.id),
  };
}
