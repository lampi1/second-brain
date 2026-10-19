// Issue #93: a skill's tool classes from what the brain model reads in it, and the launch warning when the role lacks
// them (agents/skill-needs.ts); agent_catalog lists the warnings for the skills it is asked about (agents/discovery.ts).
import { describe, expect, it } from 'vitest';
import { gapLines, skillClasses, skillGaps } from '../../../src/main/agents/skill-needs';
import { discoverRoles } from '../../../src/main/agents/discovery';
import { TOOL_CLASSES, type AgentCatalog } from '../../../src/shared/agents';

const tools: Record<string, string[]> = {
  'issue-open': ['Write', 'node scripts/open-issue.mjs', 'scripts/open-issue.mjs'],
  'devops-read': ['mcp__devops__wit_get'],
  'notes': ['Read', 'Grep'],
};
const of = (n: string) => tools[n];

describe('skill needs', () => {
  it('maps a skill\'s tools to classes', () => {
    expect(skillClasses(tools['issue-open']!)).toEqual(['edit', 'shell']);
    expect(skillClasses(['Bash(git:*)', 'WebFetch', 'mcp__second-brain__navigate'])).toEqual(['shell', 'web']);
    expect(skillClasses(tools['devops-read']!)).toEqual(['mcp']);
    expect(skillClasses([])).toEqual([]);
  });
  it('warns for a skill whose tools the role lacks; nothing with every permission or no limit', () => {
    const herald = { tools: { allow: ['read' as const, 'web' as const, 'mail-draft' as const] }, ceiling: null };
    expect(skillGaps(['issue-open', 'notes', 'unknown'], of, herald)).toEqual([{ skill: 'issue-open', needs: ['edit', 'shell'] }]);
    expect(skillGaps(['issue-open'], of, { tools: { allow: [...TOOL_CLASSES] }, ceiling: null })).toEqual([]);
    expect(skillGaps(['issue-open'], of, null)).toEqual([]);
    const reader = { tools: { allow: ['read' as const, 'edit' as const, 'shell-read' as const] }, ceiling: null };
    expect(skillGaps(['issue-open'], of, reader)).toEqual([{ skill: 'issue-open', needs: [], readOnlyCommands: true }]);
    expect(gapLines('Herald', skillGaps(['issue-open'], of, herald))[0]).toMatch(/skill «issue-open» needs edit, shell, which Herald lacks/);
  });
  it('agent_catalog names, per role, the asked skills it lacks tools for', () => {
    const catalog = { problem: null, models: [], profiles: [
      { id: 'herald', name: 'Herald', purpose: '', scope: 'role', engine: 'claude', model: null, tier: 'light', tierMax: 'mid', independent: false, launches: [], skills: [], tools: { allow: ['read', 'web'] }, permissionCeiling: null, activeVersion: 1 },
      { id: 'artisan', name: 'Artisan', purpose: '', scope: 'role', engine: 'claude', model: null, tier: 'mid', tierMax: 'top', independent: false, launches: [], skills: [], tools: { allow: [...TOOL_CLASSES] }, permissionCeiling: null, activeVersion: 1 },
    ] } as unknown as AgentCatalog;
    const out = discoverRoles(() => catalog, { skills: ['issue-open'] }, () => Object.entries(tools).map(([name, t]) => ({ name, tools: t })));
    expect(out.roles.find(r => r.id === 'herald')?.skillWarnings?.[0]).toMatch(/issue-open/);
    expect(out.roles.find(r => r.id === 'artisan')).not.toHaveProperty('skillWarnings');
    expect(() => discoverRoles(() => catalog, { skills: ['Bad Name'] })).toThrow(/skills/);
    expect(discoverRoles(() => catalog, {}).roles[0]).not.toHaveProperty('skillWarnings');
  });
});
