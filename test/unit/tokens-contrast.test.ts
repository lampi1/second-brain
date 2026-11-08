// Design tokens (src/renderer/styles/tokens.css, appearance.css): the colour pairs the restyle fixed for contrast meet
// WCAG 2.2 AA in both themes (4.5:1 text, 3:1 control borders), computed like the restyle audit's contrast.mjs, and the
// blocks written twice (the light theme by media query and by data-theme; the three calm blocks) define the same tokens,
// so a token added to one block cannot be forgotten in its twin. Step 2: one accent (--accent*, --focus on it, the --blue*
// aliases kept for one step) in every block, the calm appearance with its own teal accent, the Brain layer on --accent.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES = path.resolve(import.meta.dirname, '..', '..', 'src', 'renderer', 'styles');
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
const lightMedia = block(tokensCss, ':root:not([data-theme="dark"])');
const lightAttr = block(tokensCss, ':root[data-theme="light"]');
const themes = { dark, light: lightMedia } as const;
const calmDark = block(appearanceCss, ':root[data-appearance="calm"],.appearance-sample[data-appearance="calm"]');
const calmAttr = block(appearanceCss, ':root[data-theme="light"][data-appearance="calm"],:root[data-theme="light"] [data-appearance="calm"]');
const calmMedia = block(appearanceCss, ':root:not([data-theme="dark"])[data-appearance="calm"],:root:not([data-theme="dark"]) [data-appearance="calm"]');
const ACCENT_TOKENS = ['--accent', '--accent-strong', '--accent-bg', '--accent-line'];

// [foreground, background, minimum, role]: the pairs step 1 of the restyle changed
const PAIRS: [string, string, number, string][] = [
  ['--text-4', '--surface', 4.5, 'faint meta'],
  ['--text-4', '--surface-2', 4.5, 'faint meta on raised'],
  ['--text-4', '--surface-3', 4.5, 'faint meta on hover'],
  ['--on-amber', '--amber', 4.5, 'amber badge text'],
  ['--border-control', '--surface', 3, 'control border'],
  ['--border-control', '--surface-2', 3, 'control border on raised'],
  ['--border-control', '--bg', 3, 'control border on canvas (.field)'],
  // step 2: the one accent
  ['--accent', '--surface', 4.5, 'accent text and links'],
  ['--accent', '--surface-2', 4.5, 'accent text on raised'],
  ['--on-accent', '--accent', 4.5, 'primary button label'],
  ['--focus', '--surface', 3, 'focus ring'],
  ['--focus', '--bg', 3, 'focus ring on canvas'],
];

describe('token contrast (WCAG 2.2 AA)', () => {
  for (const [name, t] of Object.entries(themes)) {
    for (const [fg, bg, min, role] of PAIRS) {
      it(`${name}: ${role} (${fg} on ${bg}) >= ${min}:1`, () => {
        expect(ratio(colour(t, dark, fg), colour(t, dark, bg))).toBeGreaterThanOrEqual(min);
      });
    }
  }

  it('matches the audit numbers of contrast.mjs (same formula)', () => {
    expect(ratio(hex('#1b1304'), hex('#93580a')).toFixed(2)).toBe('3.19');
    expect(ratio(hex('#ffffff'), hex('#93580a')).toFixed(2)).toBe('5.77');
    expect(ratio(hex('#707788'), hex('#191a1f')).toFixed(2)).toBe('3.87');
    expect(ratio(hex('#80889a'), hex('#f6f7f9')).toFixed(2)).toBe('3.32');
  });

  it('--text-4 is --text-3 in every theme block', () => {
    for (const t of [dark, lightMedia, lightAttr]) expect(t.get('--text-4')).toBe('var(--text-3)');
  });

  it('the dark accent and focus match the restyle plan (7.32:1 on --surface, 7.96:1 on --bg)', () => {
    expect(ratio(colour(dark, dark, '--accent'), colour(dark, dark, '--surface')).toFixed(2)).toBe('7.32');
    expect(ratio(colour(dark, dark, '--focus'), colour(dark, dark, '--bg')).toFixed(2)).toBe('7.96');
  });

  it('the calm appearance keeps a teal accent that meets AA, its focus on it', () => {
    for (const [calm, base] of [[calmDark, dark], [calmAttr, lightAttr]] as const) {
      expect(calm.get('--accent')).not.toBe(base.get('--accent'));
      const [r, g, b] = colour(calm, base, '--accent');
      expect(g > r && b > r, 'teal: green and blue over red').toBe(true);
      for (const bg of ['--surface', '--surface-2']) expect(ratio(colour(calm, base, '--accent'), colour(calm, base, bg))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(colour(calm, base, '--on-accent'), colour(calm, base, '--accent'))).toBeGreaterThanOrEqual(4.5);
      for (const bg of ['--surface', '--bg']) expect(ratio(colour(calm, base, '--focus'), colour(calm, base, bg))).toBeGreaterThanOrEqual(3);
    }
  });

  it('control borders stay >= 3:1 on the calm appearance surfaces', () => {
    for (const [calm, base] of [[calmDark, dark], [calmAttr, lightAttr]] as const) {
      for (const bg of ['--surface', '--surface-2']) expect(ratio(colour(base, dark, '--border-control'), colour(calm, base, bg))).toBeGreaterThanOrEqual(3);
      for (const bg of ['--surface', '--surface-2']) expect(ratio(colour(calm, base, '--text-4'), colour(calm, base, bg))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('token block parity', () => {
  it('the two light blocks define the same tokens with the same values', () => {
    expect(Object.fromEntries(lightAttr)).toEqual(Object.fromEntries(lightMedia));
  });

  it('every colour the light theme overrides exists in the dark :root, and the new tokens are in all three', () => {
    for (const k of lightMedia.keys()) if (k !== 'color-scheme') expect(dark.has(k), k).toBe(true);
    for (const k of ['--on-amber', '--border-control', '--text-4']) for (const t of [dark, lightMedia, lightAttr]) expect(t.has(k), k).toBe(true);
  });

  it('the three calm blocks define the same tokens, the two light ones with the same values', () => {
    expect(Object.fromEntries(calmMedia)).toEqual(Object.fromEntries(calmAttr));
    const colourKeys = [...calmDark.keys()].filter(k => calmAttr.has(k) || /^--(text|accent|blue|focus|on-|surface|bg|border)/.test(k));
    for (const k of colourKeys) expect(calmAttr.has(k), k).toBe(true);
    // --text-4 must be redefined in each calm block: else it falls back to the base theme's value, under AA on calm
    for (const t of [calmDark, calmAttr, calmMedia]) expect(t.has('--text-4')).toBe(true);
  });
});

describe('one accent (restyle step 2)', () => {
  it('--accent* are in every theme block and every calm block', () => {
    for (const t of [dark, lightMedia, lightAttr, calmDark, calmAttr, calmMedia]) for (const k of ACCENT_TOKENS) expect(t.has(k), k).toBe(true);
  });

  it('--focus is the accent in every block', () => {
    for (const t of [dark, lightMedia, lightAttr, calmDark, calmAttr, calmMedia]) expect(t.get('--focus')).toBe('var(--accent)');
  });

  it('the --blue* names are only aliases of --accent* (no own value in any block)', () => {
    for (const k of ACCENT_TOKENS) expect(dark.get(k.replace('--accent', '--blue'))).toBe(`var(${k})`);
    for (const t of [lightMedia, lightAttr, calmDark, calmAttr, calmMedia]) for (const k of t.keys()) expect(k.startsWith('--blue'), k).toBe(false);
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
