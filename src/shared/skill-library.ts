// The skill library (#361-#364, ADR 0241): every skill a chat can load, as a package (SKILL.md plus scripts/,
// references/, assets/), with its files, the roles that get it, its usage per role and its own history with Undo.
// Shapes shared by main (skills/library.ts, appctl/skills.ts) and the Memoria «Skill» tab (SkillsPage.tsx).

/** brain = the brain's `.agents/skills` (the one copy, `.claude/skills` links to it); app = shipped with the app
 *  (read-only: an edit makes a brain copy that replaces it); home = the user's own ~/.claude or ~/.agents skills */
export type SkillOrigin = 'brain' | 'app' | 'home';

export interface SkillFile {
  /** path inside the skill's folder, with `/` (`SKILL.md`, `scripts/run.mjs`, `assets/query.sql`) */
  path: string;
  size: number;
  /** false = a binary file (an image, a PDF): listed, never shown or edited as text */
  text: boolean;
}

export interface SkillRoleUse { role: string; uses: number; lastAt: number }

export interface LibSkill {
  name: string;
  description: string;
  origin: SkillOrigin;
  /** a brain skill that replaces an app skill of the same name («Ripristina originale» removes it) */
  overridesApp: boolean;
  /** absolute folder */
  folder: string;
  files: SkillFile[];
  /** frontmatter `metadata.area` (or `area`), for the filter; null = none */
  area: string | null;
  /** the roles that load it at start (their default skills and the ones linked to them) */
  roles: string[];
  /** usage from the runs (which role opened it, how often, when last) */
  uses: SkillRoleUse[];
  totalUses: number;
  lastUse: number | null;
  changedAt: number | null;
  /** who changed it last when the history knows ("user", a maintenance job, "migration"…) */
  madeBy: string | null;
  /** SKILL.md problems (missing name or description…) */
  errors: number;
}

export interface SkillRole { id: string; name: string; emoji?: string }

export interface SkillLibraryState {
  /** null = no brain folder: only the app's and the user's skills, nothing can be created */
  root: string | null;
  skills: LibSkill[];
  roles: SkillRole[];
}

export interface SkillFileText { skill: string; path: string; text: string | null; size: number; mtime: number; origin: SkillOrigin }

/** One entry of a skill's history: every file of the skill it changed, before and after (null = created / removed). */
export interface SkillVersion {
  id: string;
  at: number;
  /** user, a maintenance job, migration, research */
  job: string;
  summary: string;
  reason: string;
  files: { path: string; before: string | null; after: string | null }[];
  canUndo: boolean;
  undoneAt: number | null;
}

export interface SkillWrite {
  skill: string;
  path: string;
  /** null = remove the file (SKILL.md cannot be removed: remove the skill) */
  text: string | null;
  /** the file's mtime when it was opened: a newer one on disk refuses the save */
  mtime?: number;
}
export type SkillWriteResult = { ok: true; changeId: string | null; skill: LibSkill } | { ok: false; error: string };

/** The kebab-case name every skill folder has (Claude Code and the Agent Skills format). */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A file path inside a skill: up to 4 folders, plain names, never hidden or `..`. */
export const SKILL_PATH = /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]{0,80}\/){0,4}[A-Za-z0-9_][A-Za-z0-9_.-]{0,120}$/;
