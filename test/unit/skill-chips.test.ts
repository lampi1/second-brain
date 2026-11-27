// The skills of a Grindhouse strip, in its ⓘ (ADR 0366): Claude's from the run's tags, other engines' from the SKILL.md
// they read, else the ones the role loaded marked «uso non tracciato» (GrindStrip.tsx infoLines, main/agents/runs.ts
// skillOfRead and addSkill).
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: () => () => {} } }));
import type { AgentRun } from '../../src/shared/agents';
import { infoLines } from '../../src/renderer/components/GrindStrip';
import { addSkill, skillOfRead } from '../../src/main/agents/runs';

const run = (skills: string[]) => ({ tags: { skills, app: null, repo: null } }) as unknown as AgentRun;

describe('the skills in the ⓘ of a strip (infoLines)', () => {
  const skills = (c: object) => infoLines({ id: 'c', model: 'claude-opus-4-5', harness: 'claude', cwd: '', ...c } as never, null).lines.filter(l => l.startsWith('skill'));
  it('lists every skill a run used, Claude or another engine', () => {
    expect(skills({ harness: 'claude', run: run(['a', 'b', 'c', 'd']) })).toEqual(['skill: a · b · c · d']);
    expect(skills({ harness: 'cursor', run: run(['ops-core']) })).toEqual(['skill: ops-core']);
  });
  it('another engine that reports none: the skills its role loaded, marked as not tracked; Claude never', () => {
    expect(skills({ harness: 'codex', run: run([]), loadedSkills: ['code-work', 'air-qa'] })).toEqual(['skill caricate (uso non tracciato): code-work · air-qa']);
    expect(skills({ harness: 'codex', run: run(['ops-core']), loadedSkills: ['code-work'] })).toEqual(['skill: ops-core']);
    expect(skills({ harness: 'claude', run: run([]), loadedSkills: ['code-work'] })).toEqual([]);
  });
  it('says nothing for a chat that is no run, or a run with no skill', () => {
    expect(skills({ harness: 'codex', loadedSkills: ['x'] })).toEqual([]);
    expect(skills({ harness: 'claude', run: run([]) })).toEqual([]);
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
