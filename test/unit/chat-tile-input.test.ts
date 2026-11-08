// Render the real tile's composition boundary: onboarding and user chats can reply; worker inspection cannot compose.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
vi.mock('../../src/renderer/sb', () => ({ sb: {} }));
vi.mock('../../src/renderer/store/store', () => ({ useApp: vi.fn(), closeChat: vi.fn(), send: vi.fn(), stop: vi.fn() }));
vi.mock('../../src/renderer/store/ui', () => ({ ui: { use: (fn: (s: unknown) => unknown) => fn({ prefs: { chatExpanded: {}, treeCollapsed: {}, browserOpen: {} }, closing: [] }) }, setFocused: vi.fn(), setChatExpanded: vi.fn() }));
vi.mock('../../src/renderer/actions', () => ({ admitNow: vi.fn(), reqKey: vi.fn(), toggleMaximize: vi.fn() }));
vi.mock('../../src/renderer/lib/later', () => ({ openQueue: vi.fn(), requestPostponed: () => false }));
vi.mock('../../src/renderer/lib/clock', () => ({ useNow: () => 1000 }));
vi.mock('../../src/renderer/lib/pairs', () => ({ usePair: () => ({ cls: '' }), pairHover: () => ({}) }));
vi.mock('../../src/renderer/lib/child-requests', () => ({ childRequestsFor: () => [], requestHost: () => null }));
vi.mock('../../src/renderer/components/ChatInput', () => ({ ChatInput: ({ testid }: { testid: string }) => createElement('textarea', { 'data-testid': testid }), setDraft: vi.fn() }));
vi.mock('../../src/renderer/components/ChatTranscript', () => ({ ChatTranscript: () => null }));
vi.mock('../../src/renderer/components/ChatMenu', () => ({ ChatMenu: () => null, TitleInput: () => null }));
vi.mock('../../src/renderer/components/ContextBar', () => ({ ChatLinks: () => null, ContextMeter: () => null, ContextNotice: () => null, useWarnTokens: () => 200000 }));
vi.mock('../../src/renderer/components/AutoCloseNotice', () => ({ AutoCloseNotice: () => null }));
vi.mock('../../src/renderer/components/RunSurface', () => ({ RunChips: () => null, RunOutcomeControl: () => null }));
vi.mock('../../src/renderer/components/RunEstimate', () => ({ StripEstimate: () => null }));
vi.mock('../../src/renderer/components/StrategyPanel', () => ({ StrategyPanel: () => null }));
vi.mock('../../src/renderer/components/ChatLinkChips', () => ({ ChatLinkChips: () => null }));
vi.mock('../../src/renderer/components/StripActivity', () => ({ StripActivity: () => null }));
vi.mock('../../src/renderer/components/QuestionsWindow', () => ({ InWindowLine: () => null }));
import { useApp } from '../../src/renderer/store/store';
import { ChatTile } from '../../src/renderer/components/ChatTile';
import { setLang } from '../../src/renderer/i18n';

function render(startedBy?: 'user' | 'orchestrator' | 'parent' | 'app') {
  const chat = { id: 'guide', title: 'First interview', cwd: '', state: 'idle', harness: 'claude', lastText: '',
    ...(startedBy ? { run: { runId: 'r1', startedBy, goal: 'Continue', counters: { reopened: 0 } } } : {}) } as ChatSummary;
  vi.mocked(useApp).mockImplementation(selector => selector({ chats: { guide: chat }, pending: [], tabs: [] } as unknown as Parameters<typeof selector>[0]));
  setLang('en');
  try { return renderToStaticMarkup(createElement(ChatTile, { chatId: 'guide', embedded: true })); }
  finally { setLang('it'); }
}

describe('chat tile input', () => {
  it('the first-run guide without a task run can receive an answer', () => {
    expect(render()).toContain('data-testid="chat-input-guide"');
  });
  it('a user-started chat keeps its input and Continue action', () => {
    const html = render('user');
    expect(html).toContain('data-testid="chat-input-guide"');
    expect(html).toContain('>Continue here</button>');
  });
  it.each(['orchestrator', 'parent', 'app'] as const)('a %s worker has no input or dead Continue action', startedBy => {
    const html = render(startedBy);
    expect(html).not.toContain('data-testid="chat-input-guide"');
    expect(html).not.toContain('>Continue here</button>');
  });
});
