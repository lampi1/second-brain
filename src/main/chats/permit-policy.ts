// The user's own permission rules, read from their brain (ADR 0254, issue #352): the app has no opinion of its own on
// what is dangerous. `<brain>/permissions.json` lists rules; a rule that matches a permission request either holds it
// for the user's Esegui click (`esegui`: the agent gives the exact command, the user runs it), sends it to the user
// (`ask-user`), or refuses it because it would print a secret (`never-print`). No file: no rule, everything is free. A
// file that cannot be read: the app cannot know the user's rules, so it asks the user for everything that is not a read
// (never a fixed deny list of its own). Pure apart from reading the file (cached by mtime and size); used by
// auto-permit.ts; pinned by test/unit/chats/permit-policy.test.ts with the owner's policy as fixture.
import fs from 'node:fs';
import path from 'node:path';

export const POLICY_FILE = 'permissions.json';
export const POLICY_ACTIONS = ['esegui', 'ask-user', 'never-print'] as const;
export type PolicyAction = typeof POLICY_ACTIONS[number];
/** what a rule looks at: the tool classes below, or an exact tool name (case-insensitive) */
export const POLICY_TOOL_CLASSES = ['command', 'edit', 'read', 'web', 'mcp', '*'] as const;

export interface PolicyRule {
  id: string;
  action: PolicyAction;
  /** the user's reason, shown in the chat and given to the agent */
  why: string;
  tools: string[];
  match: RegExp[];
  unless: RegExp[];
}
export type BrainPolicy =
  | { state: 'none' }
  | { state: 'ok'; rules: PolicyRule[] }
  | { state: 'broken'; error: string };

const MAX_RULES = 200, MAX_PATTERN = 500, MAX_PATTERNS = 50, MAX_FILE = 256 * 1024, MAX_SUBJECT = 100_000;
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

const COMMAND = new Set(['bash', 'powershell', 'shell', 'execute', 'terminal', 'run_terminal_cmd', 'exec_command', 'local_shell']);
const EDIT = new Set(['edit', 'write', 'multiedit', 'notebookedit', 'delete', 'move', 'apply_patch', 'patch']);
const READ = new Set(['read', 'glob', 'grep', 'ls', 'notebookread', 'search', 'list']);
const WEB = new Set(['webfetch', 'websearch', 'codesearch', 'fetch']);

/** The class of a tool name, for a rule's `tools`. */
export function toolClass(tool: string, commandTools: readonly string[]): string {
  const t = tool.toLowerCase();
  if (commandTools.includes(tool) || COMMAND.has(t)) return 'command';
  if (EDIT.has(t)) return 'edit';
  if (READ.has(t)) return 'read';
  if (WEB.has(t)) return 'web';
  // an ACP engine's MCP call is a «Tool» named only by its title (OpenCode <server>_<tool>, Cursor's own form)
  if (t.startsWith('mcp__') || t.startsWith('mcp_') || t.includes('__') || t === 'tool') return 'mcp';
  return 'other';
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function patterns(v: unknown, where: string): RegExp[] {
  if (v === undefined) return [];
  const list = typeof v === 'string' ? [v] : v;
  if (!Array.isArray(list) || list.length > MAX_PATTERNS || !list.every(p => typeof p === 'string' && p.length > 0 && p.length <= MAX_PATTERN)) {
    throw new Error(`${where}: a list of 1-${MAX_PATTERN} character patterns is expected`);
  }
  return list.map(p => {
    try { return new RegExp(p, 'iu'); } catch { throw new Error(`${where}: «${p}» is not a valid pattern`); }
  });
}

/** Parses the file's text. A file that is not exactly the format is broken as a whole: half a policy would silently
 *  free what the missing rules held. */
export function parsePolicy(text: string): BrainPolicy {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch (e) { return { state: 'broken', error: `not JSON: ${(e as Error).message}` }; }
  try {
    if (!isObj(doc) || doc.version !== 1 || !Array.isArray(doc.rules)) throw new Error('expected { "version": 1, "rules": [...] }');
    if (doc.rules.length > MAX_RULES) throw new Error(`at most ${MAX_RULES} rules`);
    const ids = new Set<string>();
    const rules = doc.rules.map((raw, i): PolicyRule => {
      const where = `rule ${i + 1}`;
      if (!isObj(raw)) throw new Error(`${where}: not an object`);
      const id = raw.id;
      if (typeof id !== 'string' || !ID.test(id) || ids.has(id)) throw new Error(`${where}: a unique id (letters, digits, . _ -) is expected`);
      ids.add(id);
      if (!POLICY_ACTIONS.includes(raw.action as PolicyAction)) throw new Error(`${where} (${id}): action must be ${POLICY_ACTIONS.join(', ')}`);
      if (typeof raw.why !== 'string' || !raw.why.trim() || raw.why.length > 300) throw new Error(`${where} (${id}): why (1-300 characters) is expected`);
      const tools = raw.tools === undefined ? ['command'] : raw.tools;
      if (!Array.isArray(tools) || !tools.length || !tools.every(t => typeof t === 'string' && t.length > 0 && t.length <= 120)) throw new Error(`${where} (${id}): tools must be a list of tool classes or names`);
      // a class spelled wrong would be a rule that never fires: «commands», «Command»
      const classes = POLICY_TOOL_CLASSES as readonly string[];
      const typo = (tools as string[]).find(t => !classes.includes(t.toLowerCase()) && classes.includes(t.toLowerCase().replace(/s$/, '')));
      if (typo) throw new Error(`${where} (${id}): «${typo}» is not a tool class (${POLICY_TOOL_CLASSES.join(', ')})`);
      const match = patterns(raw.match, `${where} (${id}) match`);
      if (!match.length) throw new Error(`${where} (${id}): match is required`);
      for (const k of Object.keys(raw)) if (!['id', 'action', 'why', 'tools', 'match', 'unless'].includes(k)) throw new Error(`${where} (${id}): unknown field «${k}»`);
      return { id, action: raw.action as PolicyAction, why: raw.why.trim(), tools: tools.map(t => (t as string).toLowerCase()), match, unless: patterns(raw.unless, `${where} (${id}) unless`) };
    });
    for (const k of Object.keys(doc)) if (!['version', 'rules', '$comment'].includes(k)) throw new Error(`unknown field «${k}»`);
    return { state: 'ok', rules };
  } catch (e) {
    return { state: 'broken', error: (e as Error).message };
  }
}

let cache: { file: string; mtimeMs: number; ctimeMs: number; size: number; policy: BrainPolicy } | null = null;

/** The policy of the brain at brainRoot (null: no brain chosen yet = no rule). */
export function loadPolicy(brainRoot: string | null | undefined): BrainPolicy {
  if (!brainRoot) return { state: 'none' };
  const file = path.join(brainRoot, POLICY_FILE);
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return { state: 'broken', error: `cannot be read: ${(e as NodeJS.ErrnoException).code ?? 'error'}` };
    // no file in a brain that is there: no rule. A brain that is not there (an unplugged disk, an offline cloud
    // folder) may hold rules the app cannot see
    try { return fs.statSync(brainRoot).isDirectory() ? { state: 'none' } : { state: 'broken', error: 'the brain folder is not a folder' }; }
    catch { return { state: 'broken', error: 'the brain folder cannot be reached' }; }
  }
  if (!st.isFile()) return { state: 'broken', error: 'not a file' };
  if (st.size > MAX_FILE) return { state: 'broken', error: `larger than ${MAX_FILE / 1024} KB` };
  if (cache && cache.file === file && cache.mtimeMs === st.mtimeMs && cache.ctimeMs === st.ctimeMs && cache.size === st.size) return cache.policy;
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { state: 'broken', error: `cannot be read: ${(e as NodeJS.ErrnoException).code ?? 'error'}` }; }
  const policy = parsePolicy(text.replace(/^﻿/, ''));
  cache = { file, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, size: st.size, policy };
  return policy;
}

/** What a rule is matched against: a command's own line; any other tool's name (and title), its input as JSON, then
 *  each top-level text value as `key: value` lines (a query that starts on a new line reads as written). */
export function policySubject(tool: string, input: unknown, cls: string, title?: string): string {
  return subjectParts(tool, input, cls, title).join('\n');
}
/** The subject in the parts that each say everything: a command's line alone; for any other tool the name with the
 *  text values, then the name with the JSON (it repeats the values). */
function subjectParts(tool: string, input: unknown, cls: string, title?: string): string[] {
  const o = isObj(input) ? input : {};
  if (cls === 'command' && typeof o.command === 'string') return [o.command];
  let json = '';
  try { json = JSON.stringify(input ?? {}); } catch { /* circular: the name alone */ }
  // text values first, one level down too (Codex's {server, tool, arguments}): a long JSON cannot push them out
  const values = Object.entries(o).flatMap(([k, v]) => typeof v === 'string' ? [`${k}: ${v}`]
    : isObj(v) ? Object.entries(v).filter(([, x]) => typeof x === 'string').map(([k2, x]) => `${k2}: ${x as string}`) : []);
  // first line: the name; last line: the name and the JSON on one line, as a rule on `tool + JSON input` reads it
  const head = `${tool}${title && title !== tool ? ` ${title}` : ''}`;
  return [[head, ...values].join('\n'), `${head} ${json}`];
}
/** What the rules are run on: the whole subject, each part cut at the limit. A long file is in the subject twice (its
 *  text, then the JSON), so a file of half the limit is not «too long»; a pattern still reads one text, whatever the
 *  size, so a rule means the same on a short and on a long request (ADR 0290). long: a part is over the limit, so some
 *  of it is not read. */
function readable(tool: string, input: unknown, cls: string, title?: string): { text: string; long: boolean } {
  const parts = subjectParts(tool, input, cls, title);
  return { text: parts.map(p => p.slice(0, MAX_SUBJECT)).join('\n'), long: parts.some(p => p.length > MAX_SUBJECT) };
}

const ruleSees = (rule: PolicyRule, cls: string, name: string, title: string): boolean => rule.tools.some(t => t === '*' || t === cls || t === name || (!!title && t === title));

/** What the rules say of a request. unread: they did not read it all (a part over the limit, or they would take too
 *  long), so no rule found is not «no rule holds it»: the caller asks. */
export interface PolicyRead { rule: PolicyRule | null; unread: boolean }

// The rules run in the main process and a pattern cannot be stopped: one that goes back over the text for every match
// (`psql[\s\S]*insert`, on a text full of «psql») takes seconds on 100,000 characters. So the rules have a time budget
// for one request, and on a long text each pattern is first timed on every 20,000 characters of it: when the whole
// text would take too long at that pace, the app stops and asks.
const BUDGET_MS = 250, PATTERN_MS = 250, PROBE = 20_000, NOISE_MS = 25;

/** A pattern is quick enough on the whole text, judged by its time on each stretch of PROBE characters. A pattern that
 *  goes back over the text scans from each match to the end, so a slow stretch weighs as much as the text after it is
 *  long (all of it slow: the square of the length). spent: the request's time so far is over its budget. */
function quick(re: RegExp, text: string, now: () => number, spent: () => boolean): boolean {
  let whole = 0;
  for (let at = 0; at < text.length; at += PROBE) {
    if (spent()) return false;
    const stretch = text.slice(at, at + PROBE), weight = Math.max(1, 2 * (text.length - at) / PROBE - 1);
    // a short time that would stop the pattern is taken again, the fastest of three: one look alone also measures
    // what else the machine was doing; a long one is the pattern's own
    let ms = Infinity;
    for (let look = 0; look < 3 && whole + ms * weight > PATTERN_MS && (look === 0 || ms <= NOISE_MS); look++) {
      const t0 = now();
      re.test(stretch);
      ms = Math.min(ms, now() - t0);
    }
    whole += ms * weight;
    if (whole > PATTERN_MS) return false;
  }
  return true;
}

/** The first rule that holds this request, and whether the rules read all of it. title: the engine's line, an ACP MCP
 *  tool's only name. now: the clock (the tests' own). */
export function policyRead(policy: BrainPolicy, tool: string, input: unknown, commandTools: readonly string[], title?: string, now: () => number = () => performance.now()): PolicyRead {
  if (policy.state !== 'ok') return { rule: null, unread: false };
  const cls = toolClass(tool, commandTools), name = tool.toLowerCase(), t = (title ?? '').trim().toLowerCase();
  const { text, long } = readable(tool, input, cls, cls === 'mcp' ? title?.trim() : undefined);
  const start = now(), spent = (): boolean => now() - start > BUDGET_MS;
  let slow = false;
  const hit = (re: RegExp): boolean => {
    if (slow) return false;
    if (spent() || (text.length > PROBE && !quick(re, text, now, spent))) { slow = true; return false; }
    return re.test(text);
  };
  for (const rule of policy.rules) {
    if (!ruleSees(rule, cls, name, t)) continue;
    const held = rule.match.some(hit) && !rule.unless.some(hit);
    if (slow) return { rule: null, unread: true };
    if (held) return { rule, unread: false };
  }
  return { rule: null, unread: long };
}

/** Some rule could hold a request of this tool, or the policy cannot be read: no «always» on what the user grants for
 *  it (a remembered grant would let a later one the rules hold through without coming back to the app). */
export function policyCovers(policy: BrainPolicy, tool: string, commandTools: readonly string[], title?: string): boolean {
  if (policy.state === 'broken') return true;
  if (policy.state !== 'ok') return false;
  const cls = toolClass(tool, commandTools), name = tool.toLowerCase(), t = (title ?? '').trim().toLowerCase();
  return policy.rules.some(rule => ruleSees(rule, cls, name, t));
}
