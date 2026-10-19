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
  'brainLib.charts.nPointsMax': (p: { n: number; max: string }) => `${p.n} punti; massimo ${p.max}.`,
  'brainLib.charts.firstLabel': (p: { n: number; first: string; value: string }) => `${p.n} voci; la prima: ${p.first}, ${p.value}.`,


  // record-discuss.ts
  'brainLib.recordDiscuss.untitled': 'senza titolo',


  // learn.ts
  'brainLib.learn.waiting': (p: { n: number }) => `in attesa dei primi ${p.n} casi dopo il cambio`,
  'brainLib.learn.helpIntro': 'Qui il cervello controlla quanto sbagliano le sue stime di tempo e costo (e, quando avrà dati, la scelta del modello). Ogni tanto rifà le stime sulle chat passate con metodi diversi: se uno sbaglia chiaramente meno, nasce una proposta. Niente cambia finché non premi Applica; ogni cambio si annulla con Ripristina e dopo 20 chat viene controllato da solo.',
  'brainLib.learn.helpTypical': 'Di quanto la stima si allontana dal vero, a metà delle chat: ×1,7 vuol dire che una volta su due il vero sta tra la stima divisa 1,7 e la stima per 1,7. Più vicino a ×1, meglio è.',
  'brainLib.learn.helpCover': 'La forbice «da … a …» della stima è fatta per contenere il valore vero 8 volte su 10. Qui vedi quante volte ci è riuscita davvero sulle ultime chat.',
  'brainLib.learn.helpOut': 'Chat di cui non si sa come sono finite, o troppo vecchie per avere una stima fatta prima: non entrano nei numeri, ma restano contate qui.',
  'brainLib.learn.helpNoData': (p: { min: number }) => `Prima di dire qualcosa servono almeno ${p.min} chat con il risultato noto: con meno, i numeri sarebbero rumore.`,
  'brainLib.learn.helpProposal': 'Il cervello ha rifatto le stime sulle stesse chat passate (almeno 30) con il metodo in uso e con quello nuovo. Propone il nuovo solo se sbaglia meno in modo chiaro, non per caso: anche nel caso peggiore del margine («tra … e …») resta meglio, e non peggiora nient\'altro.',
  'brainLib.learn.helpCheck': 'Dopo un cambio, sulle 20 chat successive confronta il metodo nuovo con quello di prima. Se il nuovo è peggio, propone di tornare indietro: non lo fa mai da solo.',
  'brainLib.learn.helpRollback': 'Torna alla versione precedente con un clic. Nessun dato si perde e puoi riapplicare la proposta quando vuoi.',
  'brainLib.learn.helpDrift': 'Le ultime 20 chat sbagliano più di 1,5 volte le 60 prima: il tipo di lavoro è cambiato e le stime vanno ricalibrate.',
  'brainLib.learn.policyEstimates': 'Stime di tempo e costo',
  'brainLib.learn.policyRouting': 'Scelta del modello',
  'brainLib.learn.policyNotifications': 'Soglie delle notifiche',
  'brainLib.learn.errorLineNoData': (p: { n: number; min: number }) => `senza dati: ${p.n} ${p.n === 1 ? 'misurato' : 'misurati'}, ne servono ${p.min}`,
  'brainLib.learn.errorLineUnmeasured': 'errore non misurato',
  'brainLib.learn.errorLineMeasured': (p: { factor: string; count: number }) => `errore tipico ${p.factor} sulle ultime ${p.count}`,
  'brainLib.learn.coverageLine': (p: { rate: string; n: number }) => `l'intervallo dell'80% ha contenuto il reale ${p.rate} delle volte (su ${p.n})`,
  'brainLib.learn.gainLineNoShared': 'misura non disponibile',
  'brainLib.learn.gainLineWithShared': (p: { shared: number }) => `su ${p.shared} casi in comune`,
  'brainLib.learn.gainLineBetter': (p: { pct: number; lo: number; hi: number; shared?: number }) => `errore più piccolo del ${p.pct}% (tra ${p.lo}% e ${p.hi}%)${p.shared ? `, su ${p.shared} casi in comune` : ''}`,
  'brainLib.learn.gainLineWorse': (p: { pct: number; lo: number; hi: number; shared?: number }) => `errore più grande del ${p.pct}% (tra ${p.lo}% e ${p.hi}%)${p.shared ? `, su ${p.shared} casi in comune` : ''}`,
  'brainLib.learn.checkLineWaiting': (p: { n: number; need: number }) => `in attesa: ${p.n} casi dopo il cambio su ${p.need} che servono`,
  'brainLib.learn.checkLineFailed': (p: { n?: number }) => `peggiorata${p.n ? ` (su ${p.n} casi)` : ''}: c'è una proposta di ripristino`,
  'brainLib.learn.checkLineOther': (p: { state: string; n?: number }) => `${p.state}${p.n ? ` (su ${p.n} casi)` : ''}`,

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
