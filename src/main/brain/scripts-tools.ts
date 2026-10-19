// The MCP tools over the brain's scripts and changelog (ADR 0076). Two faces:
// - brain_scripts, on every chat's own endpoint (read only): find a tested script before writing a new one. It matches
//   words over each script's title, description, usage and tags (scripts.ts findScripts), no classifier: the list is
//   short and each script describes itself, so the agent reads the few hits and picks (ADR 0076 says when to revisit).
// - brain_script_save, brain_script_delete, brain_changelog_add, on the Orchestrator's app endpoint only (appctl/tools.ts):
//   the owner gave it full freedom over the scripts (2026-10-19), so they write directly, no approval card; every change
//   lands in the brain's changelog, a delete keeps a copy, and a script holding a credential is refused.
// Used by wiring.ts (brain_scripts) and appctl/tools.ts (the write tools).
import type { McpTool } from '../mcp/server';
import type { ChangelogAction, ChangelogKind } from '../../shared/contract';
import { CHANGELOG_ACTIONS, CHANGELOG_KINDS, type BrainChangelog } from './changelog';
import { findScripts, SCRIPT_EXTS, type BrainScripts } from './scripts';

export interface ScriptToolDef { name: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }; run(args: Record<string, unknown>): Promise<object | string> | object | string }

const text = (v: unknown, key: string, required = true): string => {
  if (v === undefined && !required) return '';
  if (typeof v !== 'string' || (required && !v.trim())) throw new Error(`${key}: required text`);
  return v;
};

export function brainScriptsTool(scripts: BrainScripts): McpTool {
  return {
    name: 'brain_scripts',
    description: `The brain's reusable scripts (its scripts/ folder): tested scripts the user's agents wrote, each with what it does, how to run it (usage) and its last test. Call it BEFORE writing a new script for a task: reuse or adapt a fitting one instead of starting over. q: what you need, in plain words (all words must match title, description, usage or tags); empty = all. Read the file at its path for the code. Only the Orchestrator adds, fixes or deletes scripts (brain_script_save): if you improved or wrote a reusable script, give it to the Orchestrator in your report.`,
    inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'What the script should do (e.g. "backup note zip"). Optional.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: args => {
      const all = scripts.list();
      const list = findScripts(all.scripts, typeof args.q === 'string' ? args.q : '').slice(0, 30);
      return JSON.stringify({
        folder: all.root ? `${all.root}/${all.dir}` : null, total: all.scripts.length,
        scripts: list.map(s => ({ path: all.root ? `${all.root}/${s.file}` : s.file, title: s.title, description: s.description, usage: s.usage, language: s.language, tags: s.tags, tested: s.tested })),
      });
    },
  };
}

/** The Orchestrator's write tools. `by` = who the changelog names (the calling Orchestrator's title). */
export function scriptWriteTools(scripts: BrainScripts, changelog: BrainChangelog, by: () => string): ScriptToolDef[] {
  return [
    {
      name: 'brain_script_save',
      description: `Add, edit or fix a reusable script in the user's brain (scripts/<name>), shown on the brain's Script page. Save only a script that was RUN and worked (tested.ok true, with what was run and the result in tested.note); a script that failed stays out, or is saved with ok false only to keep a fix in progress visible. Before adding, call brain_scripts: fix or extend an existing one instead of a near-duplicate. One self-contained file, no secrets (read them from an environment variable or the user's credentials file at run time: a line that looks like a credential is refused). The app writes the header (title, description, usage, tags, tested) in the language's comment syntax; pass the code without it. Every save is logged in the brain's changelog. Languages by extension: ${SCRIPT_EXTS.join(' ')}.`,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File name with extension, e.g. "export-tickets.py" (letters, digits, . _ -). An existing name replaces that script.' },
          title: { type: 'string', description: 'Short human title, in the user’s language.' },
          description: { type: 'string', description: 'What it does and when to reuse it, one or two sentences, in the user’s language.' },
          usage: { type: 'string', description: 'How to run it: the command line(s) with placeholders, one per line.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'A few words to find it (area, tool, system).' },
          code: { type: 'string', description: 'The whole script, without the app header.' },
          tested: { type: 'object', properties: { ok: { type: 'boolean' }, note: { type: 'string', description: 'What was run and what came out, one line.' } }, required: ['ok', 'note'], additionalProperties: false },
          fix: { type: 'boolean', description: 'true when this repairs a script that failed (the changelog says "fixed").' },
          summary: { type: 'string', description: 'One line for the changelog: what changed and why. Default: the title.' },
        },
        required: ['name', 'title', 'description', 'code', 'tested'], additionalProperties: false,
      },
      run: a => {
        const tested = a.tested && typeof a.tested === 'object' ? a.tested as { ok?: unknown; note?: unknown } : null;
        if (!tested || typeof tested.ok !== 'boolean') throw new Error('tested: { ok: boolean, note: string } required: save a script after running it');
        const r = scripts.save({
          name: text(a.name, 'name'), code: text(a.code, 'code'), by: by(), fix: a.fix === true, ...(typeof a.summary === 'string' ? { summary: a.summary } : {}),
          meta: { title: text(a.title, 'title'), description: text(a.description, 'description'), usage: text(a.usage, 'usage', false),
            tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === 'string').slice(0, 12) : [],
            tested: { ok: tested.ok, note: typeof tested.note === 'string' ? tested.note.slice(0, 300) : '' } },
        });
        return { ok: true, ...r, changelog: 'logged' };
      },
    },
    {
      name: 'brain_script_delete',
      description: 'Remove a script from the user\'s brain (wrong, obsolete or replaced by another). The file moves to scripts/.deleted/ (kept, restorable by saving it again) and the change is logged in the brain\'s changelog with your reason.',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'The script\'s file name, as brain_scripts lists it.' }, reason: { type: 'string', description: 'Why, one line, in the user’s language.' } }, required: ['name', 'reason'], additionalProperties: false },
      run: a => ({ ok: true, ...scripts.delete({ name: text(a.name, 'name'), reason: text(a.reason, 'reason'), by: by() }) }),
    },
    {
      name: 'brain_changelog_add',
      description: `Log a change you or a worker made to the user's brain outside the script tools (a rule, procedure, note, agent or skill file added, edited, fixed or deleted) in the brain's changelog, shown on its Changelog page. One entry per change the user would want to know about; brain_script_save and brain_script_delete log themselves. kind: ${CHANGELOG_KINDS.join(', ')}; action: ${CHANGELOG_ACTIONS.join(', ')}.`,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: { type: 'object', properties: {
        kind: { type: 'string', enum: [...CHANGELOG_KINDS] }, action: { type: 'string', enum: [...CHANGELOG_ACTIONS] },
        target: { type: 'string', description: 'The brain-relative file (or the thing) that changed, e.g. "rules/git.md".' },
        summary: { type: 'string', description: 'What changed and why, one line, in the user’s language.' },
      }, required: ['kind', 'action', 'target', 'summary'], additionalProperties: false },
      run: a => {
        const kind = text(a.kind, 'kind') as ChangelogKind, action = text(a.action, 'action') as ChangelogAction;
        return { ok: true, entry: changelog.add({ kind, action, target: text(a.target, 'target'), summary: text(a.summary, 'summary'), by: by() }) };
      },
    },
  ];
}
