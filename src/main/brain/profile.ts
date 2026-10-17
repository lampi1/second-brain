// The owner's profile in the brain's me.md: read for Settings → Il mio profilo and the first interview, patched only in
// its managed fields (name, role, language, "Main work", "Reply style"); every other byte of the file is kept as it is,
// so the rules brain-editor adds keep growing untouched. Why patch, not render: me.md belongs to the owner and their
// agents; the app writes the least it can. Safety: a regular file directly inside the brain folder (no symlink, size
// cap), the save carries the revision it read (a concurrent edit is refused, never overwritten), the write goes to a
// temp file then a rename (no half-written me.md), single-line fields only (no markdown structure can be injected).
// Used by main/index.ts ('profile:get', 'profile:save'); unit tests: test/unit/brain/profile.test.ts.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { OwnerProfile, ProfileFields, ProfileResult, ProfileRule, ProfileSave } from '../../shared/profile';
import { PROFILE_FORBIDDEN, PROFILE_LIMITS } from '../../shared/profile';

const MAX_BYTES = 256 * 1024;
const BOM = String.fromCharCode(0xfeff), BOM_START = new RegExp('^' + BOM);
const PLACEHOLDER = '- **Main work**: (one line per area; the agents learn the rest from `now.md` and the journal)';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Parsed {
  lines: string[];
  name: string; nameAt: number;
  role: string; language: string; whoAt: number;
  mainWork: string[]; workAt: number; workEnd: number;
  rules: (ProfileRule & { at: number; end: number })[];
  howAt: number; howEnd: number;
}
/** the [start, end) of a "## title" section, -1 when absent */
function section(lines: string[], match: RegExp): [number, number] {
  const at = lines.findIndex(l => match.test(l));
  if (at < 0) return [-1, -1];
  let end = at + 1;
  while (end < lines.length && !/^#{1,2} /.test(lines[end]!)) end++;
  return [at, end];
}
/** a bullet and its continuation lines (indented, not blank, not a new top-level bullet) */
function bulletEnd(lines: string[], at: number, end: number): number {
  let i = at + 1;
  while (i < end && /^\s+\S/.test(lines[i]!)) i++;
  return i;
}
export function parseProfile(text: string): Parsed {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));
  const nameAt = lines.findIndex(l => /^# \S/.test(l));
  const name = nameAt >= 0 ? lines[nameAt]!.slice(2).trim() : '';
  const [whoStart, whoEnd] = section(lines, /^## Who\s*$/);
  let whoAt = -1, role = '', language = '', workAt = -1, workEnd = -1;
  const mainWork: string[] = [];
  if (whoStart >= 0) {
    for (let i = whoStart + 1; i < whoEnd; i++) {
      const line = lines[i]!, lang = line.lastIndexOf('. Language: ');
      if (whoAt < 0 && name && line.startsWith(name + ', ') && lang > name.length) {
        whoAt = i; role = line.slice(name.length + 2, lang).trim();
        const rest = line.slice(lang + 12), stop = rest.indexOf(' in chat');
        language = (stop >= 0 ? rest.slice(0, stop) : rest.split(/[;.]/)[0]!).trim();
      }
      const work = /^- \*\*Main work\*\*:(.*)$/.exec(line);
      if (work && workAt < 0) {
        workAt = i; workEnd = bulletEnd(lines, i, whoEnd);
        const inline = work[1]!.trim();
        if (inline && !(inline.startsWith('(') && inline.endsWith(')'))) mainWork.push(...inline.split(';').map(s => s.trim()).filter(Boolean));
        for (let j = i + 1; j < workEnd; j++) { const item = /^\s+- (.+)$/.exec(lines[j]!); if (item) mainWork.push(item[1]!.trim()); }
      }
    }
  }
  const [howAt, howEnd] = section(lines, /^## How to work with /);
  const rules: Parsed['rules'] = [];
  if (howAt >= 0) for (let i = howAt + 1; i < howEnd; i++) {
    const rule = /^- \*\*(.+?)\*\*:?\s*(.*)$/.exec(lines[i]!);
    if (!rule) continue;
    const end = bulletEnd(lines, i, howEnd);
    rules.push({ title: rule[1]!.replace(/:$/, '').trim(), text: [rule[2]!, ...lines.slice(i + 1, end).map(l => l.trim())].join(' ').trim(), at: i, end });
    i = end - 1;
  }
  return { lines, name, nameAt, role, language, whoAt, mainWork, workAt, workEnd, rules, howAt, howEnd };
}
const isReply = (r: ProfileRule) => /^reply style$/i.test(r.title);
const mentions = (line: string, name: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}([^\\p{L}\\p{N}]|$)`, 'u').test(line);
const ownerLines = (template: string) => template.split(/\r?\n/).filter(l => l.includes('{{OWNER}}') && !/^# /.test(l));
/** Fields the app cannot rewrite without losing or contradicting something: the agents' brain-editor edits them instead. */
export function lockedFields(p: Parsed, template = ''): (keyof ProfileFields)[] {
  const locked: (keyof ProfileFields)[] = [];
  // a name the owner also wrote into their own lines (not the template's) would be left stale there
  const owner = ownerLines(template), managed = new Set([p.nameAt, p.whoAt, p.howAt]);
  if (p.nameAt < 0 || p.lines.some((l, i) => !managed.has(i) && mentions(l, p.name) && renameLine(l, p.name, p.name, owner) === null)) locked.push('name');
  if (p.whoAt < 0) locked.push('role', 'language');
  // Main work is rewritten whole: only a placeholder, an inline list or plain one-line sub-bullets survive that
  const block = p.workAt >= 0 ? p.lines.slice(p.workAt + 1, p.workEnd) : [];
  if ((p.workAt < 0 && p.whoAt < 0) || block.some(l => !/^ {2}- \S/.test(l)) || p.mainWork.length > PROFILE_LIMITS.areas) locked.push('mainWork');
  if (p.howAt < 0) locked.push('replyStyle');
  return locked;
}

const oneLine = (value: unknown, max: number): string => {
  if (typeof value !== 'string') throw new Error('PROFILE_FIELDS');
  const clean = value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length > max) throw new Error('PROFILE_FIELDS');
  return clean;
};
/** checks a renderer patch: unknown keys, wrong types, multi-line or over-long values are refused, never trimmed silently */
export function checkFields(value: unknown): Partial<ProfileFields> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PROFILE_FIELDS');
  const v = value as Record<string, unknown>, out: Partial<ProfileFields> = {};
  for (const key of Object.keys(v)) if (!['name', 'role', 'language', 'mainWork', 'replyStyle'].includes(key)) throw new Error('PROFILE_FIELDS');
  if ('name' in v) {
    const name = oneLine(v.name, PROFILE_LIMITS.name);
    if (!name || PROFILE_FORBIDDEN.name.test(name)) throw new Error('PROFILE_FIELDS');
    out.name = name;
  }
  if ('role' in v) { out.role = oneLine(v.role, PROFILE_LIMITS.role); if (!out.role || PROFILE_FORBIDDEN.role.test(out.role)) throw new Error('PROFILE_FIELDS'); }
  if ('language' in v) { out.language = oneLine(v.language, PROFILE_LIMITS.language); if (!out.language || PROFILE_FORBIDDEN.language.test(out.language)) throw new Error('PROFILE_FIELDS'); }
  if ('replyStyle' in v) { out.replyStyle = oneLine(v.replyStyle, PROFILE_LIMITS.replyStyle); if (!out.replyStyle) throw new Error('PROFILE_FIELDS'); }
  if ('mainWork' in v) {
    if (!Array.isArray(v.mainWork) || v.mainWork.length > PROFILE_LIMITS.areas) throw new Error('PROFILE_FIELDS');
    out.mainWork = v.mainWork.map(item => oneLine(item, PROFILE_LIMITS.area)).filter(Boolean);
  }
  return out;
}

/** The template lines that carry {{OWNER}}: a name change rewrites exactly those rendered lines; null for any other line. */
function renameLine(line: string, from: string, to: string, template: string[]): string | null {
  for (const t of template) {
    const parts = t.split(/(\{\{[A-Z_]+\}\})/);
    const match = new RegExp('^' + parts.map(p => p === '{{OWNER}}' ? escape(from) : /^\{\{/.test(p) ? '(.*?)' : escape(p)).join('') + '$').exec(line);
    if (!match) continue;
    let k = 1;
    return parts.map(p => p === '{{OWNER}}' ? to : /^\{\{/.test(p) ? match[k++]! : p).join('');
  }
  return null;
}
/** Applies the checked fields to me.md's text; returns the new text. Throws PROFILE_UNRECOGNIZED for a locked field. */
export function patchProfile(text: string, fields: Partial<ProfileFields>, template = ''): string {
  const p = parseProfile(text), locked = lockedFields(p, template);
  for (const key of Object.keys(fields) as (keyof ProfileFields)[]) if (locked.includes(key)) throw new Error('PROFILE_UNRECOGNIZED');
  const lines = [...p.lines];
  // each line keeps its own ending (a mixed file stays mixed); new lines take the file's usual one
  const cr = text.split('\n').map(l => l.endsWith('\r')), crNew = text.includes('\r\n');
  // bottom-up, so earlier indexes stay valid
  const edits: { at: number; end: number; with: string[] }[] = [];
  if (fields.replyStyle !== undefined) {
    const rule = p.rules.find(isReply), line = `- **Reply style**: ${fields.replyStyle}`;
    // a missing rule goes first in the list, after the blank line under the heading
    const at = lines[p.howAt + 1]?.trim() === '' ? p.howAt + 2 : p.howAt + 1;
    edits.push(rule ? { at: rule.at, end: rule.end, with: [line] } : { at, end: at, with: [line] });
  }
  if (fields.mainWork !== undefined) {
    const block = fields.mainWork.length ? ['- **Main work**:', ...fields.mainWork.map(a => `  - ${a}`)] : [PLACEHOLDER];
    edits.push(p.workAt >= 0 ? { at: p.workAt, end: p.workEnd, with: block } : { at: p.whoAt + 1, end: p.whoAt + 1, with: ['', ...block] });
  }
  if (fields.role !== undefined || fields.language !== undefined) {
    const line = lines[p.whoAt]!, lang = line.lastIndexOf('. Language: ');
    const rest = line.slice(lang + 12), stop = rest.indexOf(' in chat');
    const language = fields.language ?? p.language, tail = stop >= 0 ? rest.slice(stop) : rest.slice(rest.indexOf(p.language) + p.language.length);
    const role = fields.role ?? p.role;
    edits.push({ at: p.whoAt, end: p.whoAt + 1, with: [`${p.name}, ${role}. Language: ${language}${tail}`] });
  }
  edits.sort((a, b) => b.at - a.at);
  for (const e of edits) { lines.splice(e.at, e.end - e.at, ...e.with); cr.splice(e.at, e.end - e.at, ...e.with.map(() => crNew)); }
  if (fields.name !== undefined && fields.name !== p.name) {
    const from = p.name, to = fields.name, owner = ownerLines(template);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/^# /.test(line) && line.slice(2).trim() === from) lines[i] = `# ${to}`;
      else if (line.startsWith(from + ', ') && line.includes('. Language: ')) lines[i] = to + line.slice(from.length);
      else if (line === `## How to work with ${from}`) lines[i] = `## How to work with ${to}`;
      else if (line.includes(from)) lines[i] = renameLine(line, from, to, owner) ?? line;
    }
  }
  return lines.map((l, i) => cr[i] ? l + '\r' : l).join('\n');
}

const hash = (text: string) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
/** rename over me.md; on Windows an editor or the antivirus holding the file makes it fail for a moment, so retry briefly */
async function swap(temp: string, file: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { return await fs.rename(temp, file); }
    catch (e) {
      if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
      await new Promise(r => setTimeout(r, 50 * 2 ** attempt));
    }
  }
}
export interface ProfileHost { root: () => string | null; template?: string }
export class ProfileService {
  constructor(private readonly host: ProfileHost) {}
  private async file(): Promise<string | null> {
    const root = this.host.root();
    if (!root) return null;
    const real = await fs.realpath(root), file = path.join(real, 'me.md');
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > MAX_BYTES) throw new Error('PROFILE_UNREADABLE');
    return file;
  }
  private async read(file: string): Promise<{ text: string; mtime: number }> {
    const [buf, stat] = await Promise.all([fs.readFile(file), fs.stat(file)]);
    return { text: buf.toString('utf8'), mtime: stat.mtimeMs };
  }
  private async growth(file: string): Promise<OwnerProfile['growth']> {
    const days = await fs.readdir(path.join(path.dirname(file), 'journal')).catch(() => [] as string[]);
    const dated = days.filter(d => /^\d{4}-\d{2}-\d{2}\.md$/.test(d)).sort();
    return { journalDays: dated.length, lastJournal: dated.length ? dated[dated.length - 1]!.slice(0, 10) : null };
  }
  private async view(file: string, text: string, mtime: number): Promise<OwnerProfile> {
    const p = parseProfile(text.replace(BOM_START, ''));
    return {
      name: p.name, role: p.role, language: p.language, mainWork: p.mainWork, replyStyle: p.rules.find(isReply)?.text ?? '',
      rules: p.rules.map(r => ({ title: r.title, text: r.text })), replyStyleDefault: parseProfile(this.host.template ?? '').rules.find(isReply)?.text ?? '', locked: lockedFields(p, this.host.template ?? ''),
      revision: hash(text), updatedAt: mtime, growth: await this.growth(file), path: file,
    };
  }
  async get(): Promise<ProfileResult> {
    let file: string | null;
    try { file = await this.file(); }
    catch (e) { return { ok: false, reason: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable' }; }
    if (!file) return { ok: false, reason: 'no-brain' };
    try { const { text, mtime } = await this.read(file); return { ok: true, profile: await this.view(file, text, mtime) }; }
    catch { return { ok: false, reason: 'unreadable' }; }
  }
  async save(request: ProfileSave): Promise<OwnerProfile> {
    if (!request || typeof request.revision !== 'string') throw new Error('PROFILE_FIELDS');
    const fields = checkFields(request.fields);
    const file = await this.file();
    if (!file) throw new Error('PROFILE_NO_BRAIN');
    const { text } = await this.read(file);
    if (hash(text) !== request.revision) throw new Error('PROFILE_CHANGED');
    const bom = text.startsWith(BOM) ? BOM : '';
    const next = bom + patchProfile(text.slice(bom.length), fields, this.host.template ?? '');
    if (next !== text) {
      const temp = path.join(path.dirname(file), `.me.md.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
      try {
        await fs.writeFile(temp, next, { flag: 'wx', mode: (await fs.stat(file)).mode & 0o777 });
        // re-check right before the swap: an edit that landed while we wrote wins
        if (hash((await this.read(file)).text) !== request.revision) throw new Error('PROFILE_CHANGED');
        await swap(temp, file);
      } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
    }
    const after = await this.read(file);
    return this.view(file, after.text, after.mtime);
  }
}
