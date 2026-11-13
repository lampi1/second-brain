// The README stays fresh (ADR 0208; the owner, 2026-10-30: README always updated, fresh screenshots, always in English).
// Checks README.md against docs/readme-shots.json (the manifest: each screenshot → the test that takes it and the UI
// source paths it shows; each page of BRAIN_PAGES → the words that mention it):
//   - English: no paragraph and not the whole text dense with Italian or German stop words (code, links and «quoted
//     labels» left out);
//   - every image it references exists, and every docs/screenshots/ image is taken by test/shots/readme.spec.ts, in the
//     test the manifest names; every shot the spec takes is in the manifest; every manifest source path exists;
//   - every page of BRAIN_PAGES (renderer/brain/index.tsx, aliases excluded) is mentioned;
//   - freshness (branches only, against the merge base with main): a branch that changes a shot's source paths changes
//     the shot too, unless a commit message of the branch says `shots: unchanged-visually [shot …]`.
// The manifest's `pending` lists known gaps by key: printed as warnings, not failures, until someone fixes them (then
// the check asks to remove the key). Usage: node scripts/readme-check.mjs [--base <sha>] [--json]; exit 1 with each
// problem and its fix. Run by scripts/check-branch.mjs; the pure parts are tested in test/unit/readme-check.test.ts.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MANIFEST = 'docs/readme-shots.json';
export const SPEC = 'test/shots/readme.spec.ts';
export const SHOTS_DIR = 'docs/screenshots/';
export const PAGES_FILE = 'src/renderer/brain/index.tsx';
export const OPT_OUT = 'shots: unchanged-visually';

// ── English ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Italian and German words that are not English words too (no "per", "non", "die", "con", "mit"…). */
const FOREIGN = new Set(('il lo gli della delle degli dello del nel nella nelle negli che è sono una uno questo questa questi queste '
  + 'anche più perché perche quando dove cosa ogni tutti tutte alla alle allo dei sul sulla sugli poi già ancora molto essere hai '
  + 'puoi sei mio tuo suo nostro vostro loro di chi siamo stato stata fatto deve possono vuoi qui così '
  + 'und nicht ist für auf eine einen einem werden wird sich auch oder wenn kann dass sind noch bei über durch').split(' '));
/** A paragraph this dense with foreign words (and at least MIN_HITS of them) is not English; the same for the whole text. */
export const PARAGRAPH_MAX = 0.12, TEXT_MAX = 0.02, MIN_WORDS = 6, MIN_HITS = 2;

/** The README's prose: without HTML comments, code blocks, inline code, tags, link targets, URLs and «quoted labels». */
export function prose(md) {
  return md.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, '').replace(/«[^»\n]*»/g, '').replace(/“[^”\n]*”/g, '').replace(/\be\.g\./gi, '');
}
const words = s => s.toLowerCase().match(/[a-zà-ÿß]+/g) ?? [];

/** Paragraphs (and the whole text) that read as Italian or German: { paragraphs: [{ text, words, hits }], density }. */
export function foreignProse(md) {
  const paragraphs = [];
  let all = 0, allHits = 0;
  for (const p of prose(md).split(/\n\s*\n/)) {
    const w = words(p), hits = w.filter(x => FOREIGN.has(x));
    all += w.length; allHits += hits.length;
    if (w.length >= MIN_WORDS && hits.length >= MIN_HITS && hits.length / w.length > PARAGRAPH_MAX) paragraphs.push({ text: p.trim().replace(/\s+/g, ' ').slice(0, 90), words: w.length, hits: [...new Set(hits)] });
  }
  return { paragraphs, density: all ? allHits / all : 0 };
}

// ── images, the spec, the manifest ─────────────────────────────────────────────────────────────────────────────────
/** Local images the README references (markdown and <img>), in order, without duplicates. */
export function readmeImages(md) {
  const out = [];
  const text = md.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '');
  for (const m of text.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)|<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/g)) {
    const src = (m[1] ?? m[2]).split('#')[0];
    if (!/^(https?:|data:)/i.test(src) && !out.includes(src)) out.push(src);
  }
  return out;
}
/** The shots the spec takes: name → the title of the test that takes it (save('x') / saveBuffers('x')). */
export function specShots(spec) {
  const tests = [...spec.matchAll(/\btest\(\s*'((?:\\.|[^'\\])*)'/g)].map(m => ({ at: m.index, title: m[1].replace(/\\(.)/g, '$1') }));
  const out = new Map();
  for (const m of spec.matchAll(/\b(?:save|saveBuffers)\(\s*'([a-z0-9-]+)'/g)) {
    const t = tests.filter(x => x.at < m.index).pop();
    out.set(m[1], t?.title ?? null);
  }
  return out;
}
/** The page ids of BRAIN_PAGES (comments and aliases left out). */
export function pageIds(text) {
  const start = text.indexOf('export const BRAIN_PAGES');
  if (start < 0) return [];
  return [...text.slice(start, text.indexOf('];', start)).replace(/\/\/[^\n]*/g, '').matchAll(/\bpage\(\s*'([a-z0-9-]+)'/g)].map(m => m[1]);
}
/** "src/x/**", "src/x/*.tsx", "src/x/" (a folder) or a plain path, against a repo-relative path. */
export function globMatch(pattern, file) {
  if (pattern.endsWith('/')) return file.startsWith(pattern);
  const re = new RegExp(`^${pattern.split('**').map(part => part.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`);
  return re.test(file);
}
const shotName = src => src.slice(SHOTS_DIR.length).replace(/\.[a-z0-9]+$/i, '');
const mentions = (text, word) => new RegExp(`(^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(text);

/**
 * The README's problems, each { key, message } with its fix. `files` = every repo file (for the manifest's sources),
 * `exists(path)` = a path is on disk.
 */
export function readmeProblems({ readme, spec, manifest, pages, files, exists }) {
  const out = [];
  const add = (key, message) => out.push({ key, message });
  const { paragraphs, density } = foreignProse(readme);
  for (const p of paragraphs) add(`english:${p.text.slice(0, 40)}`, `README.md is not English here («${p.text}…», ${p.hits.join(', ')}): write it in English (UI labels may stay in «quotes»)`);
  if (density > TEXT_MAX) add('english:text', `README.md has ${(density * 100).toFixed(1)}% Italian/German stop words (max ${TEXT_MAX * 100}%): write it in English`);

  const taken = specShots(spec), shots = manifest.shots ?? {};
  for (const src of readmeImages(readme)) {
    if (!exists(src)) { add(`missing-image:${src}`, `README.md shows ${src}, which does not exist: take it (npm run shots) or fix the path`); continue; }
    if (!src.startsWith(SHOTS_DIR)) continue;
    const name = shotName(src);
    if (!taken.has(name)) add(`no-test:${name}`, `README.md shows ${src}, but ${SPEC} never takes it: add a save('${name}') step to a README test and a "${name}" entry to ${MANIFEST}`);
  }
  for (const [name, test] of taken) {
    const m = shots[name];
    if (!m) { add(`no-manifest:${name}`, `${SPEC} takes "${name}" but ${MANIFEST} has no entry for it: add { "test": ${JSON.stringify(test)}, "sources": [the UI files it shows] }`); continue; }
    if (m.test !== test) add(`manifest-test:${name}`, `${MANIFEST} says "${name}" is taken by test ${JSON.stringify(m.test)}, but ${SPEC} takes it in ${JSON.stringify(test)}: fix the manifest`);
  }
  for (const [name, m] of Object.entries(shots)) {
    if (!taken.has(name)) add(`manifest-stale:${name}`, `${MANIFEST} has "${name}", which ${SPEC} no longer takes: remove the entry (or take the shot again)`);
    if (!Array.isArray(m.sources) || !m.sources.length) add(`manifest-sources:${name}`, `${MANIFEST} "${name}" needs "sources": the UI files the screenshot shows`);
    for (const g of m.sources ?? []) if (!files.some(f => globMatch(g, f))) add(`manifest-source:${name}:${g}`, `${MANIFEST} "${name}" lists ${g}, which matches no file (renamed?): fix the path`);
  }
  for (const g of manifest.global ?? []) if (!files.some(f => globMatch(g, f))) add(`manifest-source:global:${g}`, `${MANIFEST} "global" lists ${g}, which matches no file: fix the path`);

  // a mention may be in prose or in an image's alt text (what a reader of the page sees), never in code or a comment
  const text = readme.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const said = manifest.pages ?? {};
  for (const id of pages) {
    const ws = said[id];
    if (!ws?.length) { add(`page-words:${id}`, `page "${id}" (BRAIN_PAGES) has no entry in ${MANIFEST} "pages": add the English words that name it in the README, and mention it in README.md`); continue; }
    if (!ws.some(w => mentions(text, w))) add(`page:${id}`, `README.md never mentions the page "${id}" (any of: ${ws.join(', ')}): add it to the tour or to «Also on board»`);
  }
  for (const id of Object.keys(said)) if (!pages.includes(id)) add(`page-stale:${id}`, `${MANIFEST} "pages" has "${id}", which is no longer in BRAIN_PAGES: remove it`);
  return out;
}

/** The opt-out of a branch's commit messages: null = none, [] = every shot, else the named shots. */
export function optOut(messages) {
  let all = false;
  const names = [];
  for (const line of messages.split('\n')) {
    const m = /^\s*shots:\s*unchanged-visually\b(.*)$/i.exec(line);
    if (!m) continue;
    const rest = m[1].trim().split(/[\s,]+/).filter(Boolean);
    if (!rest.length) all = true; else names.push(...rest);
  }
  return all ? [] : names.length ? names : null;
}

/** Shots whose UI changed on the branch while the shot did not: [{ key, message }]. */
export function freshnessProblems({ manifest, changed, messages }) {
  const out = [];
  const skip = optOut(messages);
  const global = manifest.global ?? [];
  for (const [name, m] of Object.entries(manifest.shots ?? {})) {
    const img = `${SHOTS_DIR}${name}.webp`;
    if (changed.includes(img)) continue;
    if (skip && (skip.length === 0 || skip.includes(name))) continue;
    const hits = changed.filter(f => [...(m.sources ?? []), ...global].some(g => globMatch(g, f)));
    if (!hits.length) continue;
    out.push({ key: `fresh:${name}`, message: `${img} shows UI this branch changed (${hits.slice(0, 4).join(', ')}${hits.length > 4 ? ` +${hits.length - 4}` : ''}) but was not taken again: run \`npm run shots\`, look at it and commit it; if nothing visible changed, add the line \`${OPT_OUT} ${name}\` (or \`${OPT_OUT}\` for every shot) to a commit message of the branch` });
  }
  return out;
}

/** Splits problems by the manifest's pending keys: { failures, pending (still true), fixed (pending keys to remove) }. */
export function sortOut(problems, pending = {}) {
  const keys = new Set(problems.map(p => p.key));
  return {
    failures: problems.filter(p => !(p.key in pending)),
    pending: problems.filter(p => p.key in pending),
    fixed: Object.keys(pending).filter(k => !keys.has(k)).map(k => ({ key: k, message: `${MANIFEST} "pending" lists "${k}", which is fixed now: remove it` })),
  };
}

// ── the command ────────────────────────────────────────────────────────────────────────────────────────────────────
function repoFiles(root) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  return [...new Set([...git('-c', 'core.quotePath=false', 'ls-files').split('\n'), ...git('-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard').split('\n')])]
    .filter(f => f && fs.existsSync(path.join(root, f)));
}

/** Everything the command checks, from a checkout: { failures, pending, fixed }. base = null skips the freshness. */
export function checkRepo(root, base) {
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const manifest = JSON.parse(read(MANIFEST));
  const problems = readmeProblems({ readme: read('README.md'), spec: read(SPEC), manifest, pages: pageIds(read(PAGES_FILE)), files: repoFiles(root), exists: f => fs.existsSync(path.join(root, f)) });
  if (!pageIds(read(PAGES_FILE)).length) problems.push({ key: 'read:pages', message: `could not read BRAIN_PAGES in ${PAGES_FILE}: update pageIds in scripts/readme-check.mjs` });
  const sorted = sortOut(problems, manifest.pending ?? {});
  if (base) {
    const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
    const changed = [...new Set([...git('-c', 'core.quotePath=false', 'diff', '--name-only', base).split('\n'), ...git('-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean))];
    sorted.failures.push(...freshnessProblems({ manifest, changed, messages: git('log', '--format=%B', `${base}..HEAD`) }));
  }
  return sorted;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  let base = args.includes('--base') ? args[args.indexOf('--base') + 1] : null;
  if (!base) {
    try {
      const head = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
      if (head !== 'main') base = execFileSync('git', ['merge-base', 'HEAD', 'main'], { cwd: root, encoding: 'utf8' }).trim();
    } catch { base = null; }
  }
  const r = checkRepo(root, base);
  if (args.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(r.failures.length || r.fixed.length ? 1 : 0); }
  for (const p of r.pending) console.log(`readme: pending (${MANIFEST}): ${p.message}`);
  const bad = [...r.failures, ...r.fixed];
  for (const p of bad) console.error(`readme: ${p.message}`);
  if (bad.length) { console.error(`\nreadme check: ${bad.length} problem${bad.length > 1 ? 's' : ''} (ADR 0208)`); process.exit(1); }
  console.log(`readme check: ok${base ? ` (freshness against ${base.slice(0, 7)})` : ''}${r.pending.length ? `, ${r.pending.length} pending` : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
