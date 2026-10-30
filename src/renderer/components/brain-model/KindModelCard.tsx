// The Classificatori card of the kind of work by examples (ADR 0197): what it decides, its examples, its agreement with
// the word rule on the 20% held out (k/n), the «altro» threshold, the confusion matrix (rows = the word rule, columns =
// the classifier, the diagonal highlighted), what it proposes where the words say «altro», and «Come funziona» with the
// limit said plainly (the labels are the word rule's). State lines when it cannot answer: no local model, too few
// examples, still embedding. Data: ClassifiersState.kindModel (main/brainmodel/kind-model.ts). Rendered by
// ClassifiersSection.tsx; styles in styles/classifiers.css (.cls-km-*).
import type { KindModelCard as Card } from '@shared/brain-model';
import type { TaskKind } from '@shared/contract';
import { t } from '../../i18n';
import { getKindIt } from '../../lib/work-kinds';
import { Num, intFmt, pctFmt } from './ClassifierParts';

const kindName = (k: string): string => getKindIt()[k as TaskKind] ?? k;

export function KindModelCard({ c }: { c: Card }) {
  const accuracy = c.test && c.test.n ? c.test.agree / c.test.n : null;
  return <article className="catalog-card cls-card cls-km" data-id="kindmodel" data-state={c.state} data-testid="cls-card-kindmodel">
    <header className="cls-card-head">
      <span className="cls-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="8" r="2.5" /><circle cx="17" cy="7" r="2.5" /><circle cx="12" cy="17" r="2.5" /><path d="M9 9.5l2 5M15 9l-2 5.5" /></svg></span>
      <div className="cls-card-id"><h3>{t('stats.km.name')}</h3></div>
      <span className="bm-badge" data-tone="violet">{t('stats.km.badge')}</span>
    </header>
    <p className="cls-decides">{t('stats.km.decides')}</p>
    <div className="cls-nums">
      <Num label={t('stats.km.examples')} value={c.examples ? intFmt(c.examples) : null} help={t('stats.km.examplesHelp')} testId="cls-km-examples" />
      <Num label={t('stats.km.agree')} value={accuracy === null ? null : pctFmt(accuracy)} sub={c.test ? `${c.test.agree}/${c.test.n}` : undefined} help={t('stats.km.agreeHelp')} testId="cls-km-agree" />
      <Num label={t('stats.km.threshold')} value={c.threshold === null ? null : c.threshold.toFixed(2)} help={t('stats.km.thresholdHelp')} />
    </div>
    {c.state === 'no-model' && <p className="cls-empty" role="status">{t('stats.km.noModel')}</p>}
    {c.state === 'few' && <p className="cls-empty" role="status">{t('stats.km.few', { min: c.minPerKind })}</p>}
    {c.state === 'busy' && <p className="cls-empty" role="status">{t('stats.km.busy')}</p>}
    {c.state === 'ready' && c.kinds.length > 0 && <p className="cls-km-note">{t('stats.km.kinds', { kinds: c.kinds.map(kindName).join(', '), min: c.minPerKind })}</p>}
    {c.test && c.test.n > 0 && <figure className="cls-km-matrix" data-testid="cls-km-matrix">
      <figcaption><span className="cls-cap">{t('stats.km.matrix')}</span><small>{t('stats.km.matrixRows')}</small></figcaption>
      <div className="cls-km-scroll"><table>
        <thead><tr><th scope="col" aria-label={t('stats.km.matrixRows')} />{c.test.labels.map(l => <th key={l} scope="col" title={kindName(l)}>{kindName(l)}</th>)}</tr></thead>
        <tbody>{c.test.matrix.map((row, i) => <tr key={c.test!.labels[i]}>
          <th scope="row">{kindName(c.test!.labels[i]!)}</th>
          {row.map((n, j) => <td key={j} data-diag={i === j || undefined} data-zero={n === 0 || undefined}>{n}</td>)}
        </tr>)}</tbody>
      </table></div>
    </figure>}
    {c.altroProposed && c.altroProposed.of > 0 && <p className="cls-km-note">{t('stats.km.altro', c.altroProposed)}</p>}
    {c.perKind.length > 0 && <details className="cls-km-more"><summary>{t('stats.km.perKind')}</summary>
      <ul>{c.perKind.map(k => <li key={k.kind}><span>{kindName(k.kind)}</span><b>{k.n}</b></li>)}</ul></details>}
    <details className="cls-km-more"><summary>{t('stats.km.how')}</summary>
      <ul>{(['how1', 'how2', 'how3', 'how4'] as const).map(k => <li key={k}><span>{t(`stats.km.${k}`)}</span></li>)}</ul></details>
  </article>;
}
