// brain-doc: where a brain keeps its own rules, memory map and behaviour tests. An older brain has them as loose
// files at its root (map.md, brain-rules.md, tests/behavior.md); a clean brain keeps them inside the `brain-rules`
// skill package (ADR 0241, ADR 0277), so its root looks like a fresh install. The tools ask here instead of naming a
// root path, and both layouts work. Pure lookups; used by brain-lint, brain-map and chat-prompt.
import fs from 'node:fs';
import path from 'node:path';

const SKILL = '.agents/skills/brain-rules';
/** Each document's homes, first found wins: the root file (older brains), then the skill package. */
export const DOC_HOMES = {
  'map.md': ['map.md', `${SKILL}/references/memory-map.md`],
  'brain-rules.md': ['brain-rules.md', `${SKILL}/SKILL.md`],
  'tests/behavior.md': ['tests/behavior.md', `${SKILL}/references/behavior-tests.md`],
};

/** Brain-relative path (forward slashes) of `name` where it exists under `root`, or null when it is nowhere. */
export function brainDocRel(root, name) {
  const key = String(name).replace(/\\/g, '/');
  return (DOC_HOMES[key] ?? [key]).find(rel => fs.existsSync(path.join(root, rel))) ?? null;
}

/** Absolute path of `name` in the brain at `root`, or null when it is nowhere. */
export function brainDoc(root, name) {
  const rel = brainDocRel(root, name);
  return rel ? path.join(root, rel) : null;
}
