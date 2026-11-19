// The app window on the whole screen while the file viewer is in full screen (ADR 0328, the owner 2026-11-19: «il full
// screen del file viewer deve prendere davvero tutto lo schermo»): the page asks with 'app:fullScreen' and main sets the
// window's own full screen (no web permission is granted: the page's requestFullscreen stays refused, window.ts). Only
// a full screen this module turned on is turned off again, so a window the user put in full screen by themselves (the
// green button on macOS) stays as it was. An agent's or a test's run (SB_HIDDEN, SB_TEST) never moves its window.
// Used by ipc-handlers/app.ts; pinned by test/unit/full-screen.test.ts.
export interface FullScreenWindow { isDestroyed(): boolean; isFullScreen(): boolean; setFullScreen(on: boolean): void }

export function fullScreenSwitch(win: () => FullScreenWindow | null, still: () => boolean): (on: boolean) => { on: boolean } {
  let ours = false;
  return on => {
    const w = win();
    if (!w || w.isDestroyed() || still()) return { on: false };
    // the user left it by themselves meanwhile: nothing of ours is left to undo
    if (ours && !w.isFullScreen()) ours = false;
    if (on && !w.isFullScreen()) { ours = true; w.setFullScreen(true); }
    else if (!on && ours) { ours = false; w.setFullScreen(false); }
    return { on: on || w.isFullScreen() };
  };
}
