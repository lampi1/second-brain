// The little people's lines of the day, in the renderer (ADR 0305): asks main for the lines to say in the language on
// screen (IPC agents:quips, main/quips/daily.ts) and gives them to shared/agent-quips.ts setDailyQuips, where pickQuip
// finds them beside the fixed ones. When today's are still to be written it asks once more a little later, waiting
// for the model (the app's start comes first); then again every hour, so an app left open finds tomorrow's lines.
// Main keeps the count of the day's tries: asking more often here costs nothing. Any failure leaves the fixed lines.
// Used by i18n/LangRoot.tsx.
import { useEffect } from 'react';
import type { Lang } from '@shared/contract';
import { setDailyQuips, type DailyQuips } from '@shared/agent-quips';
import { sb } from '../sb';

/** How long after the first answer the model is asked for today's lines, in ms. */
export const DAILY_START_MS = 20_000;
/** How often the lines are asked again, in ms. */
export const DAILY_EVERY_MS = 60 * 60_000;

/** What the watch needs from its surroundings (tests give their own: no IPC, no real clock). */
export interface DailyWatchDeps {
  ask(lang: Lang, wait: boolean): Promise<{ lines: DailyQuips; pending: boolean }>;
  set(lang: Lang, lines: DailyQuips | null): void;
  /** runs `fn` once after `ms`; the function it gives back cancels it */
  later(fn: () => void, ms: number): () => void;
  /** runs `fn` every `ms`; the function it gives back stops it */
  every(fn: () => void, ms: number): () => void;
}
/** Keeps the lines of a language up to date until the function it gives back is called: reads them now and every
 *  hour; when today's are still to be written, one waiting ask DAILY_START_MS later (never two pending at once). */
export function watchDailyQuips(lang: Lang, d: DailyWatchDeps): () => void {
  let live = true, cancel: (() => void) | null = null, waiting = false;
  const ask = async (wait: boolean): Promise<void> => {
    try {
      const r = await d.ask(lang, wait);
      if (!live) return;
      d.set(lang, r.lines);
      if (r.pending && !wait && !cancel && !waiting) cancel = d.later(() => { cancel = null; waiting = true; void ask(true).finally(() => { waiting = false; }); }, DAILY_START_MS);
    } catch { /* an older main, a closed window: the lines there are stay */ }
  };
  void ask(false);
  const stop = d.every(() => { void ask(false); }, DAILY_EVERY_MS);
  return () => { live = false; cancel?.(); stop(); };
}

/** Keeps the lines of the day of `lang` in the registry; `on` is the setting quipsDaily (off: only the fixed lines). */
export function useDailyQuips(lang: Lang, on: boolean): void {
  useEffect(() => {
    if (!on) { setDailyQuips(lang, null); return; }
    return watchDailyQuips(lang, {
      ask: (l, wait) => sb.invoke('agents:quips', { lang: l, wait }),
      set: setDailyQuips,
      later: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
      every: (fn, ms) => { const t = setInterval(fn, ms); return () => clearInterval(t); },
    });
  }, [lang, on]);
}
