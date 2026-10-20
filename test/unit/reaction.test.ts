// Unit tests of shared/reaction.ts: which replies the chat view shows as a reaction, and the rule every role frame
// carries (main/agents/orchestrator-role.ts roleFrame).
import { describe, expect, it } from 'vitest';
import { REACTION_RULE, isReaction } from '../../src/shared/reaction';
import { ORCHESTRATOR_ROLE, roleFrame } from '../../src/main/agents/orchestrator-role';
import { WAKE_ASK } from '../../src/main/chats/orchestrator-wake';

describe('isReaction', () => {
  it('takes one or two emoji, with skin tones and joiners', () => {
    for (const t of ['👍', ' 👍 ', '✅', '👍🏽', '🙏🎉', '❤️', '👨‍💻']) expect(isReaction(t)).toBe(true);
  });
  it('never takes text, digits, three emoji or an empty reply', () => {
    for (const t of ['', 'ok', '👍 fatto', 'Fatto 👍', '1', '#', '👍👍👍', '**👍**']) expect(isReaction(t)).toBe(false);
  });
});

describe('the rule in every frame', () => {
  it('is in a work role frame and in the Orchestrator frame', () => {
    expect(roleFrame('Scout', 'cerca')).toContain(REACTION_RULE);
    expect(ORCHESTRATOR_ROLE).toContain(REACTION_RULE);
  });
});

describe('the Orchestrator speaks only when it is useful (owner, 2026-10-20)', () => {
  it('its rules ask for short replies and reactions, never at the cost of a due result', () => {
    expect(ORCHESTRATOR_ROLE).toContain('Be brief and quick');
    expect(ORCHESTRATOR_ROLE).toContain('never restate or paraphrase it'); // a chat\'s result is read in that chat
    expect(ORCHESTRATOR_ROLE).not.toMatch(/Tell the user the estimate/); // #113: the agents view shows it
    expect(ORCHESTRATOR_ROLE).toContain('Do not write the estimate in your reply');
    expect(ORCHESTRATOR_ROLE).toContain('Brevity never drops a result, a blocker or a question that is due.');
  });
  it('the app\'s news asks for a line only when the user needs it, else one emoji', () => {
    expect(WAKE_ASK).toContain('solo se gli serve saperlo');
    expect(WAKE_ASK).toContain('rispondi solo 👍');
  });
});
