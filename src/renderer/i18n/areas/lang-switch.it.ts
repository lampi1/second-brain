// Italian texts of the language switch in the top bar (ADR 0120: one setting for the UI and the AI's replies): its
// tooltip, the menu's heading, the «system» option and the note under it. The languages' own names are settings.language.*.
// Used by components/LangSwitch.tsx; en and de are typed by this file.
export const langSwitchIt = {
  'langSwitch.tip': (p: { name: string }) => `Lingua dell’app e dell’IA: ${p.name}`,
  'langSwitch.heading': 'Lingua dell’app e dell’IA',
  'langSwitch.system': (p: { name: string }) => `Come il sistema · ${p.name}`,
  'langSwitch.note': 'Gli agenti rispondono in questa lingua, anche nelle chat già aperte. Il tuo profilo (me.md) si aggiorna.',
};
