// Italian texts of the chat composer's inline suggestion (issue #167, ADR 0118): the screen reader's hint on the input,
// its rows in Impostazioni → Scrittura (SuggestSettings.tsx) and its line in Costi. The source of suggest.en/de.ts.
export const suggestIt = {
  'suggest.srHint': (p: { text: string }) => `Suggerimento: «${p.text}». Tab per accettarlo, Esc per nasconderlo.`,
  'suggest.group': 'Scrittura',
  'suggest.groupDesc': 'Come ti aiuta mentre scrivi nelle chat.',
  'suggest.title': 'Suggerimenti mentre scrivi',
  'suggest.hint': 'Un testo grigio dopo il cursore: Tab lo accetta, Esc lo nasconde, il resto lo ignora. Prima dai tuoi messaggi passati, dai comandi «/», dai ruoli, dalle chat e dai file: zero token.',
  'suggest.model': 'Chiedi al modello quando non c’è altro',
  'suggest.modelHint': 'Solo dopo una pausa nella scrittura, con l’ultima riga e l’ultimo messaggio della chat, sul modello più piccolo della chiave API. Le risposte uguali vengono dalla cache, senza token.',
  'suggest.budget': 'Budget giornaliero del modello ($)',
  'suggest.budgetHint': 'Raggiunto, il modello si ferma fino a domani; i suggerimenti locali restano.',
  'suggest.budgetBad': 'Un importo da 0,01 a 1 $.',
  'suggest.today': (p: { usd: string; limit: string; calls: number; hits: number }) => `Oggi ${p.usd} di ${p.limit} · ${p.calls} chiamate · ${p.hits} dalla cache`,
  'suggest.kpi': 'Suggerimenti oggi',
  'suggest.kpiSub': (p: { calls: number; hits: number; limit: string }) => `${p.calls} chiamate, ${p.hits} dalla cache · budget ${p.limit}`,
  'suggest.kpiOff': 'modello spento: solo suggerimenti locali, zero token',
  'suggest.kpiHelp': 'Quanto è costato oggi il testo grigio che compare mentre scrivi nelle chat, quando le fonti locali non avevano niente. A prezzo di listino, sulla chiave API.',
};
