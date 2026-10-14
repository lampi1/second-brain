// The DevOps page's "Test e QA" section: for each of the user's active PRs with a test plan, how many test cases are done
// and how many are missing, who ran them, the failed/blocked ones first, each test case with its outcome, who and when,
// and the QA bugs linked to it (state, link); "Copia per lo stand-up" copies the same as plain text. Names and titles
// only, ids only inside links. Data: the brain's read-only qa-status.mjs --mine, read with the page by main's
// DevopsService (zero tokens). Why: the user asked QA progress ~30 times in a week (2026-10-13: "quali abbiamo fatto,
// quali ha fatto Anna", "quanti test case mancano?", "a quale PR appartiene questo bug", a stand-up card).
// Each test plan and test case has "Apri chat" (components/RecordChatButton.tsx). Used by pages/Devops.tsx.
import type { DevopsPrRef, QaBug, QaPlan, QaReport } from '@shared/contract';
import { fmt } from '../lib/format';
import { qaHeadline, qaOrder, qaOutcome, qaPeople, qaStandup } from '../lib/qa';
import { Empty } from '../components/States';
import { copyText, ExtLink, IconCopy, IconExternal, Pill, Section, toast } from '../components/ui';
import { stateTone } from '../lib/devops';
import { RecordChatButton } from '../components/RecordChatButton';
import { HelpTip } from '../../components/HelpTip';

function Bar({ t }: { t: QaReport['totals'] }) {
  if (!t.total) return null;
  const seg = (k: number, cls: string, label: string) => k > 0 && <span className={`qa-seg ${cls}`} style={{ flexGrow: k }} data-tip={`${k} ${label}`} />;
  return (
    <div className="qa-bar" role="img" aria-label={`${t.done} su ${t.total} eseguiti`}>
      {seg(t.passed, 'good', 'passati')}{seg(t.failed, 'bad', 'falliti')}{seg(t.blocked, 'warn', 'bloccati')}
      {seg(t.notApplicable + t.other, 'na', 'non applicabili o altro')}{seg(t.missing, 'todo', 'da fare')}
    </div>
  );
}

function BugLine({ b }: { b: QaBug }) {
  return (
    <span className="qa-bug">
      <Pill tone={b.open ? 'bad' : stateTone(b.state)}>bug {b.state}</Pill>
      <ExtLink href={b.url}>{b.title}</ExtLink>
      {b.assignedTo && <span className="small muted">a {b.assignedTo}</span>}
    </span>
  );
}

function PlanView({ p, bugs, pr }: { p: QaPlan; bugs: Map<number, QaBug>; pr: DevopsPrRef | null }) {
  return (
    <details className="qa-plan" data-testid={`qa-plan-${p.id}`}>
      <summary>
        <span className="t">Test plan <b>{p.name}</b></span>
        <span className="small muted">{p.totals.done} su {p.totals.total}</span>
        <span className="sp" />
        <RecordChatButton rec={{ kind: 'testplan', plan: p, pr }} />
        <ExtLink href={p.url} className="dv-open" title="Apri il test plan in DevOps">Apri <IconExternal /></ExtLink>
      </summary>
      <ul className="qa-points">
        {qaOrder(p.points).map(x => {
          const o = qaOutcome(x.outcome);
          return (
            <li key={x.id} data-testid={`qa-point-${x.id}`}>
              <Pill tone={o.tone}>{o.label}</Pill>
              <span className="qa-point-main">
                <ExtLink href={x.testCase.url} title="Apri il test case in DevOps">{x.testCase.title}</ExtLink>
                <span className="small muted">
                  {x.outcome ? <>{x.ranBy ?? 'qualcuno'}{x.ranAt && <span title={fmt.when(x.ranAt)}> · {fmt.ago(x.ranAt)}</span>}</> : x.tester ? `assegnato a ${x.tester}` : 'non assegnato'}
                </span>
                {x.bugs.map(id => bugs.get(id)).filter((b): b is QaBug => !!b).map(b => <BugLine key={b.id} b={b} />)}
              </span>
              <RecordChatButton rec={{ kind: 'testcase', point: x, plan: p, pr }} />
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
      {r.pr ? <h3><ExtLink href={r.pr.url} title="Apri la PR in DevOps">{r.pr.title} <IconExternal /></ExtLink></h3> : <h3>{r.plans[0]?.name}</h3>}
      <Bar t={r.totals} />
      {r.totals.byPerson.length > 0 && (
        <div className="small" data-testid="qa-people"><span className="muted">Eseguiti da </span>{r.totals.byPerson.map((p, i) => <span key={p.name}>{i > 0 && ', '}<b>{p.name}</b> {p.done}</span>)}</div>
      )}
      {r.plans.map(p => <PlanView key={p.id} p={p} bugs={bugs} pr={r.pr} />)}
      {loose.length > 0 && (
        <div className="dv-pr-items">
          <span className="bx-eyebrow">Altri bug collegati</span>
          {loose.map(b => <BugLine key={b.id} b={b} />)}
        </div>
      )}
    </article>
  );
}

export function QaSection({ qa, error }: { qa: QaReport[]; error: string | null }) {
  const people = qaPeople(qa);
  const missing = qa.reduce((s, r) => s + r.totals.missing, 0);
  const copy = () => { void copyText(qaStandup(qa)).then(ok => toast(ok ? 'Stand-up copiato' : 'Copia non riuscita')); };
  return (
    <Section title="Test e QA" count={qa.length} testId="devops-qa"
      help={<HelpTip label="Test e QA" title="Come leggere la barra" testid="qa-help"
        example="7 su 10: 5 passati, 1 fallito, 1 bloccato, 3 ancora da fare.">
        Ogni PR con un test plan collegato: verde passati, rosso falliti, giallo bloccati, grigio non applicabili, vuoto da fare. Bloccato = la QA non può eseguirlo finché qualcosa non si sblocca (ambiente, dati, un altro bug).
      </HelpTip>}
      note={qa.length ? <>{missing ? `mancano ${missing} test case` : 'tutti i test eseguiti'}{people.length > 0 && ` · eseguiti da ${people.map(p => `${p.name} ${p.done}`).join(', ')}`}</> : 'i test plan delle tue PR attive'}
      actions={qa.length > 0 ? <button type="button" className="bx-btn s" onClick={copy} data-testid="qa-copy"><IconCopy /> Copia per lo stand-up</button> : undefined}>
      {error && <p className="small dv-bad" role="status" data-testid="qa-error">{error}{qa.length ? ' Qui sotto la lettura precedente.' : ''}</p>}
      {qa.length ? <div className="dv-prs">{qa.map(r => <QaCard key={r.pr?.id ?? r.plans[0]?.id} r={r} />)}</div>
        : !error && <Empty title="Nessuna PR attiva con test">Quando una tua PR ha un test plan collegato, qui vedi cosa è fatto, chi l'ha fatto e cosa manca.</Empty>}
    </Section>
  );
}
