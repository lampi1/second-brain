// The shipped preset know-how folders (src/main/agents/presets) must match the catalog's packaged preset ids one to one.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_ROLE_REPLACEMENTS, roleAgentPresets } from '../../src/shared/agent-presets';
import { GENERAL_AGENT_ID, ORCHESTRATOR_AGENT_ID } from '../../src/shared/agents';
import { parseMd, field } from '../../src/shared/skillmd';
import { presetSkills } from '../../src/main/agents/pack/read';

const PRESETS = path.resolve('src/main/agents/presets');

describe('shipped preset skill folders', () => {
  it('has one folder per packaged preset id: role presets, Orchestrator, Generale and the legacy seeds still in older catalogs', () => {
    const expected = new Set([...roleAgentPresets().map(p => p.id), ORCHESTRATOR_AGENT_ID, GENERAL_AGENT_ID, ...Object.keys(LEGACY_ROLE_REPLACEMENTS)]);
    expect(new Set(fs.readdirSync(PRESETS))).toEqual(expected);
  });
  it('loads every folder through the runtime lookup, with a skill named after its preset', () => {
    for (const id of fs.readdirSync(PRESETS)) {
      const files = presetSkills(PRESETS, id);
      expect(files, id).not.toBeNull();
      const skill = files!.get(`skills/${id}/SKILL.md`);
      expect(skill, id).toBeDefined();
      expect(field(parseMd(skill!.toString()), 'name')).toBe(id);
      expect(files!.has(`skills/${id}/learned-rules.md`)).toBe(true);
    }
  });
  it('refuses ids that are not preset ids', () => {
    expect(presetSkills(PRESETS, '../presets')).toBeNull();
    expect(presetSkills(PRESETS, 'agent-123')).toBeNull();
  });
});
