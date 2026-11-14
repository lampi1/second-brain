// Render the real tile's input: every chat can be written to, delegated workers too (the owner, 2026-11-10: «permettimi
// anche di scrivere ad ogni agente»); the Orchestrator stays the usual way.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
vi.mock('../../src/renderer/sb', () => ({ sb: {} }));
vi.mock('../../src/renderer/store/store', () => ({ useApp: vi.fn(), closeChat: vi.fn(), send: vi.fn(), stop: vi.fn() }));
vi.mock('../../src/renderer/store/ui', () => ({ ui: { use: (fn: (s: unknown) => unknown) => fn({ prefs: { chatExpanded: {}, treeCollapsed: {}, agentView: {}, agentSplit: {} }, closing: [] }) }, setFocused: vi.fn(), setChatExpanded: vi.fn(), setAgentView: vi.fn(), setAgentSplit: vi.fn(), DEFAULT_SPLIT: 0.42 }));
vi.mock('../../src/renderer/lib/run-estimates', () => ({ useRunEstimates: () => null }));
vi.mock('../../src/renderer/lib/viewports', () => ({ schedule: vi.fn(), suspendViews: vi.fn() }));
vi.mock('../../src/renderer/store/handoffs', () => ({ useHandoffTabs: () => [] }));
vi.mock('../../src/renderer/components/BrowserTile', () => ({ BrowserTile: () => null }));
vi.mock('../../src/renderer/components/FullTools', () => ({ FullTools: () => null }));
vi.mock('../../src/renderer/actions', () => ({ admitNow: vi.fn(), reqKey: vi.fn(), toggleMaximize: vi.fn() }));
vi.mock('../../src/renderer/lib/later', () => ({ openQueue: vi.fn(), requestPostponed: () => false }));
vi.mock('../../src/renderer/lib/clock', () => ({ useNow: () => 1000 }));
vi.mock('../../src/renderer/lib/child-requests', () => ({ childRequestsFor: () => [], requestHost: () => null }));
vi.mock('../../src/renderer/components/ChatInput', () => ({ ChatInput: ({ testid }: { testid: string }) => createElement('textarea', { 'data-testid': testid }), setDraft: vi.fn() }));
vi.mock('../../src/renderer/components/ChatTranscript', () => ({ ChatTranscript: () => null }));
vi.mock('../../src/renderer/components/ChatMenu', () => ({ ChatMenu: () => null, TitleInput: () => null }));
vi.mock('../../src/renderer/components/ContextBar', () => ({ ChatLinks: () => null, ContextMeter: () => null, ContextNotice: () => null, isLong: () => false, useWarnTokens: () => 200000 }));
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
  it.each(['orchestrator', 'parent', 'app'] as const)('a %s worker keeps its input and Continue action', startedBy => {
    const html = render(startedBy);
    expect(html).toContain('data-testid="chat-input-guide"');
    expect(html).toContain('>Continue here</button>');
  });
});

describe('chat strip head', () => {
  it('a collapsed strip is one line: the agent name, then what the chat is about', () => {
    const chat = { id: 'w', title: 'AI-DLC · U5 verifica', cwd: '', state: 'idle', harness: 'claude', lastText: '',
      agent: { id: 'artisan', name: 'Artisan' } } as unknown as ChatSummary;
    vi.mocked(useApp).mockImplementation(selector => selector({ chats: { w: chat }, pending: [], tabs: [] } as unknown as Parameters<typeof selector>[0]));
    const html = renderToStaticMarkup(createElement(ChatTile, { chatId: 'w' }));
    expect(html).toMatch(/Artisan<\/button>.*<span class="strip-now"[^>]*><span class="th-topic"[^>]*>AI-DLC · U5 verifica<\/span>/);
    // the noise is gone (ADR 0287): no close cross, no help mark on a strip
    expect(html).not.toContain('chat-x-w'); expect(html).not.toContain('chat-help-w');
  });
  it('a closed strip says the task and the state; the rest is the tip of its mark and of the task (ADR 0307)', () => {
    const chat = { id: 'w', title: 'AI-DLC · U5 verifica', cwd: '', state: 'idle', harness: 'claude', model: 'claude-opus-5-5', costUsd: 0.5, lastText: '',
      agent: { id: 'artisan', name: 'Artisan' } } as unknown as ChatSummary;
    vi.mocked(useApp).mockImplementation(selector => selector({ chats: { w: chat }, pending: [], tabs: [] } as unknown as Parameters<typeof selector>[0]));
    const html = renderToStaticMarkup(createElement(ChatTile, { chatId: 'w' }));
    const tip = /data-tip="(AI-DLC · U5 verifica\|[^"]*Opus 5\.5[^"]*)"/.exec(html)?.[1];
    expect(tip).toBeDefined();
    expect(html).toContain(`data-tip="${tip}" data-testid="chat-info-w"`);            // on the mark
    expect(html).toContain(`<span class="strip-now" data-tip="${tip}">`);              // and on the task's text
    expect(html).not.toMatch(/class="th-topic" title=/);                               // no native tooltip beside it
    expect(html).not.toContain('chat-meta-w'); expect(html).not.toContain('strip-model-w'); // no figures on the row
  });
  it('the full screen keeps the figures on its bar, with no mark', () => {
    const chat = { id: 'w', title: 'AI-DLC · U5 verifica', cwd: '', state: 'idle', harness: 'claude', model: 'claude-opus-5-5', costUsd: 0.5, lastText: '',
      agent: { id: 'artisan', name: 'Artisan' } } as unknown as ChatSummary;
    vi.mocked(useApp).mockImplementation(selector => selector({ chats: { w: chat }, pending: [], tabs: [] } as unknown as Parameters<typeof selector>[0]));
    const html = renderToStaticMarkup(createElement(ChatTile, { chatId: 'w', focus: true }));
    expect(html).toContain('strip-model-w');
    expect(html).not.toContain('chat-info-w');
    expect(html).not.toMatch(/class="strip-now" data-tip=/);
  });
  it('a chat that is gone renders nothing (every hook runs before that return)', () => {
    vi.mocked(useApp).mockImplementation(selector => selector({ chats: {}, pending: [], tabs: [] } as unknown as Parameters<typeof selector>[0]));
    expect(renderToStaticMarkup(createElement(ChatTile, { chatId: 'w' }))).toBe('');
  });
});
