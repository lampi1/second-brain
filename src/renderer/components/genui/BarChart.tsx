// Responsive signed bars for the trusted catalog. Normalizing before subtraction avoids finite-number overflow.
// Visible text and an accessible table preserve labels, exact values and notes on narrow screens and screen readers.
import type { UiBarChart } from '@shared/contract';
import { locale, t } from '../../i18n';

export function barLayout(bars: UiBarChart['bars']) {
  const scale = Math.max(1, ...bars.map(b => Math.abs(b.value)));
  const lo = Math.min(0, ...bars.map(b => b.value / scale));
  const hi = Math.max(0, ...bars.map(b => b.value / scale));
  const span = hi - lo || 1;
  return { zero: -lo / span * 100, values: bars.map(b => ({
    left: (Math.min(0, b.value / scale) - lo) / span * 100,
    width: Math.abs(b.value / scale) / span * 100,
  })) };
}

export function BarChart({ p }: { p: UiBarChart }) {
  const layout = barLayout(p.bars);
  const value = (n: number) => `${n.toLocaleString(locale(), { maximumSignificantDigits: 12 })}${p.unit ? ` ${p.unit}` : ''}`;
  return (
    <div className="gu-chart">
      <div aria-hidden="true" className="gu-chart-bars">
        {p.bars.map((b, i) => <div key={i} className="gu-chart-row">
          <div className="gu-chart-caption"><span>{b.label}</span><strong>{value(b.value)}</strong></div>
          <div className="gu-chart-track"><span className="gu-chart-zero" style={{ left: `${layout.zero}%` }} />
            <span className={`gu-chart-fill ${b.value < 0 ? 'negative' : ''}`} style={{ left: `${layout.values[i]!.left}%`, width: `${layout.values[i]!.width}%` }} />
          </div>
          {b.note && <div className="gu-chart-note">{b.note}</div>}
        </div>)}
      </div>
      <table className="sr-only"><caption>{t('genui.chart.data')}</caption>
        <thead><tr><th scope="col">{t('genui.chart.label')}</th><th scope="col">{t('genui.chart.value')}</th><th scope="col">{t('genui.chart.note')}</th></tr></thead>
        <tbody>{p.bars.map((b, i) => <tr key={i}><th scope="row">{b.label}</th><td>{b.value}{p.unit ? ` ${p.unit}` : ''}</td><td>{b.note ?? ''}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
