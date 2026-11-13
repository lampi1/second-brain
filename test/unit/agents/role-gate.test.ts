// Pins agents/role-gate.ts: a role chat's Skill call is always allowed at once (ADR 0278); a granted bare name is
// rewritten to "<its launch plugin>:<name>" where the engine runs a changed input;
// on an engine that runs a changed input a granted bare name is allowed as the qualified one (issue #101).
import { describe, expect, it } from 'vitest';
import { gateRequest, qualifiedSkillsLine, runtimePluginName } from '../../../src/main/agents/role-gate';

const hash = 'a'.repeat(16) + 'b'.repeat(48);
const plugin = runtimePluginName(`/u/agent-pack-runtime/${hash}`);
const chat = { role: { id: 'artisan', name: 'Artisan' }, skills: ['brain-edit'], plugin };
const skill = (name: string, key = 'skill') => gateRequest({ type: 'permission', tool: 'Skill', input: { [key]: name } }, chat);

describe('role gate: skills', () => {
  it('names the runtime plugin from the folder hash, as the pack writes it', () => {
    expect(plugin).toBe(`agent-${'a'.repeat(16)}`);
    expect(runtimePluginName(hash)).toBe(plugin);
  });
  it('allows an assigned skill named through the launch plugin', () => {
    expect(skill(`${plugin}:brain-edit`).kind).toBe('allow');
    expect(skill(`${plugin}:brain-edit`, 'command').kind).toBe('allow');
  });
  it('allows a granted bare name as it is when the engine cannot run a changed input', () => {
    expect(skill('brain-edit')).toEqual({ kind: 'allow' });
  });
  it('rewrites a granted bare name to the launch plugin when the engine runs a changed input (issue #101)', () => {
    const re = { ...chat, rewrite: true };
    expect(gateRequest({ type: 'permission', tool: 'Skill', input: { skill: 'brain-edit', args: 'x' } }, re)).toEqual({ kind: 'allow', patch: { skill: `${plugin}:brain-edit` } });
    expect(gateRequest({ type: 'permission', tool: 'Skill', input: { command: 'brain-edit' } }, re)).toEqual({ kind: 'allow', patch: { command: `${plugin}:brain-edit` } });
    // the qualified name needs no patch; a skill the launch did not give, another prefix or no plugin runs unchanged
    expect(gateRequest({ type: 'permission', tool: 'Skill', input: { skill: `${plugin}:brain-edit` } }, re)).toEqual({ kind: 'allow' });
    for (const raw of ['deploy-prod', 'plug:brain-edit', 'dataviz'])
      expect(gateRequest({ type: 'permission', tool: 'Skill', input: { skill: raw } }, re), raw).toEqual({ kind: 'allow' });
    expect(gateRequest({ type: 'permission', tool: 'Skill', input: { skill: 'brain-edit' } }, { role: chat.role, skills: chat.skills, rewrite: true })).toEqual({ kind: 'allow' });
  });
  it('names the launch skills by their qualified names for the role instructions', () => {
    expect(qualifiedSkillsLine(plugin, ['example-app-qa', 'brain-edit'])).toContain(`${plugin}:example-app-qa, ${plugin}:brain-edit`);
    expect(qualifiedSkillsLine(plugin, [])).toBe('');
  });
  it('allows a skill the launch did not give: the engine\'s own, the user\'s, another plugin\'s (ADR 0278)', () => {
    for (const raw of ['dataviz', 'plug:brain-edit', `${plugin}:deploy-prod`, 'deploy-prod'])
      expect(skill(raw), raw).toEqual({ kind: 'allow' });
  });
  it('allows a skill when the launch has no plugin', () => {
    expect(gateRequest({ type: 'permission', tool: 'Skill', input: { skill: 'dataviz' } }, { role: chat.role, skills: chat.skills })).toEqual({ kind: 'allow' });
  });
  it('passes plain chats and non-permission requests', () => {
    expect(gateRequest({ type: 'permission', tool: 'Skill', input: { skill: 'x' } }, { skills: [] }).kind).toBe('pass');
    expect(gateRequest({ type: 'question', tool: 'AskUserQuestion' }, chat).kind).toBe('pass');
  });
});
