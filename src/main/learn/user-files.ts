// The user's own files as a lesson's sources (ADR 0204; owner, 2026-10-30, report «Impara v3» I1: «file trascinabili
// nel campo come fonti»): the start form reads the files and folders the user dropped or picked (in the renderer, with
// the browser's File API: main opens no path the page names) and sends their text with the start request; here they
// are checked and capped (text only, at most FILES_MAX files, FILE_MAX characters each, TOTAL_MAX in all) and become
// part of the lesson's material: one file `fonti.md` in the lesson's folder that the research and the teacher may read
// whole, the first part inline in the prompt, and a line each on the lesson's «Fonti». Used by learn/service.ts;
// tests: test/unit/learn-user-files.test.ts.
import type { LessonFile } from '@shared/lesson';
import { INLINE_MAX, type Material } from './material';

export const FILES_MAX = 40;
export const FILE_MAX = 120_000;
export const TOTAL_MAX = 600_000;
/** the material file the user's files are written to */
export const USER_FILES = 'fonti.md';

/** The files of a start request, checked: a name (a relative path, no control characters) and a text without NUL (a
 *  binary file is left out); empty ones, repeats and the ones over the caps are dropped. */
export function cleanFiles(raw: unknown): LessonFile[] {
  if (!Array.isArray(raw)) return [];
  const out: LessonFile[] = [];
  let total = 0;
  const seen = new Set<string>();
  for (const f of raw) {
    if (out.length >= FILES_MAX || total >= TOTAL_MAX) break;
    if (!f || typeof f !== 'object') continue;
    const o = f as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.replace(/[\u0000-\u001f]/g, '').replace(/\\/g, '/').replace(/^\/+/, '').trim().slice(0, 200) : '';
    const text = typeof o.text === 'string' ? o.text.slice(0, Math.min(FILE_MAX, TOTAL_MAX - total)) : '';
    if (!name || !text.trim() || text.includes('\u0000') || seen.has(name)) continue;
    seen.add(name);
    total += text.length;
    out.push({ name, text });
  }
  return out;
}

const fence = (text: string) => (text.includes('```') ? '~~~~' : '```');
/** The user's files as markdown: a heading per file and its text fenced. */
export function filesMarkdown(files: readonly LessonFile[]): string {
  return files.map(f => { const q = fence(f.text); return `## ${f.name}\n${q}\n${f.text}\n${q}`; }).join('\n\n');
}

/** The material with the user's files added (unchanged without any). */
export function withUserFiles(m: Material, files: readonly LessonFile[] | undefined): Material {
  if (!files?.length) return m;
  const md = filesMarkdown(files);
  const room = Math.max(0, INLINE_MAX - m.text.length);
  const inline = md.length <= room ? md : `${md.slice(0, room)}\n… (il resto è nel file ${USER_FILES})`;
  const head = `## File dell'utente (${files.length})\n${files.map(f => `- ${f.name}`).join('\n')}`;
  return {
    ...m,
    text: [m.text, head, room > 200 ? inline : `(tutti nel file ${USER_FILES})`].filter(Boolean).join('\n\n'),
    files: { ...m.files, [USER_FILES]: md },
    sources: [...m.sources, ...files.slice(0, 12).map(f => `file: ${f.name}`), ...(files.length > 12 ? [`e altri ${files.length - 12} file`] : [])],
  };
}
