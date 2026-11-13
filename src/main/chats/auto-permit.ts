// The app answers a chat's permission requests itself (ADR 0103, made "allow by default" by ADR 0254, issue #352): the
// app has no opinion of its own on what is dangerous, the user's brain decides (chats/permit-policy.ts,
// `<brain>/permissions.json`). Everything passes, for every engine, unless:
// - a rule of the user's policy holds it: `esegui` and `never-print` refuse it with the rule's reason (the chat goes
//   on: the agent reads the refusal), `ask-user` sends it to the user;
// - the policy file is there but cannot be read: the app cannot know the user's rules, so all but reads reach the user;
// - the user narrowed the role on its card: «Chiede conferma» or «Solo piano» ask everything but reads, «Accetta
//   modifiche» lets reads and edits through and asks the rest;
// - it would change the brain's rules file itself (permissions.json): an agent that may rewrite the rules has none;
// - it is a plan to approve (ExitPlanMode): the user's call by its nature.
// The app keeps no guard of its own on settings or hooks (ADR 0292; a user who wants one writes it as a rule).
// Pure (the file system only to resolve links); used by ChatManager's sink.pending after the role gate; pinned by
// test/unit/chats/auto-permit.test.ts and permit-policy.test.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PermissionCeiling } from '../../shared/agents';
import { COMMAND_TOOLS, readOnlyCommand, type ReadScripts } from '../agents/tool-policy';
import { policyCovers, policyRead, type BrainPolicy, type PolicyRule } from './permit-policy';

/** title: the engine's one line; an ACP engine names an MCP tool only there (its tool is «Tool») */
/** whole: the input is as the engine sent it (Claude, ADR 0290), not a copy an engine or the app shortened: the signs
 *  of a cut (a string ending «… (+N)», a list of 200) are then plain content */
export interface PermitRequest { type: string; tool: string; input?: unknown; title?: string; whole?: boolean }
export interface PermitContext {
  /** the chat's folder: relative paths are read from here */
  cwd: string;
  /** the role's limit set by the user on its card (null = none) */
  ceiling: PermissionCeiling | null;
  /** the brain's declared read-only node tools (agents/read-tools.ts) */
  readScripts?: ReadScripts;
  /** the user's rules from the brain (permit-policy.ts loadPolicy); missing = none */
  policy?: BrainPolicy;
  /** the brain's rules file (absolute path), when the brain has one: a change of it is the user's call */
  rulesFile?: string;
  /** the clock of the rules' time budget (permit-policy.ts policyRead); the tests' own, else the real one */
  now?: () => number;
}
export type PermitVerdict =
  | { kind: 'allow' }
  /** rule: the user's policy rule that sent it to the user (no «always» then: a rule would free later ones) */
  | { kind: 'ask'; rule?: PolicyRule; rulesFile?: true }
  /** a rule of the user's policy refused it. message: English, what the model reads */
  | { kind: 'deny'; shown: string; rule: PolicyRule; message: string };

const ASK: PermitVerdict = { kind: 'ask' };
const ALLOW: PermitVerdict = { kind: 'allow' };

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'Search', 'TodoWrite', 'Think', 'WebSearch']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Delete', 'Move']);
/** an engine's cut (session.ts trimInput): a string ends with «… (+N)», a list stops at 200 entries */
const CUT = /… \(\+\d+\)$/;
/** what a tool writes or says, never where */
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

/** The places a tool may name: every string value that is not its content (any engine's shape: file_path, filePath,
 *  target_file, Codex files, ACP locations), one level down too. null = it cannot be read whole (an engine cut
 *  it, or a list too long to be all there). */
function placesOf(input: unknown, whole = false): string[] | null {
  const out: string[] = [];
  const walk = (v: unknown, depth: number): boolean => {
    if (typeof v === 'string') {
      if (!whole && CUT.test(v)) return false;
      // however long and on however many lines: a tool that tidies a path before it opens it reaches the same file
      // through `./` twenty thousand times or a line break before `/..`. A web address is no place, unless it climbs
      if (!/^https?:\/\/\S*$/i.test(v) || /(^|[\\/])\.\.([\\/]|$)/.test(v)) out.push(v.replace(/^file:\/\//i, ''));
      return true;
    }
    if (depth > 20) return false;   // deeper than any engine's shape: not read whole
    if (Array.isArray(v)) return (whole || v.length < 200) && v.every(x => walk(x, depth + 1));
    if (v && typeof v === 'object') return Object.entries(v).every(([k, x]) => CONTENT_KEYS.has(k) ? cutFree(x, depth + 1) : walk(x, depth + 1));
    return true;
  };
  /** content is not a place, but a cut in it still hides what runs */
  const cutFree = (v: unknown, depth: number): boolean => typeof v === 'string' ? whole || !CUT.test(v)
    : depth > 20 ? false : Array.isArray(v) ? (whole || v.length < 200) && v.every(x => cutFree(x, depth + 1)) : v && typeof v === 'object' ? Object.values(v).every(x => cutFree(x, depth + 1)) : true;
  return walk(input, 0) ? out : null;
}
/** A shell line as words: quoted stretches stay inside their word, separators and redirections end one. */
const WORDS = /(?:"[^"]*"|'[^']*'|[^\s;&|<>"'])+/g;
const MOVES = /^(cd|pushd|chdir|set-location|sl)$/i;
/** The request names the brain's rules file: a tool with it among its places (or a session-wide grant of a folder that
 *  holds it), or a command with it among its words. The words are read from the chat's folder and from every folder
 *  the line itself moves to (`cd x`, `git -C x`); home is read in its usual spellings (`~`, `$HOME`, `%USERPROFILE%`,
 *  Git Bash `/c/…` on Windows). A word that ends in the file's name through a variable the app cannot read, or after
 *  a move it cannot follow, counts too: the app does not know where it lands. What only reads has passed already.
 *  A net by name, not a wall: a command that reaches the file without naming it is not seen (ADR 0292). */
function namesRules(req: PermitRequest, command: boolean, cwd: string, file: string): boolean {
  if (!path.isAbsolute(cwd)) return false;
  const win = process.platform === 'win32';
  const fold = (p: string): string => win ? p.toLowerCase() : p;
  let target: string;
  try { target = fold(realish(path.resolve(file))); } catch { return false; }
  const home = os.homedir();
  const plain = (p: string): string => {
    let out = p.replace(/^file:\/\//i, '').replace(/^(~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|\$env:HOME|%USERPROFILE%|%HOME%)(?=$|[\\/])/i, () => home);
    if (win) out = out.replace(/^\/(?:mnt\/)?([a-z])\/(?!\/)/i, (_m, d: string) => `${d}:/`);
    return out;
  };
  const open = (p: string): boolean => /[$`%]|^~/.test(p);
  // each look reads the disk: a line that names the file more times than any real one asks instead of stalling the app
  let looks = 0;
  const same = (base: string, p: string): boolean => {
    if (++looks > 400) return true;
    try { return fold(realish(path.resolve(base, p))) === target; } catch { return true; }
  };
  const input = obj(req.input);
  if (!command) {
    if ((placesOf(req.input, true) ?? []).some(p => /permissions\.json/i.test(p) && same(cwd, plain(p)))) return true;
    // a grant of a whole folder for the session (Codex) frees every later edit under it, the rules file among them
    const root = typeof input.grantRoot === 'string' && input.grantRoot ? input.grantRoot : null;
    if (!root) return false;
    try { const r = fold(realish(path.resolve(cwd, plain(root)))); return target === r || target.startsWith(r.endsWith(path.sep) ? r : r + path.sep); } catch { return true; }
  }
  const line = typeof input.command === 'string' ? input.command : '';
  const start = typeof input.cwd === 'string' && input.cwd ? path.resolve(cwd, input.cwd) : cwd;
  const scan = (whole: string, from: string[], depth: number): boolean => {
    if (!/permissions\.json/i.test(whole)) return false;
    const bases = [...from];
    let lost = false;   // the line moved somewhere the app cannot follow
    // a substitution ($(…), `…`) stands in its word as a variable the app cannot read; what it runs is read on its own
    const inner: string[] = [];
    const text = whole.replace(/\$\(([^()]*)\)|`([^`]*)`/g, (_m, a?: string, b?: string) => { inner.push(a ?? b ?? ''); return '$_'; });
    if (depth < 3 && inner.some(x => scan(x, bases, depth + 1))) return true;
    const words = (text.match(WORDS) ?? []).map(w => w.replace(/["'`]/g, m => m === '`' ? m : ''));
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      if (MOVES.test(w) || w === '-C') {
        let j = i + 1;
        while (MOVES.test(w) && j < words.length && /^-\w/.test(words[j]!)) j++;   // Set-Location -Path x
        const to = j < words.length ? plain(words[j]!) : '';
        if (!to || open(to) || to === '-' || bases.length > 32) lost = true;
        else bases.push(...bases.map(b => path.resolve(b, to)));
        continue;
      }
      if (!/permissions\.json/i.test(w)) continue;
      // a quoted stretch with its own words (bash -c "…", a commit message): read as a line of its own
      if (/\s/.test(w)) { if (depth < 3 && scan(w, bases, depth + 1)) return true; continue; }
      for (const piece of new Set([w, ...w.split(/[(){}=,]+/)])) {
        if (!/permissions\.json/i.test(piece)) continue;
        const p = plain(piece);
        if (/permissions\.json$/i.test(p) && (open(p) || (lost && !path.isAbsolute(p)))) return true;
        if (bases.some(b => same(b, p))) return true;
      }
    }
    return false;
  };
  return scan(line, [start], 0);
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
  // some rule could hold this tool (or the rules cannot be read): then they must read what will run, so a command
  // with no line, or a request an engine cut, is the user's call. With no rule on the tool, nothing needs reading
  const covered = policyCovers(policy, req.tool, COMMAND_TOOLS, req.title);
  if (covered && command && (typeof raw !== 'string' || !raw.trim())) return ASK;
  if (covered && !req.whole && cut(req.input)) return ASK;
  const { rule, unread } = policyRead(policy, req.tool, req.input, COMMAND_TOOLS, req.title, ctx.now);
  if (rule) {
    if (rule.action === 'ask-user') return { kind: 'ask', rule };
    return refusal(rule, typeof raw === 'string' ? raw.trim() : req.title?.trim() || req.tool, command);
  }
  // no rule in what they read, but they did not read it all (longer than their limit, or too slow to read): what they
  // did not see may be what they hold. Only for a tool some rule could hold
  if (unread && covered) return ASK;
  // looking never asks, whatever the role's limit (ADR 0278: the quick-answer role, limited to «Solo piano», asked the
  // user for Read, Glob and Grep)
  const reads = command ? readOnlyCommand(raw, ctx.readScripts) : READ_TOOLS.has(req.tool);
  if (reads) return ALLOW;
  if (ctx.ceiling === 'plan' || ctx.ceiling === 'default') return ASK;
  if (ctx.ceiling === 'acceptEdits' && !EDIT_TOOLS.has(req.tool)) return ASK;
  if (policy.state === 'broken') return ASK;
  // Codex's grantRoot is write access under a folder for the rest of the session: later writes never come back here,
  // so where a rule could hold an edit the grant is the user's call
  if (obj(req.input).grantRoot !== undefined && covered) return ASK;
  // the rules file is the user's to change: no «always» on it either
  if (ctx.rulesFile && policy.state !== 'none' && namesRules(req, command, ctx.cwd, ctx.rulesFile)) return { kind: 'ask', rulesFile: true };
  return ALLOW;
}
