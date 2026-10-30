// scripts/readme-check.mjs (ADR 0208): the README stays English, every image it shows exists and is taken by the README
// screenshot spec in the test the manifest names, every page is mentioned, and a branch that changes a shot's UI takes
// the shot again or opts out in a commit message. The pure parts on fixtures, then this checkout (no new problem, no
// pending key already fixed); the git-based freshness runs in `npm run check:branch`.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import * as rc from '../../scripts/readme-check.mjs';

interface Problem { key: string; message: string }
interface Manifest { global?: string[]; shots?: Record<string, { test: string | null; sources: string[] }>; pages?: Record<string, string[]>; pending?: Record<string, string> }
const m = rc as {
  prose(md: string): string;
  foreignProse(md: string): { paragraphs: { text: string; hits: string[] }[]; density: number };
  readmeImages(md: string): string[];
  specShots(spec: string): Map<string, string | null>;
  pageIds(text: string): string[];
  globMatch(pattern: string, file: string): boolean;
  readmeProblems(o: { readme: string; spec: string; manifest: Manifest; pages: string[]; files: string[]; exists(f: string): boolean }): Problem[];
  optOut(messages: string): string[] | null;
  freshnessProblems(o: { manifest: Manifest; changed: string[]; messages: string }): Problem[];
  sortOut(p: Problem[], pending?: Record<string, string>): { failures: Problem[]; pending: Problem[]; fixed: Problem[] };
  checkRepo(root: string, base: string | null): { failures: Problem[]; pending: Problem[]; fixed: Problem[] };
};

describe('English', () => {
  it('leaves code, links, comments and «quoted labels» out of the prose', () => {
    const p = m.prose('Hi <!-- nota -->\n```\nil codice della app\n```\n`della` [the docs](http://x/della) «Il mio spazio» https://e.it/che');
    expect(p).not.toMatch(/codice|della|mio|nota|che/);
    expect(p).toContain('the docs');
  });
  it('flags an Italian or German paragraph, not an English one with a few loan words', () => {
    const en = 'A cockpit for your agents: the Orchestrator plans, five roles work, and the brain gets better per role every week.';
    expect(m.foreignProse(en).paragraphs).toEqual([]);
    const it = `${en}\n\nQuesto è il pannello che mostra tutti gli agenti della squadra e anche le loro note.`;
    const out = m.foreignProse(it);
    expect(out.paragraphs).toHaveLength(1);
    expect(out.paragraphs[0]!.hits).toEqual(expect.arrayContaining(['questo', 'il', 'della']));
    expect(m.foreignProse('Das ist nicht für dich und auch nicht für mich, wenn es regnet oder schneit.').paragraphs).toHaveLength(1);
  });
});

describe('images, the spec and the manifest', () => {
  const spec = "test('first', async () => {\n  await save('a');\n});\ntest('the Strategist\\'s plan', async () => {\n  await saveBuffers('b', []);\n});";
  it('reads the README images and the shots the spec takes with their test', () => {
    expect(m.readmeImages('![x](docs/screenshots/a.webp)\n<img src="docs/screenshots/b.webp" width="3">\n<img src="https://x/y.png">\n![x](docs/screenshots/a.webp)'))
      .toEqual(['docs/screenshots/a.webp', 'docs/screenshots/b.webp']);
    expect([...m.specShots(spec)]).toEqual([['a', 'first'], ['b', 'the Strategist\'s plan']]);
  });
  it('matches globs, folders and plain paths', () => {
    expect(m.globMatch('src/x/**', 'src/x/a/b.ts')).toBe(true);
    expect(m.globMatch('src/x/*.tsx', 'src/x/a/b.tsx')).toBe(false);
    expect(m.globMatch('src/x/', 'src/x/a.ts')).toBe(true);
    expect(m.globMatch('src/a.ts', 'src/a.ts')).toBe(true);
    expect(m.globMatch('src/a.ts', 'src/a.tsx')).toBe(false);
  });
  it('names each gap with its key: a missing image, a shot no test takes, a manifest out of step, a page not mentioned', () => {
    const readme = 'Meet the Grindhouse.\n![x](docs/screenshots/a.webp) ![y](docs/screenshots/c.webp) ![z](build/missing.png)';
    const manifest: Manifest = { shots: { a: { test: 'first', sources: ['src/a.tsx'] }, b: { test: 'wrong', sources: ['src/gone.tsx'] }, old: { test: 'x', sources: ['src/a.tsx'] } }, pages: { home: ['Grindhouse'], task: ['Tasks'], gone: ['X'] } };
    const keys = m.readmeProblems({ readme, spec, manifest, pages: ['home', 'task', 'impara'], files: ['src/a.tsx'], exists: f => f !== 'build/missing.png' }).map(p => p.key);
    expect(keys).toEqual(['no-test:c', 'missing-image:build/missing.png', 'manifest-test:b', 'manifest-source:b:src/gone.tsx', 'manifest-stale:old', 'page:task', 'page-words:impara', 'page-stale:gone']);
    expect(m.pageIds("const X = 1;\nexport const BRAIN_PAGES = [\n  page('home', 'G H'),\n  // page('x', 'G')\n  page('impara', 'G X'),\n];")).toEqual(['home', 'impara']);
  });
  it('keeps pending gaps as warnings and asks to remove a pending key once fixed', () => {
    const r = m.sortOut([{ key: 'page:task', message: 'm' }, { key: 'no-test:c', message: 'n' }], { 'page:task': 'later', 'page:gone': 'old' });
    expect(r.failures.map(p => p.key)).toEqual(['no-test:c']);
    expect(r.pending.map(p => p.key)).toEqual(['page:task']);
    expect(r.fixed.map(p => p.key)).toEqual(['page:gone']);
  });
});

describe('freshness', () => {
  const manifest: Manifest = { global: ['src/tokens.css'], shots: { log: { test: 't', sources: ['src/Log.tsx'] }, memory: { test: 't', sources: ['src/mem/'] } } };
  it('fails a branch that changed a shot\'s UI but not the shot, with the fix', () => {
    const out = m.freshnessProblems({ manifest, changed: ['src/Log.tsx', 'src/other.ts'], messages: 'feat: x' });
    expect(out.map(p => p.key)).toEqual(['fresh:log']);
    expect(out[0]!.message).toContain('npm run shots');
    expect(out[0]!.message).toContain('shots: unchanged-visually log');
    expect(m.freshnessProblems({ manifest, changed: ['src/tokens.css'], messages: '' }).map(p => p.key)).toEqual(['fresh:log', 'fresh:memory']);
  });
  it('passes when the shot was taken again or a commit message opts out', () => {
    expect(m.freshnessProblems({ manifest, changed: ['src/Log.tsx', 'docs/screenshots/log.webp'], messages: '' })).toEqual([]);
    expect(m.freshnessProblems({ manifest, changed: ['src/Log.tsx', 'src/mem/a.tsx'], messages: 'fix: y\n\nshots: unchanged-visually' })).toEqual([]);
    expect(m.freshnessProblems({ manifest, changed: ['src/Log.tsx', 'src/mem/a.tsx'], messages: 'shots: unchanged-visually log' }).map(p => p.key)).toEqual(['fresh:memory']);
    expect(m.optOut('nothing here')).toBeNull();
    expect(m.optOut('Shots: unchanged-visually a, b')).toEqual(['a', 'b']);
  });
});

describe('this checkout', () => {
  it('has no README problem beyond the pending ones, and no pending key already fixed', () => {
    const r = m.checkRepo(path.resolve(import.meta.dirname, '../..'), null);
    expect([...r.failures, ...r.fixed].map(p => p.message)).toEqual([]);
  });
});
