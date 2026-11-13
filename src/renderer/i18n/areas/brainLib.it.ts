// Italian UI texts of the "brainLib" area (ADR 0057): spread into it.ts. Keys start with "brainLib.".
export const brainLibIt = {
  // Charts.tsx
  'brainLib.charts.dataToggle': 'Dati',
  'brainLib.charts.dataToggleTitle': 'Mostra i numeri come tabella',
  'brainLib.charts.csvDownloadTitle': 'Scarica i numeri del grafico in CSV',
  'brainLib.charts.voiceLabel': 'Voce',
  'brainLib.charts.valueLabel': 'valore',
  'brainLib.charts.csvVoiceHeader': 'voce',
  'brainLib.charts.noData': 'Nessun dato.',
  'brainLib.charts.nValuesMax': (p: { n: number; max: string; values: string }) => `${p.n} valori; il più alto ${p.max}: ${p.values}`,
  'brainLib.charts.nBarsRange': (p: { n: number; from: string; to: string }) => `${p.n} barre; da ${p.from} a ${p.to}.`,
  'brainLib.charts.firstLabel': (p: { n: number; first: string; value: string }) => `${p.n} voci; la prima: ${p.first}, ${p.value}.`,

  // record-discuss.ts
  'brainLib.recordDiscuss.untitled': 'senza titolo',

  // stats.ts
  'brainLib.stats.trendStable': 'stabile',
  'brainLib.stats.trendUp': 'in aumento',
  'brainLib.stats.trendDown': 'in calo',
  'brainLib.stats.trendNoData': (p: { value: string; before: string }) => `${p.value}; ${p.before} nessun dato per confrontare`,
  'brainLib.stats.trendWithData': (p: { word: string; cur: string; prev: string }) => `${p.word}: ${p.cur} contro ${p.prev}`,
  // Markdown.tsx
  'brainLib.markdown.copyBlock': 'Copia',
  'brainLib.markdown.copyBlockTitle': 'Copia il blocco negli appunti',
  'brainLib.markdown.blockCopied': 'Copiato',
  'brainLib.markdown.blockCopiedToast': 'Blocco copiato',
  'brainLib.markdown.copyFailed': 'Copia non riuscita',
};
