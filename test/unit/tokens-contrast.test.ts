// Design tokens (src/renderer/styles/tokens.css, appearance.css): the app is dark only (ADR 0366), so there is one theme
// block and the calm appearance on it. The colour pairs the restyle fixed meet WCAG 2.2 AA (4.5:1 text, 3:1 control
// borders), computed like the restyle audit's contrast.mjs; the state words (coloured text with their dot, no tinted box,
// issue #491) read on every surface; the three radii are the squarer 3/4/6 px; no light block is left anywhere; and no
// CSS rule of the renderer sets a text colour under 4.5:1 on the background it sets itself.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER = path.resolve(import.meta.dirname, '..', '..', 'src', 'renderer');
const STYLES = path.join(RENDERER, 'styles');
const tokensCss = fs.readFileSync(path.join(STYLES, 'tokens.css'), 'utf8');
const appearanceCss = fs.readFileSync(path.join(STYLES, 'appearance.css'), 'utf8');
const brainCss = fs.readFileSync(path.resolve(STYLES, '..', 'brain', 'brain.css'), 'utf8');

/** The custom properties declared in the first rule whose selector starts with `selector` (nested media rules too). */
function block(css: string, selector: string): Map<string, string> {
  const at = css.indexOf(selector + ' {') >= 0 ? css.indexOf(selector + ' {') : css.indexOf(selector + '{');
  if (at < 0) throw new Error(`no block ${selector}`);
  const open = css.indexOf('{', at);
  const body = css.slice(open + 1, css.indexOf('}', open));
  const vars = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars.set(m[1]!, m[2]!.trim());
  return vars;
}

// the formula of contrast.mjs: sRGB relative luminance, alpha colours composited on their background first
type Rgb = [number, number, number];
type Rgba = [number, number, number, number];
const hex = (h: string): Rgb => { const s = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16)) as Rgb; };
const lum = (rgb: Rgb): number => {
  const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };

/** A token's colour, following `var(--x)` references inside the same theme (falling back to the dark :root). */
function colour(theme: Map<string, string>, root: Map<string, string>, name: string): Rgb {
  let v = theme.get(name) ?? root.get(name);
  for (let i = 0; v && i < 5; i++) {
    const ref = /^var\((--[\w-]+)\)$/.exec(v);
    if (!ref) break;
    v = theme.get(ref[1]!) ?? root.get(ref[1]!);
  }
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} is not a #rrggbb colour: ${v}`);
  return hex(v);
}

const dark = block(tokensCss, ':root');
const calmDark = block(appearanceCss, ':root[data-appearance="calm"],.appearance-sample[data-appearance="calm"]');
const ACCENT_TOKENS = ['--accent', '--accent-strong', '--accent-bg', '--accent-line'];

// [foreground, background, minimum, role]
const PAIRS: [string, string, number, string][] = [
  ['--text-4', '--surface', 4.5, 'faint meta'],
  ['--text-4', '--surface-2', 4.5, 'faint meta on raised'],
  ['--text-4', '--surface-3', 4.5, 'faint meta on hover'],
  ['--on-amber', '--amber', 4.5, 'amber badge text'],
  ['--on-red', '--red', 4.5, 'red button text'],
  ['--border-control', '--surface', 3, 'control border'],
  ['--border-control', '--surface-2', 3, 'control border on raised'],
  ['--border-control', '--bg', 3, 'control border on canvas (.field)'],
  ['--accent', '--surface', 4.5, 'accent text and links'],
  ['--accent', '--surface-2', 4.5, 'accent text on raised'],
  ['--on-accent', '--accent', 4.5, 'primary button label and the sidebar counters'],
  ['--focus', '--surface', 3, 'focus ring'],
  ['--focus', '--bg', 3, 'focus ring on canvas'],
  ['--del-fg', '--surface-3', 4.5, 'a red ✕ on its hover'],
];
// the state words of a strip and of every state pill: coloured text on the page itself, no tinted box (issue #491)
const STATE_TONES = ['--accent', '--amber', '--green', '--red', '--violet', '--text-3'];
const SURFACES = ['--bg', '--surface', '--surface-2', '--surface-3'];

describe('token contrast (WCAG 2.2 AA, dark only)', () => {
  for (const [fg, bg, min, role] of PAIRS) {
    it(`${role} (${fg} on ${bg}) >= ${min}:1`, () => {
      expect(ratio(colour(dark, dark, fg), colour(dark, dark, bg))).toBeGreaterThanOrEqual(min);
    });
  }

  it('every state tone reads >= 4.5:1 on every surface (the strips and pills have no tinted box)', () => {
    for (const fg of STATE_TONES) for (const bg of SURFACES) expect(ratio(colour(dark, dark, fg), colour(dark, dark, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('matches the audit numbers of contrast.mjs (same formula)', () => {
    expect(ratio(hex('#1b1304'), hex('#93580a')).toFixed(2)).toBe('3.19');
    expect(ratio(hex('#ffffff'), hex('#93580a')).toFixed(2)).toBe('5.77');
    expect(ratio(hex('#707788'), hex('#191a1f')).toFixed(2)).toBe('3.87');
  });

  it('--text-4 is --text-3', () => {
    expect(dark.get('--text-4')).toBe('var(--text-3)');
  });

  it('the dark accent and focus match the restyle plan (7.32:1 on --surface, 7.96:1 on --bg)', () => {
    expect(ratio(colour(dark, dark, '--accent'), colour(dark, dark, '--surface')).toFixed(2)).toBe('7.32');
    expect(ratio(colour(dark, dark, '--focus'), colour(dark, dark, '--bg')).toFixed(2)).toBe('7.96');
  });

  it('the calm appearance keeps a teal accent that meets AA, its focus on it', () => {
    expect(calmDark.get('--accent')).not.toBe(dark.get('--accent'));
    const [r, g, b] = colour(calmDark, dark, '--accent');
    expect(g > r && b > r, 'teal: green and blue over red').toBe(true);
    for (const bg of ['--surface', '--surface-2']) expect(ratio(colour(calmDark, dark, '--accent'), colour(calmDark, dark, bg))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colour(calmDark, dark, '--on-accent'), colour(calmDark, dark, '--accent'))).toBeGreaterThanOrEqual(4.5);
    for (const bg of ['--surface', '--bg']) expect(ratio(colour(calmDark, dark, '--focus'), colour(calmDark, dark, bg))).toBeGreaterThanOrEqual(3);
  });

  it('control borders and faint text stay readable on the calm surfaces', () => {
    for (const bg of ['--surface', '--surface-2']) expect(ratio(colour(dark, dark, '--border-control'), colour(calmDark, dark, bg))).toBeGreaterThanOrEqual(3);
    for (const bg of ['--surface', '--surface-2']) expect(ratio(colour(calmDark, dark, '--text-4'), colour(calmDark, dark, bg))).toBeGreaterThanOrEqual(4.5);
    expect(calmDark.has('--text-4')).toBe(true);
  });
});

describe('dark only, squarer (ADR 0366)', () => {
  it('the radii are 3 / 4 / 6 px, the calm appearance too', () => {
    expect([dark.get('--r-s'), dark.get('--r-m'), dark.get('--r-l')]).toEqual(['3px', '4px', '6px']);
    expect([calmDark.get('--r-m'), calmDark.get('--r-l')]).toEqual(['4px', '6px']);
  });

  it('no stylesheet of the renderer keeps a light theme block', () => {
    const css = files(RENDERER).filter(f => f.endsWith('.css'));
    const light = css.filter(f => /prefers-color-scheme\s*:\s*light|data-theme\s*=\s*"?light/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(light).toEqual([]);
  });

  it('no hard-coded pill or large radius is left (circles of a square element excepted)', () => {
    const hits: string[] = [];
    for (const f of files(RENDERER).filter(x => x.endsWith('.css'))) {
      for (const [sel, body] of rules(fs.readFileSync(f, 'utf8'))) {
        const r = /border-radius\s*:\s*([^;}]+)/.exec(body);
        if (!r || /scrollbar/.test(sel)) continue;
        for (const v of r[1]!.split(/\s+/)) {
          const px = /^(\d+(?:\.\d+)?)px$/.exec(v);
          if (!px || Number(px[1]) <= 6) continue;
          const w = /(?:^|[;\s])width\s*:\s*(\d+)px/.exec(body), h = /(?:^|[;\s])height\s*:\s*(\d+)px/.exec(body);
          if (Number(px[1]) >= 99 && w && h && w[1] === h[1]) continue;
          hits.push(`${rel(f)} ${sel.trim().slice(0, 60)}: ${v}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('one accent', () => {
  it('--accent* are in the theme block and the calm block; --focus is the accent', () => {
    for (const t of [dark, calmDark]) for (const k of ACCENT_TOKENS) expect(t.has(k), k).toBe(true);
    for (const t of [dark, calmDark]) expect(t.get('--focus')).toBe('var(--accent)');
  });

  it('the --blue* names are only aliases of --accent* (no own value in any block)', () => {
    for (const k of ACCENT_TOKENS) expect(dark.get(k.replace('--accent', '--blue'))).toBe(`var(${k})`);
    for (const k of calmDark.keys()) expect(k.startsWith('--blue'), k).toBe(false);
  });

  it('the Brain layer takes the accent from the app tokens; only the 3D map keeps its own blue', () => {
    expect(brainCss).toContain('--bx-blue: var(--accent, ');
    expect(brainCss).toContain('--bx-focus: var(--focus, ');
    const outsideMap = brainCss.replace(/\.bx-map \{[^}]*\}/, '');
    expect(outsideMap).not.toBe(brainCss);
    expect(outsideMap).not.toMatch(/#3a5ce0/i);
    expect(outsideMap).not.toMatch(/--bx-blue(-bg|-line)?:\s*#/);
  });
});

// ---- a scan of every rule that sets both a text colour and a background: >= 4.5:1 on --surface and on --bg
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : [p];
  });
}
const rel = (p: string): string => path.relative(RENDERER, p).split(path.sep).join('/');
function rules(css: string): [string, string][] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1]!, m[2]!]);
}
/** A CSS colour as rgba, following the dark tokens; null when it cannot be read (a gradient, an unknown function). */
function parse(v: string): Rgba | null {
  v = v.trim();
  let r: RegExpExecArray | null;
  if ((r = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(v))) { const t = dark.get(r[1]!); return t ? parse(t) : r[2] ? parse(r[2]) : null; }
  if ((r = /^#([0-9a-f]{6})$/i.exec(v))) return [...hex(r[1]!), 1];
  if ((r = /^#([0-9a-f]{8})$/i.exec(v))) return [...hex(r[1]!.slice(0, 6)), parseInt(r[1]!.slice(6), 16) / 255];
  if ((r = /^#([0-9a-f]{3})$/i.exec(v))) { const s = r[1]!; return [...hex(s[0]! + s[0] + s[1] + s[1] + s[2] + s[2]), 1]; }
  if ((r = /^rgba?\(([^)]+)\)$/.exec(v))) { const p = r[1]!.split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0]!, p[1]!, p[2]!, p[3] ?? 1]; }
  if (v === 'transparent' || v === 'none') return [0, 0, 0, 0];
  if ((r = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)(?:\s+[\d.]+%)?\)$/.exec(v))) {
    const a = parse(r[1]!), b = parse(r[3]!), k = Number(r[2]) / 100;
    if (!a || !b) return null;
    if (b[3] === 0) return [a[0], a[1], a[2], a[3] * k];
    return [a[0] * k + b[0] * (1 - k), a[1] * k + b[1] * (1 - k), a[2] * k + b[2] * (1 - k), 1];
  }
  return null;
}
const over = (c: Rgba, bg: Rgb): Rgb => [0, 1, 2].map(i => c[i]! * c[3] + bg[i]! * (1 - c[3])) as Rgb;
/** brand marks keep their brand's colours (a logo, not text); a check box's tick shows only on its accent «on» state */
const EXEMPT = new Set(['.mark-claude', '.ask-check', '.mcp-role i']);

describe('no low-contrast text on its own background (dark mode)', () => {
  it('every rule with a colour and a background reads >= 4.5:1 on --surface and --bg', () => {
    const surface = colour(dark, dark, '--surface'), bg = colour(dark, dark, '--bg');
    const low: string[] = [];
    for (const f of files(RENDERER).filter(x => x.endsWith('.css'))) {
      for (const [sel, body] of rules(fs.readFileSync(f, 'utf8'))) {
        const b = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;!]+)/.exec(body), c = /(?:^|;)\s*color\s*:\s*([^;!]+)/.exec(body);
        if (!b || !c || EXEMPT.has(sel.trim())) continue;
        const back = parse(b[1]!), fore = parse(c[1]!);
        if (!back || !fore || back[3] === 0) continue;
        const worst = Math.min(...[surface, bg].map(base => { const under = over(back, base); return ratio(over(fore, under), under); }));
        if (worst < 4.5) low.push(`${rel(f)} ${sel.trim().slice(0, 60)}: ${worst.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });
});
