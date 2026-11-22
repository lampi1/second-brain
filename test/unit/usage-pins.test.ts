// The pinned weekly limits of the top-bar usage strip (ADR 0333): which window a pin shows (never a 5 h one), the
// saved pin list read back safely (renderer/store/ui.ts), and app_state's usage without account e-mails.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: {} }));
import { primaryWeeklyWindow } from '../../src/renderer/components/UsageBar';
import { loadPrefs, pinnedHarnesses } from '../../src/renderer/store/ui';
import { usageForAgents } from '../../src/main/appctl/tools';
import type { HarnessUsage, Usage } from '../../src/shared/contract';

const h = (windows: HarnessUsage['windows']): HarnessUsage =>
  ({ harness: 'codex', label: 'Codex', status: 'ok', planLabel: null, accountEmail: 'user@example.com', windows, message: null, source: 'oauth', at: 0 });

describe('usage pins', () => {
  it('a pin shows the weekly or plan window, never a 5 h or daily one', () => {
    expect(primaryWeeklyWindow(h([{ kind: 'five-hour', label: '5h', usedPercent: 50, resetsAt: null }, { kind: 'weekly', label: '7g', usedPercent: 20, resetsAt: null }]))?.usedPercent).toBe(20);
    expect(primaryWeeklyWindow(h([{ kind: 'five-hour', label: '5h', usedPercent: 50, resetsAt: null }]))).toBeNull();
    expect(primaryWeeklyWindow(h([{ kind: 'daily', label: '24h', usedPercent: 50, resetsAt: null }]))).toBeNull();
    expect(primaryWeeklyWindow(h([{ kind: 'plan', label: 'Piano', usedPercent: 65, resetsAt: null }]))?.usedPercent).toBe(65);
  });

  it('keeps only known harnesses, once each; a non-list falls back to the default', () => {
    expect(pinnedHarnesses(['codex', 'codex', 'nope', 3, 'cursor'])).toEqual(['codex', 'cursor']);
    expect(pinnedHarnesses('claude')).toEqual(['claude']);
    expect(pinnedHarnesses([])).toEqual([]);
    expect(loadPrefs(JSON.stringify({ usagePinned: { x: 1 } }), 0).usagePinned).toEqual(['claude']);
    expect(loadPrefs(JSON.stringify({ usagePinned: ['opencode', 'x'] }), 0).usagePinned).toEqual(['opencode']);
  });

  it('app_state gives agents the usage without the harnesses\' account e-mails', () => {
    const u = { harnesses: [h([])] } as unknown as Usage;
    expect(usageForAgents(u).harnesses?.[0]?.accountEmail).toBeNull();
    expect(u.harnesses?.[0]?.accountEmail).toBe('user@example.com');
  });
});
