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
/** A shell line in pieces: a separator between commands, or a word (quoted stretches stay inside their word;
 *  redirections and blanks end one). */
const PIECES = /(\r?\n|;|&&|\|\||\||&)|((?:"[^"]*"|'[^']*'|[^\s;&|<>"'])+)/g;
const MOVES = /^(cd|pushd|chdir|set-location|push-location|sl)$/i;
/** the word before a quoted stretch that is a command line of its own (bash -c "…", cmd /c "…", pwsh -Command "…") */
const RUNS = /^(-l?c|-command|\/c|\/k|eval)$/i;
const NAME = /permissions\\?\.json/i;
/** The request names the brain's rules file. A tool: the file among its places, the file's name among them beside its
 *  folder (a copy or a move into the brain), or a session-wide grant of a folder that holds it. A command: the same,
 *  word by word, each command of the line read from the folder it runs in: the chat's, then wherever a literal `cd`
 *  moved it (`git -C x` for that command alone); home in its usual spellings (`~`, `$HOME`, `%USERPROFILE%`, Git Bash
 *  `/c/…` on Windows). Only a word that is the file counts: a mention inside a message, a heredoc or a web address
 *  does not, and neither does a word the app cannot read (a variable, a move it cannot follow). What only reads has
 *  passed already. A net by name, not a wall (ADR 0292). */
function namesRules(req: PermitRequest, command: boolean, cwd: string, file: string): boolean {
  if (!path.isAbsolute(cwd)) return false;
  const win = process.platform === 'win32';
  const fold = (p: string): string => win || process.platform === 'darwin' ? p.toLowerCase() : p;   // disks that fold case
  let target: string, folder: string;
  try { target = fold(realish(path.resolve(file))); folder = path.dirname(target); } catch { return false; }
  const home = os.homedir();
  /** A word as a path from `base` (null = the app lost where the line is): null when it cannot be read as one. */
  const at = (base: string | null, word: string): string | null => {
    let p = word.replace(/^file:\/\//i, '');
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return null;   // a web address is no place
    if (!win) p = p.replace(/\\(.)/g, '$1'); else p = p.replace(/^\\\\\?\\/, '');
    p = p.replace(/^(~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|\$env:HOME|%USERPROFILE%|%HOME%)(?=$|[\\/])/i, () => home);
    if (base) p = p.replace(/^(\$PWD|\$\{PWD\}|\$\(pwd\)|%CD%|\$_PWD_)(?=$|[\\/])/i, () => base);
    if (win) p = p.replace(/^\/(?:mnt\/)?([a-z])\/(?!\/)/i, (_m, d: string) => `${d}:/`);
    if (/[$`%*?]|^~/.test(p) || p.includes('\0')) return null;
    if (!path.isAbsolute(p) && !base) return null;
    const full = path.resolve(base ?? '/', p);
    return full.length > 32_768 ? null : full;   // longer than any path a disk holds
  };
  // each look reads the disk: asked once per path, and a line with more paths than any real one asks instead of stalling
  const seen = new Map<string, string | null>();
  const real = (full: string): string | null => {
    let r = seen.get(full);
    if (r === undefined) {
      if (seen.size >= 400) return target;
      try { r = fold(realish(full)); } catch { r = null; }
      seen.set(full, r);
    }
    return r;
  };
  /** the words of one command (or the places of one tool): the file itself, or its name beside its folder */
  const hit = (paths: (string | null)[]): boolean => {
    if (!paths.some(f => f && NAME.test(f))) return false;   // a command that never names it costs no look
    let named = false, inFolder = false;
    for (const full of paths) {
      if (!full) continue;
      const isName = NAME.test(path.basename(full)) && fold(path.basename(full)) === path.basename(target);
      if (!isName && named && inFolder) continue;
      const r = real(full);
      if (r === target) return true;
      named ||= isName;
      inFolder ||= r === folder;
    }
    return named && inFolder;
  };
  const input = obj(req.input);
  if (!command) {
    const places = placesOf(req.input, true) ?? [];
    if (places.some(p => NAME.test(p)) && hit(places.map(p => at(cwd, p)))) return true;
    // a grant of a whole folder for the session (Codex) frees every later edit under it, the rules file among them
    const root = typeof input.grantRoot === 'string' && input.grantRoot ? at(cwd, input.grantRoot) : null;
    const r = root ? real(root) : null;
    return !!r && (target === r || target.startsWith(r.endsWith(path.sep) ? r : r + path.sep));
  }
  const line = typeof input.command === 'string' ? input.command : '';
  const own = [input.cwd, input.workdir, input.working_directory].find((x): x is string => typeof x === 'string' && !!x);
  const start = own ? path.resolve(cwd, own) : cwd;
  const scan = (whole: string, from: string | null, depth: number): boolean => {
    if (!NAME.test(whole)) return false;
    // a heredoc's body is text, not words of the command; a substitution ($(…), `…`) is read as a line of its own
    // and stands in its word as something the app cannot read ($(pwd) is the folder it is in)
    const inner: string[] = [];
    const text = whole.replace(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2(?=\s|$)/g, (_m, _q, _tag, rest: string) => ` ${rest} `)
      .replace(/\$\(\s*pwd\s*\)/gi, '$_PWD_')
      .replace(/\$\(([^()]*)\)|`([^`]*)`/g, (_m, a?: string, b?: string) => { inner.push(a ?? b ?? ''); return '$_'; });
    if (depth < 3 && inner.some(x => scan(x, from, depth + 1))) return true;
    let base = from;                    // where the next command of the line runs
    let here = base;                    // where this one does (git -C x, tar -C x)
    let words: (string | null)[] = [];
    let first = true, prev = '';
    const pieces = [...text.matchAll(PIECES)];
    for (let i = 0; i <= pieces.length; i++) {
      const m = pieces[i];
      if (!m || m[1]) {                 // the command ends
        if (hit(words)) return true;
        words = []; here = base; first = true; prev = '';
        continue;
      }
      const quoted = m[2]!;
      const w = quoted.replace(/["']/g, '').replace(/^[({]+/, '');
      if (!w) continue;
      if (first && MOVES.test(w)) {
        // the folder the rest of the line runs in: the first word that is no option
        let j = i + 1, to: string | null = null;
        for (; j < pieces.length && !pieces[j]![1]; j++) {
          const x = pieces[j]![2]!.replace(/["']/g, '');
          if (/^(--|\/d|-\w[\w-]*)$/i.test(x)) continue;
          to = x.replace(/[)}]+$/, ''); break;
        }
        base = to === null ? null : at(base, to);
        here = base; i = j; first = false; prev = '';
        continue;
      }
      if (first && /^(builtin|command|sudo|time|nohup|env)$/i.test(w)) continue;
      // a bare first word is the program (or a name between backticks in a message), not a place, unless a
      // redirection writes there
      const program = first && !/[\\/()]/.test(w) && !/>[|&]?\s*$/.test(text.slice(Math.max(0, m.index - 8), m.index));
      first = false;
      if (program) { prev = w; continue; }
      const dir = /^(-C|--work-tree|--directory)$/.test(prev) ? w : /^(--work-tree|--directory)=(.+)$/.exec(w)?.[2];
      if (dir !== undefined) { here = at(here, dir); if (here) words.push(here); prev = w; continue; }
      if (NAME.test(w) || words.length < 64) {
        // a quoted stretch with blanks is a message, unless what comes before runs it as a line of its own
        if (/\s/.test(w)) { if (RUNS.test(prev) && depth < 3 && scan(w, here, depth + 1)) return true; }
        else for (const piece of new Set([w, ...w.replace(/^-[\w-]+:/, '').split(/[(){}=,]+/)])) if (piece) words.push(at(here, piece));
      }
      prev = w;
    }
    return false;
  };
  return scan(line, start, 0);
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
  if (req.type !== 'permission' || typeof req.tool !== 'string' || req.tool === 'ExitPlanMode') return ASK;
  if (req.title !== undefined && typeof req.title !== 'string') req = { ...req, title: String(req.title) };
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
  if (ctx.rulesFile && policy.state !== 'none') {
    let names: boolean;
    try { names = namesRules(req, command, ctx.cwd, ctx.rulesFile); } catch { names = true; }   // a text it cannot read is the user's call
    if (names) return { kind: 'ask', rulesFile: true };
  }
  return ALLOW;
}
