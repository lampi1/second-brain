// The skills a role may load at start (agents/pack/flows.ts runtime): the first folder holding a skill wins, in the
// order the brain's own (.agents/skills, .claude/skills), the user's home ones, then the app's rendered copy of the
// skills it ships (brain-template/harness/claude/skills, copied for this brain by rules/tools.ts ensureTools). The app's
// copy is last so a brain or user skill of the same name stays theirs, and it is there whatever brain.json
// rules.appRules says: a role's default skills (Scout code-investigation, Sentinel code-review) always load (#146).
// Used by agents/pack/wiring.ts; pinned by test/unit/agents/shared-skills.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { APP_PLUGIN_PARTS } from '../../rules/tools';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The app-shipped skills folder inside a rendered tools copy (ensureTools' target). */
export const appSkillsIn = (tools: string): string => path.join(tools, APP_PLUGIN_PARTS.find(p => p.to === 'skills')!.from);

/** The folders to look in, in order: brain, home, then the app's copy (null = none). */
export function skillFolders(o: { root: string | null; home: string | null; appTools: string | null }): string[] {
  return [o.root && path.join(o.root, '.agents/skills'), o.root && path.join(o.root, '.claude/skills'), o.home && path.join(o.home, '.agents/skills'),
    o.home && path.join(o.home, '.claude/skills'), o.appTools && appSkillsIn(o.appTools)].filter((p): p is string => !!p);
}

/** Every skill (a kebab-case folder with a SKILL.md) in `dirs`; the first folder that has a name wins. */
export function skillsIn(dirs: readonly string[]): { name: string; folder: string }[] {
  const found = new Map<string, { name: string; folder: string }>();
  for (const folder of dirs) if (fs.existsSync(folder)) for (const name of fs.readdirSync(folder)) {
    if (NAME.test(name) && !found.has(name) && fs.existsSync(path.join(folder, name, 'SKILL.md'))) found.set(name, { name, folder: path.join(folder, name) });
  }
  return [...found.values()];
}
