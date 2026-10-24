// The skill and rule proposals of the app's other parts wait for the user's «Manutenzione» (ADR 0152,
// proposals/service.ts heldBack): a skill candidate or a Battito rule made after the last click is hidden until the
// next one; the maintenance's own cards and the other sources never are.
import { describe, expect, it } from 'vitest';
import type { Proposal, ProposalSource } from '../../../src/shared/proposals';
import { heldBack } from '../../../src/main/proposals/service';

const card = (source: ProposalSource, at: string): Proposal => ({
  id: `${source}:x`, source, group: 'rule', applied: false, title: 't', ask: { kind: 'rule', role: 'artisan' }, content: '', facts: [],
  provenance: { who: { kind: 'app', id: 'agent' }, at, evidence: [] }, canApprove: true, canReject: true,
});
const CLICK = Date.parse('2026-10-24T10:00:00Z');

describe('heldBack', () => {
  it('holds candidates and Battito rules made after the last click, or when never pressed', () => {
    expect(heldBack(card('candidate', '2026-10-24T11:00:00Z'), CLICK)).toBe(true);
    expect(heldBack(card('pulse', '2026-10-24T11:00:00Z'), CLICK)).toBe(true);
    expect(heldBack(card('candidate', '2026-10-24T09:00:00Z'), CLICK)).toBe(false);
    expect(heldBack(card('pulse', '2026-10-24T09:00:00Z'), null)).toBe(true);
  });
  it('never holds the maintenance\'s cards, settings, trials or applied changes', () => {
    for (const s of ['research', 'setting', 'trial', 'tier', 'change', 'policy', 'memory'] as const) expect(heldBack(card(s, '2026-10-24T11:00:00Z'), CLICK)).toBe(false);
  });
});
