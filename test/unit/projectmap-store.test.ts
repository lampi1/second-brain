// Unit tests of main/projectmap/store.ts (ADR 0271): a map lives in <brain>/projects/<project>/ as map.json plus one
// history line per version; list sums what waits for the user; a version reads back as it was; the history keeps its
// first line and the last HISTORY_MAX - 1; no brain or a bad project name refuses to write.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectMap } from '../../src/shared/project-map';
import { HISTORY_MAX, ProjectMapStore } from '../../src/main/projectmap/store';

const dirs: string[] = [];
const brain = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pmap-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const map = (version: number, extra: Partial<ProjectMap> = {}): ProjectMap => ({
  project: 'shop', title: 'Shop', version, updatedAt: version * 1000, by: 'Scout', summary: `v${version}`, corrections: [],
  elements: [{ id: 'web', kind: 'system', name: 'Web', status: 'blocked', actor: 'user', evidence: [], confirmedAt: 1 }],
  links: [], ...extra,
});

describe('ProjectMapStore', () => {
  it('saves versions, lists them and reads any back', () => {
    const root = brain(), s = new ProjectMapStore(() => root);
    s.save(map(1)); s.save(map(2, { title: 'Shop 2' }));
    expect(JSON.parse(fs.readFileSync(path.join(root, 'projects', 'shop', 'map.json'), 'utf8')).version).toBe(2);
    expect(s.list()).toEqual([{ project: 'shop', title: 'Shop 2', version: 2, updatedAt: 2000, elements: 1, waiting: 1 }]);
    expect(s.history('shop').map(h => h.summary)).toEqual(['v1', 'v2']);
    expect(s.version('shop', 1)!.title).toBe('Shop');
    expect(s.version('shop', 9)).toBeNull();
  });
  it('keeps the first version and the last ones', () => {
    const root = brain(), s = new ProjectMapStore(() => root);
    for (let v = 1; v <= HISTORY_MAX + 5; v++) s.save(map(v));
    const h = s.history('shop');
    expect(h).toHaveLength(HISTORY_MAX);
    expect(h[0]!.version).toBe(1);
    expect(h[1]!.version).toBe(7);
    expect(h.at(-1)!.version).toBe(HISTORY_MAX + 5);
  });
  it('skips a broken history line and a folder that is not a project', () => {
    const root = brain(), s = new ProjectMapStore(() => root);
    s.save(map(1));
    fs.appendFileSync(path.join(root, 'projects', 'shop', 'history.jsonl'), '{broken\n');
    fs.mkdirSync(path.join(root, 'projects', 'Not A Project'));
    expect(s.history('shop')).toHaveLength(1);
    expect(s.list()).toHaveLength(1);
  });
  it('refuses without a brain or with a bad name', () => {
    expect(() => new ProjectMapStore(() => null).save(map(1))).toThrow('nessun brain');
    expect(new ProjectMapStore(() => null).list()).toEqual([]);
    const root = brain();
    expect(() => new ProjectMapStore(() => root).save(map(1, { project: '../x' }))).toThrow('progetto non valido');
  });
});
