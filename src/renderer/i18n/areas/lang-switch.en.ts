// English texts of the language switch in the top bar (ADR 0120), the same keys as lang-switch.it.ts.
import type { langSwitchIt } from './lang-switch.it';
export const langSwitchEn: typeof langSwitchIt = {
  'langSwitch.tip': p => `App and AI language: ${p.name}`,
  'langSwitch.heading': 'App and AI language',
  'langSwitch.system': p => `Same as the system · ${p.name}`,
  'langSwitch.note': 'The agents reply in this language, in open chats too. Your profile (me.md) is updated.',
};
