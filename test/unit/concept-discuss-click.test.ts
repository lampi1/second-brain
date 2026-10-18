// Exercise the actual GuidePage click handler without a DOM: duplicate clicks must not spend two agent runs,
// and completion or a failed creation must release the guard so the user can try again.
import { expect, it, vi } from 'vitest';
import type * as React from 'react';
import type { ReactElement, ReactNode } from 'react';

const { createChat, setDraft, fallback } = vi.hoisted(() => ({ createChat: vi.fn(), setDraft: vi.fn(), fallback: vi.fn(() => true) }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useId: () => 'id',
  useMemo: (f: () => unknown) => f(),
  useState: (init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, () => {}],
}));
vi.mock('../../src/renderer/styles/guide.css', () => ({}));
vi.mock('../../src/renderer/i18n', () => ({ lang: () => 'it', t: (k: string) => k }));
vi.mock('../../src/renderer/components/Icons', () => ({ IconChevronDown: () => null, IconChevronRight: () => null }));
vi.mock('../../src/renderer/components/ChatInput', () => ({ setDraft }));
vi.mock('../../src/renderer/actions', () => ({ brainBridge: { draftToRegia: fallback }, focusChat: vi.fn(), regiaId: () => null }));
vi.mock('../../src/renderer/store/ui', () => ({ toast: vi.fn(), ui: { get: () => ({ prefs: { newChat: { cwd: null } } }) } }));
vi.mock('../../src/renderer/store/store', () => ({ app: { get: () => ({ info: { brainRoot: '/brain' } }) }, createChat }));
vi.mock('../../src/renderer/store/agents', () => ({
  useAgents: () => ({}),
  agents: { get: () => ({ catalog: {
    profiles: [{ id: 'explainer', name: 'Explainer', purpose: 'p', instructions: '', engine: 'claude', model: null, status: 'active' }],
    archived: [], problem: null,
    models: [{ engine: 'claude', enabled: true, trusted: true, installed: true, authenticated: true, defaultModel: true, modelSelectable: true, effort: true, models: [] }],
  } }) },
}));

function walk(node: ReactNode, out: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return out;
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as ReactElement<Record<string, unknown>>;
  if (typeof el.type === 'function') return walk((el.type as (p: unknown) => ReactNode)(el.props), out);
  out.push(el);
  walk(el.props?.children as ReactNode, out);
  return out;
}

it('creates one chat across rapid clicks and remounts, then permits another deliberate discussion', async () => {
  let finish!: (chat: { id: string } | null) => void;
  createChat.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { GuidePage } = await import('../../src/renderer/components/GuidePage');
  const click = () => {
    const button = walk(GuidePage()).find(e => e.props['data-testid'] === 'guide-discuss-every-task-agent')!;
    (button.props.onClick as () => void)();
  };
  click(); click();
  expect(createChat).toHaveBeenCalledTimes(1);
  finish({ id: 'new-chat' });
  await vi.waitFor(() => expect(setDraft).toHaveBeenCalledTimes(1));
  click(); click();
  expect(createChat).toHaveBeenCalledTimes(2);
  finish(null);
  await vi.waitFor(() => expect(fallback).toHaveBeenCalledTimes(1));
  click();
  expect(createChat).toHaveBeenCalledTimes(3);
  finish({ id: 'retry-chat' });
  await vi.waitFor(() => expect(setDraft).toHaveBeenCalledTimes(2));
});
