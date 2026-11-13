// Italian texts of the chat composer's inline suggestion (issue #167, ADR 0118): the screen reader's hint on the input,
// its row in Impostazioni → Scrittura (SuggestSettings.tsx). The source of suggest.en/de.ts.
export const suggestIt = {
  'suggest.srHint': (p: { text: string }) => `Suggerimento: «${p.text}». Tab per accettarlo, Esc per nasconderlo.`,
  'suggest.group': 'Scrittura',
  'suggest.groupDesc': 'Come ti aiuta mentre scrivi nelle chat.',
  'suggest.title': 'Suggerimenti mentre scrivi',
  'suggest.hint': 'Un testo grigio dopo il cursore: Tab lo accetta, Esc lo nasconde, il resto lo ignora. Dai tuoi messaggi passati, dai comandi «/», dai ruoli, dalle chat e dai file: zero token.',
};
