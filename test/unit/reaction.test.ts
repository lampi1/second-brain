// Unit tests of shared/reaction.ts: which replies the chat view shows as a reaction, and the rule every role frame
// carries (main/agents/orchestrator-role.ts roleFrame).
import { describe, expect, it } from 'vitest';
import { REACTION_RULE, isReaction } from '../../src/shared/reaction';
import { ORCHESTRATOR_ROLE, roleFrame } from '../../src/main/agents/orchestrator-role';

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
