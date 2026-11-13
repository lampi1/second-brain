// German (de-AT) texts of the language switch in the top bar (ADR 0120), the same keys as lang-switch.it.ts.
import type { langSwitchIt } from './lang-switch.it';
export const langSwitchDe: typeof langSwitchIt = {
  'langSwitch.tip': p => `Sprache der App und der KI: ${p.name}`,
  'langSwitch.heading': 'Sprache der App und der KI',
  'langSwitch.system': p => `Wie das System · ${p.name}`,
  'langSwitch.note': 'Die Agenten antworten in dieser Sprache, auch in schon offenen Chats. Dein Profil (me.md) wird aktualisiert.',
};
