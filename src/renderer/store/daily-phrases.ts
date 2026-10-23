// The working-line phrases of the day (main/daily-phrases.ts, 'phrases:today'): read once and again on
// 'phrases:changed'; null = the fixed phrases of lib/typing-line.ts. Used by components/ChatItems.tsx and StripActivity.tsx.
import { useEffect } from 'react';
import type { DailyPhrases } from '@shared/contract';
import { sb } from '../sb';
import { createStore } from './createStore';

const daily = createStore<{ phrases: DailyPhrases | null }>({ phrases: null });
let reading = false;
const readDaily = () => { void sb.invoke('phrases:today', undefined).then(phrases => daily.set(() => ({ phrases })), () => { /* the fixed phrases stay */ }); };
export function useDailyPhrases(): DailyPhrases | null {
  useEffect(() => { if (reading) return; reading = true; sb.on('phrases:changed', readDaily); readDaily(); }, []);
  return daily.use(s => s.phrases);
}
