// «Quanto ritrova la memoria» (ADR 0235; owner, 2026-11-09: measure the memory before changing technology): how often the
// right fact is among the ones a role gets at launch, by words only (today's launch) and by words + meaning (the local
// e5 model), with up to three facts the words miss. Asks main itself ('memory:recallCheck', main/rules/recall-check.ts)
// when the Statistiche tab opens, and again every 5 s while main says «busy». Rendered by MemoryInsights.tsx; styles in
// styles/memory.css (mm-recall-*).
import { useCallback, useEffect, useState } from 'react';
import type { MemoryRecallCard } from '@shared/brain-model';
import { t } from '../../i18n';
import { sb } from '../../sb';
import { errText } from '../../lib/ipc-error';
import { HelpTip } from '../HelpTip';

const pct = (n: number | null, of: number) => (n === null || !of ? '—' : `${Math.round((n / of) * 100)}%`);

function Meter({ label, n, of }: { label: string; n: number | null; of: number }) {
  return <div className="mm-recall-num">
    <span className="mm-recall-label">{label}</span>
    <b>{pct(n, of)}</b>
    <span className="mm-meter"><i style={{ width: n === null || !of ? 0 : `${(n / of) * 100}%` }} /></span>
    {n !== null && <small>{t('mm.recallOf', { n, of })}</small>}
  </div>;
}

export function RecallCheckCard() {
  const [c, setC] = useState<MemoryRecallCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setC(await sb.invoke('memory:recallCheck', undefined)); setError(null); } catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const busy = c?.state === 'busy';
  useEffect(() => {
    if (!busy) return;
    const id = setTimeout(() => { void load(); }, 5000);
    return () => clearTimeout(id);
  }, [busy, c, load]);
  if (!c && !error) return null;
  const k = c?.k ?? 8;
  return <section className="bx-card mm-recall" data-testid="mm-recall" data-state={c?.state ?? 'error'}>
    <header className="mm-head">
      <h3>{t('mm.recall')} <HelpTip label={t('mm.recall')} wide>{t('mm.recallHelp', { k })}</HelpTip></h3>
      <p>{t('mm.recallLead', { k })}</p>
    </header>
    {error && <p role="alert" className="bm-empty">{error}</p>}
    {c?.state === 'few' && <p className="bm-empty" data-testid="mm-recall-few">{t('mm.recallFew', { n: c.n, min: c.minCases })}</p>}
    {c && c.state !== 'few' && <>
      <div className="mm-recall-nums">
        <Meter label={t('mm.recallWords')} n={c.words} of={c.n} />
        <Meter label={t('mm.recallHybrid')} n={c.hybrid} of={c.n} />
      </div>
      {c.state === 'busy' && <p role="status" className="mm-recall-note">{t('mm.recallBusy')}</p>}
      {c.state === 'no-model' && <p role="status" className="mm-recall-note">{t('mm.recallNoModel')}</p>}
      {c.state === 'ready' && <p className="mm-recall-note" data-testid="mm-recall-find">{t('mm.recallFind', { only: c.onlyHybrid, back: c.onlyWords })}</p>}
      {c.missed.length > 0 && <details className="mm-recall-missed">
        <summary>{t('mm.recallMissed')}</summary>
        <ul>{c.missed.map((m, i) => <li key={i}>
          <span><small>{t('mm.recallGoal')} · {m.role}</small>{m.goal}</span>
          <span><small>{t('mm.recallFact')}</small>{m.fact}</span>
        </li>)}</ul>
      </details>}
    </>}
  </section>;
}
