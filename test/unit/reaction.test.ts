// Unit tests of shared/reaction.ts: which replies the chat view shows as a reaction, and the rule every role frame
// carries (main/agents/orchestrator-role.ts roleFrame), and the Orchestrator frame saying each thing once.
import { describe, expect, it } from 'vitest';
import { REACTION_RULE, isReaction } from '../../src/shared/reaction';
import { ORCHESTRATOR_ROLE, RETIRED_LINES, WAKE_RULE, orchestratorRole, roleFrame } from '../../src/main/agents/orchestrator-role';
import { PRE_ADR0100_INSTRUCTIONS } from '../../src/main/agents/role-migrate';
import { ROLE_DEFAULTS } from '../../src/shared/roles';
import { wakeMessage } from '../../src/main/chats/orchestrator-wake';

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
    expect(WAKE_RULE).toContain('write to the user only when they need it');
    expect(WAKE_RULE).toContain('reply 👍 and nothing else');
    expect(ORCHESTRATOR_ROLE).toContain(WAKE_RULE); // once per session, in the frame
    expect(wakeMessage([])).not.toContain('👍'); // not again in every wake
  });
});

describe('the Orchestrator frame says each thing once (owner, 2026-10-20)', () => {
  it('a catalog still holding the old shipped lines gets the current ones: no role list, no fast path twice', () => {
    const [oldCoordinate, oldRoles] = [...RETIRED_LINES.keys()];
    const rest = ROLE_DEFAULTS.orchestrator.instructions.split('\n').slice(2);
    const stored = [oldCoordinate, oldRoles, ...rest].join('\n');
    expect(orchestratorRole(stored)).toBe(orchestratorRole());
    expect(orchestratorRole()).not.toContain('The roles: strategist');
    expect(orchestratorRole().match(/task_estimate/g)).toHaveLength(1);
    // a line the user edited is kept as written
    expect(orchestratorRole(`${oldRoles} (mia nota)`)).toContain('(mia nota)');
  });
  it('the pre-ADR 0100 line that named the Router gets today\'s, also in a text the user edited elsewhere', () => {
    const lines = (PRE_ADR0100_INSTRUCTIONS.orchestrator ?? '').split('\n');
    expect(lines[1]).toMatch(/Router/);
    const stored = [`${lines[0]} (mia nota)`, ...lines.slice(1)].join('\n');
    expect(orchestratorRole(stored)).toContain('(mia nota)');
    expect(orchestratorRole(stored)).not.toMatch(/Router/);
  });
});
