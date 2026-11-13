// Exercise the actual GuidePage «Discuti» click handler without a DOM: the card goes to the Orchestrator's input as a
// ready message and no work chat is ever created; without an Orchestrator the user is told how to start one.
import { beforeEach, expect, it, vi } from 'vitest';
import type * as React from 'react';
import type { ReactElement, ReactNode } from 'react';

const { createChat, toast, draft } = vi.hoisted(() => ({ createChat: vi.fn(), toast: vi.fn(), draft: vi.fn((_text: string, _sent: () => void) => true) }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useId: () => 'id',
  useMemo: (f: () => unknown) => f(),
  useState: (init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, () => {}],
  // the page's data load (guide:stale, «Per te»: ADR 0196) needs the bridge; without a DOM it never runs
  useEffect: () => {},
}));
vi.mock('../../src/renderer/styles/guide.css', () => ({}));
vi.mock('../../src/renderer/i18n', () => ({ lang: () => 'it', t: (k: string) => k }));
vi.mock('../../src/renderer/components/Icons', () => ({ IconChevronDown: () => null, IconChevronRight: () => null, IconSparkle: () => null }));
vi.mock('../../src/renderer/actions', () => ({ brainBridge: { draftToOrchestrator: draft } }));
vi.mock('../../src/renderer/store/ui', () => ({ toast }));
vi.mock('../../src/renderer/store/store', () => ({ createChat }));

function walk(node: ReactNode, out: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return out;
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as ReactElement<Record<string, unknown>>;
  if (typeof el.type === 'function') return walk((el.type as (p: unknown) => ReactNode)(el.props), out);
  out.push(el);
  walk(el.props?.children as ReactNode, out);
  return out;
}
const click = async () => {
  const { GuidePage } = await import('../../src/renderer/components/GuidePage');
  const button = walk(GuidePage()).find(e => e.props['data-testid'] === 'guide-discuss-every-task-agent')!;
  (button.props.onClick as () => void)();
};
beforeEach(() => { createChat.mockReset(); toast.mockReset(); draft.mockClear(); });

it('puts the card in the Orchestrator input and creates no work chat', async () => {
  await click();
  expect(draft).toHaveBeenCalledTimes(1);
  expect(draft.mock.calls[0]![0]).toContain('Ogni compito passa da un ruolo');
  expect(toast).toHaveBeenCalledWith('guide.toOrchestrator', 'ok');
  expect(createChat).not.toHaveBeenCalled();
});

it('says how to start the Orchestrator when none is open', async () => {
  draft.mockReturnValueOnce(false);
  await click();
  expect(toast).toHaveBeenCalledWith('guide.noOrchestrator', 'warn');
  expect(createChat).not.toHaveBeenCalled();
});
