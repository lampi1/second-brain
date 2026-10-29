// Server render coverage for every trusted view and rich choices. IPC and app stores are isolated, no DOM dependency.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn() } }));
vi.mock('../../src/renderer/store/store', () => ({ useApp: vi.fn(), onChatRemoved: () => () => {} }));
vi.mock('../../src/renderer/store/ui', () => ({ ui: {}, closeModal: vi.fn(), openModal: vi.fn(), toast: vi.fn() }));
vi.mock('../../src/renderer/components/ui', () => ({ Modal: () => null }));
vi.mock('../../src/renderer/brain/components/ui', () => ({ copyText: vi.fn() }));
vi.mock('../../src/renderer/lib/markdown', () => ({ renderMarkdown: (s: string) => s }));
import { UiPreview, UiView } from '../../src/renderer/components/GenUi';
import { ChoiceCard } from '../../src/renderer/components/genui/ChoiceCard';
import { barLayout } from '../../src/renderer/components/genui/BarChart';
import { catalogFixtures, questionFixture, richQuestion } from '../../src/renderer/components/genui/fixtures';
import { setLang, t } from '../../src/renderer/i18n';
import { checkUi } from '../../src/shared/genui';

afterEach(() => setLang('it'));
const render = (spec: typeof catalogFixtures[number]) => renderToStaticMarkup(createElement(UiView, { spec }));
describe('catalog product views', () => {
  it.each(catalogFixtures)('$component renders a validated fixture', spec => {
    expect(checkUi(spec.component, spec.props).ok).toBe(true);
    expect(render(spec).length).toBeGreaterThan(100);
  });
  it('table names column headers, overflow and empty state', () => {
    const html = render(catalogFixtures[0]!);
    expect(html).toContain('scope="col"');
    expect(html).toContain('role="region"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(render({ component: 'table', props: { columns: ['A'], rows: [] } })).toContain('colSpan="1"');
  });
  it('cards expose benefits, tradeoffs and recommendation in both languages', () => {
    expect(render(catalogFixtures[1]!)).toContain('Vantaggi');
    expect(render(catalogFixtures[1]!)).toContain('Consigliata');
    setLang('en');
    expect(render(catalogFixtures[1]!)).toContain('Benefits');
    expect(render(catalogFixtures[1]!)).toContain('Tradeoffs');
  });
  it('board keeps explicit status even when the title names it; empty lanes remain visible', () => {
    const html = render(catalogFixtures[2]!);
    expect(html).toContain('gu-status gu-running');
    expect(html).toContain('gu-empty');
  });
  it('diff files expose a file action and a labelled copy button', () => {
    const html = render(catalogFixtures[3]!);
    expect(html).toContain('gu-path');
    expect(html).toContain('aria-label="');
    expect(html).toContain('accessibility-review.md');
    expect(html).toContain('−12');
  });
  it('chart keeps full labels and notes in an accessible data table', () => {
    const html = render(catalogFixtures[4]!);
    expect(html).toContain('<caption>Dati del grafico</caption>');
    expect(html).toContain('scope="row"');
    expect(html).toContain('Analysis and verification');
    expect(html).toContain('-4.2 EUR');
  });
  it('bar geometry handles negative, zero, huge and fractional finite values', () => {
    expect(barLayout([{ label: 'zero', value: 0 }]).values[0]?.width).toBe(0);
    const layout = barLayout([{ label: 'negative', value: -Number.MAX_VALUE }, { label: 'positive', value: Number.MAX_VALUE }]);
    expect(layout).toEqual({ zero: 50, values: [{ left: 0, width: 50 }, { left: 50, width: 50 }] });
    expect(barLayout([{ label: 'fraction', value: .01 }]).values[0]?.width).toBe(100);
  });
});
describe('rich choices and sb-ui previews', () => {
  it('localizes request chrome and plural counts without changing agent content', () => {
    expect(t('genui.request.count', { count: 0 })).toBe('Nessuna scelta');
    expect(t('genui.request.count', { count: 1 })).toBe('1 scelta');
    setLang('en');
    expect(t('genui.request.question')).toBe('Question');
    expect(t('genui.request.enter')).toBe('Enter');
    expect(t('genui.request.count', { count: 2 })).toBe('2 choices');
    expect(t('genui.request.from', { kind: 'Question', title: 'A?' })).toBe('Question from a chat: A?');
    expect(richQuestion.questions![0]!.options[0]!.label).toBe('Correzione mirata (Consigliata)');
    expect(questionFixture('en').questions![0]!.options[0]!.label).toBe('Focused fix (Recommended)');
  });
  it('renders a separate disclosure, recommendation and multi-select semantics without submitting', () => {
    const choose = vi.fn();
    const html = renderToStaticMarkup(createElement(ChoiceCard, { option: richQuestion.questions![0]!.options[0]!, number: 1,
      recommended: true, multi: true, picked: true, onChoose: choose, testid: 'choice' }));
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('<details');
    expect(html).toContain('data-option-preview');
    expect(html.indexOf('</button>')).toBeLessThan(html.indexOf('<details'));
    expect(html).toContain('Vantaggi');
    expect(html).not.toContain('Riprogettazione');
    expect(choose).not.toHaveBeenCalled();
  });
  it('retains errors in malformed preview fences', () => {
    const html = renderToStaticMarkup(createElement(UiPreview, { text: '```sb-ui\n{"component":"unknown"}\n```' }));
    expect(html).toContain('preview-visual-bad');
  });
});
