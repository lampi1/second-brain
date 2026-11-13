// The words of the brain-sync status (src/renderer/lib/sync.ts, ADR 0059): hidden when nothing syncs (today's brains),
// tone and label, the per-domain line and each stop reason (the guard as file:line + rule).
import { describe, expect, it } from 'vitest';
import { blockLines, blockTitle, domainLine, syncSummary } from '../../../src/renderer/lib/sync';
import type { DomainSyncStatus } from '../../../src/shared/contract';

const NOW = 1_800_000_000_000;
const dom = (p: Partial<DomainSyncStatus>): DomainSyncStatus => ({ name: 'Personale', root: 'C:/p', scope: 'everywhere', state: 'idle', remote: 'origin', lastSync: NOW - 4 * 60_000, ahead: 0, behind: 0, blocked: null, problem: null, ...p });

describe('sync status words', () => {
  it('hidden when no domain syncs', () => {
    expect(syncSummary(null).show).toBe(false);
    expect(syncSummary({ at: NOW, domains: [dom({ state: 'off', remote: null, scope: 'this-pc' })] }).show).toBe(false);
  });
  it('blocked wins over syncing, syncing over ok', () => {
    expect(syncSummary({ at: NOW, domains: [dom({}), dom({ name: 'B', state: 'syncing' })] })).toMatchObject({ show: true, tone: 'busy' });
    expect(syncSummary({ at: NOW, domains: [dom({ state: 'syncing' }), dom({ name: 'B', state: 'blocked', blocked: { kind: 'no-guard', hint: 'h' } })] })).toEqual({ show: true, tone: 'bad', label: 'Sincronizzazione ferma: B' });
    expect(syncSummary({ at: NOW, domains: [dom({})] })).toEqual({ show: true, tone: 'ok', label: 'Brain sincronizzato' });
  });
  it('a domain line: last sync, to send, to receive', () => {
    expect(domainLine(dom({ ahead: 2, behind: 1 }), NOW)).toBe('sincronizzato 4 min fa · 2 da inviare · 1 da ricevere');
    expect(domainLine(dom({ lastSync: null }), NOW)).toBe('mai sincronizzato');
    expect(domainLine(dom({ state: 'off', problem: null }), NOW)).toMatch(/non si sincronizza/);
  });
  it('the guard as file:line + rule', () => {
    const b = { kind: 'guard' as const, findings: [{ file: 'a.md', line: 3, rule: 'deny-list' }, { file: 'b.md', line: null, rule: 'jwt' }] };
    expect(blockTitle(b)).toMatch(/controllo/);
    expect(blockLines(b)).toEqual(['a.md:3 · deny-list', 'b.md · jwt']);
    expect(blockLines({ kind: 'conflict', files: ['notes.md'] })).toEqual(['notes.md']);
  });
});
