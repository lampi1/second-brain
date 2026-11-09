// Screenshots never show a password (ADR 0237): agents type passwords on every host, and a "show password" toggle turns
// the field into plain text, so before any capture of an agent tab every field ever seen as a password field gets its
// value hidden in every frame (page.ts shotMask), and shown again right after. A frame that cannot be masked refuses
// the capture: a picture that might show a password is never taken. Used by browser/actions.ts (the screenshot tool)
// and appctl/tools.ts (app_screenshot, which captures the visible tabs too).
import type { WebFrameMain } from 'electron';
import { errText } from '../log';
import { pageCall, shotMask } from './page';

/** Runs a script in one frame (with its own deadline and dialog handling). */
export type FrameRun = (frame: WebFrameMain, script: string) => Promise<unknown>;

/** Runs capture() with every password field of the frames hidden; refused (nothing captured) when a frame cannot be. */
export async function withPasswordsHidden<T>(frames: readonly WebFrameMain[], run: FrameRun, capture: () => Promise<T>): Promise<T> {
  const masked: WebFrameMain[] = [];
  try {
    for (const f of frames) {
      try { await run(f, pageCall(shotMask, true)); } catch (e) {
        throw new Error(`Refused: the password fields of the page could not be hidden for the screenshot (${errText(e)}). Try again, or handle_dialog first if a dialog is open.`);
      }
      masked.push(f);
    }
    return await capture();
  } finally {
    for (const f of masked) await run(f, pageCall(shotMask, false)).catch(() => { /* a frame gone with its page */ });
  }
}
