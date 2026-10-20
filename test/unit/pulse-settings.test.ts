// The Battito's times as the user types them in Settings → Notifiche (src/renderer/components/PulseSettings.tsx, ADR
// 0102): one to three HH:MM times, any separator, sorted, a one-digit hour padded; anything else refused.
import { describe, expect, it } from 'vitest';
import { parseSlots } from '../../src/renderer/lib/pulse-context';

describe('parseSlots', () => {
  it('reads one to three times, sorted and without repeats', () => {
    expect(parseSlots('13:00, 08:30')).toEqual(['08:30', '13:00']);
    expect(parseSlots('8:30; 18:30 8:30')).toEqual(['08:30', '18:30']);
  });
  it('refuses none, four, or a wrong time', () => {
    expect(parseSlots('')).toBeNull();
    expect(parseSlots('08:00, 09:00, 10:00, 11:00')).toBeNull();
    expect(parseSlots('25:00')).toBeNull();
    expect(parseSlots('mattina')).toBeNull();
  });
});
