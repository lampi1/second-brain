// Presence outside the window (ADR 0102): on the Windows taskbar button, an overlay badge with the number of things
// waiting for the user (open questions, permissions and commands) and an indeterminate progress bar while at least one
// agent works. The calmest channel Windows has: never flashFrame, never focus, never a sound (ADR 0022). A no-op under
// SB_HIDDEN (tests and agents' dev instance: the window lives off screen, out of the taskbar) and outside Windows.
// The badge is drawn here (a 16×16 BGRA bitmap, a 3×5 pixel font): no image files, no dependency. Wired by index.ts;
// the pure parts (badgePixels, taskbarState) are pinned by test/unit/taskbar.test.ts.
import { nativeImage, type BrowserWindow } from 'electron';
import type { ChatSummary } from '../shared/contract';
import { timersFor } from './timers';
import { log, errText } from './log';
const { setInterval, clearInterval } = timersFor('taskbar');

export const SIZE = 16;
/** 3×5 glyphs, one row per string, '#' = ink */
const FONT: Record<string, string[]> = {
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '.##', '..#', '###'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'], '+': ['...', '.#.', '###', '.#.', '...'],
};

/** The badge for n things waiting (1-9, then "9+"): a red disc with white text, BGRA, SIZE×SIZE; null for none. */
export function badgePixels(n: number): Buffer | null {
  if (!(n > 0)) return null;
  const text = n > 9 ? '9+' : String(Math.floor(n));
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const put = (x: number, y: number, b: number, g: number, r: number) => { if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return; const i = (y * SIZE + x) * 4; px[i] = b; px[i + 1] = g; px[i + 2] = r; px[i + 3] = 255; };
  const c = (SIZE - 1) / 2;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if ((x - c) ** 2 + (y - c) ** 2 <= (SIZE / 2) ** 2) put(x, y, 0x4d, 0x48, 0xe5); // #e5484d
  // one digit at scale 2 (6×10), two glyphs at scale 1 with a gap (7×5)
  const scale = text.length === 1 ? 2 : 1, w = text.length * 3 * scale + (text.length - 1) * scale, h = 5 * scale;
  const x0 = Math.round((SIZE - w) / 2), y0 = Math.round((SIZE - h) / 2);
  [...text].forEach((ch, k) => {
    const glyph = FONT[ch]!;
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if (glyph[gy]![gx] === '#')
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) put(x0 + k * 4 * scale + gx * scale + sx, y0 + gy * scale + sy, 255, 255, 255);
  });
  return px;
}

/** What the taskbar shows: the things waiting for the user, and whether any agent works now. */
export function taskbarState(chats: readonly ChatSummary[], waiting: number): { count: number; working: boolean } {
  return { count: Math.max(0, waiting), working: chats.some(c => !c.closedAt && (c.state === 'running' || c.state === 'starting')) };
}

export interface TaskbarDeps {
  window: () => BrowserWindow | null;
  chats: () => ChatSummary[];
  /** open questions, permissions and commands left for the user */
  waiting: () => number;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  everyMs?: number;
}

/** Starts the taskbar presence; returns its stop. A no-op where it does not apply. */
export function startTaskbar(d: TaskbarDeps): () => void {
  const env = d.env ?? process.env;
  if ((d.platform ?? process.platform) !== 'win32' || env.SB_HIDDEN === '1') return () => {};
  let last = '';
  const tick = () => {
    const w = d.window();
    if (!w || w.isDestroyed()) return;
    let st: { count: number; working: boolean };
    try { st = taskbarState(d.chats(), d.waiting()); } catch { return; }
    const key = `${Math.min(st.count, 10)}|${st.working}`;
    if (key === last) return;
    last = key;
    try {
      const px = badgePixels(st.count);
      w.setOverlayIcon(px ? nativeImage.createFromBitmap(px, { width: SIZE, height: SIZE }) : null, st.count ? `${st.count} ${st.count === 1 ? 'cosa ti aspetta' : 'cose ti aspettano'}` : '');
      // above 1 = indeterminate on Windows; -1 removes the bar
      w.setProgressBar(st.working ? 2 : -1, { mode: st.working ? 'indeterminate' : 'none' });
    } catch (e) { log.warn('app', 'taskbar badge not updated', { cause: errText(e), hint: 'the window still shows what waits; this is the taskbar only' }); }
  };
  tick();
  const timer = setInterval(tick, d.everyMs ?? 2000);
  timer.unref?.();
  return () => clearInterval(timer);
}
