// What the user did with each text-to-send block (lib/sendable.ts): "Copiato hh:mm" or "Mandato ✓ hh:mm", kept per
// block (chat, message, text: blockKey) in localStorage so it is still there after a restart, and the same in every
// window of the app page (the storage event). A newer mark replaces the older one (Copiato, then Mandato); undo puts
// the previous one back. Used by CodeBlock.tsx (reads) and store/store.ts (writes, with the notes to the chat). ADR 0038.
import { useSyncExternalStore } from 'react';

export interface Mark { kind: 'sent' | 'copied'; at: number }

const KEY = 'sb.marks.v1';
const KEEP = 500;
let marks: Record<string, Mark> = read();
const listeners = new Set<() => void>();

function read(): Record<string, Mark> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Mark>;
    const out: Record<string, Mark> = {};
    for (const [k, m] of Object.entries(raw ?? {})) if (m && (m.kind === 'sent' || m.kind === 'copied') && Number.isFinite(m.at)) out[k] = { kind: m.kind, at: m.at };
    return out;
  } catch { return {}; }
}

function changed(save: boolean): void {
  if (save) {
    // the newest KEEP marks only: an old chat's blocks fall off, the file never grows without end
    const all = Object.entries(marks);
    if (all.length > KEEP) marks = Object.fromEntries(all.sort((a, b) => b[1].at - a[1].at).slice(0, KEEP));
    try { localStorage.setItem(KEY, JSON.stringify(marks)); } catch { /* storage off: the mark lives until reload */ }
  }
  for (const l of [...listeners]) l();
}

if (typeof window !== 'undefined') window.addEventListener('storage', e => { if (e.key === KEY) { marks = read(); changed(false); } });

export const markOf = (key: string): Mark | null => marks[key] ?? null;

/** Set (or with null, clear) a block's mark; returns the one it had. */
export function setMark(key: string, m: Mark | null): Mark | null {
  const before = marks[key] ?? null;
  const next = { ...marks };
  if (m) next[key] = m; else delete next[key];
  marks = next;
  changed(true);
  return before;
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export function useMark(key: string | null): Mark | null {
  return useSyncExternalStore(subscribe, () => (key ? marks[key] ?? null : null));
}
