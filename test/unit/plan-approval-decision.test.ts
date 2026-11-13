// Exercise PlanApproval's actual handlers without a DOM: explicit refusal is a timestamp-bound change, never approval;
// free text, duplicate submissions, failed delivery retries and composing keyboard input preserve user intent.
import type * as React from 'react';
import type { ReactElement, ReactNode } from 'react';
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
type Choice = { onChoose: () => void; disabled?: boolean };
type Card = { busy?: boolean; yes: Choice; no: Choice; skip: Choice; write: { onSend: (text: string) => void; onDraft: (text: string) => void; initial?: string } };
/** PlanApproval's decision card (DecisionCard.tsx draws and keys it: decision-card.test.ts) */
const card = (): Card | null => {
  state.cursor = state.refCursor = 0;
  const el = PlanApproval({ ask: { type: 'plan', chatId: 'strategist', at: 42, id: 'plan@42' }, chatTitle: 'Example', onEscape: () => {}, testid: 'plan' }) as ReactElement<Record<string, unknown>> | null;
  return el ? el.props as unknown as Card : null;
};
const evidence = () => walk((PlanApproval({ ask: { type: 'plan', chatId: 'strategist', at: 42, id: 'plan@42' }, chatTitle: 'Example', onEscape: () => {}, testid: 'plan' }) as ReactElement<Record<string, unknown>>).props.children as ReactNode);

beforeEach(() => {
  state.values = []; state.refs = []; state.openFile.mockReset(); state.decide.mockReset().mockResolvedValue(true);
  plan = { phase: 'proposed', at: 42, clarified: [], steps: [{ title: 'Scope', state: 'todo' }] };
});
describe('PlanApproval decisions', () => {
  it('No needs no typing, requests a different plan and keeps the exact timestamp', () => {
    card()!.no.onChoose();
    expect(state.decide).toHaveBeenCalledWith('strategist', 'change', 42,
      'Non approvo questo piano. Non avviare i passi proposti. Proponi un piano diverso e chiedi di nuovo la mia approvazione.');
    expect(state.decide).toHaveBeenCalledTimes(1);
  });
  it('«Non voglio rispondere» never starts the plan', () => {
    card()!.skip.onChoose();
    expect(state.decide).toHaveBeenCalledWith('strategist', 'change', 42, expect.stringContaining('Non approvo questo piano'));
  });
  it('guards rapid duplicate clicks and restores the controls after a delivery refusal', async () => {
    state.decide.mockResolvedValueOnce(false);
    const handler = card()!.no.onChoose;
    handler(); handler();
    expect(state.decide).toHaveBeenCalledTimes(1);
    expect(card()!.busy).toBe(true);
    await Promise.resolve();
    expect(card()!.busy).toBe(false);
    card()!.yes.onChoose();
    expect(state.decide).toHaveBeenLastCalledWith('strategist', 'approve', 42, '');
  });
  it('free text cannot send an empty change', () => {
    card()!.write.onSend('  ');
    expect(state.decide).not.toHaveBeenCalled();
    card()!.write.onSend('Prima i test');
    expect(state.decide).toHaveBeenCalledWith('strategist', 'change', 42, 'Prima i test');
  });
  it('opens a report in the source chat viewer without making a plan decision', () => {
    plan.doneWhen = '[Report](file:///C:/reports/plan.md)';
    (evidence().find(el => el.props['data-testid'] === 'plan-link-0')!.props.onClick as () => void)();
    expect(state.openFile).toHaveBeenCalledWith('file:///C:/reports/plan.md', 'strategist');
    expect(state.decide).not.toHaveBeenCalled();
  });
  it('renders no decision for a replaced plan', () => {
    plan.at = 43;
    expect(card()).toBeNull();
    expect(state.decide).not.toHaveBeenCalled();
  });
  it('keeps an unsent alternative when the evidence viewer or queue remounts the same proposal', async () => {
    card()!.write.onDraft('Controlla il report prima');
    state.values = []; state.refs = [];
    expect(card()!.write.initial).toBe('Controlla il report prima');
    expect(state.decide).not.toHaveBeenCalled();
    card()!.write.onSend('Controlla il report prima');
    await Promise.resolve();
    state.values = []; state.refs = [];
    expect(card()!.write.initial).toBeUndefined();
  });
});
