// Which chat-endpoint tools a chat sees (src/main/chats/tool-visibility.ts, ChatManager.chatToolShown): the research's
// two tools only for the research, nothing of delegation for Lampo, the Orchestrator's own endpoint tools hidden.
import { describe, expect, it } from 'vitest';
import { toolShownToChat, toolShownToUnknown, toolShownToWarm } from '../../../src/main/chats/tool-visibility';

const chat = (o: Record<string, unknown> = {}): Parameters<typeof toolShownToChat>[0] => ({ isOrchestrator: false, parentId: null, ...o }) as never;

describe('tool visibility', () => {
  it('the research sees its two tools and no agent_* tool; nobody else sees them', () => {
    expect(toolShownToChat(chat({ research: true }), undefined, 'maintenance_propose')).toBe(true);
    expect(toolShownToChat(chat({ research: true }), undefined, 'agent_report')).toBe(false);
    expect(toolShownToChat(chat(), undefined, 'maintenance_pack')).toBe(false);
    expect(toolShownToUnknown('maintenance_pack')).toBe(false);
    expect(toolShownToUnknown('agent_report')).toBe(true);
  });
  it('the Orchestrator, Lampo, a root chat and a role that launches nobody', () => {
    expect(toolShownToChat(chat({ isOrchestrator: true }), undefined, 'agent_delegate')).toBe(false);
    expect(toolShownToChat(chat({ quick: true }), undefined, 'agent_children')).toBe(false);
    expect(toolShownToChat(chat(), undefined, 'agent_ask_parent')).toBe(false);
    expect(toolShownToChat(chat({ parentId: 'p' }), undefined, 'agent_ask_parent')).toBe(true);
    expect(toolShownToChat(chat(), [], 'agent_delegate')).toBe(false);
    expect(toolShownToChat(chat(), undefined, 'agent_delegate')).toBe(true);
    expect(toolShownToChat(chat(), undefined, 'plan_propose')).toBe(false);
  });
  it('a waiting engine sees what its role\'s root chat would', () => {
    expect(toolShownToWarm({ role: 'scout', launches: [] }, 'agent_delegate')).toBe(false);
    expect(toolShownToWarm({ role: 'strategist', launches: ['scout'] }, 'agent_delegate')).toBe(true);
    expect(toolShownToWarm({ role: 'scout', launches: null }, 'agent_ask_parent')).toBe(false);
    expect(toolShownToWarm({ role: 'scout', launches: null, child: { ancestors: [] } }, 'agent_ask_parent')).toBe(true);
  });
});
