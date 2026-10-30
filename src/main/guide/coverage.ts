// The Guida's coverage read from a checkout (ADR 0208): the page ids of BRAIN_PAGES (renderer/brain/index.tsx) and the
// Settings section ids (renderer/lib/settings-sections.ts SETTINGS_SECTION_IDS) read from the source text, so the check
// runs in Node without the renderer, then shared/guide-coverage.ts says which of them lack a complete card. A list that
// cannot be read is a gap too (its file changed shape: update the reader here). Used by anchors-cli.ts
// (scripts/guide-anchors.mjs --check) and test/unit/guide-anchors.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { CONCEPTS } from '../../shared/concept-guide';
import { GUIDE_DE } from '../../shared/concept-guide.de';
import { coverageGaps, type CoverageGap } from '../../shared/guide-coverage';

const PAGES_FILE = 'src/renderer/brain/index.tsx';
const SECTIONS_FILE = 'src/renderer/lib/settings-sections.ts';

/** The ids inside `export const BRAIN_PAGES … = [ page('id', …), … ];` (comments and aliases left out). */
export function pageIdsOf(text: string): string[] {
  const start = text.indexOf('export const BRAIN_PAGES');
  if (start < 0) return [];
  const body = text.slice(start, text.indexOf('];', start)).replace(/\/\/[^\n]*/g, '');
  return [...body.matchAll(/\bpage\(\s*'([a-z0-9-]+)'/g)].map(m => m[1]!);
}
/** The ids of `export const SETTINGS_SECTION_IDS = [ … ] as const`. */
export function sectionIdsOf(text: string): string[] {
  const m = /export const SETTINGS_SECTION_IDS\s*=\s*\[([^\]]*)\]/.exec(text);
  return m ? [...m[1]!.matchAll(/'([a-z0-9-]+)'/g)].map(x => x[1]!) : [];
}

export function coverageInRepo(root: string): CoverageGap[] {
  const read = (f: string) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } };
  const pages = pageIdsOf(read(PAGES_FILE)), sections = sectionIdsOf(read(SECTIONS_FILE));
  const unread: CoverageGap[] = [
    ...(pages.length ? [] : [{ key: 'read:pages', message: `could not read the page ids of BRAIN_PAGES in ${PAGES_FILE}: update pageIdsOf in src/main/guide/coverage.ts` }]),
    ...(sections.length ? [] : [{ key: 'read:sections', message: `could not read SETTINGS_SECTION_IDS in ${SECTIONS_FILE}: update sectionIdsOf in src/main/guide/coverage.ts` }]),
  ];
  return [...unread, ...coverageGaps({ pages, sections, cards: CONCEPTS, de: GUIDE_DE })];
}
