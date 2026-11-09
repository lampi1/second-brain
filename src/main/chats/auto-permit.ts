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
import { policyCovers, policyHit, policyTooLong, type BrainPolicy, type PolicyRule } from './permit-policy';

/** title: the engine's one line; an ACP engine names an MCP tool only there (its tool is «Tool») */
export interface PermitRequest { type: string; tool: string; input?: unknown; title?: string }
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
const SETTINGS_DIRS = new Set(['.git', '.claude', '.cursor', '.codex', '.opencode', '.githooks', '.husky', '.vscode', '.idea']);
const SETTINGS_FILE = /^(\.mcp\.json|\.claude\.json|\.guardallow|\.gitconfig|claude_desktop_config\.json|opencode\.jsonc?)$/i;
/** commands that change the agents' or git's settings without naming the file */
const SETTINGS_COMMAND = /\bgit\b[^;&|\n]*\bconfig\b[^;&|\n]*--(global|system)\b|\b(claude|codex|cursor-agent|agent|opencode)(\.exe)?\s+(mcp|config|plugins?|hooks?)\b|core\.hookspath/i;
/** an engine's cut (session.ts trimInput): a string ends with «… (+N)», a list stops at 200 entries */
const CUT = /… \(\+\d+\)$/;
/** what a tool writes or says, never where: its text may name a settings file without touching it */
const CONTENT_KEYS = new Set(['content', 'old_string', 'new_string', 'old_str', 'new_str', 'oldText', 'newText', 'text', 'description', 'title', 'explanation', 'instructions', 'code_edit', 'prompt', 'body', 'message', 'query', 'command']);

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
  // Windows reads `.git.`, `.git ` and `.git::$INDEX_ALLOCATION` as `.git`
  const parts = p.toLowerCase().split(/[\\/]+/).filter(Boolean).map(seg => seg.replace(/(?<=.):.*$/, '').replace(/[. ]+$/, '') || seg);
  return parts.some(seg => SETTINGS_DIRS.has(seg)) || SETTINGS_FILE.test(parts[parts.length - 1] ?? '');
};
/** p names a settings or hooks place, as written or once links are resolved (a link in the folder to ~/.claude). */
function settingsPath(p: string, cwd: string): boolean {
  if (!p || p.includes('\0')) return true;
  if (settingsSegments(p) || settingsSegments(p.replace(/\\/g, ''))) return true;
  if (!path.isAbsolute(cwd) || p.startsWith('~')) return false;
  try { return settingsSegments(realish(path.resolve(cwd, p))); } catch { return false; }
}

/** The places a tool names: every short one-line string value that is not its content (any engine's shape: file_path,
 *  filePath, target_file, Codex files, ACP locations), one level down too. null = it cannot be read whole (an engine cut
 *  it, or a list too long to be all there). */
function placesOf(input: unknown): string[] | null {
  const out: string[] = [];
  const walk = (v: unknown, depth: number): boolean => {
    if (typeof v === 'string') {
      if (CUT.test(v)) return false;
      if (v.length <= 1000 && !/[\r\n]/.test(v) && !/^https?:\/\//i.test(v)) out.push(v.replace(/^file:\/\//i, ''));
      return true;
    }
    if (depth > 20) return false;   // deeper than any engine's shape: not read whole
    if (Array.isArray(v)) return v.length < 200 && v.every(x => walk(x, depth + 1));
    if (v && typeof v === 'object') return Object.entries(v).every(([k, x]) => CONTENT_KEYS.has(k) ? cutFree(x, depth + 1) : walk(x, depth + 1));
    return true;
  };
  /** content is not a place, but a cut in it still hides what runs */
  const cutFree = (v: unknown, depth: number): boolean => typeof v === 'string' ? !CUT.test(v)
    : depth > 20 ? false : Array.isArray(v) ? v.length < 200 && v.every(x => cutFree(x, depth + 1)) : v && typeof v === 'object' ? Object.values(v).every(x => cutFree(x, depth + 1)) : true;
  return walk(input, 0) ? out : null;
}
const pathLike = (p: string): boolean => /[\\/]/.test(p) || p.startsWith('.') || p.startsWith('~');

/** A change that would touch the agents' settings or hooks (rule 6): a tool naming such a place, or a command naming
 *  one or changing them by itself. A command or tool that only reads may look. Null input shapes ask. */
function touchesSettings(req: PermitRequest, command: boolean, cwd: string): boolean {
  const o = obj(req.input);
  if (command) {
    // `.g''it` and `.g'i't` are `.git` to a shell; a glob can name a settings place by pattern (.gi?/hooks); `$'\x2e'`,
    // an escape that printf or echo (zsh and dash need no -e) turns into a name, and a `$(…)` or a `…` pair glued to a
    // path build a name the app cannot read. `X=$(…) cmd`, `echo $(date)`, `-v $(pwd):/app`, `grep '^$'`, a Windows
    // `C:\work\2026` path and PowerShell's single `t escape stay free.
    const line = typeof o.command === 'string' ? o.command : '';
    // `$'.git'` and `$".git"` are `.git`; PowerShell drops a backtick before a letter that is no escape (.g`it is .git)
    const raw = line.replace(/\$(?=['"])/g, '').replace(/['"]/g, '');
    const plain = raw.replace(/`(?![0abefnrtuv])/g, '');
    if (/\$'[^']*\\/.test(line)) return true;
    // printf or echo with an escape anywhere in the line (the app does not parse where an echo's arguments end:
    // redirects, substitutions and escaped quotes all move it). A Windows folder of digits (\2026\, \1.log, \0\) is
    // not an octal escape: its digits run on, or end at a \, a space, a .ext or the line's end
    const esc = /\\(x[0-9a-f]{2}|0?[0-7]{1,3}(?![\d\\\s]|\.\w|$)|u[0-9a-f]{4})/i;
    if (/\b(printf|echo)\b/i.test(line) && esc.test(line)) return true;
    if (/[^\s=;&|(<>]\$\(|[^\s=;&|(<>]`[^`]*`|\$\([^)]*\)[^\s;&|)<>:]|`[^`]*`[^\s;&|)<>:]/.test(raw)) return true;
    if (SETTINGS_COMMAND.test(raw)) return true;
    const base = typeof o.cwd === 'string' && o.cwd ? path.resolve(cwd, o.cwd) : cwd;
    const words = [...raw.split(/[\s'"`;&|<>(){}=,]+/), ...plain.split(/[\s'"`;&|<>(){}=,]+/)].filter(w => /[\\/]/.test(w) || w.startsWith('.') || w.startsWith('~'));
    if (words.some(w => /[*?[]/.test(w) && /(^|[\\/])\.[^\\/]*[*?[]|[*?[][^\\/]*[\\/]/.test(w))) return true;
    return words.some(w => settingsPath(w, base)) || (typeof o.cwd === 'string' && settingsPath(o.cwd, cwd));
  }
  const places = placesOf(o);
  if (!places) return true;
  return places.filter(pathLike).some(p => settingsPath(p, cwd));
}

/** An engine cut the request (session.ts trimInput): what runs is not what the rules would read. */
const cut = (input: unknown): boolean => placesOf(input) === null || Object.values(obj(input)).some(v => typeof v === 'string' && CUT.test(v));

function refusal(rule: PolicyRule, shown: string, command: boolean): PermitVerdict {
  const message = rule.action === 'esegui' && !command
    ? `Held by the user's rule "${rule.id}": ${rule.why}. Only the user does this: do not retry it or a variant of it. Tell the user exactly what is needed (the tool and its input) in your reply (a delegated chat reports it as userAction), then go on with the rest of the work.`
    : rule.action === 'esegui'
    ? `Held by the user's rule "${rule.id}": ${rule.why}. Only the user runs this, by pressing Esegui: do not run it or a variant of it. Write the exact command in a fenced code block in your reply and say what it does (a delegated chat reports it as userAction { kind: 'command', command }), then go on with the rest of the work.`
    : `Refused by the user's rule "${rule.id}": ${rule.why}. You may read and use a secret, but never print it: do not echo, cat or log its value. Pass it on without showing it (an environment variable, a file the program reads), then go on with the rest of the work.`;
  return { kind: 'deny', shown: shown.slice(0, 120), rule, message };
}

export function autoPermit(req: PermitRequest, ctx: PermitContext): PermitVerdict {
  if (req.type !== 'permission' || req.tool === 'ExitPlanMode') return ASK;
  const policy = ctx.policy ?? { state: 'none' };
  const command = COMMAND_TOOLS.includes(req.tool);
  const raw = obj(req.input).command;
  // the rules and rule 6 must read what will run: a command with no line, or one an engine cut, is the user's call
  if (command && (typeof raw !== 'string' || !raw.trim())) return ASK;
  if (cut(req.input)) return ASK;
  const rule = policyHit(policy, req.tool, req.input, COMMAND_TOOLS, req.title);
  if (rule) {
    if (rule.action === 'ask-user') return { kind: 'ask', rule };
    return refusal(rule, typeof raw === 'string' ? raw.trim() : req.title?.trim() || req.tool, command);
  }
  // no rule in what they read, but longer than that, for a tool they could hold: what they cannot see may be what they hold
  if (policyCovers(policy, req.tool, COMMAND_TOOLS, req.title) && policyTooLong(req.tool, req.input, COMMAND_TOOLS, req.title)) return ASK;
  if (ctx.ceiling === 'plan' || ctx.ceiling === 'default') return ASK;
  const reads = command ? readOnlyCommand(raw, ctx.readScripts) : READ_TOOLS.has(req.tool);
  if (reads) return ALLOW;
  if (ctx.ceiling === 'acceptEdits' && !EDIT_TOOLS.has(req.tool)) return ASK;
  if (policy.state === 'broken') return ASK;
  // Codex's grantRoot is write access under a folder for the rest of the session: later writes never come back here
  if (obj(req.input).grantRoot !== undefined) return ASK;
  if (EDIT_TOOLS.has(req.tool) && !placesOf(req.input)?.some(pathLike) && !placesOf(req.input)?.some(p => /^[\w.-]+\.\w+$/.test(p))) return ASK; // an edit that names no file
  if (touchesSettings(req, command, ctx.cwd)) return ASK;
  return ALLOW;
}
