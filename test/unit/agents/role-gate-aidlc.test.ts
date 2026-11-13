// The role gate's AI-DLC exemption (ADR 0083 amendment): a role chat in a project with the AI-DLC harness installed
// (.claude/skills/aidlc) may run that project's own aidlc-* sub-agents (.claude/agents/<name>.md), through the
// PreToolUse hook and the permission gate alike; any other non-Explore sub-agent stays refused, and so does an aidlc-*
// name outside such a project, one the project does not define, or one shaped like a path. Pins agents/role-gate.ts
// aidlcSubagent, subagentRefusal and SubagentGate.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SubagentGate, aidlcSubagent, gateRequest, subagentRefusal } from '../../../src/main/agents/role-gate';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

/** A project folder: with the harness (skills/aidlc) or not, and the given agents in .claude/agents. */
function project(harness: boolean, agents: string[] = ['aidlc-developer-agent', 'aidlc-architecture-reviewer-agent', 'reviewer']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-aidlc-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
  if (harness) fs.mkdirSync(path.join(root, '.claude', 'skills', 'aidlc'), { recursive: true });
  for (const a of agents) fs.writeFileSync(path.join(root, '.claude', 'agents', `${a}.md`), `---\nname: ${a}\n---\n`);
  return root;
}
const agent = (subagent_type: string) => ({ tool: 'Agent', input: { subagent_type, prompt: 'p' } });
const chat = (cwd: string) => ({ role: { id: 'artisan', name: 'Artisan' }, skills: [], cwd });

describe('AI-DLC sub-agents', () => {
  it('allows the project\'s own aidlc-* agents in an AI-DLC project', () => {
    const root = project(true);
    const gate = new SubagentGate(root);
    expect(gate.decide(agent('aidlc-developer-agent'))).toBeNull();
    expect(gate.decide({ tool: 'Task', input: { subagent_type: 'aidlc-architecture-reviewer-agent' } })).toBeNull();
    expect(gate.decide(agent('Explore'))).toBeNull();
    expect(gateRequest({ type: 'permission', ...agent('aidlc-developer-agent') }, chat(root)).kind).toBe('pass');
  });

  it('still refuses every other non-Explore sub-agent there, project-defined ones too', () => {
    const root = project(true);
    const gate = new SubagentGate(root);
    for (const t of ['general-purpose', 'reviewer', 'Plan', 'aidlc-unknown-agent'])
      expect(gate.decide(agent(t))?.deny, t).toContain(`Sub-agent «${t}» refused`);
    expect(gate.decide({ tool: 'Agent', input: { prompt: 'no type' } })?.deny).toContain('«general-purpose» refused');
    const v = gateRequest({ type: 'permission', ...agent('reviewer') }, chat(root));
    expect(v.kind === 'deny' ? v.code : v.kind).toBe('subagentRefused');
  });

  it('refuses aidlc-* agents in a project without the harness, or with no folder known', () => {
    const plain = project(false);
    expect(new SubagentGate(plain).decide(agent('aidlc-developer-agent'))?.deny).toContain('refused');
    expect(new SubagentGate().decide(agent('aidlc-developer-agent'))?.deny).toContain('refused');
    expect(new SubagentGate(null).decide(agent('aidlc-developer-agent'))?.deny).toContain('refused');
    expect(subagentRefusal({ subagent_type: 'aidlc-developer-agent' })).not.toBeNull();
    expect(gateRequest({ type: 'permission', ...agent('aidlc-developer-agent') }, { role: { id: 'a', name: 'A' }, skills: [] }).kind).toBe('deny');
  });

  it('refuses names that are not a plain aidlc-* agent name, and a relative folder', () => {
    const root = project(true, ['aidlc-developer-agent']);
    fs.writeFileSync(path.join(root, '.claude', 'evil.md'), 'x');
    for (const t of ['aidlc-../evil', 'aidlc-developer-agent/../../evil', 'AIDLC-developer-agent', 'aidlc-', 'xaidlc-developer-agent', 'aidlc-developer-agent.md'])
      expect(aidlcSubagent(root, t), t).toBe(false);
    // A temp folder on another drive (Windows) has no relative path from here: path.relative gives the absolute one back.
    const rel = path.relative(process.cwd(), root);
    if (!path.isAbsolute(rel)) expect(aidlcSubagent(rel, 'aidlc-developer-agent')).toBe(false);
    expect(aidlcSubagent(path.join('no-such-folder', 'here'), 'aidlc-developer-agent')).toBe(false);
    expect(aidlcSubagent(root, 'aidlc-developer-agent')).toBe(true);
  });

  it('refuses an aidlc-* name whose definition is a folder, not a file', () => {
    const root = project(true, []);
    fs.mkdirSync(path.join(root, '.claude', 'agents', 'aidlc-developer-agent.md'));
    expect(aidlcSubagent(root, 'aidlc-developer-agent')).toBe(false);
  });
});
