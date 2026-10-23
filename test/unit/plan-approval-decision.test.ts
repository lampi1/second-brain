// Exercise PlanApproval's actual handlers without a DOM: explicit refusal is a timestamp-bound change, never approval;
// free text, duplicate submissions, failed delivery retries and composing keyboard input preserve user intent.
import type * as React from 'react';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StrategyPlan } from '../../src/shared/strategy';

const state = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], cursor: 0, refCursor: 0, decide: vi.fn(), openFile: vi.fn() }));
vi.mock('react', async original => ({
  ...await original<typeof React>(),
  useState: (initial: unknown) => {
    const i = state.cursor++;
    if (!(i in state.values)) state.values[i] = initial;
    return [state.values[i], (value: unknown) => { state.values[i] = value; }];
  },
  useRef: (initial: unknown) => state.refs[state.refCursor++] ??= { current: initial },
  useEffect: () => {}, useLayoutEffect: () => {},
}));
vi.mock('../../src/renderer/components/GenUi', () => ({ openFile: state.openFile }));
vi.mock('../../src/renderer/actions', () => ({ claimFocus: () => false }));
vi.mock('../../src/renderer/sb', () => ({ sb: {} }));
let plan: StrategyPlan;
vi.mock('../../src/renderer/store/store', () => ({
  planDecide: state.decide,
  useApp: (pick: (app: { chats: Record<string, { plan: StrategyPlan }> }) => unknown) => pick({ chats: { strategist: { plan } } }),
}));
import { PlanApproval } from '../../src/renderer/components/PlanApproval';

function walk(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(walk);
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...walk(el.props.children as ReactNode)];
}
const render = () => {
  state.cursor = state.refCursor = 0;
  return walk(PlanApproval({ ask: { type: 'plan', chatId: 'strategist', at: 42, id: 'plan@42' }, chatTitle: 'Example', onEscape: () => {}, testid: 'plan' }));
};
const get = (id: string) => render().find(el => el.props['data-testid'] === `plan-${id}`)!;
const click = (id: string) => (get(id).props.onClick as () => void)();
const key = (overrides: Record<string, unknown> = {}) => ({ key: 'Enter', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides });

beforeEach(() => {
  state.values = []; state.refs = []; state.openFile.mockReset(); state.decide.mockReset().mockResolvedValue(true);
  plan = { phase: 'proposed', at: 42, clarified: [], steps: [{ title: 'Scope', state: 'todo' }] };
});
describe('PlanApproval decisions', () => {
  it('No needs no typing, requests a different plan and keeps the exact timestamp', () => {
    click('reject');
    expect(state.decide).toHaveBeenCalledWith('strategist', 'change', 42,
      'Non approvo questo piano. Non avviare i passi proposti. Proponi un piano diverso e chiedi di nuovo la mia approvazione.');
    expect(state.decide).toHaveBeenCalledTimes(1);
  });
  it('guards rapid duplicate clicks and restores the controls after a delivery refusal', async () => {
    state.decide.mockResolvedValueOnce(false);
    const handler = get('reject').props.onClick as () => void;
    handler(); handler();
    expect(state.decide).toHaveBeenCalledTimes(1);
    expect(get('approve').props.disabled).toBe(true);
    await Promise.resolve();
    expect(get('approve').props.disabled).toBe(false);
    click('approve');
    expect(state.decide).toHaveBeenLastCalledWith('strategist', 'approve', 42, '');
  });
  it('free text is optional to open but cannot send an empty change', () => {
    click('change');
    expect(get('change-send').props.disabled).toBe(true);
    click('change-send');
    expect(state.decide).not.toHaveBeenCalled();
    (get('change-text').props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'Prima i test' } });
    click('change-send');
    expect(state.decide).toHaveBeenCalledWith('strategist', 'change', 42, 'Prima i test');
  });
  it('does not submit composed, repeated or modified Enter from the alternative', () => {
    click('change');
    (get('change-text').props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'Prima i test' } });
    const onKey = get('change-text').props.onKeyDown as (e: KeyboardEvent<HTMLTextAreaElement>) => void;
    for (const overrides of [{ nativeEvent: { isComposing: true } }, { repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
      onKey(key(overrides) as unknown as KeyboardEvent<HTMLTextAreaElement>);
    }
    expect(state.decide).not.toHaveBeenCalled();
    onKey(key() as unknown as KeyboardEvent<HTMLTextAreaElement>);
    expect(state.decide).toHaveBeenCalledTimes(1);
  });
  it('opens a report in the source chat viewer without making a plan decision', () => {
    plan.doneWhen = '[Report](file:///C:/reports/plan.md)';
    click('link-0');
    expect(state.openFile).toHaveBeenCalledWith('file:///C:/reports/plan.md', 'strategist');
    expect(state.decide).not.toHaveBeenCalled();
  });
  it('renders no decision for a replaced plan', () => {
    plan.at = 43;
    expect(render()).toEqual([]);
    expect(state.decide).not.toHaveBeenCalled();
  });
  it('keeps an unsent alternative when the evidence viewer or queue remounts the same proposal', async () => {
    click('change');
    (get('change-text').props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'Controlla il report prima' } });
    state.values = []; state.refs = [];
    expect(get('change-text').props.value).toBe('Controlla il report prima');
    expect(state.decide).not.toHaveBeenCalled();
    click('change-send');
    await Promise.resolve();
    state.values = []; state.refs = [];
    expect(get('change')).toBeDefined();
    click('change');
    expect(get('change-text').props.value).toBe('');
  });

});
