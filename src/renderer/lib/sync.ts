// The words of the brain-sync status (ADR 0059), pure so they are unit-tested apart: whether the top bar shows the
// button at all (only when a domain syncs: a brain of today has none, so nothing changes for it), its tone and label,
// and the Italian line for each domain and each reason a sync stopped (file:line + rule for the guard, never a value).
// Used by components/SyncStatus.tsx.
import type { DomainSyncStatus, SyncBlock, SyncState } from '@shared/contract';
import { ago } from './format';
import { t } from '../i18n';

export type SyncTone = 'ok' | 'busy' | 'bad';

export function syncSummary(st: SyncState | null): { show: boolean; tone: SyncTone; label: string } {
  const synced = st?.domains.filter(d => d.state !== 'off') ?? [];
  if (!synced.length) return { show: false, tone: 'ok', label: '' };
  const blocked = synced.filter(d => d.state === 'blocked');
  if (blocked.length) return { show: true, tone: 'bad', label: blocked.length === 1 ? t('appText.sync.stoppedOne', { name: blocked[0]!.name }) : t('appText.sync.stoppedMany', { n: blocked.length }) };
  if (synced.some(d => d.state === 'syncing')) return { show: true, tone: 'busy', label: t('appText.sync.syncing') };
  return { show: true, tone: 'ok', label: t('appText.sync.synced') };
}

export const scopeLabel = (d: Pick<DomainSyncStatus, 'scope'>): string => (d.scope === 'everywhere' ? t('appText.sync.everywhere') : t('appText.sync.thisPc'));

/** "sincronizzato 4 min fa · 2 da inviare · 1 da ricevere" */
export function domainLine(d: DomainSyncStatus, now: number): string {
  if (d.state === 'off') return d.problem ?? t('appText.sync.noRemote');
  const parts = [d.state === 'syncing' ? t('appText.sync.syncingShort') : d.lastSync ? (ago(d.lastSync, now) === t('appText.format.now') ? t('appText.sync.syncedNow') : t('appText.sync.syncedAgo', { ago: ago(d.lastSync, now) })) : t('appText.sync.never')];
  if (d.ahead) parts.push(t('appText.sync.ahead', { n: d.ahead }));
  if (d.behind) parts.push(t('appText.sync.behind', { n: d.behind }));
  return parts.join(' · ');
}

export function blockTitle(b: SyncBlock): string {
  switch (b.kind) {
    case 'conflict': return t('appText.sync.conflict');
    case 'guard': return t('appText.sync.guard');
    case 'no-guard': return t('appText.sync.noGuard');
    case 'error': return t('appText.sync.error');
  }
}

/** The details under the title: files, findings (file:line regola), or the hint. */
export function blockLines(b: SyncBlock): string[] {
  switch (b.kind) {
    case 'conflict': return b.files.slice(0, 8);
    case 'guard': return b.findings.slice(0, 8).map(f => `${f.file}${f.line ? `:${f.line}` : ''} · ${f.rule}`);
    case 'no-guard': return [b.hint];
    case 'error': return [b.message, b.hint];
  }
}
