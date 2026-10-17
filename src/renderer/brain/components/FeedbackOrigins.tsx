// Recent human feedback from canonical memory events, used by Qualità; praise never implies a model success score.
import type { WinRow } from '../types';
import { lang } from '../../i18n';
import { ModelOrigin } from '../../components/ModelOrigin';
import { Section } from './ui';

export function FeedbackOrigins({ rows }: { rows: WinRow[] }) {
  if (!rows.length) return null;
  const en = lang() === 'en';
  const recent = [...rows].sort((a, b) => `${b.data} ${b.ora}`.localeCompare(`${a.data} ${a.ora}`)).slice(0, 5);
  return <Section title={en ? 'Human feedback' : 'Feedback umano'} count={rows.length} testId="bx-feedback-origins"
    note={en ? 'Recorded words, not a model performance score. Source: ai-wins.md.' : 'Parole registrate, senza punteggi al modello. Fonte: ai-wins.md.'}>
    <ul className="bx-list">{recent.map((row, index) => <li key={`${row.data}:${row.ora}:${index}`}>
      <span className="t">{row.parole}<br /><small className="muted">{row.data} {row.ora} · {row.chat}</small></span>
      <ModelOrigin human origin={row.origin} />
    </li>)}</ul>
  </Section>;
}
