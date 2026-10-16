// Pure mapping from Claude Code tool calls to what a tile shows: a one-line summary ("Bash: npm test"), line diff
// counts for Edit/Write/MultiEdit, tool_result text, AskUserQuestion questions and permission titles, the agent a SendMessage resumed.
// Why pure: the live session (claude.ts) and the transcript reader (transcript.ts) render the same rows, and the
// rules are unit-tested without a process. Shapes follow the CLI tool inputs (sdk-tools.d.ts of the Agent SDK).
import path from 'node:path';
import type { FileDiff, Question, QuestionOption } from '../../shared/contract';
import { cut, stripAnsi } from './session';

type Obj = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

/** A path shown relative to the chat folder when it is inside it. */
export function shortPath(p: string, cwd?: string): string {
  if (!p) return '';
  if (cwd) {
    const rel = path.relative(cwd, p);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.replace(/\\/g, '/');
  }
  return p.replace(/\\/g, '/');
}

/** One line for a tool row: "Bash: npm test", "Edit: src/app.ts", "Agent: review the diff". */
export function toolSummary(name: string, input: unknown, cwd?: string): string {
  const i = obj(input);
  const file = shortPath(str(i.file_path) || str(i.notebook_path) || str(i.path), cwd);
  switch (name) {
    case 'Bash': case 'PowerShell': return `${name}: ${cut(str(i.description) && !str(i.command) ? str(i.description) : str(i.command).split(/\r?\n/)[0] ?? '', 90)}`;
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `${name}: ${cut(file, 90)}`;
    case 'Grep': return `Grep: ${cut(str(i.pattern), 60)}${file ? ` in ${cut(file, 40)}` : ''}`;
    case 'Glob': return `Glob: ${cut(str(i.pattern), 80)}`;
    case 'WebFetch': return `WebFetch: ${cut(str(i.url), 90)}`;
    case 'WebSearch': return `WebSearch: ${cut(str(i.query), 90)}`;
    case 'Task': case 'Agent': return `Agent: ${cut(str(i.description) || str(i.prompt), 90)}`;
    case 'TodoWrite': return `TodoWrite: ${Array.isArray(i.todos) ? i.todos.length : 0} attività`;
    case 'AskUserQuestion': return `Domanda: ${cut(str(obj(Array.isArray(i.questions) ? i.questions[0] : null).question), 90)}`;
    case 'ExitPlanMode': return 'Piano pronto';
    case 'Skill': return `Skill: ${cut(str(i.skill) || str(i.command), 80)}`;
    default: {
      const m = name.match(/^mcp__(.+?)__(.+)$/);
      const label = m ? `${m[1]}: ${m[2]}` : name;
      const first = Object.values(i).find(v => typeof v === 'string' && v.trim()) as string | undefined;
      return first ? `${label} · ${cut(first, 70)}` : label;
    }
  }
}

const lines = (s: string): string[] => (s === '' ? [] : s.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));

/** Line diff of two texts: counts and a short patch (' ', '-', '+' prefixed lines). Common prefix/suffix are
 *  trimmed first; a middle larger than the LCS budget falls back to "all removed, all added". */
export function lineDiff(before: string, after: string, maxPatch = 300): { added: number; removed: number; patch: string } {
  const a = lines(before), b = lines(after);
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const A = a.slice(s, ea), B = b.slice(s, eb);
  const out: string[] = [];
  if (s > 0) out.push(` ${a[s - 1]}`);
  if (A.length * B.length <= 1_000_000) {
    // LCS table (lengths of the common suffix), then walk it
    const n = A.length, m = B.length, w = m + 1;
    const t = new Uint32Array((n + 1) * w);
    for (let x = n - 1; x >= 0; x--) for (let y = m - 1; y >= 0; y--) t[x * w + y] = A[x] === B[y] ? (t[(x + 1) * w + y + 1] ?? 0) + 1 : Math.max(t[(x + 1) * w + y] ?? 0, t[x * w + y + 1] ?? 0);
    let x = 0, y = 0;
    while (x < n || y < m) {
      if (x < n && y < m && A[x] === B[y]) { out.push(` ${A[x]}`); x++; y++; }
      else if (x < n && (y >= m || (t[(x + 1) * w + y] ?? 0) >= (t[x * w + y + 1] ?? 0))) { out.push(`-${A[x]}`); x++; }
      else { out.push(`+${B[y]}`); y++; }
    }
  } else {
    for (const l of A) out.push(`-${l}`);
    for (const l of B) out.push(`+${l}`);
  }
  if (ea < a.length) out.push(` ${a[ea]}`);
  const added = out.filter(l => l.startsWith('+')).length, removed = out.filter(l => l.startsWith('-')).length;
  const patch = out.length > maxPatch ? `${out.slice(0, maxPatch).join('\n')}\n… (+${out.length - maxPatch} righe)` : out.join('\n');
  return { added, removed, patch };
}

/** Diff counts from the tool input (before the result arrives). */
export function diffFor(name: string, input: unknown, cwd?: string): FileDiff[] | undefined {
  const i = obj(input);
  const p = shortPath(str(i.file_path), cwd);
  if (name === 'Edit') {
    const d = lineDiff(str(i.old_string), str(i.new_string));
    return [{ path: p, ...d }];
  }
  if (name === 'MultiEdit' && Array.isArray(i.edits)) {
    let added = 0, removed = 0;
    const patches: string[] = [];
    for (const e of i.edits) {
      const d = lineDiff(str(obj(e).old_string), str(obj(e).new_string));
      added += d.added; removed += d.removed; patches.push(d.patch);
    }
    return [{ path: p, added, removed, patch: patches.join('\n…\n') }];
  }
  if (name === 'Write') {
    const l = lines(str(i.content));
    const shown = l.slice(0, 300).map(x => `+${x}`);
    return [{ path: p, added: l.length, removed: 0, patch: l.length > 300 ? `${shown.join('\n')}\n… (+${l.length - 300} righe)` : shown.join('\n') }];
  }
  return undefined;
}

/** Exact counts from the CLI's own structuredPatch (tool_use_result of Edit/Write/MultiEdit), when it has hunks. */
export function diffFromResult(name: string, input: unknown, toolUseResult: unknown, cwd?: string): FileDiff[] | undefined {
  if (!['Edit', 'Write', 'MultiEdit'].includes(name)) return undefined;
  const r = obj(toolUseResult);
  const hunks = Array.isArray(r.structuredPatch) ? r.structuredPatch : null;
  if (!hunks || hunks.length === 0) return undefined;
  const p = shortPath(str(r.filePath) || str(obj(input).file_path), cwd);
  let added = 0, removed = 0;
  const out: string[] = [];
  for (const h of hunks) {
    for (const l of Array.isArray(obj(h).lines) ? (obj(h).lines as unknown[]) : []) {
      const s = str(l);
      if (s.startsWith('+')) added++;
      else if (s.startsWith('-')) removed++;
      if (out.length < 300) out.push(s);
    }
  }
  return [{ path: p, added, removed, patch: out.join('\n') }];
}

/** Text of a tool_result content (string or blocks), cut for the tile. */
export function resultText(content: unknown, max = 4000): string {
  let t = '';
  if (typeof content === 'string') t = content;
  else if (Array.isArray(content)) {
    t = content.map(b => {
      const o = obj(b);
      if (o.type === 'text') return str(o.text);
      if (o.type === 'image') return '[immagine]';
      return '';
    }).filter(Boolean).join('\n');
  }
  t = stripAnsi(t);
  return t.length > max ? `${t.slice(0, max)}… (+${t.length - max})` : t;
}

/** AskUserQuestion input → contract questions (defensive: bad entries are dropped). */
export function questionsFrom(input: unknown): Question[] {
  const qs = obj(input).questions;
  if (!Array.isArray(qs)) return [];
  const out: Question[] = [];
  for (const q of qs) {
    const o = obj(q);
    if (!str(o.question)) continue;
    const options: QuestionOption[] = (Array.isArray(o.options) ? o.options : [])
      .map(x => obj(x)).filter(x => str(x.label))
      .map(x => ({ label: str(x.label), ...(str(x.description) ? { description: str(x.description) } : {}), ...(str(x.preview).trim() ? { preview: str(x.preview).slice(0, 20_000) } : {}) }));
    out.push({ question: str(o.question), ...(str(o.header) ? { header: str(o.header) } : {}), options, multiSelect: o.multiSelect === true });
  }
  return out;
}

/** Title and detail of a permission panel. */
export function permissionText(tool: string, input: unknown, extra: { title?: string; description?: string; reason?: string; blockedPath?: string; cwd?: string }): { title: string; detail: string } {
  const i = obj(input);
  const title = extra.title ? cut(stripAnsi(extra.title), 120) : toolSummary(tool, input, extra.cwd);
  let main = '';
  if (tool === 'Bash' || tool === 'PowerShell') main = str(i.command);
  else if (tool === 'ExitPlanMode') main = str(i.plan);
  else if (str(i.file_path)) main = shortPath(str(i.file_path), extra.cwd);
  else if (str(i.url)) main = str(i.url);
  const parts = [main, extra.description ? stripAnsi(extra.description) : '', extra.reason ? `Motivo: ${stripAnsi(extra.reason)}` : '', extra.blockedPath ? `Percorso: ${extra.blockedPath}` : '']
    .map(s => s.trim()).filter(Boolean);
  const detail = parts.join('\n');
  return { title, detail: detail.length > 8000 ? `${detail.slice(0, 8000)}…` : detail };
}

const MODE_IT: Record<string, string> = {
  default: 'normale', acceptEdits: 'accetta modifiche', plan: 'piano', bypassPermissions: 'senza permessi', auto: 'automatica', dontAsk: 'non chiedere',
};

/** What "Consenti sempre" would grant, one human line per CLI permission suggestion (PermissionUpdate in sdk.d.ts):
 *  "Bash(git push:*)", "modalità: accetta modifiche", "cartella: C:/repo". The app applies them for the session only. */
export function describeSuggestions(suggestions: unknown[]): string[] {
  const out: string[] = [];
  for (const raw of suggestions) {
    const x = obj(raw);
    const rules = (Array.isArray(x.rules) ? x.rules : []).map(r => {
      const o = obj(r);
      return str(o.ruleContent) ? `${str(o.toolName)}(${str(o.ruleContent)})` : str(o.toolName);
    }).filter(Boolean);
    const dirs = (Array.isArray(x.directories) ? x.directories : []).map(d => `cartella: ${str(d)}`);
    switch (x.type) {
      case 'addRules': case 'replaceRules': out.push(...rules.map(r => (x.behavior === 'deny' ? `nega ${r}` : x.behavior === 'ask' ? `chiedi ${r}` : r))); break;
      case 'removeRules': out.push(...rules.map(r => `rimuove ${r}`)); break;
      case 'setMode': out.push(`modalità: ${MODE_IT[str(x.mode)] ?? str(x.mode)}`); break;
      case 'addDirectories': out.push(...dirs); break;
      case 'removeDirectories': out.push(...dirs.map(d => `rimuove ${d}`)); break;
      default: if (str(x.type)) out.push(str(x.type));
    }
  }
  return out;
}

/** Flattens the user's answers to what the CLI expects: { question text: "label" | "a, b" }. */
export function flattenAnswers(answers: Record<string, string | string[]>): Record<string, string> {
  return Object.fromEntries(Object.entries(answers).map(([q, a]) => [q, Array.isArray(a) ? a.join(', ') : String(a)]));
}

/** The agent a SendMessage result resumed ('' when none): the structured result's resumedAgentId, else the same field
 *  in its text (CLI 2.1.283: {"success":true,"message":"Resuming agent …","resumedAgentId":"a26420c62ff6f065f"}). A
 *  stopped agent that "won't be resumed" (success false) is none. */
export function resumedAgent(structured: unknown, text: string): string {
  const r = obj(structured);
  if (r.success === false) return '';
  const id = str(r.resumedAgentId);
  if (id) return id;
  if (/"success"\s*:\s*false/.test(text)) return '';
  return /"resumedAgentId"\s*:\s*"([\w-]+)"/.exec(text)?.[1] ?? '';
}
