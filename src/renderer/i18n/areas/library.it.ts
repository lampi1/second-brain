// Italian UI texts of Memoria → Artifact (ADR 0328): the list (search, cards, days), the viewer's artifact bar (source
// chat, versions, related) and the empty and missing states. Spread into it.ts; library.en.ts and library.de.ts have
// the same keys (typed by this object).
type N = { n: number };
export const libraryIt = {
  'mh.tab.artifact': 'Artifact',
  'lib.lead': (p: N) => (p.n === 1 ? 'Un artifact: quello che hai chiesto agli agenti di preparare (report, documenti, piani, analisi). Clic per aprirlo qui nell’app.' : `${p.n} artifact: quello che hai chiesto agli agenti di preparare (report, documenti, piani, analisi). Clic per aprirne uno qui nell’app.`),
  'lib.lead0': 'Qui finisce solo quello che chiedi di preparare: un report, un documento, un piano, un’analisi. Chiedilo all’Orchestrator e il file arriva qui da solo.',
  'lib.search': 'Cerca per titolo, testo, area o chat…', 'lib.searchLabel': 'Cerca negli artifact', 'lib.clear': 'Cancella la ricerca',
  'lib.badge.html': 'HTML', 'lib.badge.markdown': 'MD', 'lib.badge.pdf': 'PDF', 'lib.badge.image': 'IMG',
  'lib.area': 'Area',
  'lib.view': 'Vista', 'lib.view.grid': 'Griglia', 'lib.view.list': 'Elenco',
  'lib.count': (p: { shown: number; n: number }) => (p.shown === p.n ? (p.n === 1 ? '1 artifact' : `${p.n} artifact`) : `${p.shown} di ${p.n} artifact`),
  'lib.more': (p: { n: number; left: number }) => `Mostra altri ${p.n} (ne restano ${p.left})`,
  'lib.remove': (p: { title: string }) => `Togli ${p.title} dagli artifact`, 'lib.removeYes': 'Togli dalla lista',
  'lib.removeTip': 'Toglie l’artifact da questa lista. Il file resta dov’è sul disco.',
  'lib.day.today': 'Oggi', 'lib.day.yesterday': 'Ieri', 'lib.day.week': 'Questa settimana', 'lib.day.month': 'Questo mese',
  'lib.versions': (p: N) => (p.n === 1 ? '1 versione' : `${p.n} versioni`),
  'lib.missing': 'File mancante', 'lib.missingTip': 'Il file non è più dove era. Se l’app ne aveva una copia, si apre quella; altrimenti puoi togliere l’artifact dalla lista.',
  'lib.fromChat': (p: { title: string }) => `Da «${p.title}»`, 'lib.fromChatGone': 'Da una chat chiusa',
  'lib.openChat': 'Apri la chat che l’ha prodotto',
  'lib.empty': 'Ancora nessun artifact. Chiedi un report, un documento o un piano: appena è pronto appare qui.',
  'lib.emptyFilter': 'Nessun artifact con questa ricerca.',
  'lib.loadError': 'Gli artifact non si sono caricati:',
  'lib.open': (p: { title: string }) => `Apri ${p.title}`,
  // the viewer's bar
  'lib.bar.label': 'Artifact', 'lib.bar.noChat': 'Senza chat di origine',
  'lib.bar.version': (p: { i: number; n: number }) => `Versione ${p.i} di ${p.n}`, 'lib.bar.versionsLabel': 'Versioni di questo artifact',
  'lib.bar.current': 'attuale', 'lib.bar.copy': 'copia salvata', 'lib.bar.gone': 'non più disponibile',
  'lib.bar.related': 'Correlati', 'lib.bar.relatedLabel': 'Artifact correlati',
  'lib.bar.openApp': 'Apri con l’app', 'lib.bar.openAppTip': 'Apri il file con il programma del sistema (Word, Excel, PowerPoint…) per vederlo con la sua impaginazione', 'lib.bar.openFailed': 'Il file non si è aperto:',
  'lib.bar.inMemory': 'Vedi in Memoria → Artifact',
};
