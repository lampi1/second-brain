// Nothing in the app still names the old project maps and work maps (ADR 0361): they are plans now. Only three places may:
// the one reader of the retired files (main/plans/migrate.ts), the historical ADRs, and the changelog. The 3D brain map is not
// one of them, and is allowed under its own names (page `mappa`, nav-mappa3d).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const ALLOWED = [/^src\/main\/plans\/migrate\.ts$/, /^docs\/adr\//, /^CHANGELOG\.md$/, /^test\/unit\/no-old-maps\.test\.ts$/, /^test\/unit\/plans\/migrate\.test\.ts$/];
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'release', 'test-results', 'playwright-report', 'coverage']);
const EXT = /\.(ts|tsx|css|md|json|html|mjs|cjs|yml|yaml)$/;
/** the names the old maps lived under: code, files, tool names, wording in the three languages */
const OLD = [
  /project[-_ ]?maps?/i, /work[-_ ]?maps?/i, /workmaps?/i, /\bprojectmap/i, /app_project_map/, /\bMapsButton\b/, /\bopenMaps\b/, /\bWorkBox\b/, /\bjobAction\b/,
  /mappe? di lavoro/i, /mappe? (del|dei|dello) progett/i, /mappa del lavoro/i, /Arbeitskarte/i, /Projektkarte/i,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

describe('no leftovers of the old maps', () => {
  it('src, test, docs and the manifests name them nowhere but in the migration reader, the historical ADRs and the changelog', () => {
    const files = ['src', 'test', 'docs', 'e2e'].flatMap(d => (fs.existsSync(path.join(ROOT, d)) ? walk(path.join(ROOT, d)) : []))
      .concat(['README.md', 'CLAUDE.md', 'AGENTS.md', 'package.json'].map(f => path.join(ROOT, f)).filter(f => fs.existsSync(f)));
    const hits: string[] = [];
    for (const f of files) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      if (ALLOWED.some(a => a.test(rel))) continue;
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { const m = OLD.find(re => re.test(line)); if (m) hits.push(`${rel}:${i + 1} ${m}`); });
    }
    expect(hits).toEqual([]);
  });
  it('the retired folders and files are gone', () => {
    for (const gone of ['src/main/projectmap', 'src/renderer/components/project-map', 'src/renderer/components/work-map', 'src/shared/project-map.ts']) expect(fs.existsSync(path.join(ROOT, gone)), gone).toBe(false);
  });
});
