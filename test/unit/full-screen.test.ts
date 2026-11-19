// The viewer's full screen moves the app window (ADR 0328): on while the viewer is in full screen, off after it, and
// only a full screen the app turned on is undone; a hidden or test run and a closed window never move.
import { expect, it } from 'vitest';
import { fullScreenSwitch, type FullScreenWindow } from '../../src/main/full-screen';

function fakeWindow(full = false) {
  const w = { full, destroyed: false, calls: [] as boolean[] };
  const win: FullScreenWindow = { isDestroyed: () => w.destroyed, isFullScreen: () => w.full, setFullScreen: on => { w.calls.push(on); w.full = on; } };
  return { w, win };
}

it('turns the window’s full screen on and off with the viewer’s', () => {
  const { w, win } = fakeWindow();
  const set = fullScreenSwitch(() => win, () => false);
  expect(set(true)).toEqual({ on: true });
  expect(set(true)).toEqual({ on: true });
  expect(set(false)).toEqual({ on: false });
  expect(set(false)).toEqual({ on: false });
  expect(w.calls).toEqual([true, false]);
});

it('leaves a window the user put in full screen by themselves as it was', () => {
  const { w, win } = fakeWindow(true);
  const set = fullScreenSwitch(() => win, () => false);
  expect(set(true)).toEqual({ on: true });
  expect(set(false)).toEqual({ on: true });
  expect(w.calls).toEqual([]);
});

it('leaves its own full screen even when the window does not say it is in one yet (macOS animates the change)', () => {
  const w = { calls: [] as boolean[] };
  // the window answers «not full screen» the whole time, as during the animation
  const win: FullScreenWindow = { isDestroyed: () => false, isFullScreen: () => false, setFullScreen: on => { w.calls.push(on); } };
  const set = fullScreenSwitch(() => win, () => false);
  set(true);
  expect(set(false)).toEqual({ on: false });
  expect(w.calls).toEqual([true, false]);
  // and only once: a second «off» has nothing of ours to undo
  set(false);
  expect(w.calls).toEqual([true, false]);
});

it('never moves a hidden or test run, a missing or a closed window', () => {
  const { w, win } = fakeWindow();
  expect(fullScreenSwitch(() => win, () => true)(true)).toEqual({ on: false });
  expect(fullScreenSwitch(() => null, () => false)(true)).toEqual({ on: false });
  w.destroyed = true;
  expect(fullScreenSwitch(() => win, () => false)(true)).toEqual({ on: false });
  expect(w.calls).toEqual([]);
});
