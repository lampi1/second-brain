// Reads, checks and edits the markdown file of a skill (SKILL.md) or an agent (<name>.md): a YAML frontmatter between
// two "---" lines, then the instructions. Why: the "Skill e agenti" section (ADR 0018) edits these files with a form
// and a raw editor, and both must keep what they do not touch (other keys, comments, order) and refuse a file the CLIs
// could not read. Only a YAML subset is understood (scalars, quoted strings, ">"/"|" blocks, "- item" lists); any other
// value is kept verbatim. Pure, no I/O: used by the renderer (live check while typing) and by main/skills/service.ts
// (the same check before writing).
import type { MdIssue, SkillKind } from './contract';

export const NAME_MAX = 64;
export const DESC_MAX = 1024;
/** lowercase letters, digits and single hyphens (Claude Code skills and agents; Cursor accepts the same) */
export const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface Field { key: string; value: string; start: number; end: number } // lines [start, end) inside the frontmatter
export interface ParsedMd {
  /** null = no frontmatter at all */
  front: string[] | null;
  fields: Field[];
  body: string;
  /** line ending of the file */
  eol: '\n' | '\r\n';
  issues: MdIssue[];
}

const KEY = /^([A-Za-z_][\w-]*)\s*:(?:\s+(.*?))?\s*$/;
const indented = (l: string) => /^\s+\S/.test(l) || l.trim() === '';

/** A YAML scalar as written after "key:" (and its continuation lines) → its text. err = cannot be read. */
function scalar(first: string, more: string[]): { value: string; err?: string } {
  const v = first.trim();
  if (v.startsWith('"')) {
    const all = [v, ...more.map(l => l.trim())].join(' ').replace(/(")\s+#.*$/, '$1'); // "x" # a comment
    try { const s = JSON.parse(all.replace(/\\'/g, "'")) as unknown; return { value: typeof s === 'string' ? s : String(s) }; } catch {
      return { value: all.replace(/^"|"$/g, ''), err: 'virgolette " non chiuse o con un carattere non valido' };
    }
  }
  if (v.startsWith("'")) {
    const all = [v, ...more.map(l => l.trim())].join(' ').replace(/(')\s+#.*$/, '$1');
    if (!/^'(?:[^']|'')*'$/.test(all)) return { value: all.replace(/^'|'$/g, ''), err: "virgolette ' non chiuse" };
    return { value: all.slice(1, -1).replace(/''/g, "'") };
  }
  if (/^[|>][-+]?$/.test(v)) {
    const lines = more.slice();
    while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
    const pad = Math.min(...lines.filter(l => l.trim()).map(l => l.length - l.trimStart().length));
    const body = lines.map(l => l.slice(Number.isFinite(pad) ? pad : 0));
    return { value: v.startsWith('|') ? body.join('\n') : body.join(' ').replace(/\s+/g, ' ').trim() };
  }
  if (!v && more.some(l => l.trim().startsWith('- '))) return { value: more.filter(l => l.trim().startsWith('- ')).map(l => l.trim().slice(2).trim().replace(/^["']|["']$/g, '')).join(', ') };
  const plain = [v, ...more.map(l => l.trim())].filter(Boolean).join(' ');
  return { value: plain.replace(/\s+#.*$/, '') };
}

/** Splits the file into frontmatter lines and body, reads the top-level keys. */
export function parseMd(text: string): ParsedMd {
  const eol: ParsedMd['eol'] = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const issues: MdIssue[] = [];
  if (lines[0]?.trim() !== '---') {
    return { front: null, fields: [], body: text, eol, issues: [{ level: 'error', text: 'Manca l’intestazione: il file deve iniziare con una riga "---", poi name e description, poi un’altra riga "---".' }] };
  }
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (close < 0) return { front: lines.slice(1), fields: [], body: '', eol, issues: [{ level: 'error', text: 'L’intestazione non è chiusa: manca la seconda riga "---".' }] };
  const front = lines.slice(1, close);
  const body = lines.slice(close + 1).join(eol);
  const fields: Field[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < front.length;) {
    const l = front[i]!;
    if (!l.trim() || l.trimStart().startsWith('#')) { i++; continue; }
    const m = KEY.exec(l);
    if (!m || /^\s/.test(l)) { issues.push({ level: 'error', text: `Intestazione, riga ${i + 2}: non è "chiave: valore" (${l.trim().slice(0, 40)}).` }); i++; continue; }
    const key = m[1]!;
    const first = m[2] ?? '';
    let j = i + 1;
    // continuation: indented lines; for a key without a value also "- item" lines at the key's own indent (a compact list)
    while (j < front.length && (indented(front[j]!) || (!first.trim() && /^-\s/.test(front[j]!)))) j++;
    // trailing blank lines belong to no key (kept when the form edits this one), except inside a "|" block
    if (!first.trim().startsWith('|')) while (j > i + 1 && !front[j - 1]!.trim()) j--;
    const sc = scalar(first, front.slice(i + 1, j));
    if (sc.err) issues.push({ level: 'error', field: key, text: `${key}: ${sc.err}.` });
    else if (!/^["'|>]/.test(first.trim()) && /:\s/.test(first)) issues.push({ level: 'warn', field: key, text: `${key}: contiene ": " senza virgolette; alcuni lettori YAML lo rifiutano (il modulo lo salva tra virgolette).` });
    if (seen.has(key)) issues.push({ level: 'error', field: key, text: `"${key}" compare due volte nell’intestazione.` });
    seen.add(key);
    fields.push({ key, value: sc.value, start: i, end: j });
    i = j;
  }
  return { front, fields, body, eol, issues };
}

export const field = (p: ParsedMd, key: string): string | undefined => p.fields.find(f => f.key === key)?.value;

/** Every problem of the file for its kind; errors block the save. */
export function checkMd(kind: SkillKind, text: string): MdIssue[] {
  const p = parseMd(text);
  const out = [...p.issues];
  if (!p.front) return out;
  const name = field(p, 'name');
  const desc = field(p, 'description');
  if (name === undefined || !name.trim()) out.push({ level: 'error', field: 'name', text: 'Manca il nome (name).' });
  else if (name.length > NAME_MAX) out.push({ level: 'error', field: 'name', text: `Nome troppo lungo: al massimo ${NAME_MAX} caratteri (ora ${name.length}).` });
  else if (!NAME_RE.test(name)) out.push({ level: 'error', field: 'name', text: 'Nome: solo lettere minuscole, cifre e trattini (es. "rivedi-pr").' });
  if (desc === undefined || !desc.trim()) out.push({ level: 'error', field: 'description', text: `Manca la descrizione (description): ${kind === 'skill' ? 'dice al modello quando usare la skill' : 'dice quando delegare a questo agente'}.` });
  else {
    if (desc.length > DESC_MAX) out.push({ level: 'error', field: 'description', text: `Descrizione troppo lunga: al massimo ${DESC_MAX} caratteri (ora ${desc.length}).` });
    if (/<\/?[A-Za-z][\w-]*>/.test(desc)) out.push({ level: 'warn', field: 'description', text: 'La descrizione contiene un tag tra < >: alcune versioni lo rifiutano.' });
  }
  if (!p.body.trim()) out.push({ level: 'warn', field: 'body', text: 'Istruzioni vuote: il modello leggerà solo la descrizione.' });
  return out;
}

/** "a: b", leading quotes, "#", YAML words… need quotes; JSON's double-quoted string is valid YAML. */
export function yamlValue(v: string): string {
  if (v === '') return '""';
  const plain = !/[\n\r\t]/.test(v) && !/^[\s"'#&*!|>%@`{}[\],?:-]/.test(v) && !/\s$/.test(v) && !/:(\s|$)/.test(v) && !/\s#/.test(v)
    && !/^(true|false|yes|no|on|off|null|~|[-+]?\d[\d._]*(e[-+]?\d+)?)$/i.test(v);
  return plain ? v : JSON.stringify(v);
}

/** The file with these frontmatter keys set (added at the end when missing; '' with drop removes the key), the rest
 *  kept as it is. A file without frontmatter gets one. */
export function setFields(text: string, patch: Record<string, string>, drop: string[] = []): string {
  const p = parseMd(text);
  const front = p.front ? p.front.slice() : [];
  const fields = p.front ? p.fields.slice() : [];
  // from the last field up, so line numbers of the ones above stay right
  const ops = Object.entries(patch).map(([key, value]) => ({ key, value, f: fields.find(x => x.key === key) }));
  const removes = drop.map(key => fields.find(x => x.key === key)).filter((f): f is Field => !!f);
  const edits = [...ops.filter(o => o.f).map(o => ({ f: o.f!, line: `${o.key}: ${yamlValue(o.value)}` as string | null })), ...removes.map(f => ({ f, line: null }))]
    .sort((a, b) => b.f.start - a.f.start);
  for (const e of edits) front.splice(e.f.start, e.f.end - e.f.start, ...(e.line === null ? [] : [e.line]));
  for (const o of ops) if (!o.f) {
    // after the last key (blank lines and comments at the end stay at the end)
    let at = front.length;
    while (at > 0 && (!front[at - 1]!.trim() || front[at - 1]!.trimStart().startsWith('#'))) at--;
    front.splice(at, 0, `${o.key}: ${yamlValue(o.value)}`);
  }
  // the body exactly as it was (a file without frontmatter: all of it, after a blank line)
  return bom(text, p.front ? ['---', ...front, '---', p.body].join(p.eol) : ['---', ...front, '---', '', text.replace(/^\uFEFF/, '')].join(p.eol));
}

/** A file that started with a BOM keeps it. */
const bom = (from: string, out: string): string => (from.startsWith('\uFEFF') ? `\uFEFF${out}` : out);

/** The file with this body (the frontmatter untouched, or an empty one); one blank line between them, then the body as
 *  typed (its own leading blank lines too, so the form's textarea shows exactly what it sent); the file's line endings
 *  (a textarea gives "\n" only). */
export function setBody(text: string, body: string): string {
  const p = parseMd(text);
  return bom(text, ['---', ...(p.front ?? []), '---', '', body.replace(/\r?\n/g, p.eol)].join(p.eol));
}

/** A new file from the form. */
export function newMd(kind: SkillKind, o: { name: string; description: string; body: string; tools?: string; model?: string }): string {
  const lines = ['---', `name: ${yamlValue(o.name)}`, `description: ${yamlValue(o.description)}`];
  if (kind === 'agent' && o.tools?.trim()) lines.push(`tools: ${yamlValue(o.tools.trim())}`);
  if (kind === 'agent' && o.model?.trim()) lines.push(`model: ${yamlValue(o.model.trim())}`);
  lines.push('---', '', '');
  return `${lines.join('\n')}${o.body.trim() ? `${o.body.replace(/\s+$/, '')}\n` : ''}`;
}

/** The first lines a new skill or agent starts with, so the form is never blank. */
export function template(kind: SkillKind): { name: string; description: string; body: string } {
  return kind === 'skill'
    ? { name: '', description: '', body: '# Titolo\n\nCosa fa, passo per passo:\n\n1. …\n2. …\n' }
    : { name: '', description: '', body: 'Sei un agente che … \n\nQuando ti chiamano:\n\n1. …\n2. …\n\nRispondi con …\n' };
}

/** "<!-- Generated by sync-agents.mjs (…) from .claude/agents/reviewer.md, do not edit … -->" → why it is read-only. */
export function generatedBy(text: string): string | null {
  const m = /<!--\s*(?:Generated|Auto-generated|Generato)\b([\s\S]{0,400}?)-->/i.exec(text.slice(0, 4000));
  if (!m || !/do not edit|non modificare|don't edit/i.test(m[1] ?? '')) return null;
  const src = /\bfrom\s+(\S+\.md)\b/i.exec(m[1] ?? '')?.[1];
  const tool = /by\s+([\w.-]+\.m?[jt]s)\b/i.exec(m[0])?.[1];
  return `Copia generata${tool ? ` da ${tool}` : ''}${src ? ` da ${src}` : ''}: modifica il file sorgente, questo viene riscritto.`;
}
