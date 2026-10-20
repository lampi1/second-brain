// The Classificatori page's small shared pieces (ClassifiersPage.tsx grid, ClassifierDetail.tsx detail): the
// per-classifier text lookup, the icon of each classifier, a number with its "?" HelpTip (null = "nessun dato
// ancora", never zero) and the third number of a card. The "pronto a calibrarsi" meter is gone with the calibration
// it measured (bb953da; ADR 0101).
import type { ReactNode } from 'react';
import { locale, t } from '../../i18n';
import { usdOf, type CardId, type CardView } from '../../lib/classifier-view';
import { HelpTip } from '../HelpTip';

/** A per-classifier text (stats.c.<id>.<what>). */
export const ct = (id: CardId | 'mail' | 'cmd', what: string): string => t(`stats.c.${id}.${what}` as Parameters<typeof t>[0]);
export const pctFmt = (v: number): string => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(v);
export const intFmt = (v: number): string => new Intl.NumberFormat(locale()).format(v);

const PATHS: Record<CardId | 'mail' | 'cmd', ReactNode> = {
  kind: <><path d="M4 6h16M4 12h10M4 18h6" /><circle cx="18" cy="16" r="3" /></>,
  model: <><rect x="5" y="5" width="14" height="14" rx="3" /><path d="M10 10h4v4h-4zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>,
  skills: <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" />,
  estimates: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6" /></>,
  tasks: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  jobkind: <><path d="M4 7h16v12H4z" /><path d="M9 7V4h6v3M4 12h16" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  cmd: <path d="M4 17l6-6-6-6M12 19h8" />,
};
export function ClsIcon({ id }: { id: CardId | 'mail' | 'cmd' }) {
  return <span className="cls-icon" data-id={id} aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{PATHS[id]}</svg></span>;
}

/** A number with its label and a "?" that says how it is computed; null = no data yet. */
export function Num({ label, value, sub, help, testId }: { label: string; value: string | null; sub?: string; help: string; testId?: string }) {
  return <div className="cls-num" data-testid={testId}>
    <span className="cls-num-label">{label}<HelpTip title={label} label={label}>{help}</HelpTip></span>
    {value === null ? <span className="cls-num-value none">{t('stats.cls.noData')}</span> : <strong className="cls-num-value">{value}</strong>}
    {sub && value !== null && <small>{sub}</small>}
  </div>;
}

/** The third number of a card that has no verified outcomes: the estimates' typical error, the task estimator's
 *  median gap, else the average cost. */
export function third(c: CardView): { label: string; value: string | null; help: string } {
  if (c.id === 'tasks') return { label: ct('tasks', 'err'), value: c.tasks?.medianErr == null ? null : pctFmt(c.tasks.medianErr), help: ct('tasks', 'errHelp') };
  if (c.id === 'estimates') return { label: ct('estimates', 'typical'), value: c.estimates?.typical == null ? null : `×${c.estimates.typical.toLocaleString(locale(), { maximumFractionDigits: 1 })}`, help: ct('estimates', 'typicalHelp') };
  return { label: t('stats.cls.cost'), value: usdOf(c.avgCostUsd), help: t('stats.cls.costHelp') };
}

