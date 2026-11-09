// The app answers a chat's permission requests itself (ADR 0103, made "allow by default" by ADR 0254, issue #352): the
// app has no opinion of its own on what is dangerous, the user's brain decides (chats/permit-policy.ts,
// `<brain>/permissions.json`). Everything passes, for every engine, unless:
// - a rule of the user's policy holds it: `esegui` and `never-print` refuse it with the rule's reason (the chat goes
//   on: the agent reads the refusal), `ask-user` sends it to the user;
// - the policy file is there but cannot be read: the app cannot know the user's rules, so all but reads reach the user;
// - the user narrowed the role on its card: «Chiede conferma» or «Solo piano» ask everything, «Accetta modifiche» lets
//   reads and edits through and asks the rest;
// - it would change the agents' own settings or hooks (Claude, Cursor, Codex, the editor's, git's hooks): AGENTS.md
//   rule 6, «never change Claude desktop / Cursor config, hooks or settings», not an opinion of the app;
// - it is a plan to approve (ExitPlanMode): the user's call by its nature.
// Pure (the file system only to resolve links); used by ChatManager's sink.pending after the role gate; pinned by
// test/unit/chats/auto-permit.test.ts and permit-policy.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { PermissionCeiling } from '../../shared/agents';
import { COMMAND_TOOLS, readOnlyCommand, type ReadScripts } from '../agents/tool-policy';
import { policyHit, type BrainPolicy, type PolicyRule } from './permit-policy';

export interface PermitRequest { type: string; tool: string; input?: unknown }
export interface PermitContext {
  /** the chat's folder: relative paths are read from here */
  cwd: string;
  /** the role's limit set by the user on its card (null = none) */
  ceiling: PermissionCeiling | null;
  /** the brain's declared read-only node tools (agents/read-tools.ts) */
  readScripts?: ReadScripts;
  /** the user's rules from the brain (permit-policy.ts loadPolicy); missing = none */
  policy?: BrainPolicy;
}
export type PermitVerdict =
  | { kind: 'allow' }
  /** rule: the user's policy rule that sent it to the user (no «always» then: a rule would free later ones) */
  | { kind: 'ask'; rule?: PolicyRule }
  /** a rule of the user's policy refused it. message: English, what the model reads */
  | { kind: 'deny'; shown: string; rule: PolicyRule; message: string };

const ASK: PermitVerdict = { kind: 'ask' };
const ALLOW: PermitVerdict = { kind: 'allow' };

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'Search', 'TodoWrite', 'Think', 'WebSearch']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Delete', 'Move']);
/** the agents' own settings and hooks (AGENTS.md rule 6) and the repository's internals, where hooks live */
const SETTINGS_DIRS = new Set(['.git', '.claude', '.cursor', '.codex', '.githooks', '.husky', '.vscode', '.idea']);
const SETTINGS_FILE = /^(\.mcp\.json|\.guardallow|\.gitconfig|claude_desktop_config\.json|opencode\.jsonc?)$/i;

const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** The real path of p, or of its deepest existing ancestor with the rest appended (a file about to be written). */
function realish(p: string): string {
  let cur = p;
  const rest: string[] = [];
  for (let i = 0; i < 64; i++) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); } catch { /* not there yet */ }
    const up = path.dirname(cur);
    if (up === cur) break;
    rest.push(path.basename(cur));
    cur = up;
  }
  return p;
}

const settingsSegments = (p: string): boolean => {
  const parts = p.toLowerCase().split(/[\\/]+/).filter(Boolean);
  return parts.some(seg => SETTINGS_DIRS.has(seg)) || SETTINGS_FILE.test(parts[parts.length - 1] ?? '');
};
/** p names a settings or hooks place, as written or once links are resolved (a link in the folder to ~/.claude). */
function settingsPath(p: string, cwd: string): boolean {
  if (!p || p.includes('\0')) return true;
  if (settingsSegments(p)) return true;
  if (!path.isAbsolute(cwd) || p.startsWith('~')) return false;
  try { return settingsSegments(realish(path.resolve(cwd, p))); } catch { return false; }
}

/** The paths a file tool names (Claude, Cursor ACP, Codex shapes); null = one is not a plain string. */
function pathsOf(input: unknown): string[] | null {
  const o = obj(input);
  const out: string[] = [];
  for (const k of ['file_path', 'notebook_path', 'path', 'directory', 'source', 'destination', 'target', 'cwd']) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== 'string') return null;
    out.push(o[k] as string);
  }
  if (o.locations !== undefined) {
    if (!Array.isArray(o.locations) || !o.locations.every(l => typeof obj(l).path === 'string')) return null;
    out.push(...o.locations.map(l => obj(l).path as string));
  }
  if (o.files !== undefined) {
    if (!Array.isArray(o.files) || !o.files.every(f => typeof f === 'string')) return null;
    out.push(...o.files as string[]);
  }
  return out;
}

/** A change that would touch the agents' settings or hooks (rule 6): an edit there, or a command naming such a place or
 *  git's hooks path. A command that only reads may look. */
function touchesSettings(req: PermitRequest, command: boolean, cwd: string): boolean {
  const o = obj(req.input);
  if (command) {
    const raw = typeof o.command === 'string' ? o.command : '';
    if (/core\.hookspath/i.test(raw)) return true;
    const words = raw.split(/[\s'"`;&|<>(){}=,]+/).filter(w => /[\\/]/.test(w) || w.startsWith('.') || w.startsWith('~'));
    return words.some(w => settingsPath(w, cwd)) || (typeof o.cwd === 'string' && settingsPath(o.cwd, cwd));
  }
  const paths = pathsOf(o);
  if (!paths) return EDIT_TOOLS.has(req.tool);
  return paths.some(p => settingsPath(p, cwd));
}

function refusal(rule: PolicyRule, shown: string): PermitVerdict {
  const message = rule.action === 'esegui'
    ? `Held by the user's rule "${rule.id}": ${rule.why}. Only the user runs this, by pressing Esegui: do not run it or a variant of it. Write the exact command in a fenced code block in your reply and say what it does (a delegated chat reports it as userAction { kind: 'command', command }), then go on with the rest of the work.`
    : `Refused by the user's rule "${rule.id}": ${rule.why}. You may read and use a secret, but never print it: do not echo, cat or log its value. Pass it on without showing it (an environment variable, a file the program reads), then go on with the rest of the work.`;
  return { kind: 'deny', shown: shown.slice(0, 120), rule, message };
}

export function autoPermit(req: PermitRequest, ctx: PermitContext): PermitVerdict {
  if (req.type !== 'permission' || req.tool === 'ExitPlanMode') return ASK;
  const policy = ctx.policy ?? { state: 'none' };
  const command = COMMAND_TOOLS.includes(req.tool);
  const rule = policyHit(policy, req.tool, req.input, COMMAND_TOOLS);
  if (rule) {
    if (rule.action === 'ask-user') return { kind: 'ask', rule };
    const raw = obj(req.input).command;
    return refusal(rule, typeof raw === 'string' && raw.trim() ? raw.trim() : req.tool);
  }
  if (ctx.ceiling === 'plan' || ctx.ceiling === 'default') return ASK;
  const reads = command ? readOnlyCommand(obj(req.input).command, ctx.readScripts) : READ_TOOLS.has(req.tool);
  if (reads) return ALLOW;
  if (ctx.ceiling === 'acceptEdits' && !EDIT_TOOLS.has(req.tool)) return ASK;
  if (policy.state === 'broken') return ASK;
  if ((command || EDIT_TOOLS.has(req.tool)) && touchesSettings(req, command, ctx.cwd)) return ASK;
  return ALLOW;
}
