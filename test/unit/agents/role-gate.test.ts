// Pins agents/role-gate.ts: a role chat's Skill call is allowed only as "<its launch plugin>:<an assigned skill>"; a
// bare name, another plugin's prefix or an unassigned skill is refused (a user or project skill could share the name).
import { describe, expect, it } from 'vitest';
import { gateRequest, runtimePluginName } from '../../../src/main/agents/role-gate';

const hash = 'a'.repeat(16) + 'b'.repeat(48);
const plugin = runtimePluginName(`/u/agent-pack-runtime/${hash}`);
const chat = { role: { id: 'scribe', name: 'Scribe' }, skills: ['brain-edit'], plugin };
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
