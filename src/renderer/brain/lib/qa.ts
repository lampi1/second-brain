// Pure rules of the DevOps page's "Test e QA" section (pages/DevopsQa.tsx), from what the brain's read-only
// qa-status.mjs --mine read (zero tokens): each outcome in Italian with its tone, the points in stand-up order (failed,
// blocked, still to do, then the rest), who ran how many across all PRs, one headline per PR and the stand-up text to
// copy. Names and titles only: ids stay inside links (the user, 2026-10-06, "se mi dici i numeri non capisco").
// Why: he asked QA progress ~30 times in a week ("quali ha fatto Anna", "quanti test case mancano?"; 2026-10-13).
// Pinned by test/unit/brain-ui/qa-view.test.ts.
import type { QaPoint, QaReport } from '@shared/contract';
import type { Tone } from '../components/ui';

/** passed / failed / blocked / notApplicable / null (not run) → Italian label and tone. */
export function qaOutcome(o: string | null): { label: string; tone: Tone } {
  switch ((o ?? '').toLowerCase()) {
    case 'passed': return { label: 'passato', tone: 'good' };
    case 'failed': return { label: 'fallito', tone: 'bad' };
    case 'blocked': return { label: 'bloccato', tone: 'warn' };
    case 'notapplicable': return { label: 'non applicabile', tone: 'outline' };
    case '': return { label: 'da fare', tone: 'outline' };
    default: return { label: o!, tone: 'warn' };
  }
}

const RANK: Record<string, number> = { failed: 0, blocked: 1, '': 2 };
/** Stand-up order: failed, blocked, still to do, then the rest; the plan's order inside each. */
export function qaOrder(points: readonly QaPoint[]): QaPoint[] {
  return points.map((p, i) => ({ p, i })).sort((a, b) => (RANK[a.p.outcome ?? ''] ?? 3) - (RANK[b.p.outcome ?? ''] ?? 3) || a.i - b.i).map(x => x.p);
}

/** Who ran how many tests over all the reports, most first. */
export function qaPeople(reports: readonly QaReport[]): { name: string; done: number }[] {
  const by = new Map<string, number>();
  for (const r of reports) for (const p of r.totals.byPerson) by.set(p.name, (by.get(p.name) ?? 0) + p.done);
  return [...by.entries()].map(([name, done]) => ({ name, done })).sort((a, b) => b.done - a.done || a.name.localeCompare(b.name));
}

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/** "4 su 6 fatti · mancano 2 · 1 fallito · 1 bloccato · 1 bug aperto" and the tone of the worst part. */
export function qaHeadline(r: QaReport): { text: string; tone: Tone } {
  const t = r.totals;
  if (!t.total) return { text: 'nessun test case', tone: 'outline' };
  const parts = [`${t.done} su ${t.total} fatti`, t.missing ? `mancano ${t.missing}` : 'tutti eseguiti',
    t.failed && n(t.failed, 'fallito', 'falliti'), t.blocked && n(t.blocked, 'bloccato', 'bloccati'), t.openBugs && n(t.openBugs, 'bug aperto', 'bug aperti')].filter(Boolean);
  const tone: Tone = t.failed || t.openBugs ? 'bad' : t.blocked || t.missing ? 'warn' : 'good';
  return { text: parts.join(' · '), tone };
}

/** The stand-up card as plain text: one block per PR, titles and names, no ids. */
export function qaStandup(reports: readonly QaReport[]): string {
  if (!reports.length) return 'Test e QA: nessuna PR attiva con test.';
  return reports.map(r => {
    const t = r.totals;
    const who = t.byPerson.length ? ` (${t.byPerson.map(p => `${p.name} ${p.done}`).join(', ')})` : '';
    const lines = [`PR «${r.pr?.title ?? r.plans[0]?.name ?? ''}»: ${qaHeadline(r).text}${who}`];
    const points = r.plans.flatMap(p => p.points);
    for (const p of points.filter(x => x.outcome === 'failed' || x.outcome === 'blocked'))
      lines.push(`- ${qaOutcome(p.outcome).label}: ${p.testCase.title}${p.ranBy ? ` (${p.ranBy})` : ''}`);
    const todo = points.filter(x => !x.outcome);
    if (todo.length) lines.push(`- da fare: ${todo.map(p => p.testCase.title).join('; ')}`);
    for (const b of r.bugs.filter(x => x.open)) lines.push(`- bug aperto: ${b.title} (${b.state}${b.assignedTo ? `, ${b.assignedTo}` : ''})`);
    return lines.join('\n');
  }).join('\n\n');
}
