// No model calls: explicit-source, confirmation, conflict, budget and legacy context fixtures.
import { it, expect } from 'vitest';
import { loadUserContext } from '../../src/main/brain/user-context';
import selection from '../fixtures/extensions/context-selection.json';
const fact = (id: string, key: string, value: string) => ({ id, key, value, confirmation: 'confirmed', confirmedAt: '2026-10-17T08:00:00Z' });
const source = (id: string, facts: unknown[]) => ({ schemaVersion: 1, id, label: id, facts });

it('preserves empty legacy context and never reads an unrequested source', () => {
  let reads = 0;
  expect(loadUserContext(null, [], () => { reads++; }).text).toBe('');
  expect(reads).toBe(0);
});
it('retains provenance and confirmed timestamp, excludes pending and conflicting facts', () => {
  const canonical = source('essential', [fact('language', 'language', 'Italiano'), fact('role', 'role', 'Developer')]);
  const packet = loadUserContext(canonical, ['activity', 'activity'], () => source('activity', [
    fact('language', 'language', 'English'), { ...fact('draft', 'draft', 'Not yet confirmed'), confirmation: 'pending', confirmedAt: null },
    fact('goal', 'goal', 'Review synthetic practices'),
  ]));
  expect(packet.conflicts).toEqual(['language']);
  expect(packet.pending).toEqual(['activity/draft']);
  expect(packet.text).not.toContain('English');
  expect(packet.text).not.toContain('Not yet confirmed');
  expect(JSON.parse(packet.text).facts).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: 'essential', sourceLabel: 'essential', key: 'role', confirmedAt: '2026-10-17T08:00:00Z' })]));
});
it('uses UTF-8 bytes and never truncates a fact, with essential context first', () => {
  const packet = loadUserContext(source('essential', [fact('language', 'language', 'Italiano')]), ['activity'], () => source('activity', [fact('long', 'long', '界'.repeat(1000))]), 512);
  expect(packet.included).toEqual(['essential/language']);
  expect(packet.omitted).toEqual(['activity/long']);
  expect(packet.bytes).toBe(Buffer.byteLength(packet.text));
  expect(packet.bytes).toBeLessThanOrEqual(512);
});
it('reports missing, malformed or spoofed sources and rejects invalid request IDs', () => {
  expect(loadUserContext(null, ['activity'], () => source('wrong-id', [])).unavailable).toEqual(['activity']);
  expect(loadUserContext(null, ['missing'], () => { throw new Error('Unavailable'); }).unavailable).toEqual(['missing']);
  expect(() => loadUserContext(null, ['../secret'], () => null)).toThrow();
  expect(() => loadUserContext(null, [], () => null, NaN)).toThrow();
});

it('replays confirmed constraints/profile priority and predictable budget degradation without a model', () => {
  const activity = source('activity', [fact('task', 'task', 'Review synthetic deadlines')]);
  const full = loadUserContext(selection, ['activity'], () => activity, 4096);
  expect(full.included).toEqual(['essential/z-constraint', 'essential/a-profile', 'activity/task']);
  expect(full.pending).toEqual(['essential/pending-role']);
  const firstFact = JSON.parse(full.text).facts[0];
  const oneFactBytes = Buffer.byteLength(JSON.stringify({ kind: 'untrusted-user-context', schemaVersion: 1, facts: [firstFact] }));
  const reduced = loadUserContext(selection, ['activity'], () => activity, oneFactBytes);
  expect(reduced.included).toEqual(['essential/z-constraint']);
  expect(reduced.omitted).toEqual(['essential/a-profile', 'activity/task']);
  expect(reduced.status).toBe('degraded');
  expect(reduced.bytes).toBe(oneFactBytes);
  expect(reduced.estimatedTokens).toEqual({ value: Math.ceil(oneFactBytes / 4), method: 'ceil-utf8-bytes-div-4', approximate: true });
  // Input order never overrides category priority; no inferred constraints are added.
  expect(loadUserContext({ ...selection, facts: [...selection.facts].reverse() }, ['activity'], () => activity, oneFactBytes).text).toBe(reduced.text);
});

it('reports conflicted constraints instead of selecting a winner, and keeps the profile', () => {
  const conflict = source('activity', [{ ...fact('approval', 'approval', 'Allow automatic publication'), category: 'constraint' }]);
  const packet = loadUserContext(selection, ['activity'], () => conflict);
  expect(packet.conflicts).toEqual(['approval']);
  expect(packet.included).toEqual(['essential/a-profile']);
  expect(packet.status).toBe('degraded');
  expect(packet.text).not.toContain('publication');
});
