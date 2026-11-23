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
  });
  it('marks the skills the role loaded as «uso non tracciato» when the engine reports none (two shown, the rest counted)', () => {
    expect(skillChipsOf({ harness: 'codex', run: run([]), loadedSkills: ['code-work', 'air-qa'] })).toEqual({ names: ['code-work', 'air-qa'], more: 0, untracked: true });
    expect(skillChipsOf({ harness: 'cursor', run: run([]), loadedSkills: ['a', 'b', 'c', 'd'] })).toEqual({ names: ['a', 'b'], more: 2, untracked: true });
    // what the engine really read wins over the loaded list; Claude reports its own and never shows the mark
    expect(skillChipsOf({ harness: 'codex', run: run(['ops-core']), loadedSkills: ['code-work'] })).toEqual({ names: ['ops-core'], more: 0, untracked: false });
    expect(skillChipsOf({ harness: 'claude', run: run([]), loadedSkills: ['code-work'] })).toBeNull();
  });
  it('shows nothing extra for chats that are no run', () => {
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
  it('reads the engine-specific field names: Antigravity «Path», any letter case', () => {
    expect(skillOfRead({ Path: 'C:\\b\\skills\\air-qa\\SKILL.md' }, 'Read')).toBe('air-qa');
    expect(skillOfRead({ FilePath: '/b/skills/air-qa/SKILL.md' }, 'Read')).toBe('air-qa');
  });
  it('reads a skill a Shell command opens (Codex): cat, type, Get-Content, head, sed -n, also inside a shell wrapper', () => {
    const sh = (command: string) => skillOfRead({ command, cwd: '/b' }, 'Shell');
    expect(sh('cat /b/skills/ops-core/SKILL.md')).toBe('ops-core');
    expect(sh('/bin/bash -lc "cat /b/skills/ops-core/SKILL.md"')).toBe('ops-core');
    expect(sh('powershell.exe -Command "Get-Content -Raw \'C:\\b\\skills\\code-work\\SKILL.md\'"')).toBe('code-work');
    expect(sh('type C:\\b\\skills\\air-qa\\SKILL.md')).toBe('air-qa');
    expect(sh('head -n 40 /b/skills/wiz-pr/SKILL.md')).toBe('wiz-pr');
    expect(sh("sed -n '1,200p' /b/skills/urgente/SKILL.md")).toBe('urgente');
    expect(sh('cd /b && cat /b/skills/ops-core/SKILL.md')).toBe('ops-core');
  });
  it('never counts a mention that is no read: edit, delete, listing, grep, a write redirect, an edit tool', () => {
    const sh = (command: string) => skillOfRead({ command }, 'Shell');
    expect(sh('rm /b/skills/ops-core/SKILL.md')).toBeNull();
    expect(sh('Remove-Item C:\\b\\skills\\ops-core\\SKILL.md')).toBeNull();
    expect(sh('ls -la /b/skills/ops-core/SKILL.md')).toBeNull();
    expect(sh('grep -n foo /b/skills/ops-core/SKILL.md')).toBeNull();
    expect(sh('cat notes.txt > /b/skills/ops-core/SKILL.md')).toBeNull();
    expect(sh('cat a.md | tee /b/skills/ops-core/SKILL.md')).toBeNull();
    expect(sh('cat a.md && rm /b/skills/ops-core/SKILL.md')).toBeNull();
    expect(sh('cat notes.txt >/b/skills/ops-core/SKILL.md')).toBeNull();
    expect(sh('sed -i s/a/b/ /b/skills/ops-core/SKILL.md')).toBeNull();
    expect(sh('echo "see /b/skills/ops-core/SKILL.md"')).toBeNull();
    expect(skillOfRead({ file_path: '/b/skills/ops-core/SKILL.md' }, 'Edit')).toBeNull();
    expect(skillOfRead({ target_file: '/b/skills/ops-core/SKILL.md' }, 'Delete')).toBeNull();
    expect(skillOfRead({ command: 'cat /b/skills/ops-core/SKILL.md' }, 'Read')).toBeNull();
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
