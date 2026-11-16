// Italian UI texts of Memoria → Artifact (ADR 0317): the gallery (search, filters, cards, days), the viewer's artifact
// bar (source chat, versions, related) and the empty and missing states. Spread into it.ts; library.en.ts and
// library.de.ts have the same keys (typed by this object).
type N = { n: number };
export const libraryIt = {
  'mh.tab.artifact': 'Artifact',
  'lib.lead': (p: N) => (p.n === 1 ? 'Un artifact prodotto dalle tue chat: report, analisi, documenti e immagini, dove sono sul disco. Clic per aprirlo formattato.' : `${p.n} artifact prodotti dalle tue chat: report, analisi, documenti e immagini, dove sono sul disco. Clic per aprirne uno formattato.`),
  'lib.lead0': 'Qui finiscono i report, le analisi, i documenti e le immagini che le tue chat producono: da soli, senza spostare nessun file.',
  'lib.refresh': 'Aggiorna', 'lib.refreshTip': 'Guarda adesso nelle cartelle (reviews, tmp, evidence e quelle delle chat)', 'lib.scanning': 'Cerco nuovi artifact…',
  'lib.backfilling': 'Sto guardando le chat passate: gli artifact che avevano linkato arrivano tra poco.',
  'lib.search': 'Cerca per titolo, testo, area o chat…', 'lib.searchLabel': 'Cerca negli artifact', 'lib.clear': 'Cancella la ricerca',
  'lib.kindLabel': 'Tipo', 'lib.kind.all': 'Tutti', 'lib.kind.html': 'HTML', 'lib.kind.markdown': 'Markdown', 'lib.kind.pdf': 'PDF', 'lib.kind.image': 'Immagini',
  'lib.kind.data': 'Dati', 'lib.kind.document': 'Documenti', 'lib.kind.media': 'Video e audio', 'lib.kind.file': 'Altri file',
  'lib.badge.html': 'HTML', 'lib.badge.markdown': 'MD', 'lib.badge.pdf': 'PDF', 'lib.badge.image': 'IMG',
  'lib.area': 'Area', 'lib.area.all': 'Tutte le aree',
  'lib.range': 'Periodo', 'lib.range.all': 'Sempre', 'lib.range.today': 'Oggi', 'lib.range.week': 'Ultimi 7 giorni', 'lib.range.month': 'Ultimi 30 giorni',
  'lib.chat': 'Chat', 'lib.chat.all': 'Tutte le chat',
  'lib.sort': 'Ordina', 'lib.sort.newest': 'Più recenti', 'lib.sort.oldest': 'Meno recenti', 'lib.sort.title': 'Titolo A-Z', 'lib.sort.versions': 'Più versioni',
  'lib.view': 'Vista', 'lib.view.grid': 'Griglia', 'lib.view.list': 'Elenco',
  'lib.count': (p: { shown: number; n: number }) => (p.shown === p.n ? (p.n === 1 ? '1 artifact' : `${p.n} artifact`) : `${p.shown} di ${p.n} artifact`),
  'lib.reset': 'Togli i filtri',
  'lib.dropped': (p: N) => `${p.n} più vecchi non tenuti (l’indice è pieno)`,
  'lib.day.today': 'Oggi', 'lib.day.yesterday': 'Ieri', 'lib.day.week': 'Questa settimana', 'lib.day.month': 'Questo mese',
  'lib.versions': (p: N) => (p.n === 1 ? '1 versione' : `${p.n} versioni`),
  'lib.missing': 'File mancante', 'lib.missingTip': 'Il file non è più dove era. Resta qui come promemoria; se l’app ne aveva una copia, si apre quella.',
  'lib.fromChat': (p: { title: string }) => `Da «${p.title}»`, 'lib.fromChatGone': 'Da una chat chiusa', 'lib.found': 'Trovato in una cartella',
  'lib.openChat': 'Apri la chat che l’ha prodotto',
  'lib.empty': 'Ancora nessun artifact. Appena una chat linka un report, un’analisi o uno screenshot, appare qui da solo.',
  'lib.emptyFilter': 'Nessun artifact con questi filtri.',
  'lib.loadError': 'Gli artifact non si sono caricati:',
  'lib.open': (p: { title: string }) => `Apri ${p.title}`,
  // the viewer's bar
  'lib.bar.label': 'Artifact', 'lib.bar.noChat': 'Trovato in una cartella, senza chat di origine',
  'lib.bar.version': (p: { i: number; n: number }) => `Versione ${p.i} di ${p.n}`, 'lib.bar.versionsLabel': 'Versioni di questo artifact',
  'lib.bar.current': 'attuale', 'lib.bar.copy': 'copia salvata', 'lib.bar.gone': 'non più disponibile',
  'lib.bar.related': 'Correlati', 'lib.bar.relatedLabel': 'Artifact correlati',
  'lib.bar.openApp': 'Apri con l’app', 'lib.bar.openAppTip': 'Apri il file con il programma del sistema (Word, Excel, il lettore video…)', 'lib.bar.openFailed': 'Il file non si è aperto:',
  'lib.bar.inMemory': 'Vedi in Memoria → Artifact',
};
