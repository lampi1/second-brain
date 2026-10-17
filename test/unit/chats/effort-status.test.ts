import { describe, expect, it } from 'vitest';
import { initialEffort, selectEffort, submitEffort } from '../../../src/main/chats/effort';
describe('Effort request and observed state', () => {
  it('never labels the CLI default or unsupported engines medium', () => {
    expect(initialEffort(true, null)).toMatchObject({ requested: null, effective: null, submitted: null, sessionDefault: null, pending: false });
    expect(initialEffort(false, null)).toMatchObject({ supported: false, effective: null, pending: false });
  });
  it('preserves the current effective report when a different next-turn value is selected', () => {
    const current = { ...initialEffort(true, 'xhigh'), submitted: 'xhigh', effective: 'xhigh', effectiveSource: 'provider' as const, pending: false };
    const next = selectEffort(current, 'medium');
    expect(next).toMatchObject({ requested: 'medium', effective: 'xhigh', submitted: 'xhigh', pending: true });
    expect(submitEffort(next, 'medium')).toMatchObject({ requested: 'medium', submitted: 'medium', effective: null, effectiveSource: 'unknown', pending: false });
  });
  it('maps the actual submitted value without claiming provider resolution and preserves newer requests', () => {
    expect(submitEffort(initialEffort(true, 'max'), 'xhigh')).toMatchObject({ submitted: 'xhigh', effective: null, pending: false });
    expect(submitEffort(initialEffort(true, 'high'), 'medium').pending).toBe(true);
  });
});
