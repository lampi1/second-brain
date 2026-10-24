// The end notice of the one-click «Manutenzione» (ADR 0149): one line with what it made (cards in Proposte, ideas in
// Idee, issues to open) and «Apri Memoria»; nothing found says so, a failed research says why. Kept in this one function
// so the app-wide notices (thread «Notifiche uniformi e suoni») can restyle it in one place. Used by
// store/maintenance.ts.
import type { MaintenanceDone } from '@shared/maintenance-research';
import { go } from '../actions';
import { t } from '../i18n';
import { toast } from '../store/ui';

/** The notice's words: what the click made, in one line. */
export function maintenanceSummary(d: MaintenanceDone): string {
  const parts = [
    d.proposals ? t('mm.done.proposals', { n: d.proposals }) : '',
    d.ideas ? t('mm.done.ideas', { n: d.ideas }) : '',
    d.issues ? t('mm.done.issues', { n: d.issues }) : '',
  ].filter(Boolean);
  if (d.state === 'failed' || d.state === 'capped') return `${t(`mm.done.${d.state}`)}${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
  return parts.length ? t('mm.done.made', { what: parts.join(' · ') }) : t('mm.done.nothing');
}

export function announceMaintenanceDone(d: MaintenanceDone): void {
  const cards = d.proposals + d.issues;
  const open = () => go({ page: 'memoria', arg: cards ? 'proposte' : d.ideas ? 'idee/ia' : 'proposte' });
  toast(maintenanceSummary(d), d.state === 'failed' ? 'warn' : 'ok', cards || d.ideas ? { label: t('mm.done.open'), run: open } : undefined, 9000);
}
