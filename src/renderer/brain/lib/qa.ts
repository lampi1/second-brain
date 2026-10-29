// Pure rules of the Task page's "Test e QA" section (pages/TaskQa.tsx), from what the brain's read-only
// qa-status.mjs --mine read (zero tokens): each outcome in Italian with its tone, the points worst first (failed, blocked,
// still to do, then the rest), who ran how many across all PRs and one headline per PR. Names and titles only: ids stay inside links (the user, 2026-10-06, "se mi dici i numeri non capisco").
// Why: he asked QA progress ~30 times in a week ("quali ha fatto Anna", "quanti test case mancano?"; 2026-10-13).
// Pinned by test/unit/brain-ui/qa-view.test.ts.
import type { QaPoint, QaReport } from '@shared/contract';
import type { Tone } from '../components/ui';
import { t as tr } from '../../i18n';

/** passed / failed / blocked / notApplicable / null (not run) → Italian label and tone. */
export function qaOutcome(o: string | null): { label: string; tone: Tone } {
  switch ((o ?? '').toLowerCase()) {
    case 'passed': return { label: tr('brainText.tasks.outcome.passed'), tone: 'good' };
    case 'failed': return { label: tr('brainText.tasks.outcome.failed'), tone: 'bad' };
    case 'blocked': return { label: tr('brainText.tasks.outcome.blocked'), tone: 'warn' };
    case 'notapplicable': return { label: tr('brainText.tasks.outcome.na'), tone: 'outline' };
    case '': return { label: tr('brainText.qa.todo'), tone: 'outline' };
    default: return { label: o!, tone: 'warn' };
  }
}

const RANK: Record<string, number> = { failed: 0, blocked: 1, '': 2 };
/** Worst first: failed, blocked, still to do, then the rest; the plan's order inside each. */
export function qaOrder(points: readonly QaPoint[]): QaPoint[] {
  return points.map((p, i) => ({ p, i })).sort((a, b) => (RANK[a.p.outcome ?? ''] ?? 3) - (RANK[b.p.outcome ?? ''] ?? 3) || a.i - b.i).map(x => x.p);
}

/** Who ran how many tests over all the reports, most first. */
export function qaPeople(reports: readonly QaReport[]): { name: string; done: number }[] {
  const by = new Map<string, number>();
  for (const r of reports) for (const p of r.totals.byPerson) by.set(p.name, (by.get(p.name) ?? 0) + p.done);
  return [...by.entries()].map(([name, done]) => ({ name, done })).sort((a, b) => b.done - a.done || a.name.localeCompare(b.name));
}

/** "4 su 6 fatti · mancano 2 · 1 fallito · 1 bloccato · 1 bug aperto" and the tone of the worst part. */
export function qaHeadline(r: QaReport): { text: string; tone: Tone } {
  const t = r.totals;
  if (!t.total) return { text: tr('brainText.qa.noTests'), tone: 'outline' };
  const parts = [tr('brainText.qa.done', { done: t.done, total: t.total }), t.missing ? tr('brainText.qa.missing', { n: t.missing }) : tr('brainText.qa.allRun'),
    t.failed && tr('brainText.qa.failed', { n: t.failed }), t.blocked && tr('brainText.qa.blocked', { n: t.blocked }), t.openBugs && tr('brainText.qa.openBugs', { n: t.openBugs })].filter(Boolean);
  const tone: Tone = t.failed || t.openBugs ? 'bad' : t.blocked || t.missing ? 'warn' : 'good';
  return { text: parts.join(' · '), tone };
}
