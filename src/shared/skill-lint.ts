// The checks a skill's package gets on every save and on the Skill page (#373; the app's skill-authoring skill says
// the same in words): the name equals the folder, the description says when to use the skill, SKILL.md stays under
// 500 lines, and every package file SKILL.md points to exists. Warnings, never a refusal (checkMd in skillmd.ts keeps
// the errors that block a save). Pure, no I/O: main/skills/library.ts (LibSkill.warnings), appctl/skills.ts
// (app_skill_write's answer), the renderer shows them (components/skills/SkillDetail.tsx). Sources: the Agent Skills
// specification and Anthropic's authoring best practices (brain-template/.../skill-authoring/references/sources.md).
import { field, parseMd } from './skillmd';

export type SkillLintCode = 'name-folder' | 'no-when' | 'long' | 'missing-file';
export interface SkillLint { code: SkillLintCode; detail?: string }

/** the line count past which SKILL.md should move text to references/ (spec and best practices: under 500 lines) */
export const LONG_LINES = 500;

/** «Use when», «Usala quando», «Wenn»…: the part of a description that tells a model when to load the skill. */
const WHEN = /\b(?:use|used|usa(?:la|lo|re)?|verwende|nutze)\b[^.;\n]{0,60}\b(?:when|whenever|if|for|to|before|after|on|quando|se|per|prima|dopo|wenn|bei|für|vor|nach)\b|\bwhen(?:ever)?\b|\bquando\b|\bwenn\b|\bsobald\b/i;

/** Package paths SKILL.md names: `${CLAUDE_SKILL_DIR}/x`, `scripts/x`, `references/x`, `assets/x`, and relative
 *  Markdown links. A path with a placeholder (<x>, *, {x}) is an example, not a file. */
function referenced(body: string): string[] {
  const out = new Set<string>();
  const add = (p: string) => {
    const clean = p.replace(/[)>\]`'".,;:!?]+$/, '').replace(/^\.\//, '');
    if (!clean || /[<>*{}$|]/.test(clean) || clean.endsWith('/') || clean.includes('..')) return;
    out.add(clean);
  };
  for (const m of body.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([^\s`'"()<>]+)/g)) add(m[1]!);
  for (const m of body.matchAll(/(?<![\w./$}-])(?:\.\/)?((?:scripts|references|assets)\/[^\s`'"()<>]+)/g)) add(m[1]!);
  for (const m of body.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) if (!/^[a-z][\w+.-]*:|^\/|^~/i.test(m[1]!)) add(m[1]!);
  return [...out];
}

/** Every warning of a skill's SKILL.md against its folder name and the files of its package. */
export function lintSkill(folderName: string, text: string, files: readonly { path: string }[]): SkillLint[] {
  const p = parseMd(text);
  const out: SkillLint[] = [];
  const name = field(p, 'name')?.trim();
  if (name && name !== folderName) out.push({ code: 'name-folder', detail: name });
  const desc = field(p, 'description')?.trim();
  if (desc && !WHEN.test(desc)) out.push({ code: 'no-when' });
  const lines = p.body.split(/\r?\n/).length;
  if (lines > LONG_LINES) out.push({ code: 'long', detail: String(lines) });
  const have = new Set(files.map(f => f.path.toLowerCase()));
  for (const ref of referenced(p.body)) if (!have.has(ref.toLowerCase())) out.push({ code: 'missing-file', detail: ref });
  return out;
}

/** The warning in words, for an agent (app_skill_write's answer). */
export function lintText(w: SkillLint): string {
  switch (w.code) {
    case 'name-folder': return `frontmatter name «${w.detail}» differs from the folder name: make them equal`;
    case 'no-when': return 'the description does not say when to use the skill: add "Use when …" with the words the user asks with';
    case 'long': return `SKILL.md has ${w.detail} lines: keep it under ${LONG_LINES}, move long text to references/`;
    case 'missing-file': return `SKILL.md points to ${w.detail}, which is not in the package`;
  }
}
