// Regole imparate, the section of the Regole page with what the brain's shared self-improvement loop has learned
// (ADR 0030; a page of its own until ADR 0082 folded it into Regole, old links open Regole). One card per policy (time and
// cost estimates, model choice, notification thresholds): the version in force and since when, its typical error now
// with the last ones as bars, how often the 80% range held, results out of the count, a proposal waiting with
// [Applica] / [No], the after-check of the last change and [Ripristina v<N-1>]. Nothing changes without a click here
// (or a policy whitelisted in the brain). Reads /api/improve (the brain's improve.mjs status, through the proxy; a
// brain without that CLI gets main's "loop missing" answer and the section stays hidden, as it does with no policy yet); a
// click goes to main ('learn:act'), which runs the brain's own improve.mjs. Words and numbers: lib/learn.ts. A short
// intro and a "?" beside every term that is not obvious (HELP), shown on hover or focus. The brain's own cost/time
// estimates policy is not shown (HIDDEN): ADR 0053 retired that estimator from the UI, ADR 0101 hid its last card; the
// task estimate (ADR 0087) is the only estimate the app shows.
import { useState } from 'react';
import { useBrain } from '../api';
import { fmt } from '../lib/format';
import { HELP, WAITING, checkLine, coverageLine, errorLine, factor, gainLine, normLearnData, policyLabel, type LearnPolicy } from '../lib/learn';
import { Sparkline } from '../components/Charts';
import { Pill, toast } from '../components/ui';
import type { LearnAction } from '@shared/contract';
import { t } from '../../i18n';

/** A "?" with its explanation, on hover or keyboard focus (to be replaced by the shared tooltip of feat/spiegazioni). */
function Help({ text, id }: { text: string; id: string }) {
  return (
    <span className="bx-help">
      <button type="button" className="bx-help-q" aria-label={t('brainPages.miglioramento.helpQuestion')} aria-describedby={id} data-testid={`bx-help-${id}`}>?</button>
      <span role="tooltip" id={id} className="bx-help-tip">{text}</span>
    </span>
  );
}

function Policy({ p, busy, act }: { p: LearnPolicy; busy: boolean; act: (a: LearnAction) => void }) {
  const check = checkLine(p.lastCheck) ?? (p.previous != null ? WAITING() : null), cover = coverageLine(p.coverage);
  return (
    <section className="bx-card bx-learn" data-testid={`bx-learn-${p.domain}`} aria-labelledby={`bx-learn-${p.domain}-h`}>
      <div className="bx-row">
        <h2 id={`bx-learn-${p.domain}-h`} className="bx-eyebrow">{policyLabel(p.domain)}</h2>
        {p.version != null && <Pill>v{p.version}</Pill>}
        {p.noData && <><Pill tone="warn">{t('brainPages.miglioramento.noData')}</Pill><Help id={`h-nodata-${p.domain}`} text={HELP().noData} /></>}
        {p.driftChanged && <><Pill tone="warn">{t('brainPages.miglioramento.driftWarning')}</Pill><Help id={`h-drift-${p.domain}`} text={HELP().drift} /></>}
      </div>
      <p className="bx-learn-meta">
        {p.version == null ? t('brainPages.miglioramento.noVersion') : <>{p.name ? <>{t('brainPages.miglioramento.nameQuote', { name: p.name })}</> : null}{t('brainPages.miglioramento.appliedAt', { when: fmt.when(p.appliedAt), by: p.by ?? undefined })}</>}
      </p>
      {p.noData || p.typical == null
        ? <p data-testid="bx-learn-error">{errorLine(p)}</p>
        : <>
          <p className="bx-q-v" data-testid="bx-learn-error"><span className="bx-big">{factor(p.typical)}</span><span className="u">{t('brainPages.miglioramento.typicalSuffix', { n: p.spark.length })}</span><Help id={`h-typical-${p.domain}`} text={HELP().typical} /></p>
          {p.spark.length > 1 && <Sparkline values={p.spark} label={t('brainPages.miglioramento.sparklineLabel', { n: p.spark.length })} highlightLast={false} />}
        </>}
      {cover && <p data-testid="bx-learn-cover">{cover[0]!.toUpperCase() + cover.slice(1)}. <Help id={`h-cover-${p.domain}`} text={HELP().cover} /></p>}
      {(p.unknown > 0 || p.noPrediction > 0) && (
        <p className="bx-learn-out" data-testid="bx-learn-out">
          {t('brainPages.miglioramento.outsidePrefix')}{[p.unknown ? t('brainPages.miglioramento.outsideUnknown', { n: p.unknown }) : '', p.noPrediction ? t('brainPages.miglioramento.outsideNoPrediction', { n: p.noPrediction }) : ''].filter(Boolean).join(', ')}. <Help id={`h-out-${p.domain}`} text={HELP().out} />
        </p>
      )}
      {p.pending && (
        <div className="bx-learn-prop" data-testid="bx-learn-proposal">
          <p><b>{p.pending.kind === 'ripristino' ? t('brainPages.miglioramento.proposalRestore') : t('brainPages.miglioramento.proposal')}:</b> {p.pending.name || p.pending.id} · {gainLine(p.pending)}. <Help id={`h-prop-${p.domain}`} text={HELP().proposal} /></p>
          <div className="bx-row">
            <button type="button" className="bx-btn primary" disabled={busy} data-testid="bx-learn-apply" onClick={() => act({ action: 'apply', id: p.pending!.id })}>{t('brainPages.miglioramento.applyBtn')}</button>
            <button type="button" className="bx-btn" disabled={busy} data-testid="bx-learn-reject" onClick={() => act({ action: 'reject', id: p.pending!.id })}>{t('brainPages.miglioramento.rejectBtn')}</button>
          </div>
        </div>
      )}
      {check && <p data-testid="bx-learn-check"><b>{t('brainPages.miglioramento.checkTitle')}:</b> {check}. <Help id={`h-check-${p.domain}`} text={HELP().check} /></p>}
      {p.previous != null && (
        <div className="bx-row">
          <button type="button" className="bx-btn s" disabled={busy} data-testid="bx-learn-rollback" onClick={() => act({ action: 'rollback', domain: p.domain })}>{t('brainPages.miglioramento.restoreBtn', { v: p.previous })}</button>
          <Help id={`h-rollback-${p.domain}`} text={HELP().rollback} />
        </div>
      )}
    </section>
  );
}

/** policies the section never shows: the brain's retired estimator (ADR 0053, 0101) */
export const HIDDEN_POLICIES: readonly string[] = ['estimates'];

/** The learned rules section of the Regole page (components/brain-model/RulesPage.tsx). Hidden while the brain has no
 *  loop or no policy yet: a fresh brain shows no machinery (the owner's clean-install rule). */
export function LearnedRules() {
  const d = useBrain('/api/improve', normLearnData);
  const [busy, setBusy] = useState(false);
  const list = (d.data?.policies ?? []).filter(p => !HIDDEN_POLICIES.includes(p.domain));
  const missing = d.data?.loop === 'missing';
  const pending = list.filter(p => p.pending).length;
  const act = (a: LearnAction) => {
    setBusy(true);
    window.sb.invoke('learn:act', a).then(r => { toast(r.ok ? r.message : r.error); }, (e: unknown) => { toast(t('brainPages.miglioramento.actionFailed', { error: String(e) })); })
      .finally(() => { setBusy(false); d.reload(true); });
  };
  if (missing || !list.length) return null;
  return (
    <section className="bx-learned" data-testid="page-miglioramento" aria-labelledby="bx-learned-h">
      <header className="bx-learned-head">
        <h2 id="bx-learned-h">{t('brainPages.miglioramento.pageTitle')}</h2>
        <p className="bx-lead" data-testid="bx-learned-lead">{t('brainPages.miglioramento.lead', { count: list.length })}{pending ? <b>{t('brainPages.miglioramento.leadPending', { pending })}</b> : t('brainPages.miglioramento.leadNoPending')}.</p>
        <p className="bx-what">{HELP().intro}</p>
      </header>
      <div className="bx-learn-list">{list.map(p => <Policy key={p.domain} p={p} busy={busy} act={act} />)}</div>
    </section>
  );
}
