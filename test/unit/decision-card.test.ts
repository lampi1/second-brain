// The decision card every question and approval uses (DecisionCard.tsx, ADR 0149): its keys (1 / S yes, 2 / N no,
// 3 / T write, Enter the recommended one, Esc later), a free-text answer that never sends empty, composed or repeated
// Enter, and nothing answered while it is busy or a key comes from a box. Without a DOM: React's state is mocked.
import type * as React from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], cursor: 0, refCursor: 0, mock: false }));
vi.mock('react', async original => {
  const real = await original<typeof React>();
  return {
    ...real,
    useState: (initial: unknown) => {
      if (!state.mock) return real.useState(initial);
      const i = state.cursor++;
      if (!(i in state.values)) state.values[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [state.values[i], (value: unknown) => { state.values[i] = value; }];
    },
    useRef: (initial: unknown) => (state.mock ? (state.refs[state.refCursor++] ??= { current: initial }) : real.useRef(initial)),
    useEffect: (f: () => void, d?: unknown[]) => (state.mock ? undefined : real.useEffect(f, d)),
  };
});
vi.mock('../../src/renderer/sb', () => ({ sb: {} }));
import { DecisionCard, type DecisionProps } from '../../src/renderer/components/DecisionCard';

type El = ReactElement<Record<string, unknown>>;
function walk(node: ReactNode): El[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(walk);
  const el = node as El;
  return [el, ...walk(el.props.children as ReactNode)];
}
const yes = vi.fn(), no = vi.fn(), send = vi.fn(), later = vi.fn(), skip = vi.fn();
const props = (over: Partial<DecisionProps> = {}): DecisionProps => ({
  testBase: 'd', head: 'Artisan', question: 'Faccio il merge?', ifYes: 'Va su main', ifNo: 'Resta sul branch',
  yes: { onChoose: yes, recommended: true, testid: 'd-yes' }, no: { onChoose: no, testid: 'd-no' },
  write: { onSend: send }, skip: { onChoose: skip, hint: 'decide l’agente' }, onLater: later, ...over,
});
const render = (p = props()) => {
  state.cursor = state.refCursor = 0;
  return walk((DecisionCard as unknown as { render: (p: DecisionProps, r: null) => ReactNode }).render(p, null));
};
const root = (p?: DecisionProps) => render(p)[0]!;
const key = (k: string, over: Record<string, unknown> = {}) => ({ key: k, target: { tagName: 'DIV', closest: () => null }, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over });
const press = (k: string, over: Record<string, unknown> = {}, p?: DecisionProps) => (root(p).props.onKeyDown as (e: unknown) => void)(key(k, over));
const byId = (id: string) => render().find(el => el.props['data-testid'] === id)!;

beforeEach(() => {
  state.values = []; state.refs = []; state.mock = true;
  for (const f of [yes, no, send, later, skip]) f.mockReset();
});

describe('DecisionCard', () => {
  it('answers with its keys: 1 / S yes, 2 / N no, Enter the recommended one, Esc later', () => {
    press('s'); press('1'); press('y');
    expect(yes).toHaveBeenCalledTimes(3);
    press('n'); press('2');
    expect(no).toHaveBeenCalledTimes(2);
    press('Enter');
    expect(yes).toHaveBeenCalledTimes(4);
    press('Escape');
    expect(later).toHaveBeenCalledTimes(1);
    press('Enter', { repeat: true });
    press('s', { ctrlKey: true });
    press('s', { target: { tagName: 'TEXTAREA', closest: () => null } });
    press('s', { target: { tagName: 'DIV', closest: () => ({}) } }); // a visual or a command inside keeps its keys
    expect(yes).toHaveBeenCalledTimes(4);
  });

  it('Enter does nothing without a recommended answer; nothing answers while busy', () => {
    press('Enter', {}, props({ yes: { onChoose: yes }, no: { onChoose: no } }));
    expect(yes).not.toHaveBeenCalled();
    press('s', {}, props({ busy: true }));
    (render(props({ busy: true })).find(el => el.props['data-testid'] === 'd-yes')!.props.onClick as () => void)();
    expect(yes).not.toHaveBeenCalled();
  });

  it('a disabled answer is never chosen by key or click', () => {
    const p = props({ yes: { onChoose: yes, disabled: true, testid: 'd-yes' } });
    press('s', {}, p);
    (render(p).find(el => el.props['data-testid'] === 'd-yes')!.props.onClick as () => void)();
    expect(yes).not.toHaveBeenCalled();
  });

  it('T opens the free-text box; it never sends empty, composed or repeated Enter', () => {
    press('t');
    const input = () => byId('d-other-input');
    expect(input()).toBeDefined();
    const onKey = () => input().props.onKeyDown as (e: unknown) => void;
    onKey()(key('Enter'));
    expect(send).not.toHaveBeenCalled();
    (input().props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'Prima i test' } });
    for (const over of [{ nativeEvent: { isComposing: true } }, { repeat: true }, { shiftKey: true }]) onKey()(key('Enter', over));
    expect(send).not.toHaveBeenCalled();
    onKey()(key('Enter'));
    expect(send).toHaveBeenCalledWith('Prima i test');
  });

  it('draws who asks, the question, the evidence, what Sì / No do and the four answers', () => {
    state.mock = false;
    const html = renderToStaticMarkup(createElement(DecisionCard, props({ children: createElement('p', null, 'Ho corretto il bottone') })));
    for (const text of ['Artisan', 'Faccio il merge?', 'Ho corretto il bottone', 'Se Sì', 'Va su main', 'Se No', 'Resta sul branch', 'Sì', 'No', 'Consigliata', 'Scrivi una risposta…', 'Non voglio rispondere', 'Ci penso dopo']) expect(html).toContain(text);
    expect(html.indexOf('Faccio il merge?')).toBeLessThan(html.indexOf('Ho corretto il bottone'));
    expect(html.indexOf('Ho corretto il bottone')).toBeLessThan(html.indexOf('d-yes'));
    expect(renderToStaticMarkup(createElement(DecisionCard, props({ laterButton: false })))).not.toContain('Ci penso dopo');
  });
});
