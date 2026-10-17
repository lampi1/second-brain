// Keyboard model for agent input: turns "ctrl+a Backspace", "Enter" or a typed character into CDP Input.dispatchKeyEvent
// parameters (trusted key events, like a real keyboard). Pure, unit-tested; used by browser/actions.ts (key, type,
// fill_form).

export interface KeyDef { key: string; code: string; vk: number; text?: string; location?: number }
export interface KeyStroke { def: KeyDef; modifiers: number; mods: KeyDef[] }
export interface CdpKeyEvent {
  type: 'keyDown' | 'rawKeyDown' | 'keyUp';
  key: string; code: string; windowsVirtualKeyCode: number; nativeVirtualKeyCode: number; modifiers: number;
  text?: string; unmodifiedText?: string; location?: number;
}

/** CDP modifier bits. */
export const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;

const MOD_KEYS: Record<keyof typeof MOD, KeyDef> = {
  alt: { key: 'Alt', code: 'AltLeft', vk: 18, location: 1 },
  ctrl: { key: 'Control', code: 'ControlLeft', vk: 17, location: 1 },
  meta: { key: 'Meta', code: 'MetaLeft', vk: 91, location: 1 },
  shift: { key: 'Shift', code: 'ShiftLeft', vk: 16, location: 1 },
};
const MOD_NAMES: Record<string, keyof typeof MOD> = {
  ctrl: 'ctrl', control: 'ctrl', shift: 'shift', alt: 'alt', option: 'alt', meta: 'meta', cmd: 'meta', command: 'meta', win: 'meta', windows: 'meta', super: 'meta',
};

const NAMED: Record<string, KeyDef> = {
  enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  return: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', vk: 9 },
  escape: { key: 'Escape', code: 'Escape', vk: 27 },
  esc: { key: 'Escape', code: 'Escape', vk: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  delete: { key: 'Delete', code: 'Delete', vk: 46 },
  del: { key: 'Delete', code: 'Delete', vk: 46 },
  insert: { key: 'Insert', code: 'Insert', vk: 45 },
  space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  up: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  home: { key: 'Home', code: 'Home', vk: 36 },
  end: { key: 'End', code: 'End', vk: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', vk: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', vk: 34 },
};
for (let i = 1; i <= 12; i++) NAMED[`f${i}`] = { key: `F${i}`, code: `F${i}`, vk: 111 + i };

const PUNCT: Record<string, [string, number]> = {
  ' ': ['Space', 32], '-': ['Minus', 189], '=': ['Equal', 187], '[': ['BracketLeft', 219], ']': ['BracketRight', 221],
  '\\': ['Backslash', 220], ';': ['Semicolon', 186], "'": ['Quote', 222], ',': ['Comma', 188], '.': ['Period', 190],
  '/': ['Slash', 191], '`': ['Backquote', 192],
};

/** Key definition for one typed character (US layout codes); null = not a keyboard character (use insertText). */
export function charKey(ch: string): KeyDef | null {
  if (ch === '\n' || ch === '\r') return NAMED.enter!;
  if (ch === '\t') return NAMED.tab!;
  if (/^[a-z]$/i.test(ch)) return { key: ch, code: `Key${ch.toUpperCase()}`, vk: ch.toUpperCase().charCodeAt(0), text: ch };
  if (/^[0-9]$/.test(ch)) return { key: ch, code: `Digit${ch}`, vk: ch.charCodeAt(0), text: ch };
  const p = PUNCT[ch];
  if (p) return { key: ch, code: p[0], vk: p[1], text: ch };
  if (ch.length === 1 && ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) < 0x7f) return { key: ch, code: '', vk: 0, text: ch };
  return null;
}

function keyDef(name: string): KeyDef {
  const named = NAMED[name.toLowerCase()];
  if (named) return named;
  if ([...name].length === 1) { const c = charKey(name); if (c) return c; return { key: name, code: '', vk: 0, text: name }; }
  throw new Error(`Unknown key "${name}". Use names like Enter, Tab, Escape, Backspace, Delete, ArrowDown, PageDown, F5, a single character, and combos like ctrl+a or shift+Tab.`);
}

/** "ctrl+a Backspace" → strokes. Space separates strokes, "+" joins modifiers; "ctrl++" presses ctrl and "+". */
export function parseKeys(spec: string): KeyStroke[] {
  const strokes: KeyStroke[] = [];
  for (const combo of spec.trim().split(/\s+/).filter(Boolean)) {
    const parts = combo === '+' ? ['+'] : combo.endsWith('++') ? [...combo.slice(0, -2).split('+'), '+'] : combo.split('+');
    const name = parts.pop() ?? '';
    let modifiers = 0;
    const mods: KeyDef[] = [];
    for (const m of parts) {
      const k = MOD_NAMES[m.toLowerCase()];
      if (!k) throw new Error(`Unknown modifier "${m}" in "${combo}": use ctrl, shift, alt or meta.`);
      modifiers |= MOD[k];
      mods.push(MOD_KEYS[k]);
    }
    strokes.push({ def: keyDef(name), modifiers, mods });
  }
  if (!strokes.length) throw new Error('No keys given: pass e.g. "Enter" or "ctrl+a Backspace".');
  return strokes;
}

/** Clipboard authorization uses the same normalized strokes as input dispatch, including aliases/permutations. */
export function isPasteStroke(stroke: KeyStroke): boolean {
  return isPasteKey(stroke.def.key,stroke.modifiers);
}
export function isPasteKey(key:string,modifiers:number):boolean {
  return /^v$/i.test(key) && (modifiers & (MOD.ctrl | MOD.meta)) !== 0 || key === 'Insert' && (modifiers & MOD.shift) !== 0;
}
export function containsPaste(spec: string): boolean { return parseKeys(spec).some(isPasteStroke); }

/** "ctrl+shift" → CDP modifier bits (also accepts an array of names). */
export function parseModifiers(m: unknown): number {
  const list = Array.isArray(m) ? m.map(String) : String(m ?? '').split(/[+\s,]+/);
  let bits = 0;
  for (const name of list.filter(Boolean)) {
    const k = MOD_NAMES[name.toLowerCase()];
    if (!k) throw new Error(`Unknown modifier "${name}": use ctrl, shift, alt or meta.`);
    bits |= MOD[k];
  }
  return bits;
}

/** The CDP events of one stroke: modifiers down, key down (with text only when no ctrl/alt/meta), key up, modifiers up. */
export function strokeEvents(s: KeyStroke): CdpKeyEvent[] {
  const ev = (type: CdpKeyEvent['type'], d: KeyDef, modifiers: number, text?: string): CdpKeyEvent => ({
    type, key: d.key, code: d.code, windowsVirtualKeyCode: d.vk, nativeVirtualKeyCode: d.vk, modifiers,
    ...(text !== undefined ? { text, unmodifiedText: text } : {}), ...(d.location ? { location: d.location } : {}),
  });
  const out: CdpKeyEvent[] = [];
  let held = 0;
  for (const m of s.mods) { held |= bitOf(m); out.push(ev('rawKeyDown', m, held)); }
  const typing = (s.modifiers & ~MOD.shift) === 0 ? s.def.text : undefined;
  const text = typing !== undefined && s.modifiers & MOD.shift && typing.length === 1 ? typing.toUpperCase() : typing;
  out.push(ev(text !== undefined ? 'keyDown' : 'rawKeyDown', s.def, s.modifiers, text));
  out.push(ev('keyUp', s.def, s.modifiers));
  for (const m of [...s.mods].reverse()) { held &= ~bitOf(m); out.push(ev('keyUp', m, held)); }
  return out;
}

function bitOf(d: KeyDef): number {
  return d.key === 'Alt' ? MOD.alt : d.key === 'Control' ? MOD.ctrl : d.key === 'Meta' ? MOD.meta : d.key === 'Shift' ? MOD.shift : 0;
}
