// A work map's buttons, pressed (plans/PlanView.tsx PlanButtons, PlanBits.tsx usePlanAction): they are only those of
// PlanInfo.can, each makes its own IPC call with the revision on screen, «Cambia il piano» opens the box and sends its
// words, a second press while one runs does nothing, a refusal is told and keeps the words; and the line that says what
// the state means (noteOf). React's hooks are replaced, no DOM.
import type * as React from 'react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanAction, PlanInfo } from '../../../src/shared/plan';

const hook = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], cursor: 0, refCursor: 0, toast: vi.fn() }));
vi.mock('react', async original => ({
  ...await original<typeof React>(),
  useState: (initial: unknown) => {
    const i = hook.cursor++;
    if (!(i in hook.values)) hook.values[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hook.values[i], (value: unknown) => { hook.values[i] = value; }];
  },
  useRef: (initial: unknown) => hook.refs[hook.refCursor++] ??= { current: initial },
  useEffect: () => {}, useLayoutEffect: () => {},
}));
vi.mock('../../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: () => () => {} } }));
vi.mock('../../../src/renderer/actions', () => ({ openChatRef: () => {}, openPlan: () => {} }));
vi.mock('../../../src/renderer/store/ui', () => ({ toast: hook.toast }));
vi.mock('../../../src/renderer/store/store', () => ({ useApp: () => undefined }));
import { noteOf, PlanButtons } from '../../../src/renderer/components/plans/PlanView';

const invoke = vi.fn(async (..._a: unknown[]) => ({}));
vi.stubGlobal('window', { sb: { invoke, on: () => () => {} } });

function walk(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(walk);
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...walk(el.props.children as ReactNode)];
}
let seq = 0;
const info = (can: PlanAction[], p: Partial<PlanInfo> = {}): PlanInfo => ({ id: `wm_m${++seq}`, title: 'M', state: 'toApprove', steps: 3, done: 0, now: 0, blocked: 0, partial: 0, check: 0, percent: 0, ready: 0, createdAt: 1, updatedAt: 1, planAt: 42, can, ...p });
const draw = (i: PlanInfo) => {
  hook.cursor = hook.refCursor = 0;
  const all = walk(PlanButtons({ info: i }) as ReactNode);
  return { ids: all.map(e => e.props['data-testid']).filter((x): x is string => typeof x === 'string'), at: (id: string) => all.find(e => e.props['data-testid'] === id)!.props, label: (id: string) => all.find(e => e.props['data-testid'] === id)!.props.children };
};
const press = (i: PlanInfo, a: string) => (draw(i).at(`pl-do-${a}`).onClick as () => void)();
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(() => { hook.values = []; hook.refs = []; hook.toast.mockReset(); invoke.mockReset().mockResolvedValue({}); });

describe('the buttons of a map', () => {
  it('are only those of PlanInfo.can', () => {
    expect(draw(info([])).ids).toEqual([]);
    hook.values = []; hook.refs = [];
    expect(draw(info(['approve', 'keep', 'replan', 'archive'])).ids).toEqual(['pl-actions', 'pl-do-approve', 'pl-do-keep', 'pl-do-replan', 'pl-do-archive']);
    hook.values = []; hook.refs = [];
    expect(draw(info(['seen', 'archive'], { state: 'finished' })).ids).toEqual(['pl-actions', 'pl-do-archive']);
  });
  it('approving and keeping for later are two buttons, and an idea\'s start is its plan', () => {
    const d = draw(info(['approve', 'keep']));
    expect([d.label('pl-do-approve'), d.label('pl-do-keep')]).toEqual(['Approva e parti', 'Approva, parti dopo']);
    hook.values = []; hook.refs = [];
    expect(draw(info(['start'], { state: 'planned' })).label('pl-do-start')).toBe('Parti');
    hook.values = []; hook.refs = [];
    expect(draw(info(['start'], { state: 'idea' })).label('pl-do-start')).toBe('Fai il piano');
  });
  it.each([['approve', { at: 42 }], ['keep', { at: 42 }], ['start', {}], ['stop', {}], ['resume', {}], ['archive', {}], ['reopen', {}]] as const)('%s calls its own IPC', async (a, args) => {
    const i = info([a]);
    press(i, a); await settle();
    expect(invoke.mock.calls).toEqual([[`plans:${a}`, { id: i.id, ...args }]]);
  });
  it('a second press while the first runs does nothing', async () => {
    let free = () => {}; invoke.mockImplementationOnce(() => new Promise(r => { free = () => r({}); }));
    const i = info(['approve', 'keep']);
    press(i, 'approve'); press(i, 'keep');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(draw(i).at('pl-do-keep').disabled).toBe(true);
    free(); await settle();
    expect(draw(i).at('pl-do-keep').disabled).toBe(false);
  });
  it('tells a refusal with its reason', async () => {
    invoke.mockRejectedValueOnce(new Error('Il piano è cambiato nel frattempo: rileggilo.'));
    press(info(['approve']), 'approve'); await settle();
    expect(hook.toast).toHaveBeenCalledWith('Approva e parti: Il piano è cambiato nel frattempo: rileggilo.', 'err');
  });
});

describe('changing the plan', () => {
  const write = (i: PlanInfo, v: string) => (draw(i).at('pl-replan-text').onChange as (e: unknown) => void)({ target: { value: v } });
  const send = (i: PlanInfo) => (draw(i).at('pl-replan').onSubmit as (e: unknown) => void)({ preventDefault() {} });
  it('opens its box first and sends the words', async () => {
    const i = info(['approve', 'replan']);
    expect(draw(i).ids).not.toContain('pl-replan');
    press(i, 'replan');
    expect(invoke).not.toHaveBeenCalled();
    expect(draw(i).at('pl-replan-send').disabled).toBe(true);
    write(i, ' Prima i test ');
    send(i); await settle();
    expect(invoke.mock.calls).toEqual([['plans:replan', { id: i.id, text: 'Prima i test' }]]);
    expect(draw(i).ids).not.toContain('pl-replan');
  });
  it('keeps the words after a refusal and when the user comes back', async () => {
    const i = info(['replan']);
    press(i, 'replan'); write(i, 'Togli il passo 2');
    invoke.mockRejectedValueOnce(new Error('no'));
    send(i); await settle();
    expect(draw(i).at('pl-replan-text').value).toBe('Togli il passo 2');
    hook.values = []; hook.refs = []; // left and opened again
    expect(draw(i).at('pl-replan-text').value).toBe('Togli il passo 2');
  });
  it('is not there when the map does not allow it', () => {
    const i = info(['replan']);
    press(i, 'replan'); write(i, 'x');
    expect(draw({ ...i, can: ['archive'] }).ids).toEqual(['pl-actions', 'pl-do-archive']);
  });
});

describe('what the state means', () => {
  it('says it in one line', () => {
    expect(noteOf(info([]))).toBe('Niente parte prima del tuo ok.');
    expect(noteOf(info([], { replanned: true }))).toContain('I passi già partiti vanno avanti');
    expect(noteOf(info([], { state: 'planned' }))).toContain('«Parti»');
    expect(noteOf(info([], { state: 'stopped', stopped: { at: 1, by: 'closed' } }))).toBe('La sua chat è stata chiusa.');
    expect(noteOf(info([], { state: 'idea' }))).toBe('Nessuno ci lavora ancora.');
    expect(noteOf(info([], { state: 'idea', planning: true }))).toContain('sta preparando');
    expect(noteOf(info([], { state: 'running', planning: true }))).toContain('sta cambiando');
    expect(noteOf(info([], { state: 'running' }))).toBeNull();
  });
});
