// Review test (PR #29, code half A): «Discutine» on a Guida card has no in-flight guard. With an explainer agent in the
// catalog, two quick clicks (a double click, or a second click while chat:create is still on its way) each call
// createChat, so two agent chats are started for one intent (AgentStartDialog guards the same call with creating.current).
// GuidePage is rendered without a DOM: its function components are called with stubbed hooks and the stores mocked, then
// the Discutine button's onClick is fired twice. Expected: one chat. Fails today: two.
import { describe, expect, it, vi } from 'vitest';
import type * as React from 'react';
import type { ReactElement, ReactNode } from 'react';

const createChat = vi.fn(() => new Promise(res => setTimeout(() => res({ id: 'c_new' }), 20)));
const setDraft = vi.fn();

vi.mock('react', async importOriginal => {
  const real = await importOriginal<typeof React>();
  return {
    ...real,
    useId: () => 'id',
    useMemo: (f: () => unknown) => f(),
    useState: (init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, () => {}],
  };
});
vi.mock('../../../../src/renderer/styles/guide.css', () => ({}));
vi.mock('../../../../src/renderer/i18n', () => ({ lang: () => 'it', t: (k: string) => k }));
vi.mock('../../../../src/renderer/components/Icons', () => ({ IconChevronDown: () => null, IconChevronRight: () => null }));
vi.mock('../../../../src/renderer/components/ChatInput', () => ({ setDraft }));
vi.mock('../../../../src/renderer/actions', () => ({ brainBridge: { draftToRegia: vi.fn(() => true) }, focusChat: vi.fn(), regiaId: () => null }));
vi.mock('../../../../src/renderer/store/ui', () => ({ toast: vi.fn(), ui: { get: () => ({ prefs: { newChat: { cwd: null } } }) } }));
vi.mock('../../../../src/renderer/store/store', () => ({ app: { get: () => ({ info: { brainRoot: '/brain' } }) }, createChat }));
vi.mock('../../../../src/renderer/store/agents', () => ({
  useAgents: () => ({}),
  agents: { get: () => ({ catalog: {
    profiles: [{ id: 'agent-explainer', name: 'Explainer', role: 'Explainer', purpose: 'p', instructions: '', engine: 'claude', model: null, status: 'active' }],
    archived: [], problem: null,
    models: [{ engine: 'claude', enabled: true, trusted: true, installed: true, authenticated: true, defaultModel: true, modelSelectable: true, effort: true, models: [] }],
  } }) },
}));

/** Calls function components, collects host elements. */
function walk(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return out;
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as ReactElement<Record<string, unknown>>;
  if (typeof el.type === 'function') return walk((el.type as (p: unknown) => ReactNode)(el.props), out);
  out.push(el);
  walk(el.props?.children as ReactNode, out);
  return out;
}

describe('PR #29 GuidePage «Discutine»', () => {
  it('starts one explainer chat even when the button is clicked twice before chat:create answers', async () => {
    const { GuidePage } = await import('../../../../src/renderer/components/GuidePage');
    const els = walk(GuidePage());
    const btn = els.find(e => (e.props as Record<string, unknown>)['data-testid'] === 'guide-discuss-every-task-agent');
    expect(btn, 'Discutine button rendered').toBeTruthy();
    const click = (btn!.props as { onClick: () => void }).onClick;
    click(); click(); // double click
    await new Promise(r => setTimeout(r, 60));
    expect(createChat).toHaveBeenCalledTimes(1);
  });
});
