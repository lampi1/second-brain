// The review sampler's state as the Agenti page and `npm run levels` say it (ADR 0186): when the switch «Abilita
// controllo livello e performance» (Settings.judging, main/agents/judge-sample.ts) is off, no verified outcome arrives,
// and both places say so with the day it was turned off, read from the settings' change log (changes.jsonl /
// settings:history). Pure; used by renderer components/JudgingSwitch.tsx and main/agents/level-diagnosis.ts.
import type { SettingChange } from './contract';

export interface SamplerState { on: boolean; offSince: number | null }

/** When the switch was last turned off (the newest change of `judging` to false, not undone), or null: unknown. */
export function judgingOffSince(changes: readonly Pick<SettingChange, 'key' | 'after' | 'at' | 'undone'>[]): number | null {
  const last = changes.filter(c => c.key === 'judging' && !c.undone).sort((a, b) => b.at - a.at)[0];
  return last?.after === false ? last.at : null;
}

/** The plain line (Italian, the UI's and the owner's): '' while the sampler is on. */
export function samplerOffLine(s: SamplerState, day: (ms: number) => string): string {
  if (s.on) return '';
  return `Campionatore spento${s.offSince !== null ? ` dal ${day(s.offSince)}` : ''}: nessun esito verificato arriva.`;
}
