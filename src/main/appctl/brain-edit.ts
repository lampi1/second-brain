// brain_edit, the Orchestrator's small brain edit (ADR 0370, owner proposal 4): a «d'ora in poi …» rule, a now.md line,
// a section of me.md or a skill's text changed by the app at once, instead of an Artisan and then a Sentinel (p50 10.7 +
// 9.4 min on the owner's PC). Limits (brain/quick-edit.ts): inside the brain folder, Markdown or text only, never
// settings, hooks, permissions or git (their own approval, ADR 0294), nor a line about tools or permissions, at most 3 files and 40 changed lines; a bigger
// edit goes to an Artisan. The user's own hooks see every write, the brain's lint runs when it has one, the edit is
// committed in the brain repo and «Annulla» undoes it for 24 h (brain/quick-edit-service.ts). Only on the Orchestrator's
// own endpoint (appctl/tools.ts); required for it on every engine (shared/role-tools.ts ORCHESTRATOR_APP_REQUIRED).
import type { BrainQuickEdit } from '../brain/quick-edit-service';
import { QUICK_LIMITS, type QuickChange } from '../brain/quick-edit';
import type { ToolDef } from './tools';

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

export function brainEditTool(edit: BrainQuickEdit, who: () => string): ToolDef {
  return {
    name: 'brain_edit',
    description: `A SMALL edit of the user's brain, applied now by the app (no work chat): a rule he gives («d'ora in poi …», «non fare più …»), a line of now.md, a section of me.md, a skill's SKILL.md text. Read the file first; each change replaces \`old\` (exact text found once) with \`new\`, or appends \`new\` when \`old\` is empty (creating the file). Limits: Markdown/text files inside the brain, at most ${QUICK_LIMITS.files} files and ${QUICK_LIMITS.lines} changed lines; never settings, hooks, permissions.json, git, an engine's agents/commands, nor a line about tools or permissions (allowed-tools, permissionMode…) (refused: their own approval), and anything bigger goes to an Artisan. The user's own brain hooks may refuse a write (their message says why); the brain's lint runs after it: fix its \`warnings\` with a next edit. The edit is committed in the brain repo. Reply to the user with the returned \`diff\` line as it is, plus «Annulla» if he wants it back. action "undo" (id, or "last") puts the files back within 24 h, refused when they changed since; action "recent" lists the latest edits.`,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: {
      action: { type: 'string', enum: ['apply', 'undo', 'recent'], description: 'default apply' },
      changes: { type: 'array', maxItems: QUICK_LIMITS.changes, items: { type: 'object', properties: {
        path: { type: 'string', description: 'relative to the brain folder, e.g. rules/qa.md, me.md, .agents/skills/x/SKILL.md' },
        old: { type: 'string', description: 'the exact text to replace (found once); empty = append' },
        new: { type: 'string', description: 'its replacement (or the text to append)' },
      }, required: ['path', 'new'] } },
      summary: { type: 'string', description: 'what changes, in a few words (the commit message and the brain changelog); the user\'s words when he gave them' },
      id: { type: 'string', description: 'undo: the edit\'s id from a previous answer, or "last"' },
    } },
    run: async a => {
      const action = str(a.action, 10) || 'apply';
      if (action === 'recent') return { edits: edit.recent().map(e => ({ ...e, at: new Date(e.at).toISOString() })) };
      if (action === 'undo') {
        const r = await edit.undo(str(a.id, 20) || 'last', who());
        return { ok: true, undone: r.id, diff: r.diff, commit: r.commit, ...(r.commitSkipped ? { commitSkipped: r.commitSkipped } : {}) };
      }
      if (action !== 'apply') throw new Error('action: apply, undo or recent');
      const changes = Array.isArray(a.changes) ? a.changes.slice(0, QUICK_LIMITS.changes + 1).map((c: unknown) => {
        const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
        return { path: str(o.path, 300), ...(typeof o.old === 'string' ? { old: o.old } : {}), new: typeof o.new === 'string' ? o.new : (undefined as unknown as string) } satisfies QuickChange;
      }) : [];
      const r = await edit.apply(changes, { summary: str(a.summary, 300), by: who() });
      return { ok: true, id: r.id, diff: r.diff, files: r.files, commit: r.commit, ...(r.commitSkipped ? { commitSkipped: r.commitSkipped } : {}),
        ...(r.warnings.length ? { warnings: r.warnings } : {}), ...(r.lint ? { lint: r.lint } : {}), undoUntil: new Date(r.undoUntil).toISOString(),
        note: 'Show the user the diff line as it is; «Annulla» = brain_edit action undo with this id, within 24 h.' };
    },
  };
}
