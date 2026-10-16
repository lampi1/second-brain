// The words of the brain-sync status (ADR 0059), pure so they are unit-tested apart: whether the top bar shows the
// button at all (only when a domain syncs: a brain of today has none, so nothing changes for it), its tone and label,
// and the Italian line for each domain and each reason a sync stopped (file:line + rule for the guard, never a value).
// Used by components/SyncStatus.tsx.
import type { DomainSyncStatus, SyncBlock, SyncState } from '@shared/contract';
import { ago } from './format';

export type SyncTone = 'ok' | 'busy' | 'bad';

export function syncSummary(st: SyncState | null): { show: boolean; tone: SyncTone; label: string } {
  const synced = st?.domains.filter(d => d.state !== 'off') ?? [];
  if (!synced.length) return { show: false, tone: 'ok', label: '' };
  const blocked = synced.filter(d => d.state === 'blocked');
  if (blocked.length) return { show: true, tone: 'bad', label: blocked.length === 1 ? `Sincronizzazione ferma: ${blocked[0]!.name}` : `Sincronizzazione ferma: ${blocked.length} domini` };
  if (synced.some(d => d.state === 'syncing')) return { show: true, tone: 'busy', label: 'Sincronizzo il cervello…' };
  return { show: true, tone: 'ok', label: 'Cervello sincronizzato' };
}

export const scopeLabel = (d: Pick<DomainSyncStatus, 'scope'>): string => (d.scope === 'everywhere' ? 'su tutti i tuoi PC' : 'solo su questo PC');

/** "sincronizzato 4 min fa · 2 da inviare · 1 da ricevere" */
export function domainLine(d: DomainSyncStatus, now: number): string {
  if (d.state === 'off') return d.problem ?? 'non si sincronizza (nessun remote)';
  const parts = [d.state === 'syncing' ? 'sincronizzo…' : d.lastSync ? `sincronizzato ${ago(d.lastSync, now) === 'ora' ? 'ora' : `${ago(d.lastSync, now)} fa`}` : 'mai sincronizzato'];
  if (d.ahead) parts.push(`${d.ahead} da inviare`);
  if (d.behind) parts.push(`${d.behind} da ricevere`);
  return parts.join(' · ');
}

export function blockTitle(b: SyncBlock): string {
  switch (b.kind) {
    case 'conflict': return 'Conflitto: lo stesso file è cambiato qui e sull\'altro PC';
    case 'guard': return 'Il controllo di pubblicazione ha bloccato l\'invio';
    case 'no-guard': return 'Invio bloccato: manca il controllo di pubblicazione';
    case 'error': return 'Sincronizzazione non riuscita';
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
