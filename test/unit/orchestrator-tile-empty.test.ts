// The Orchestrator's column before any Orchestrator exists (OrchestratorTile.tsx): the open questions of the other
// chats still have their rows there. A chat's own tile never shows its requests (lib/child-requests.ts requestHost),
// so without these rows a question asked before the Orchestrator was created had no place to be answered (2026-11-13).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: {} }));
vi.mock('../../src/renderer/store/store', () => ({ useApp: vi.fn(), ensureOrchestrator: vi.fn(), stop: vi.fn() }));
vi.mock('../../src/renderer/store/ui', () => ({ ui: { use: (fn: (s: unknown) => unknown) => fn({ focused: null, focusReq: null }) }, setFocused: vi.fn() }));
vi.mock('../../src/renderer/actions', () => ({ awaitingCard: () => false, clearOrchestratorNow: vi.fn(), go: vi.fn(), openMaps: vi.fn() }));
vi.mock('../../src/renderer/lib/pairs', () => ({ usePair: () => ({ cls: '' }), pairHover: () => ({}) }));
vi.mock('../../src/renderer/components/AwayToggle', () => ({ AwayButton: () => null, AwayLine: () => null }));
vi.mock('../../src/renderer/components/RemoteControl', () => ({ RemoteButton: () => null, RemoteLine: () => null }));
vi.mock('../../src/renderer/components/ChatItems', () => ({ ItemList: () => null, turnActivity: () => null, Typing: () => null }));
vi.mock('../../src/renderer/components/ChatInput', () => ({ ChatInput: () => null }));
vi.mock('../../src/renderer/components/ChatMenu', () => ({ ChatMenu: () => null, TitleInput: () => null }));
vi.mock('../../src/renderer/components/ModelChip', () => ({ ModelChip: () => null }));
vi.mock('../../src/renderer/components/AgentIdentity', () => ({ AgentIdentity: () => null }));
vi.mock('../../src/renderer/components/HelpTip', () => ({ HelpTip: () => null }));
vi.mock('../../src/renderer/components/AgentAvatar', () => ({ AgentAvatar: () => null }));
vi.mock('../../src/renderer/components/ChildStrips', () => ({ ChildStrips: () => null }));
vi.mock('../../src/renderer/components/MorningBlock', () => ({ MorningLine: () => null }));
vi.mock('../../src/renderer/components/brain-model/MaintenanceButton', () => ({ MaintenanceButton: () => null }));
vi.mock('../../src/renderer/components/ChatTile', () => ({ useFlash: () => false }));
vi.mock('../../src/renderer/components/StrategyPanel', () => ({ StrategyPanel: () => null }));
vi.mock('../../src/renderer/components/QuestionsWindow', () => ({ OrchestratorAsks: () => createElement('div', { 'data-testid': 'orchestrator-asks' }) }));
import { useApp } from '../../src/renderer/store/store';
import { OrchestratorTile } from '../../src/renderer/components/OrchestratorTile';

function render(ready: boolean) {
  const state = { chats: {}, items: {}, pending: [], ready, info: { brainRoot: 'C:/brain', engines: [] }, settings: { engineOn: {}, engines: {} } };
  vi.mocked(useApp).mockImplementation(selector => selector(state as unknown as Parameters<typeof selector>[0]));
  return renderToStaticMarkup(createElement(OrchestratorTile, { chatId: null }));
}

describe('the Orchestrator column with no Orchestrator yet', () => {
  it('shows the setup and, under it, the rows of the questions other chats ask', () => {
    const html = render(true);
    expect(html).toContain('data-testid="orchestrator-create"');
    expect(html.indexOf('data-testid="orchestrator-asks"')).toBeGreaterThan(html.indexOf('data-testid="orchestrator-create"'));
  });
  it('keeps the rows while the app is still loading', () => {
    expect(render(false)).toContain('data-testid="orchestrator-asks"');
  });
});
