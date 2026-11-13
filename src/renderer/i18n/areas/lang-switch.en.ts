// English texts of the language switch in the top bar (ADR 0120), the same keys as lang-switch.it.ts.
import type { langSwitchIt } from './lang-switch.it';
export const langSwitchEn: typeof langSwitchIt = {
  'langSwitch.heading': 'App and AI language',
  'langSwitch.system': p => `Same as the system · ${p.name}`,
};
