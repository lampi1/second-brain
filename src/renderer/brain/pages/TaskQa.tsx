// The Task page's "Test e QA" section: for each of the user's active PRs with a test plan, how many test cases are done
// and how many are missing, who ran them, the failed/blocked ones first, each test case with its outcome, who and when,
// and the QA bugs linked to it (state, link). Names and titles only, ids only inside links. Data: the brain's read-only qa-status.mjs --mine, read with the page by main's
// TaskService (zero tokens). Why: the user asked QA progress ~30 times in a week (2026-10-13: "quali abbiamo fatto,
// quali ha fatto Anna", "quanti test case mancano?", "a quale PR appartiene questo bug").
// Each test plan and test case has "Discuti" (components/RecordDiscussButton.tsx). Used by pages/Task.tsx.
import type { DevopsPrRef, QaBug, QaPlan, QaReport } from '@shared/contract';
import { fmt } from '../lib/format';
import { qaHeadline, qaOrder, qaOutcome, qaPeople } from '../lib/qa';
import { Empty } from '../components/States';
import { ExtLink, IconExternal, Pill, Section } from '../components/ui';
import { stateTone } from '../lib/tasks';
import { RecordDiscussButton } from '../components/RecordDiscussButton';
import { HelpTip } from '../../components/HelpTip';
import { t as tr } from '../../i18n';

function Bar({ t }: { t: QaReport['totals'] }) {
  if (!t.total) return null;
  const seg = (k: number, cls: string, label: string) => k > 0 && <span className={`qa-seg ${cls}`} style={{ flexGrow: k }} data-tip={`${k} ${label}`} />;
  return (
    <div className="qa-bar" role="img" aria-label={tr('brainText.taskQa.barLabel', { done: t.done, total: t.total })}>
      {seg(t.passed, 'good', tr('brainText.taskQa.seg.passed'))}{seg(t.failed, 'bad', tr('brainText.taskQa.seg.failed'))}{seg(t.blocked, 'warn', tr('brainText.taskQa.seg.blocked'))}
      {seg(t.notApplicable + t.other, 'na', tr('brainText.taskQa.seg.na'))}{seg(t.missing, 'todo', tr('brainText.qa.todo'))}
    </div>
  );
}

function BugLine({ b }: { b: QaBug }) {
  return (
    <span className="qa-bug">
      <Pill tone={b.open ? 'bad' : stateTone(b.state)}>{tr('brainText.taskQa.bug', { state: b.state })}</Pill>
      <ExtLink href={b.url}>{b.title}</ExtLink>
      {b.assignedTo && <span className="small muted">{tr('brainText.common.to', { name: b.assignedTo })}</span>}
    </span>
  );
}

function PlanView({ p, bugs, pr }: { p: QaPlan; bugs: Map<number, QaBug>; pr: DevopsPrRef | null }) {
  return (
    <details className="qa-plan" data-testid={`qa-plan-${p.id}`}>
      <summary>
        <span className="t">{tr('brainText.taskQa.testPlan')} <b>{p.name}</b></span>
        <span className="small muted">{tr('brainText.common.ofCount', { n: p.totals.done, of: p.totals.total })}</span>
        <span className="sp" />
        <RecordDiscussButton rec={{ kind: 'testplan', plan: p, pr }} />
        <ExtLink href={p.url} className="dv-open" title={tr('brainText.taskQa.openPlan')}>{tr('brainText.common.open')} <IconExternal /></ExtLink>
      </summary>
      <ul className="qa-points">
        {qaOrder(p.points).map(x => {
          const o = qaOutcome(x.outcome);
          return (
            <li key={x.id} data-testid={`qa-point-${x.id}`}>
              <Pill tone={o.tone}>{o.label}</Pill>
              <span className="qa-point-main">
                <ExtLink href={x.testCase.url} title={tr('brainText.taskQa.openCase')}>{x.testCase.title}</ExtLink>
                <span className="small muted">
                  {x.outcome ? <>{x.ranBy ?? tr('brainText.taskQa.someone')}{x.ranAt && <span title={fmt.when(x.ranAt)}> · {fmt.ago(x.ranAt)}</span>}</> : x.tester ? tr('brainText.common.assignedTo', { name: x.tester }) : tr('brainText.taskQa.unassigned')}
                </span>
                {x.bugs.map(id => bugs.get(id)).filter((b): b is QaBug => !!b).map(b => <BugLine key={b.id} b={b} />)}
              </span>
              <RecordDiscussButton rec={{ kind: 'testcase', point: x, plan: p, pr }} />
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function QaCard({ r }: { r: QaReport }) {
  const h = qaHeadline(r);
  const bugs = new Map(r.bugs.map(b => [b.id, b]));
  const loose = r.bugs.filter(b => !b.testCases.length);
  return (
    <article className={`dv-pr qa-card t-${h.tone || 'none'}`} data-testid={`qa-report-${r.pr?.id ?? r.plans[0]?.id}`}>
      <div className={`dv-wait ${h.tone}`} data-testid="qa-headline">{h.text}</div>
      {r.pr ? <h3><ExtLink href={r.pr.url} title={tr('brainText.common.openPr')}>{r.pr.title} <IconExternal /></ExtLink></h3> : <h3>{r.plans[0]?.name}</h3>}
      <Bar t={r.totals} />
      {r.totals.byPerson.length > 0 && (
        <div className="small" data-testid="qa-people"><span className="muted">{tr('brainText.taskQa.ranBy')}</span>{r.totals.byPerson.map((p, i) => <span key={p.name}>{i > 0 && ', '}<b>{p.name}</b> {p.done}</span>)}</div>
      )}
      {r.plans.map(p => <PlanView key={p.id} p={p} bugs={bugs} pr={r.pr} />)}
      {loose.length > 0 && (
        <div className="dv-pr-items">
          <span className="bx-eyebrow">{tr('brainText.taskQa.otherBugs')}</span>
          {loose.map(b => <BugLine key={b.id} b={b} />)}
        </div>
      )}
    </article>
  );
}

export function QaSection({ qa, error }: { qa: QaReport[]; error: string | null }) {
  const people = qaPeople(qa);
  const missing = qa.reduce((s, r) => s + r.totals.missing, 0);
  return (
    <Section title={tr('brainText.taskQa.title')} count={qa.length} testId="task-qa"
      help={<HelpTip label={tr('brainText.taskQa.title')} title={tr('brainText.taskQa.helpTitle')} testid="qa-help"
        example={tr('brainText.taskQa.helpExample')}>
        {tr('brainText.taskQa.helpBody')}
      </HelpTip>}
      note={qa.length ? <>{missing ? tr('brainText.taskQa.missing', { n: missing }) : tr('brainText.taskQa.allRun')}{people.length > 0 && tr('brainText.taskQa.ranByList', { list: people.map(p => `${p.name} ${p.done}`).join(', ') })}</> : tr('brainText.taskQa.noteEmpty')}>
      {error && <p className="small dv-bad" role="status" data-testid="qa-error">{error}{qa.length ? tr('brainText.taskQa.previous') : ''}</p>}
      {qa.length ? <div className="dv-prs">{qa.map(r => <QaCard key={r.pr?.id ?? r.plans[0]?.id} r={r} />)}</div>
        : !error && <Empty title={tr('brainText.taskQa.emptyTitle')}>{tr('brainText.taskQa.emptyBody')}</Empty>}
    </Section>
  );
}
