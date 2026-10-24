// The end notice of the one-click «Manutenzione» (ADR 0152), on the app's one notice card (lib/notice.ts, ADR 0151): a
// celebrate notice with its arpeggio when it made something (chips: proposals in Proposte, ideas in Idee, issues to
// open) and «Apri Memoria»; a calm one when everything was already in order; a warning when the research failed, hit
// its cap or was stopped. maintenanceSummary is the same result in one line (the hero's «Ultima: …»). Used by store/maintenance.ts and
// components/brain-model/MaintenanceButton.tsx.
import type { MaintenanceDone } from '@shared/maintenance-research';
import { go } from '../actions';
import { t } from '../i18n';
import { notify } from './notice';

/** The research did not end by itself: failed, at its cap, or stopped (by «Ferma», the hour limit, a closed chat). */
const cut = (d: MaintenanceDone): d is MaintenanceDone & { state: 'failed' | 'capped' | 'stopped' } => d.state === 'failed' || d.state === 'capped' || d.state === 'stopped';

const parts = (d: MaintenanceDone): string[] => [
  d.proposals ? t('mm.done.proposals', { n: d.proposals }) : '',
  d.ideas ? t('mm.done.ideas', { n: d.ideas }) : '',
  d.issues ? t('mm.done.issues', { n: d.issues }) : '',
].filter(Boolean);

/** What the click made, in one line. */
export function maintenanceSummary(d: MaintenanceDone): string {
  const p = parts(d);
  if (cut(d)) return `${t(`mm.done.${d.state}`)}${p.length ? ` · ${p.join(' · ')}` : ''}`;
  return p.length ? t('mm.done.made', { what: p.join(' · ') }) : t('mm.done.nothing');
}

export function announceMaintenanceDone(d: MaintenanceDone): void {
  const chips = parts(d), cards = d.proposals + d.issues;
  const open = { label: t('mm.done.open'), run: () => go({ page: 'memoria', arg: cards ? 'proposte' : 'idee/ia' }) };
  const bad = cut(d);
  notify({
    tone: bad ? 'warn' : chips.length ? 'celebrate' : 'ok',
    label: t('mm.done.label'),
    title: bad ? t(`mm.done.${d.state}`) : chips.length ? t('mm.done.title') : t('mm.done.nothing'),
    ...(bad && d.why ? { detail: d.why } : {}),
    ...(chips.length ? { chips, action: open } : {}),
  });
}
