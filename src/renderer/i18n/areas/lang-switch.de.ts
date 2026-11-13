// German (de-AT) texts of the language switch in the top bar (ADR 0120), the same keys as lang-switch.it.ts.
import type { langSwitchIt } from './lang-switch.it';
export const langSwitchDe: typeof langSwitchIt = {
  'langSwitch.heading': 'Sprache der App und der KI',
  'langSwitch.system': p => `Wie das System · ${p.name}`,
};
