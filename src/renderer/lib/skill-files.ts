// What each file of a skill's package is (owner 2026-11-23: «gli asset devono essere visibili e capire subito se sono
// script o query riferimenti»): instructions (SKILL.md), script, query, reference, asset or other, from its folder and,
// outside the Agent Skills folders, its extension; with the title and description main read from its header (LibSkill
// .parts) and a short language label. Every file of the package lands in exactly one group, so every file can be opened.
// Also which skills can be deleted. Used by components/skills/*; pinned by test/unit/renderer/skill-files.test.ts.
import type { LibSkill, SkillFile, SkillPart } from '@shared/skill-library';

export type SkillFileKind = 'instructions' | 'script' | 'query' | 'reference' | 'asset' | 'other';
/** The order of the groups in the assets panel. */
export const FILE_KINDS: readonly SkillFileKind[] = ['instructions', 'script', 'query', 'reference', 'asset', 'other'];

export interface SkillFileItem {
  path: string;
  kind: SkillFileKind;
  /** the header's title, else the file name */
  title: string;
  description: string;
  /** short language or format label: the header's language, else the extension in capitals */
  language: string;
  tested?: SkillPart['tested'];
  size: number;
  text: boolean;
}

const QUERY_EXT = new Set(['sql', 'kql', 'kusto', 'csl', 'wiql']);
const SCRIPT_EXT = new Set(['mjs', 'cjs', 'js', 'ts', 'py', 'sh', 'bash', 'ps1', 'psm1', 'bat', 'cmd', 'rb', 'pl', 'csx']);
const LABEL: Record<string, string> = { mjs: 'JavaScript', cjs: 'JavaScript', js: 'JavaScript', ts: 'TypeScript', py: 'Python', sh: 'Shell', bash: 'Shell', ps1: 'PowerShell', md: 'Markdown', yml: 'YAML', yaml: 'YAML' };
/** Images the app can show inline (main reads them as a raster, file-view.ts). */
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

export const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
export const extOfPath = (path: string): string => { const name = fileName(path), at = name.lastIndexOf('.'); return at > 0 ? name.slice(at + 1).toLowerCase() : ''; };
export const isImagePath = (path: string): boolean => IMAGE_EXT.has(extOfPath(path));
export const isMarkdownPath = (path: string): boolean => extOfPath(path) === 'md';

export function kindOfFile(path: string): SkillFileKind {
  if (path === 'SKILL.md') return 'instructions';
  if (path.startsWith('assets/queries/')) return 'query';
  if (path.startsWith('scripts/')) return 'script';
  if (path.startsWith('references/')) return 'reference';
  const ext = extOfPath(path);
  if (QUERY_EXT.has(ext)) return 'query';
  if (path.startsWith('assets/')) return 'asset';
  return SCRIPT_EXT.has(ext) ? 'script' : 'other';
}

const item = (f: SkillFile, parts: ReadonlyMap<string, SkillPart>): SkillFileItem => {
  const p = parts.get(f.path), ext = extOfPath(f.path);
  return {
    path: f.path, kind: kindOfFile(f.path), title: p?.title || fileName(f.path), description: p?.description ?? '',
    language: p?.language || LABEL[ext] || ext.toUpperCase(), ...(p?.tested ? { tested: p.tested } : {}), size: f.size, text: f.text,
  };
};

/** The package's files by group, in FILE_KINDS order; empty groups are left out. */
export function groupFiles(skill: Pick<LibSkill, 'files' | 'parts'>): { kind: SkillFileKind; items: SkillFileItem[] }[] {
  const parts = new Map<string, SkillPart>(Object.values(skill.parts).flat().map(p => [p.path, p]));
  const items = skill.files.map(f => item(f, parts));
  return FILE_KINDS.map(kind => ({ kind, items: items.filter(i => i.kind === kind).sort((a, b) => a.path.localeCompare(b.path)) })).filter(g => g.items.length);
}

/** How many files of each kind besides SKILL.md (the row's small type icons). */
export function kindCounts(files: readonly Pick<SkillFile, 'path'>[]): { kind: SkillFileKind; n: number }[] {
  return FILE_KINDS.filter(k => k !== 'instructions').map(kind => ({ kind, n: files.filter(f => kindOfFile(f.path) === kind).length })).filter(x => x.n);
}

export type DeleteAction = 'delete' | 'restore' | 'none';
/** A Brain skill is deleted; a Brain copy of an app skill goes back to the app's original; an app skill cannot be
 *  deleted (main refuses it: it ships with the app). */
export const deleteAction = (skill: Pick<LibSkill, 'origin' | 'overridesApp'>): DeleteAction => (skill.origin === 'app' ? 'none' : skill.overridesApp ? 'restore' : 'delete');
