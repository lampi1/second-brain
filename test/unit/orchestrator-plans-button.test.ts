// The plans button on the Orchestrator's head (ADR 0301): ADR 0287 removed it while cleaning the head and the
// user lost the way to the maps from where they talk to the Orchestrator. This renders the real head and fails if the
// button leaves it; a click opens the plans (openPlans, the same action as the top bar's button and Ctrl+Shift+S).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: {} }));
vi.mock('../../src/renderer/store/store', () => ({ useApp: vi.fn(), ensureOrchestrator: vi.fn(), stop: vi.fn() }));
vi.mock('../../src/renderer/lib/engines', () => ({ engineName: () => 'Claude Code', useEngines: () => [], useAllEngines: () => [] }));
vi.mock('../../src/renderer/store/ui', () => ({ ui: { use: (fn: (s: unknown) => unknown) => fn({ focused: null, focusReq: null }) }, setFocused: vi.fn() }));
vi.mock('../../src/renderer/actions', () => ({ awaitingCard: () => false, clearOrchestratorNow: vi.fn(), go: vi.fn(), openPlans: vi.fn() }));
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
import { openPlans } from '../../src/renderer/actions';
import { OrchestratorTile } from '../../src/renderer/components/OrchestratorTile';
import { PlansButton } from '../../src/renderer/components/PlansButton';

const chat = { id: 'o1', title: 'Orchestrator', harness: 'claude', status: 'idle', agent: { name: 'Orchestrator' }, createdAt: 0, updatedAt: 0 };
function render(extra: Record<string, unknown> = {}) {
  const state = { chats: { o1: chat, ...extra }, items: { o1: [] }, pending: [], ready: true, info: { brainRoot: 'C:/brain', engines: [] }, settings: { engineOn: {}, engines: {} } };
  vi.mocked(useApp).mockImplementation(selector => selector(state as unknown as Parameters<typeof selector>[0]));
  return renderToStaticMarkup(createElement(OrchestratorTile, { chatId: 'o1' }));
}

describe('the plans button on the Orchestrator', () => {
  it('is on the Orchestrator\'s head, with the maps shortcut', () => {
    const html = render();
    expect(html).toContain('orchestrator-name');
    const menu = html.indexOf('data-testid="orchestrator-menu"');
    expect(menu).toBeGreaterThan(0);
    const head = html.slice(0, menu);
    expect(head).toContain('data-testid="orchestrator-plans"');
  });
  it('shows «Stai aspettando» under the topics only for chats the user waits for (ADR 0367)', () => {
    expect(render()).not.toContain('data-testid="orchestrator-waiting"');
    const html = render({ w1: { id: 'w1', title: 'Controllo DB di test', state: 'running', pending: 0, userWait: { since: 1 } } });
    expect(html).toContain('data-testid="orchestrator-waiting"');
    expect(html).toContain('Controllo DB di test');
    expect(html.indexOf('data-testid="orchestrator-waiting"')).toBeGreaterThan(html.indexOf('data-testid="orchestrator-menu"'));
  });
  it('opens the maps on click, like the top bar\'s button', () => {
    const el = PlansButton({ testid: 'orchestrator-plans' }) as unknown as { props: { onClick: () => void; testid: string; shortcut: string } };
    expect(el.props.testid).toBe('orchestrator-plans');
    expect(el.props.shortcut).toBe('Ctrl+Shift+S');
    el.props.onClick();
    expect(openPlans).toHaveBeenCalledTimes(1);
  });
});
