// Requested/submitted choices never masquerade as the provider's actual effort, including null/unsupported.
import { expect, it } from 'vitest';
import { effortSummary } from '../../src/renderer/lib/effort-status';

it('keeps effective unknown even when medium was requested and submitted', () => {
  const s = effortSummary({ supported: true, requested: 'medium', submitted: 'medium', effective: null, pending: false, effectiveSource: 'unknown', sessionDefault: null });
  expect(s.active).toBe('non riportato'); expect(s.badge).not.toContain('medium'); expect(s.requested).toBe('medium');
  expect(s.compactBadge).toBeNull();
});
it('shows the provider-reported active value separately from a next-turn change', () => {
  const s = effortSummary({ supported: true, requested: 'medium', submitted: 'xhigh', effective: 'xhigh', pending: true, effectiveSource: 'provider', sessionDefault: null });
  expect(s.badge).toBe('Attivo: xhigh'); expect(s.pending).toBe('Prossimo turno: medium');
  expect(s.compactBadge).toBe('Attivo: xhigh · Prossimo turno: medium');
});
it('does not hide null/default or unsupported engines', () => {
  const s = effortSummary({ supported: false, requested: null, submitted: null, effective: null, pending: false, effectiveSource: 'unknown', sessionDefault: null });
  expect(s.badge).toContain('non supportato'); expect(s.requested).toBe('default del motore');
  expect(s.compactBadge).toBeNull();
});
it('shows an explicit next-turn change without inventing active effort',()=>{
 const s=effortSummary({supported:true,requested:'medium',submitted:'xhigh',effective:null,pending:true,effectiveSource:'unknown',sessionDefault:null});
 expect(s.compactBadge).toBe('Prossimo turno: medium');expect(s.compactBadge).not.toContain('Attivo');
});
