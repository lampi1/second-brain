// A role version's numbers on its page (AgentStudio.tsx VersionStats, ADR 0186): runs and verified outcomes, the success
// share with its ± from MIN_SUCCESS_SAMPLE verified outcomes, «troppo pochi» below, a plain line with no run.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
import type { VersionMetrics } from '../../../src/shared/agents';
import { VersionStats } from '../../../src/renderer/components/AgentStudio';
import { setLang } from '../../../src/renderer/i18n';

afterEach(() => setLang('it'));
const m = (ended: number, value: number | null, n: number) => ({ ended, successRate: { value, n, coverage: 1 } }) as unknown as VersionMetrics;
const html = (v: VersionMetrics | undefined) => renderToStaticMarkup(createElement(VersionStats, { m: v }));

describe('VersionStats', () => {
  it('shows the share with its 90% interval from 5 verified outcomes, the count below', () => {
    expect(html(m(12, 0.8, 5))).toMatch(/12 run, 5 esiti verificati · <b>80%\s?riuscite \(probabilmente tra 44 e 95%\)<\/b>/);
    expect(html(m(9, 1, 3))).toContain('troppo pochi per una percentuale (3/5)');
    expect(html(m(0, null, 0))).toContain('Nessuna run finita');
    expect(html(undefined)).toContain('Nessuna run finita');
    setLang('en');
    expect(html(m(12, 0.8, 5))).toContain('succeeded (likely between 44 and 95%)');
  });
});
