// Which chat-endpoint tools a chat sees (src/main/chats/tool-visibility.ts, ChatManager.chatToolShown): the research's
// two tools only for the research, the Orchestrator's own endpoint tools hidden.
import { describe, expect, it } from 'vitest';
import { toolShownToChat, toolShownToUnknown, toolShownToWarm } from '../../../src/main/chats/tool-visibility';
import { appAsks } from '../../../src/main/engines/registry';

const chat = (o: Record<string, unknown> = {}): Parameters<typeof toolShownToChat>[0] => ({ isOrchestrator: false, parentId: null, ...o }) as never;

describe('tool visibility', () => {
  it('the research sees its two tools and no agent_* tool; nobody else sees them', () => {
    expect(toolShownToChat(chat({ research: true }), undefined, 'maintenance_propose')).toBe(true);
    expect(toolShownToChat(chat({ research: true }), undefined, 'agent_report')).toBe(false);
    expect(toolShownToChat(chat(), undefined, 'maintenance_pack')).toBe(false);
    expect(toolShownToUnknown('maintenance_pack')).toBe(false);
    expect(toolShownToUnknown('agent_report')).toBe(true);
  });
  it('the Orchestrator, a root chat and a role that launches nobody', () => {
    expect(toolShownToChat(chat({ isOrchestrator: true }), undefined, 'agent_delegate')).toBe(false);
    expect(toolShownToChat(chat(), undefined, 'agent_ask_parent')).toBe(false);
    expect(toolShownToChat(chat({ parentId: 'p' }), undefined, 'agent_ask_parent')).toBe(true);
    expect(toolShownToChat(chat(), [], 'agent_delegate')).toBe(false);
    expect(toolShownToChat(chat(), undefined, 'agent_delegate')).toBe(true);
    expect(toolShownToChat(chat(), undefined, 'plan_propose')).toBe(false);
  });
  it('ask_user only for a chat on an ACP engine (OpenCode, Cursor), Orchestrator included', () => {
    expect(toolShownToChat(chat(), undefined, 'ask_user')).toBe(false);
    expect(toolShownToChat(chat(), undefined, 'ask_user', true)).toBe(true);
    expect(toolShownToChat(chat({ isOrchestrator: true }), undefined, 'ask_user', true)).toBe(true);
    expect(toolShownToChat(chat({ research: true }), undefined, 'ask_user', true)).toBe(false);
    expect(toolShownToUnknown('ask_user')).toBe(false);
    expect(toolShownToWarm({ role: 'strategist', launches: ['scout'] }, 'ask_user')).toBe(false);
    // which engines: every ACP engine; Cursor too, whose AskQuestion its ACP sessions do not offer the model (real
    // run 2026-10-31: «The AskQuestion tool is unavailable»); never Claude or Codex
    expect([appAsks({ kind: 'acp' }), appAsks({ kind: 'acp', cursorExtras: true }), appAsks({ kind: 'claude' }), appAsks({ kind: 'codex' }), appAsks(null)]).toEqual([true, true, false, false, false]);
  });
  it('a waiting engine sees what its role\'s root chat would', () => {
    expect(toolShownToWarm({ role: 'scout', launches: [] }, 'agent_delegate')).toBe(false);
    expect(toolShownToWarm({ role: 'strategist', launches: ['scout'] }, 'agent_delegate')).toBe(true);
    expect(toolShownToWarm({ role: 'scout', launches: null }, 'agent_ask_parent')).toBe(false);
    expect(toolShownToWarm({ role: 'scout', launches: null, child: { ancestors: [] } }, 'agent_ask_parent')).toBe(true);
  });
});
