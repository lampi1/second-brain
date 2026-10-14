// Miglioramento: what the brain's shared self-improvement loop has learned (ADR 0030). One card per policy (time and
// cost estimates, model choice, notification thresholds): the version in force and since when, its typical error now
// with the last ones as bars, how often the 80% range held, results out of the count, a proposal waiting with
// [Applica] / [No], the after-check of the last change and [Ripristina v<N-1>]. Nothing changes without a click here
// (or a policy whitelisted in the brain). Reads /api/improve (the brain's improve.mjs status, through the proxy); a
// click goes to main ('learn:act'), which runs the brain's own improve.mjs. Words and numbers: lib/learn.ts. A short
// intro and a "?" beside every term that is not obvious (HELP), shown on hover or focus.
import { useState } from 'react';
import { useBrain } from '../api';
import { fmt } from '../lib/format';
import { HELP, WAITING, checkLine, coverageLine, errorLine, factor, gainLine, normLearn, policyLabel, type LearnPolicy } from '../lib/learn';
import { Async, Empty, PageHead } from '../components/States';
import { Sparkline } from '../components/Charts';
import { Pill, toast, type Navigate } from '../components/ui';
import type { LearnAction } from '@shared/contract';

/** A "?" with its explanation, on hover or keyboard focus (to be replaced by the shared tooltip of feat/spiegazioni). */
function Help({ text, id }: { text: string; id: string }) {
  return (
    <span className="bx-help">
      <button type="button" className="bx-help-q" aria-label="Cosa vuol dire?" aria-describedby={id} data-testid={`bx-help-${id}`}>?</button>
      <span role="tooltip" id={id} className="bx-help-tip">{text}</span>
    </span>
  );
}

function Policy({ p, busy, act }: { p: LearnPolicy; busy: boolean; act: (a: LearnAction) => void }) {
  const check = checkLine(p.lastCheck) ?? (p.previous != null ? WAITING : null), cover = coverageLine(p.coverage);
  return (
    <section className="bx-card bx-learn" data-testid={`bx-learn-${p.domain}`} aria-labelledby={`bx-learn-${p.domain}-h`}>
      <div className="bx-row">
        <h2 id={`bx-learn-${p.domain}-h`} className="bx-eyebrow">{policyLabel(p.domain)}</h2>
        {p.version != null && <Pill>v{p.version}</Pill>}
        {p.noData && <><Pill tone="warn">senza dati</Pill><Help id={`h-nodata-${p.domain}`} text={HELP.noData} /></>}
        {p.driftChanged && <><Pill tone="warn">dati cambiati: ricalibrare?</Pill><Help id={`h-drift-${p.domain}`} text={HELP.drift} /></>}
      </div>
      <p className="bx-learn-meta">
        {p.version == null ? 'Nessuna versione ancora' : <>{p.name ? <>«{p.name}» · </> : null}in vigore dal {fmt.when(p.appliedAt)}{p.by ? `, da ${p.by}` : ''}</>}
      </p>
      {p.noData || p.typical == null
        ? <p data-testid="bx-learn-error">{errorLine(p)}</p>
        : <>
          <p className="bx-q-v" data-testid="bx-learn-error"><span className="bx-big">{factor(p.typical)}</span><span className="u"> errore tipico sulle ultime {p.spark.length}</span><Help id={`h-typical-${p.domain}`} text={HELP.typical} /></p>
          {p.spark.length > 1 && <Sparkline values={p.spark} label={`Errore delle ultime ${p.spark.length}, una barra per caso: più alta = più lontana dal reale`} highlightLast={false} />}
        </>}
      {cover && <p data-testid="bx-learn-cover">{cover[0]!.toUpperCase() + cover.slice(1)}. <Help id={`h-cover-${p.domain}`} text={HELP.cover} /></p>}
      {(p.unknown > 0 || p.noPrediction > 0) && (
        <p className="bx-learn-out" data-testid="bx-learn-out">
          Fuori dal conto: {[p.unknown ? `${p.unknown} con esito sconosciuto` : '', p.noPrediction ? `${p.noPrediction} senza stima (troppo poca storia prima)` : ''].filter(Boolean).join(', ')}. <Help id={`h-out-${p.domain}`} text={HELP.out} />
        </p>
      )}
      {p.pending && (
        <div className="bx-learn-prop" data-testid="bx-learn-proposal">
          <p><b>{p.pending.kind === 'ripristino' ? 'Ripristino proposto' : 'Proposta'}:</b> {p.pending.name || p.pending.id} · {gainLine(p.pending)}. <Help id={`h-prop-${p.domain}`} text={HELP.proposal} /></p>
          <div className="bx-row">
            <button type="button" className="bx-btn primary" disabled={busy} data-testid="bx-learn-apply" onClick={() => act({ action: 'apply', id: p.pending!.id })}>Applica</button>
            <button type="button" className="bx-btn" disabled={busy} data-testid="bx-learn-reject" onClick={() => act({ action: 'reject', id: p.pending!.id })}>No</button>
          </div>
        </div>
      )}
      {check && <p data-testid="bx-learn-check"><b>Verifica dopo l'ultimo cambio:</b> {check}. <Help id={`h-check-${p.domain}`} text={HELP.check} /></p>}
      {p.previous != null && (
        <div className="bx-row">
          <button type="button" className="bx-btn s" disabled={busy} data-testid="bx-learn-rollback" onClick={() => act({ action: 'rollback', domain: p.domain })}>Ripristina v{p.previous}</button>
          <Help id={`h-rollback-${p.domain}`} text={HELP.rollback} />
        </div>
      )}
    </section>
  );
}

export function Miglioramento(_: { nav: Navigate }) {
  const d = useBrain('/api/improve', normLearn);
  const [busy, setBusy] = useState(false);
  const list = d.data ?? [];
  const pending = list.filter(p => p.pending).length;
  const act = (a: LearnAction) => {
    setBusy(true);
    window.sb.invoke('learn:act', a).then(r => { toast(r.ok ? r.message : r.error); }, (e: unknown) => { toast(`non fatto: ${String(e)}`); })
      .finally(() => { setBusy(false); d.reload(true); });
  };
  return (
    <>
      <PageHead title="Miglioramento" at={d.at} refreshing={d.refreshing} onRefresh={() => d.reload(true)}
        lead={list.length ? <>{list.length} {list.length === 1 ? 'politica' : 'politiche'} che imparano dai risultati; {pending ? <b>{pending} {pending === 1 ? 'proposta' : 'proposte'} da decidere</b> : 'nessuna proposta da decidere'}.</> : undefined}
        what={HELP.intro} />
      <Async loading={d.loading && !d.data} error={d.data ? null : d.error} onRetry={() => d.reload(true)} lines={5} block>
        {() => !list.length
          ? <Empty title="Nessuna politica">Il cervello non ha ancora il ciclo di miglioramento (ops/improve).</Empty>
          : <div className="bx-learn-list">{list.map(p => <Policy key={p.domain} p={p} busy={busy} act={act} />)}</div>}
      </Async>
    </>
  );
}
