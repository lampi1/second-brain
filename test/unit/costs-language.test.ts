// Actual Costs chrome switches languages; aggregate records never acquire an inferred originating model.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import type { CostData } from '../../src/renderer/brain/types';
import { costsIt } from '../../src/renderer/i18n/areas/costs.it';
import { costsEn } from '../../src/renderer/i18n/areas/costs.en';
import { setLang, t } from '../../src/renderer/i18n';
import { fmt, minutesAgo } from '../../src/renderer/brain/lib/format';
const fixture = vi.hoisted(() => ({ data: null as CostData | null }));
vi.mock('../../src/renderer/brain/api', () => ({ useBrain: () => ({ data: fixture.data, at: Date.now() - 120_000, loading: false, refreshing: false, error: null, reload: vi.fn() }) }));
vi.mock('../../src/renderer/brain/lib/app-chats', () => ({ useAppChats: () => null }));
vi.mock('../../src/renderer/brain/components/Discuss', async () => {
  const { createContext } = await import('react');
  return { DiscussContext: createContext(null), DiscussBar: () => null };
});
vi.mock('../../src/renderer/brain/components/AgentAnalytics', () => ({ AgentAnalytics: () => null }));
import { Costi } from '../../src/renderer/brain/pages/Costi';
import { LiveCostList } from '../../src/renderer/components/LiveCosts';
import { HelpTip } from '../../src/renderer/components/HelpTip';
afterEach(() => { setLang('it'); fixture.data = null; });
it('keeps cost dictionaries in parity and resolves parameterized copy through the registered language', () => {
  expect(Object.keys(costsEn).sort()).toEqual(Object.keys(costsIt).sort());
  setLang('en'); expect(t('costs.days', { days: 7 })).toBe('7 days');
  expect(t('costs.cursorEstimate', { margin: 20 })).toBe('estimate ±20% until confirmed by CSV');
  expect(minutesAgo(2)).toBe('2 min ago'); expect(fmt.usd(1.84)).toBe('1.84 $');
  setLang('it'); expect(minutesAgo(2)).toBe('2 min fa'); expect(fmt.usd(1.84)).toBe('1,84 $');
});
it('server-renders a genuinely closed help button without a document or portal substitute', () => {
  setLang('en'); expect(typeof document).toBe('undefined');
  const html = renderToStaticMarkup(createElement(HelpTip, {label:'Observed cost',children:'Only recorded values'}));
  expect(html).toContain('aria-expanded="false"'); expect(html).toContain('Explanation: Observed cost');
  expect(html).not.toContain('role="tooltip"');
});
it('renders the actual populated Costs page and its legacy table/header chrome in English', () => {
  setLang('en'); fixture.data = {
    from: '2026-10-10', to: '2026-10-16', total: 12, calls: 3,
    byDay: {}, byKind: {}, byModel: {}, byArea: {},
    chats: [{ title: 'Offerta cliente originale', folder: 'client-work', usd: 12, calls: 3, ctxMax: 200, from: 1, to: 2, longSave: 0 }],
    long: 0, longSave: 0, uncalibrated: [], cursor: null, fixed: null,
    advice: [{ usd: 2, text: 'Testo originale della fonte' }],
  };
  const html = renderToStaticMarkup(createElement(Costi, { nav: vi.fn() }));
  for (const text of ['Costs', '7 days', 'updated', '2 min ago', 'Refresh', 'Now', 'Search table', 'Columns', 'Potential savings', 'Offerta cliente originale', 'Testo originale della fonte']) expect(html).toContain(text);
  for (const text of ['>Costi<', '7 giorni', 'aggiornato', 'Cerca in tabella', 'Scegli le colonne']) expect(html).not.toContain(text);
});
it('discloses missing event provenance once per list, outside row buttons, without fabricating a model', () => {
  setLang('en');
  const rows = ['a', 'b'].map(key => ({ key, chatId: key, title: key, harness: 'claude' as const, usd: 1, approx: false, running: false, closed: false }));
  const html = renderToStaticMarkup(createElement(LiveCostList, { rows, onOpen: vi.fn() }));
  expect(html.match(/Model provenance/g)).toHaveLength(1);
  expect(html).toContain('<details'); expect(html).toContain('Originating model unavailable');
  expect(html).not.toContain('Model: Not available'); expect(html).not.toContain('model-origin');
  expect(html.indexOf('Model provenance')).toBeGreaterThan(html.indexOf('</ul>'));
});
