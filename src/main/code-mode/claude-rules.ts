// Claude's own permission rules for run_code's internal calls (Code Mode, ADR 0331). A Claude chat in Code Mode no
// longer sees its native Bash/Read/Edit/… tools, so Claude never checks those calls against its deny and ask rules: the
// user's, the project's and local settings files, the managed policy, and the session's inline --settings (the STABLE
// app's guard rails, stableGuards, among them). This module reads the same rules and matches a wrapper call against
// them, so a call Claude would deny is denied and one it would ask about asks. Fail closed: a settings file that exists
// but cannot be read or parsed denies every call (the app cannot tell what it would forbid). Matching leans to the
// safe side (a deny pattern matches each part of a compound command, either Bash or PowerShell rule forms, a path rule
// with no folder anywhere). Pure apart from reading the files; used by chats/manager-sink.ts (decideFor) and the
// wrappers' search filter (code-mode/natives.ts), tested in test/unit/code-mode/claude-rules.test.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** One rule with the folder its relative `/x` paths start from (the settings file's project root). */
export interface ClaudeRule { rule: string; base: string }
export type ClaudeRuleSet = { ok: true; deny: ClaudeRule[]; ask: ClaudeRule[] } | { ok: false; error: string };

/** Where one Claude session reads its rules: its settings files (Claude's order), its inline --settings, and the
 *  folder it works in (relative paths of the rules and of the calls). */
export interface ClaudeRuleSources { files: string[]; inline: Record<string, unknown> | null; cwd: string }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Claude's settings files for a session in `cwd`: managed policy, the user's (CLAUDE_CONFIG_DIR or ~/.claude), the
 *  project's shared and local ones. */
export function claudeRuleFiles(cwd: string, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string[] {
  const managed = process.platform === 'win32'
    ? [path.join(env.ProgramFiles ?? 'C:\\Program Files', 'ClaudeCode', 'managed-settings.json'), path.join(env.ProgramData ?? 'C:\\ProgramData', 'ClaudeCode', 'managed-settings.json')]
    : process.platform === 'darwin' ? ['/Library/Application Support/ClaudeCode/managed-settings.json'] : ['/etc/claude-code/managed-settings.json'];
  const user = env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, 'settings.json') : path.join(home, '.claude', 'settings.json');
  return [...new Set([...managed, user, path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')].map(f => path.resolve(f)))];
}

/** The deny and ask rules of a session's sources (auto mode's soft_deny `Tool(pattern)` rules count as ask). A file
 *  that is missing adds nothing; one that exists but cannot be read or parsed makes the whole set unreadable. */
export function readClaudeRuleSet(src: ClaudeRuleSources, home = os.homedir()): ClaudeRuleSet {
  const deny: ClaudeRule[] = [], ask: ClaudeRule[] = [];
  const add = (j: Record<string, unknown>, base: string): void => {
    const p = obj(j.permissions);
    for (const r of strs(p.deny)) deny.push({ rule: r, base });
    for (const r of strs(p.ask)) ask.push({ rule: r, base });
    for (const r of strs(obj(j.autoMode).soft_deny)) { const m = /^([A-Za-z]+\(.*?\))(\s|$)/.exec(r.trim()); if (m) ask.push({ rule: m[1]!, base }); }
  };
  for (const file of src.files) {
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') continue; return { ok: false, error: `${file} could not be read` }; }
    if (!text.trim()) continue;
    let j: unknown;
    try { j = JSON.parse(text); } catch { return { ok: false, error: `${file} is not valid JSON` }; }
    const dir = path.dirname(file);
    add(obj(j), path.basename(dir) === '.claude' ? path.dirname(dir) : path.dirname(file) === path.join(home, '.claude') ? home : dir);
  }
  if (src.inline) add(src.inline, src.cwd);
  return { ok: true, deny, ask };
}

/** The rule kinds a wrapper call meets: Bash meets Bash and PowerShell rules, Read/Grep/Glob meet Read rules, Write
 *  and Edit meet every file-editing tool's rules. */
const READS = new Set(['Read', 'Grep', 'Glob']), EDITS = new Set(['Write', 'Edit']);
const EDIT_RULES = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const esc = (s: string): string => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
const ci = process.platform === 'win32' ? 'i' : '';

/** An absolute path in one comparable form: forward slashes, a drive as `c:` (Claude's `//c/x` is the same place). */
function canon(p: string): string {
  let s = p.replace(/\\/g, '/');
  const posixDrive = /^\/\/([A-Za-z])(\/|$)/.exec(s);
  if (posixDrive) s = `${posixDrive[1]!.toLowerCase()}:/${s.slice(4)}`;
  else if (s.startsWith('//')) s = s.slice(1);
  s = s.replace(/^([A-Za-z]):/, (_m, d: string) => `${d.toLowerCase()}:`);
  return s.replace(/\/+$/, '') || '/';
}

/** A gitignore-style glob (`**` any folders, `*` within a name, `?` one character) as a RegExp over a canon path;
 *  `x/**` also matches the folder x itself. */
function pathRe(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += esc(c);
  }
  return new RegExp(`^${re.replace(/\/\.\*$/, '(?:/.*)?')}$`, ci);
}

/** The places a Claude path pattern names, as canon globs: `~/x` home, `//x` or `C:/x` absolute, `/x` from the
 *  settings file's root, anything else from the chat's folder and (with no folder in it, gitignore's rule) anywhere. */
function pathGlobs(pattern: string, base: string, cwd: string, home: string): string[] {
  const p = pattern.replace(/\\/g, '/');
  if (p === '~' || p.startsWith('~/')) return [canon(path.join(home, p.slice(1)))];
  if (p.startsWith('//') || /^[A-Za-z]:\//.test(p)) return [canon(p)];
  if (p.startsWith('/')) return [canon(path.join(base, p))];
  const rel = p.replace(/^\.\//, '');
  return [canon(path.join(cwd, rel)), ...(rel.startsWith('**/') ? [] : [`**/${rel}`])];
}

/** The parts of a command line a rule can name: the whole, and each command of a compound one (`;`, `&&`, `||`, `|`, a
 *  new line, `$(…)`, backticks, a quoted `-c "…"`), with leading `VAR=value` assignments and `sudo` taken off. */
export function commandParts(command: string): string[] {
  const parts = command.split(/&&|\|\||[;|\n`]|\$\(|\(|\)|\{|\}|["']/).map(s => s.trim()).filter(Boolean);
  const bare = (s: string): string => s.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '').replace(/^(?:sudo|exec|command|nohup|env)\s+/, '');
  return [...new Set([command.trim(), ...parts, ...parts.map(bare)].filter(Boolean))];
}

/** True when a Bash/PowerShell rule's pattern names this command: `prefix:*` (or a trailing ` *`) any part starting
 *  with it, `a * b` a wildcard over a part, else a part equal to it. */
function commandMatches(pattern: string, command: string, flags: string): boolean {
  const parts = commandParts(command);
  const prefix = /^(.*?)(?::\*| \*)$/s.exec(pattern);
  if (prefix) { const pre = new RegExp(`^${prefix[1]!.split('*').map(esc).join('.*')}`, flags); return parts.some(p => pre.test(p)); }
  if (pattern.includes('*')) { const re = new RegExp(`^${pattern.split('*').map(esc).join('.*')}$`, flags); return parts.some(p => re.test(p)); }
  return parts.some(p => (flags ? p.toLowerCase() === pattern.toLowerCase() : p === pattern));
}

/** The path a file or search wrapper call points at (a search without one: the chat's folder). */
const targetOf = (tool: string, input: Record<string, unknown>, cwd: string): string | null => {
  const p = tool === 'Grep' || tool === 'Glob' ? (typeof input.path === 'string' && input.path ? input.path : '.') : input.file_path;
  return typeof p === 'string' && p ? path.resolve(cwd, p) : null;
};

/** True when one Claude rule (`Tool`, `Tool(pattern)`, `mcp__server`, `mcp__server__tool`) covers this call. `tool`
 *  is the gate's name (the wrapper's bare name, or `mcp__<server>__<tool>`). */
export function ruleMatches(r: ClaudeRule, tool: string, input: unknown, cwd: string, home = os.homedir()): boolean {
  const rule = r.rule.trim();
  const args = obj(input);
  if (rule.startsWith('mcp__')) {
    const [, server, name] = /^mcp__(.+?)(?:__(.+))?$/s.exec(rule) ?? [];
    if (!server || !tool.startsWith(`mcp__${server}__`)) return false;
    return !name || name === '*' || tool === `mcp__${server}__${name}`;
  }
  const m = /^([A-Za-z]+)(?:\((.*)\))?$/s.exec(rule);
  if (!m) return false;
  const kind = m[1]!, pat = m[2];
  const every = pat === undefined || pat === '' || pat === '*' || pat === '**';
  if (kind === 'Bash' || kind === 'PowerShell') {
    if (tool !== 'Bash') return false;
    if (every) return true;
    const command = typeof args.command === 'string' ? args.command : '';
    return commandMatches(pat!, command, kind === 'PowerShell' ? 'i' : ci);
  }
  const reads = kind === 'Read' && READS.has(tool), edits = EDIT_RULES.has(kind) && EDITS.has(tool);
  if (!reads && !edits && kind !== tool) return false;
  if (every) return reads || edits || kind === tool;
  if (!reads && !edits) return false;
  const target = targetOf(tool, args, cwd);
  if (!target) return true; // no path to check: the safe side
  const t = canon(target);
  return pathGlobs(pat!, r.base, cwd, home).some(g => pathRe(g).test(t));
}

/** Claude's verdict on one wrapper call: deny wins over ask; null = no rule of the user's names it. */
export function claudeVerdict(set: Extract<ClaudeRuleSet, { ok: true }>, tool: string, input: unknown, cwd: string, home = os.homedir()): { kind: 'deny' | 'ask'; rule: string } | null {
  const d = set.deny.find(r => ruleMatches(r, tool, input, cwd, home));
  if (d) return { kind: 'deny', rule: d.rule };
  const a = set.ask.find(r => ruleMatches(r, tool, input, cwd, home));
  return a ? { kind: 'ask', rule: a.rule } : null;
}

/** The search wrappers' filter (Grep, Glob): false for a file a Read deny rule covers, so a search of a folder never
 *  returns what a Read of that file would be refused. */
export function readableBy(set: Extract<ClaudeRuleSet, { ok: true }>, cwd: string, home = os.homedir()): (abs: string) => boolean {
  const reads = set.deny.filter(r => /^Read\(/.test(r.rule.trim()));
  if (!reads.length) return () => true;
  return abs => !reads.some(r => ruleMatches(r, 'Read', { file_path: abs }, cwd, home));
}
