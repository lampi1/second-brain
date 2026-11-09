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

const MAX_RULES = 200, MAX_PATTERN = 500, MAX_PATTERNS = 50, MAX_FILE = 256 * 1024, MAX_SUBJECT = 20_000;
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
  if (t.startsWith('mcp__') || t.startsWith('mcp_') || t.includes('__')) return 'mcp';
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

let cache: { file: string; mtimeMs: number; size: number; policy: BrainPolicy } | null = null;

/** The policy of the brain at brainRoot (null: no brain chosen yet = no rule). */
export function loadPolicy(brainRoot: string | null | undefined): BrainPolicy {
  if (!brainRoot) return { state: 'none' };
  const file = path.join(brainRoot, POLICY_FILE);
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'none' } : { state: 'broken', error: `cannot be read: ${(e as NodeJS.ErrnoException).code ?? 'error'}` };
  }
  if (!st.isFile()) return { state: 'broken', error: 'not a file' };
  if (st.size > MAX_FILE) return { state: 'broken', error: `larger than ${MAX_FILE / 1024} KB` };
  if (cache && cache.file === file && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.policy;
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { state: 'broken', error: `cannot be read: ${(e as NodeJS.ErrnoException).code ?? 'error'}` }; }
  const policy = parsePolicy(text.replace(/^﻿/, ''));
  cache = { file, mtimeMs: st.mtimeMs, size: st.size, policy };
  return policy;
}

/** What a rule is matched against: a command's own line, any other tool's name and input. */
export function policySubject(tool: string, input: unknown, cls: string): string {
  const o = isObj(input) ? input : {};
  if (cls === 'command' && typeof o.command === 'string') return o.command.slice(0, MAX_SUBJECT);
  let json = '';
  try { json = JSON.stringify(input ?? {}); } catch { /* circular: the name alone */ }
  return `${tool} ${json}`.slice(0, MAX_SUBJECT);
}

/** The first rule that holds this request, or null. */
export function policyHit(policy: BrainPolicy, tool: string, input: unknown, commandTools: readonly string[]): PolicyRule | null {
  if (policy.state !== 'ok') return null;
  const cls = toolClass(tool, commandTools), name = tool.toLowerCase();
  const subject = policySubject(tool, input, cls);
  for (const rule of policy.rules) {
    if (!rule.tools.some(t => t === '*' || t === cls || t === name)) continue;
    if (rule.match.some(re => re.test(subject)) && !rule.unless.some(re => re.test(subject))) return rule;
  }
  return null;
}
