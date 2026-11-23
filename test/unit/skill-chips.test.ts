// The skills on a Grindhouse card: Claude's from the run's tags, other engines' from the SKILL.md they read, else
// «uso non tracciato» (SkillChips.tsx skillChipsOf, main/agents/runs.ts skillOfRead and addSkill).
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: () => () => {} } }));
import type { AgentRun } from '../../src/shared/agents';
import { skillChipsOf } from '../../src/renderer/components/SkillChips';
import { addSkill, skillOfRead } from '../../src/main/agents/runs';

const run = (skills: string[]) => ({ tags: { skills, app: null, repo: null } }) as unknown as AgentRun;

describe('skillChipsOf', () => {
  it('shows the skills of a Claude run, at most three and the rest counted', () => {
    expect(skillChipsOf({ harness: 'claude', run: run(['a', 'b']) })).toEqual({ names: ['a', 'b'], more: 0, untracked: false });
    expect(skillChipsOf({ harness: 'claude', run: run(['a', 'b', 'c', 'd', 'e']) })).toEqual({ names: ['a', 'b', 'c'], more: 2, untracked: false });
  });
  it('says «uso non tracciato» for another engine with none recorded, nothing for Claude or a chat that is no run', () => {
    expect(skillChipsOf({ harness: 'codex', run: run([]) })).toEqual({ names: [], more: 0, untracked: true });
    expect(skillChipsOf({ harness: 'claude', run: run([]) })).toBeNull();
    expect(skillChipsOf({ harness: 'codex' })).toBeNull();
  });
  it('shows what another engine recorded from a SKILL.md read', () => {
    expect(skillChipsOf({ harness: 'cursor', run: run(['ops-core']) })?.untracked).toBe(false);
  });
});

describe('skillOfRead', () => {
  it('reads the skill name from a SKILL.md path, any slash and any engine field', () => {
    expect(skillOfRead({ file_path: 'C:\\Users\\x\\brain\\.agents\\skills\\ops-core\\SKILL.md' })).toBe('ops-core');
    expect(skillOfRead({ path: '/home/x/.claude/skills/code-work/SKILL.md' })).toBe('code-work');
    expect(skillOfRead({ uri: 'file:///c:/b/skills/air-qa/SKILL.md' })).toBe('air-qa');
  });
  it('ignores other files, references of a skill and non-objects', () => {
    expect(skillOfRead({ path: '/b/skills/ops-core/references/a.md' })).toBeNull();
    expect(skillOfRead({ path: '/b/readme.md' })).toBeNull();
    expect(skillOfRead('SKILL.md')).toBeNull();
    expect(skillOfRead(null)).toBeNull();
  });
  it('joins the run tags once through addSkill', () => {
    const r = run([]);
    expect(addSkill(r, skillOfRead({ path: '/b/skills/ops-core/SKILL.md' }))).toBe(true);
    expect(addSkill(r, skillOfRead({ path: '/b/skills/ops-core/SKILL.md' }))).toBe(false);
    expect(r.tags!.skills).toEqual(['ops-core']);
  });
});
