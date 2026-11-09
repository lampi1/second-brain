// The Orchestrator's skill tools (#361-#364, ADR 0241; owner 2026-11-09: «posso facilmente creare e modificare skill
// scrivendo all'orchestrator»): app_skills reads the library (every skill of the brain, the user and the app, its files,
// roles, usage and history), app_skill_write creates a skill or changes any file of its package, app_skill_roles gives
// it to roles, app_skill_undo undoes one change. Every write is one entry of the brain's change log with its Undo, seen
// by the user's PreToolUse hooks first (skills/library.ts); an app skill is changed as a brain copy that replaces it.
// No approval (ADR 0077: skill changes apply on their own, logged and undoable). Only on the Orchestrator's own endpoint.
import type { SkillLibrary } from '../skills/library';
import type { ToolDef } from './tools';

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

export function skillTools(lib: SkillLibrary, who: () => string): ToolDef[] {
  return [{
    name: 'app_skills',
    description: 'The skill library: every skill a chat can load (the brain\'s .agents/skills, the user\'s own, the app\'s shipped ones), each a package (SKILL.md, scripts/, references/, assets/). Without `skill`: the list (name, description, origin brain|app|home, roles that load it, uses). With `skill`: its files and SKILL.md; with `file` too: that file\'s text. With `history: true`: its changes (who, when, what), newest first, each with its changeId for app_skill_undo. Read before changing a skill.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: {
      skill: { type: 'string', description: 'the skill\'s name (kebab-case)' },
      file: { type: 'string', description: 'a file of the package, e.g. scripts/report.mjs (default SKILL.md)' },
      history: { type: 'boolean', description: 'the skill\'s change history instead of its files' },
    } },
    run: async a => {
      const name = str(a.skill, 64);
      if (!name) {
        const s = await lib.state();
        return { brain: s.root, skills: s.skills.map(k => ({ name: k.name, description: k.description.slice(0, 200), origin: k.origin, ...(k.overridesApp ? { overridesApp: true } : {}), roles: k.roles, uses: k.totalUses, files: k.files.length, ...(k.errors ? { errors: k.errors } : {}) })), roles: s.roles };
      }
      if (a.history === true) return { skill: name, history: (await lib.history(name)).slice(0, 30).map(v => ({ changeId: v.id, at: new Date(v.at).toISOString(), by: v.job, summary: v.summary, files: v.files.map(f => f.path), undone: !!v.undoneAt, canUndo: v.canUndo })) };
      const k = await lib.skill(name);
      const f = await lib.read(name, str(a.file, 300) || 'SKILL.md');
      return { skill: k.name, origin: k.origin, folder: k.folder, roles: k.roles, uses: k.uses, files: k.files.map(x => `${x.path}${x.text ? '' : ' (binary)'}`), file: f.path, text: f.text ?? `(binary file, ${f.size} bytes)`,
        ...(k.origin === 'app' ? { note: 'A skill of the app: app_skill_write makes a brain copy of its whole package that replaces it (removing that copy restores the original).' } : {}) };
    },
  }, {
    name: 'app_skill_write',
    description: 'Create a skill or change one file of its package, for the user (no approval needed: the change is logged with an Undo on the Skill page). Create = write its SKILL.md (frontmatter `name` = the folder name in kebab-case, a `description` saying when to use it, then the procedure). Change = the whole new text of one file (read it first with app_skills); `remove: true` removes that file; `deleteSkill: true` deletes a brain skill (or the brain copy of an app skill, which restores the app\'s original). Scripts go in scripts/, long docs read only when needed in references/, templates, data and SQL queries in assets/; in SKILL.md refer to them as ${CLAUDE_SKILL_DIR}/scripts/x so they work from any folder. Say in `reason` why, in the user\'s words when he asked. Only brain and app skills: the user\'s own folder (origin home) and binary files are changed by the user himself.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: {
      skill: { type: 'string', description: 'the skill\'s name (kebab-case)' },
      file: { type: 'string', description: 'the file inside the package (default SKILL.md)' },
      text: { type: 'string', description: 'the file\'s whole new text' },
      remove: { type: 'boolean', description: 'remove this file of the package' },
      deleteSkill: { type: 'boolean', description: 'delete the whole skill' },
      reason: { type: 'string', description: 'why (shown in the skill\'s history)' },
    }, required: ['skill'] },
    run: async a => {
      const name = str(a.skill, 64), reason = str(a.reason, 500);
      if (a.deleteSkill === true) {
        const r = await lib.remove(name, { who: who(), reason });
        if (!r.ok) throw new Error(r.error);
        return { ok: true, deleted: name, changeId: r.changeId };
      }
      const text = a.remove === true ? null : typeof a.text === 'string' ? a.text : undefined;
      if (text === undefined) throw new Error('Give `text` (the whole new file) or `remove: true`.');
      const r = await lib.write({ skill: name, path: str(a.file, 300) || 'SKILL.md', text }, { who: who(), reason });
      if (!r.ok) throw new Error(r.error);
      return { ok: true, skill: r.skill.name, origin: r.skill.origin, files: r.skill.files.map(f => f.path), changeId: r.changeId, note: r.changeId ? 'Saved, with an Undo in the skill\'s history (Memoria → Skill).' : 'Nothing changed: the file already had this text.' };
    },
  }, {
    name: 'app_skill_roles',
    description: 'Which roles load a skill at start: `roles` is the full list of role ids that should have it (the others lose it). A role\'s default skill can only be removed from the role itself. Use when the user asks to give a skill to a role, or to take it away.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: { skill: { type: 'string' }, roles: { type: 'array', items: { type: 'string' } } }, required: ['skill', 'roles'] },
    run: async a => {
      const roles = Array.isArray(a.roles) ? a.roles.filter((r): r is string => typeof r === 'string').slice(0, 30) : [];
      const k = await lib.setRoles(str(a.skill, 64), roles);
      return { skill: k.name, roles: k.roles };
    },
  }, {
    name: 'app_skill_undo',
    description: 'Undo one change of a skill (its changeId from app_skills with history: true). Refused when a newer change touched the same file: undo that one first.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: { skill: { type: 'string' }, changeId: { type: 'string' } }, required: ['skill', 'changeId'] },
    run: async a => {
      const h = await lib.undo(str(a.skill, 64), str(a.changeId, 40));
      return { ok: true, history: h.slice(0, 5).map(v => ({ changeId: v.id, summary: v.summary, undone: !!v.undoneAt })) };
    },
  }];
}
