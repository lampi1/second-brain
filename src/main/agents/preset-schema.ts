// The JSON schema of the preset fields every delegation tool takes (ADR 0336): app_create_chat (appctl/tools.ts),
// agent_delegate's tasks and agent_assign_task (agents/delegation.ts). One copy so the three describe the choice in the
// same words: one of the role card's three presets, why in one line, a short label of the task. The checks are
// shared/model-presets.ts presetAskOf and choosePreset. Unit tests: test/unit/agents/model-presets.test.ts.
import { PRESET_IDS, PRESET_WHY_MAX, TASK_KIND_MAX } from '../../shared/model-presets';

export const PRESET_SCHEMA = {
  preset: { type: 'string', enum: [...PRESET_IDS], description: 'optional: which of the role card\'s three presets (agent_catalog presets) this task runs on: min for a known fact or a simple text, base for normal work, max for hard work. Omitted = base. Never above your own model by price: above it the highest preset that is not is used (said in warnings). No other model.' },
  presetWhy: { type: 'string', maxLength: PRESET_WHY_MAX, description: 'why this preset, one line; required for min or max (without it base is used, with a warning)' },
  taskKind: { type: 'string', maxLength: TASK_KIND_MAX, description: 'optional short label of the task (e.g. "log search", "brain note", "refactoring"), kept on the run record' },
} as const;
