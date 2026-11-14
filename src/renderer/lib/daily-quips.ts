// The little people's lines of the day, in the renderer (ADR 0305): asks main for the lines to say in the language on
// screen (IPC agents:quips, main/quips/daily.ts) and gives them to shared/agent-quips.ts setDailyQuips, where pickQuip
// finds them beside the fixed ones. When today's are still to be written it asks once more a little later, waiting
// for the model (the app's start comes first); then again every hour, so an app left open finds tomorrow's lines.
// Any failure leaves the fixed lines. Used by i18n/LangRoot.tsx.
import { useEffect } from 'react';
import type { Lang } from '@shared/contract';
import { setDailyQuips } from '@shared/agent-quips';
import { sb } from '../sb';

/** How long after the first answer the model is asked for today's lines, in ms. */
export const DAILY_START_MS = 20_000;
/** How often the lines are asked again, in ms. */
export const DAILY_EVERY_MS = 60 * 60_000;

/** Keeps the lines of the day of `lang` in the registry; `on` is the setting quipsDaily (off: only the fixed lines). */
export function useDailyQuips(lang: Lang, on: boolean): void {
  useEffect(() => {
    if (!on) { setDailyQuips(lang, null); return; }
    let live = true, later: ReturnType<typeof setTimeout> | undefined;
    const ask = async (wait: boolean): Promise<void> => {
      try {
        const r = await sb.invoke('agents:quips', { lang, wait });
        if (!live) return;
        setDailyQuips(lang, r.lines);
        if (r.pending && !wait) { clearTimeout(later); later = setTimeout(() => { void ask(true); }, DAILY_START_MS); }
      } catch { /* an older main, a closed window: the fixed lines are said */ }
    };
    void ask(false);
    const every = setInterval(() => { void ask(false); }, DAILY_EVERY_MS);
    return () => { live = false; clearTimeout(later); clearInterval(every); };
  }, [lang, on]);
}
