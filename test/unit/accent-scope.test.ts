// The one accent (restyle step 2) is defined only in the theme blocks: tokens.css and appearance.css. No other file
// under src/renderer may redefine --accent* (a component's local colour gets its own name, like tree.css --dc-tone):
// a local `--accent: var(--accent)` is a CSS cycle that empties the accent for everything inside, e.g. the ChatTile an
// open delegation card mounts. Theme blocks may not reference the token they define either.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER = path.resolve(import.meta.dirname, '..', '..', 'src', 'renderer');
const THEME_FILES = new Set(['styles/tokens.css', 'styles/appearance.css']);

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(css|tsx?)$/.test(e.name) ? [p] : [];
  });
}
const rel = (p: string): string => path.relative(RENDERER, p).split(path.sep).join('/');

describe('accent scope', () => {
  it('no file under src/renderer redefines --accent* outside the theme blocks', () => {
    // a CSS declaration (`--accent-bg: …`), a style object key (`'--accent': …`) or a setProperty('--accent…')
    const redefines = /(?<![\w-])--accent[\w-]*\s*:|['"`]--accent[\w-]*['"`]\s*:|setProperty\(\s*['"`]--accent/;
    const hits = files(RENDERER).filter(f => !THEME_FILES.has(rel(f)))
      .flatMap(f => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => [rel(f), i + 1, l] as const))
      .filter(([, , l]) => redefines.test(l)).map(([f, n]) => `${f}:${n}`);
    expect(hits).toEqual([]);
  });

  it('no theme block defines an --accent* token from itself', () => {
    for (const f of THEME_FILES) {
      const css = fs.readFileSync(path.join(RENDERER, f), 'utf8');
      for (const m of css.matchAll(/(--accent[\w-]*)\s*:\s*([^;}]+)/g)) expect(m[2]!.includes(`var(${m[1]})`), `${f} ${m[1]}`).toBe(false);
    }
  });
});
