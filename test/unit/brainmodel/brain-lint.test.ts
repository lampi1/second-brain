// The brain lint (ADR 0194, M2): cited paths are found conservatively and «missing» only when their place is there
// (rules/cited-paths.ts); the lint (brainmodel/brain-lint.ts) finds orphans (not hubs, only in a linked brain), broken
// links, concepts cited three times without a note, facts and skill lines citing files that are gone, and a confirmed
// fact whose cited file changed since it was first seen.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { boldTerms, lintBrain, noteLinks } from '../../../src/main/brainmodel/brain-lint';
import { citedPaths, pathLike, pathState } from '../../../src/main/rules/cited-paths';
import type { MemoryRecord } from '../../../src/main/rules/memory-records';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lint-'))); dirs.push(d); return d; };
const put = (root: string, rel: string, text = 'x\n') => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const fact = (id: string, value: string, o: Partial<MemoryRecord> = {}): MemoryRecord => ({ memoryId: id, scope: { roleId: 'artisan' }, subject: 'setup', predicate: 'note', value, sourceEventId: 'e', sourceRunId: 'r',
  observedAt: '2026-10-01T00:00:00Z', validFrom: '2026-10-01T00:00:00Z', validTo: null, status: 'confirmed', supersedes: null, ...o });

describe('cited paths', () => {
  it('finds backticked and bare paths, never URLs, flags, globs, versions or domains', () => {
    expect(citedPaths('Le note sono in `docs/release.md`, lo script in scripts/build.ps1. Vedi https://x.org/a/b.md e `--force`, `src/*.ts`, `1.2.3`, `github.com/a/b`.'))
      .toEqual(['docs/release.md', 'scripts/build.ps1']);
    expect(citedPaths('Usa `package.json` e C:\\Users\\me\\x.txt')).toEqual(['package.json', 'C:\\Users\\me\\x.txt']);
    expect(pathLike('readme')).toBe(false);
    expect(pathLike('notes.md')).toBe(true);
  });
  it('is missing only when the place it points into is there; a bare name never', () => {
    const root = tmp();
    put(root, 'docs/here.md');
    expect(pathState('docs/here.md', [root])).toBe('exists');
    expect(pathState('docs/gone.md', [root])).toBe('missing');
    expect(pathState('elsewhere/gone.md', [root])).toBe('unknown');
    expect(pathState('gone.md', [root])).toBe('unknown');
    expect(pathState(path.join(root, 'docs', 'gone.md'), [])).toBe('missing');
    expect(pathState('/no-such-top/really/x.md', [])).toBe('unknown');
    expect(pathState('~/docs/here.md', [], { home: root })).toBe('exists');
  });
});

describe('note parsing', () => {
  it('reads wiki and markdown links outside code, and short bold terms', () => {
    const text = 'Vedi [[Deploy|il deploy]] e [guida](sub/guida.md#x), non [web](https://x.org).\n```\n[[in-code]]\n```\n`[[inline]]`\n**Rimborsi parziali** e **Nota:**';
    expect(noteLinks(text).map(l => [l.kind, l.target])).toEqual([['wiki', 'Deploy'], ['md', 'sub/guida.md']]);
    expect(boldTerms(text)).toEqual(['Rimborsi parziali']);
  });
});

describe('lintBrain', () => {
  it('finds orphans, broken links, concepts, stale facts and skill lines, and changed cited files', () => {
    const root = tmp();
    put(root, 'hub.md', '# Hub\n\n- [[a]]\n- [[b]]\n');
    put(root, 'a.md', 'Va con [[b]] e [[Rimborsi]]. Vedi [x](missing.md). **Saldo finale** qui.\n');
    put(root, 'b.md', 'Parla di [[Rimborsi]] e **Saldo finale**.\n');
    put(root, 'c.md', 'Ancora [[Rimborsi]] e **Saldo finale** e [[Nessuno]].\n');
    put(root, 'rules/x.md', 'Regola.\n');
    put(root, 'docs/kept.md', 'v1\n');
    put(root, '.claude/skills/build/SKILL.md', '---\nname: build\ndescription: d\n---\n\n- Lancia `scripts/build.ps1`\n- Leggi `docs/kept.md`\n');
    put(root, 'scripts/other.ps1');
    const skills = [{ name: 'build', file: path.join(root, '.claude/skills/build/SKILL.md'), home: 'brain' as const }];
    const records = [fact('m1', 'Il rilascio usa `docs/old.md`'), fact('m2', 'Le note sono in `docs/kept.md`'), fact('m3', 'Vecchio `docs/old.md`', { validTo: '2026-10-02T00:00:00Z', status: 'retracted' })];
    const hashes: Record<string, string> = {};
    const found = lintBrain({ root, skills, records, hashes });
    const by = (c: string) => found.filter(f => f.check === c);
    expect(by('orphan').map(f => f.file)).toEqual(['c.md', 'docs/kept.md']); // hub, rules/ and linked notes are not
    expect(by('broken-link').map(f => `${f.file} → ${f.target}`).sort()).toEqual(['a.md → missing.md', 'c.md → Nessuno']);
    expect(by('concept').map(f => [f.target, f.about])).toEqual([['Rimborsi', '3'], ['Saldo finale', '3']]);
    expect(by('concept')[0]!.citedBy).toEqual(['a.md', 'b.md', 'c.md']);
    expect(by('stale-fact')).toEqual([expect.objectContaining({ memoryId: 'm1', target: 'docs/old.md', about: 'Il rilascio usa `docs/old.md`' })]);
    expect(by('stale-cite')).toEqual([expect.objectContaining({ file: '.claude/skills/build/SKILL.md', target: 'scripts/build.ps1', line: '- Lancia `scripts/build.ps1`', about: 'build' })]);
    expect(by('changed-fact')).toEqual([]);
    expect(Object.keys(hashes)).toEqual(['m2|docs/kept.md']);
    // the cited file changes: one changed-fact finding, keyed by the new content
    put(root, 'docs/kept.md', 'v2\n');
    const again = lintBrain({ root, skills, records, hashes }).filter(f => f.check === 'changed-fact');
    expect(again).toEqual([expect.objectContaining({ memoryId: 'm2', target: 'docs/kept.md' })]);
    expect(again[0]!.key).toMatch(/^changed-fact:m2:docs\/kept\.md:[0-9a-f]{16}$/);
  });
  it('a brain that does not link its notes has no orphans', () => {
    const root = tmp();
    put(root, 'a.md', 'testo\n'); put(root, 'b.md', 'testo\n');
    expect(lintBrain({ root, skills: [], records: [], hashes: {} })).toEqual([]);
  });
});
