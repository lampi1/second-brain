// A state shown without flicker (ADR 0312; the owner, 2026-11-15: «ogni tanto gli agenti vanno in attesa per tipo un
// decimo di secondo facendo uno strano flickering»). A chat at work passes through short stops it does not need anyone
// for: a permission the app answers by itself from the brain's rules (ADR 0290), the gap between two turns, a tool
// that ends and the next one that starts. Shown as they come, each one turns the bench amber and back in a blink. Here
// a value that leaves its active state is held on screen for HOLD_MS: if it comes back in that time, nothing changed
// on screen; if not, the new state shows, late by that much. Entering the active state, and an error, show at once.
import { useEffect, useRef, useState } from 'react';

/** How long a stop must last, in ms, before the screen says so. */
export const HOLD_MS = 700;

/** The value on screen at `now`: the last active one while a stop is younger than `ms`, else the current one.
 *  `since` is when the value left its active state (null = it is active, or never was). */
export function steadyValue<T>(current: T, lastActive: T | undefined, since: number | null, now: number, ms = HOLD_MS): T {
  return lastActive !== undefined && since !== null && now - since < ms ? lastActive : current;
}

/** `value` as the screen should show it: `active(value)` true shows at once; a change away from it waits up to `ms`
 *  (unless `urgent(value)`: an error is never held back). One timer per stop, none while nothing changes. */
export function useSteady<T>(value: T, active: (v: T) => boolean, urgent: (v: T) => boolean = () => false, ms = HOLD_MS): T {
  const lastActive = useRef<T | undefined>(undefined), since = useRef<number | null>(null);
  const [, tick] = useState(0);
  const on = active(value);
  if (on) { lastActive.current = value; since.current = null; }
  else if (urgent(value)) { lastActive.current = undefined; since.current = null; }
  else if (lastActive.current !== undefined && since.current === null) since.current = Date.now();
  const held = !on && since.current !== null;
  useEffect(() => {
    if (!held || since.current === null) return;
    const left = ms - (Date.now() - since.current);
    const timer = setTimeout(() => { lastActive.current = undefined; since.current = null; tick(n => n + 1); }, Math.max(0, left));
    return () => clearTimeout(timer);
  }, [held, ms]);
  return steadyValue(value, lastActive.current, since.current, Date.now(), ms);
}
