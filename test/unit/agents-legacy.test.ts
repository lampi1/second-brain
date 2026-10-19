/** Checks that legacy imports preserve effective choices and reject malformed persistence without replacements. */
import { describe, expect, it } from 'vitest';
import { legacyAgentProfiles, legacyKindOf } from '../../src/main/agents/legacy';
import { AGENT_SYMBOLS } from '../../src/shared/agents';
import type { RoutingRow } from '../../src/shared/contract';

const row = (extra: Partial<RoutingRow> = {}): RoutingRow => ({
  kind: 'review', harness: 'claude', model: 'retired-model', effort: 'high',
  why: 'Do not copy private rationale', since: 'old', evidence: 'Do not copy evidence', ...extra,
});
const untrusted = (values: unknown) => values as readonly RoutingRow[];

describe('legacy Agent profiles', () => {
  it('preserves engine, model and effort and gives each kind its guidance, never the row\'s private text (ADR 0078)', () => {
    const input = row({ area: 'IT' });
    const result = legacyAgentProfiles([input], 123);
    expect(result.skipped).toBe(0);
    expect(result.profiles[0]).toMatchObject({ name: 'Revisione · IT', engine: 'claude', model: 'retired-model', effort: 'high', createdAt: 123, updatedAt: 123 });
    expect(result.profiles[0]!.instructions).toMatch(/problemi in ordine di gravità/);
    expect(result.profiles[0]!.manifest?.whenToUse).toMatch(/Rivedere una modifica.*Area: IT\./);
    expect(result.profiles[0]!.purpose).toContain('legacy');
    expect(AGENT_SYMBOLS).toContain(result.profiles[0]!.avatar.kind === 'symbol' ? result.profiles[0]!.avatar.value : '');
    expect(JSON.stringify(result)).not.toContain(input.why);
    expect(JSON.stringify(result)).not.toContain(input.evidence);
    expect(input).toEqual(row({ area: 'IT' }));
  });

  it('reads a legacy profile\'s kind back from its name', () => {
    expect(legacyKindOf('Correzione bug · App')).toBe('bug-fix');
    expect(legacyKindOf('Lettura operativa')).toBe('ops-read');
    expect(legacyKindOf('Il mio agente')).toBeNull();
  });

  it('deduplicates normalized area sets while distinguishing every effective choice and scope', () => {
    const rows = [row({ area: [' B ', 'A'] }), row({ area: ['A', 'B', 'A'] }), row({ area: 'A' }), row({ kind: 'writing' }), row({ harness: 'cursor' }), row({ model: 'other' }), row({ effort: 'low' })];
    const first = legacyAgentProfiles(rows, 1);
    expect(first.profiles).toHaveLength(6);
    expect(first.skipped).toBe(1);
    const reordered = legacyAgentProfiles([...rows].reverse(), 999);
    expect(reordered.profiles.map(p => p.id).sort()).toEqual(first.profiles.map(p => p.id).sort());
    expect(legacyAgentProfiles([row({ area: ' A ' })], 2).profiles[0]!.id).toBe(first.profiles[1]!.id);
  });

  it('retains unknown providers and leaves null effort unspecified', () => {
    const p = legacyAgentProfiles([row({ harness: 'future-provider', model: 'org/model:old@v1', effort: null })], 1).profiles[0]!;
    expect(p.engine).toBe('future-provider');
    expect(p.model).toBe('org/model:old@v1');
    expect(p).not.toHaveProperty('effort');
  });

  it('preserves explicit API billing only with the configured API engine and never falls back', () => {
    const input = row({ onApi: true });
    expect(legacyAgentProfiles([input], 1)).toEqual({ profiles: [], skipped: 1 });
    expect(legacyAgentProfiles([input], 1, { apiEngine: 'bad engine' })).toEqual({ profiles: [], skipped: 1 });
    const imported = legacyAgentProfiles([input, row({ harness: 'api-provider' })], 1, { apiEngine: 'api-provider' });
    expect(imported.profiles).toHaveLength(2);
    expect(imported.profiles[0]).toMatchObject({ engine: 'api-provider', model: input.model, effort: input.effort });
    expect(imported.profiles[0]!.id).not.toBe(imported.profiles[1]!.id);
  });

  it('counts invalid rows without repairing engine, model, effort, kind or area', () => {
    const invalid = [null, [], 'row', {}, row({ harness: 'Bad engine' }), row({ harness: 'a'.repeat(61) }), row({ model: 'unsafe model' }), row({ model: 'a'.repeat(121) }), { ...row(), model: null }, { ...row(), effort: 'ultra' }, { ...row(), effort: undefined }, { ...row(), kind: 'unknown' }, { ...row(), area: ['valid', 3] }, row({ area: '' }), row({ area: 'line\nbreak' }), row({ area: [] })];
    expect(legacyAgentProfiles(untrusted(invalid), 1)).toEqual({ profiles: [], skipped: invalid.length });
    expect(legacyAgentProfiles(untrusted(null), 1)).toEqual({ profiles: [], skipped: 1 });
  });

  it('returns more than 64 valid candidates, bounds external rows and keeps text bounded', () => {
    const rows = Array.from({ length: 1005 }, (_, i) => row({ model: `model-${i}`, area: ['A'.repeat(120), 'B'.repeat(120), 'C'.repeat(120)] }));
    const result = legacyAgentProfiles(rows, 1);
    expect(result.profiles).toHaveLength(1000);
    expect(result.skipped).toBe(5);
    expect(result.profiles.every(p => p.name.length <= 80 && p.purpose.length <= 400)).toBe(true);
    expect(new Set(result.profiles.map(p => p.id)).size).toBe(1000);
  });
});
