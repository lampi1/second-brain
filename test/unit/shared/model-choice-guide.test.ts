// The model choice guide (src/shared/model-choice-guide.ts, approved by the owner 2026-11-23): one copy in the app,
// in the Orchestrator's and the Strategist's role frame (roleFrame, never a worker's) and served by app_guide topic
// «model choice». Its words are checked against the approved file by diff at review time; here: it reaches who chooses.
import { describe, expect, it } from 'vitest';
import { MODEL_CHOICE_GUIDE } from '../../../src/shared/model-choice-guide';
import { ORCHESTRATOR_ROLE, roleFrame } from '../../../src/main/agents/orchestrator-role';
import { guideTool, type GuideDeps } from '../../../src/main/appctl/guide';
import { DEFAULTS, schema } from '../../../src/main/brain/config';

const guide = MODEL_CHOICE_GUIDE.trim();

describe('the model choice guide', () => {
  it('is the approved text: its title, the three presets, the omitted preset = base on reuse', () => {
    expect(MODEL_CHOICE_GUIDE.startsWith('# Model choice guide (Orchestrator and Strategist)\n')).toBe(true);
    expect(MODEL_CHOICE_GUIDE).toContain('`min`, `base`, `max`');
    expect(MODEL_CHOICE_GUIDE).toContain('If you omit it, the chat goes back to `base`.');
    expect(MODEL_CHOICE_GUIDE).not.toMatch(/Balanced|tierMax/);
  });
  it('reaches the Orchestrator\'s and the Strategist\'s prompts, never a worker\'s', () => {
    expect(ORCHESTRATOR_ROLE).toContain(guide);
    expect(roleFrame('Strategist', 'Plan the work.', 'strategist')).toContain(guide);
    for (const id of ['scout', 'artisan', 'sentinel', 'herald']) expect(roleFrame(id, 'Work.', id)).not.toContain(guide);
    expect(roleFrame('Chat', 'Work.')).not.toContain(guide);
  });
  it('is what app_guide serves for «model choice»', async () => {
    const deps: GuideDeps = { window: () => null, settings: { schema, get: () => DEFAULTS }, tools: () => [] };
    expect(String(await guideTool(deps).run({ topic: 'model choice' }))).toContain(guide);
  });
});
