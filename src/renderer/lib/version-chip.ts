// What the top bar's version chip says (ADR 0366, issue #491; it replaces the full-width green «Partita la versione
// nuova» banner): a newer version on GitHub → «● Versione nuova · Aggiorna»; else, after a restart on a new version →
// «Aggiornata a <sha> · Novità» until dismissed; else nothing. A start that fell back to the previous version stays the
// warning banner (LaunchBanner.tsx). Pure: used by components/VersionChip.tsx; pinned by test/unit/version-chip.test.ts.
import type { AppSourceState } from '@shared/contract';

export type VersionChip = { kind: 'available'; behind: number; subject: string; canUpdate: boolean } | { kind: 'updated'; sha: string };

/** "0.1.0-91967ec" → "91967ec"; a release id without a sha stays whole. */
export const shortVersion = (id: string): string => /-([0-9a-f]{7,40})$/.exec(id)?.[1]?.slice(0, 7) ?? id;

export function versionChipOf(s: AppSourceState | null): VersionChip | null {
  if (!s) return null;
  const behind = s.source.behind ?? 0;
  if (behind > 0 && s.source.state !== 'updating' && s.source.state !== 'restarting') {
    const subject = s.candidate?.subject ?? s.source.commits[0]?.slice(8) ?? '';
    return { kind: 'available', behind, subject, canUpdate: s.source.canUpdate };
  }
  if (s.launch?.outcome === 'new') return { kind: 'updated', sha: shortVersion(s.launch.running) };
  return null;
}
