// Pins agents/role-gate.ts: a role chat's Skill call is allowed only as "<its launch plugin>:<an assigned skill>"; a
// bare name, another plugin's prefix or an unassigned skill is refused (a user or project skill could share the name);
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
  it('refuses a bare name, with the name to use', () => {
    const v = skill('brain-edit');
    expect(v.kind).toBe('deny');
    if (v.kind === 'deny') { expect(v.code).toBe('skillRefused'); expect(v.message).toContain(`${plugin}:brain-edit`); }
  });
  it('rewrites a granted bare name to the launch plugin when the engine runs a changed input (issue #101)', () => {
    const re = { ...chat, rewrite: true };
    expect(gateRequest({ type: 'permission', tool: 'Skill', input: { skill: 'brain-edit', args: 'x' } }, re)).toEqual({ kind: 'allow', patch: { skill: `${plugin}:brain-edit` } });
    expect(gateRequest({ type: 'permission', tool: 'Skill', input: { command: 'brain-edit' } }, re)).toEqual({ kind: 'allow', patch: { command: `${plugin}:brain-edit` } });
    // the qualified name needs no patch; a bare name not granted, another prefix or no plugin stays refused
    expect(gateRequest({ type: 'permission', tool: 'Skill', input: { skill: `${plugin}:brain-edit` } }, re)).toEqual({ kind: 'allow' });
    for (const raw of ['deploy-prod', 'plug:brain-edit', ''])
      expect(gateRequest({ type: 'permission', tool: 'Skill', input: { skill: raw } }, re).kind, raw).toBe('deny');
    expect(gateRequest({ type: 'permission', tool: 'Skill', input: { skill: 'brain-edit' } }, { role: chat.role, skills: chat.skills, rewrite: true }).kind).toBe('deny');
  });
  it('names the launch skills by their qualified names for the role instructions', () => {
    expect(qualifiedSkillsLine(plugin, ['example-app-qa', 'brain-edit'])).toContain(`${plugin}:example-app-qa, ${plugin}:brain-edit`);
    expect(qualifiedSkillsLine(plugin, [])).toBe('');
  });
  it('refuses another prefix, a nested one and an unassigned skill', () => {
    for (const raw of ['plug:brain-edit', `x:${plugin}:brain-edit`, `${plugin}:brain-edit:x`, `${plugin}:deploy-prod`, `${plugin}:`, ':brain-edit', ''])
      expect(skill(raw).kind, raw).toBe('deny');
    const v = skill(`${plugin}:deploy-prod`);
    expect(v.kind === 'deny' ? v.message : '').not.toContain('Call it as');
  });
  it('refuses every skill when the launch has no plugin', () => {
    expect(gateRequest({ type: 'permission', tool: 'Skill', input: { skill: `${plugin}:brain-edit` } }, { role: chat.role, skills: chat.skills }).kind).toBe('deny');
  });
  it('passes plain chats and non-permission requests', () => {
    expect(gateRequest({ type: 'permission', tool: 'Skill', input: { skill: 'x' } }, { skills: [] }).kind).toBe('pass');
    expect(gateRequest({ type: 'question', tool: 'AskUserQuestion' }, chat).kind).toBe('pass');
  });
});
