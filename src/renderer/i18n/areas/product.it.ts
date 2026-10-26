// Agent workspace and packaged appearance UI. Kept separate from provider output and user-authored content.
export const productIt={
 "viewer.reviewSelection":"Commenta selezione",
 "viewer.reviewTitle":"Commenta questo punto",
 "viewer.reviewRegion":"Area selezionata dell’immagine",
 "viewer.reviewComment":"Il tuo commento",
 "viewer.reviewPlaceholder":"Che cosa vuoi verificare o cambiare?",
 "viewer.reviewDraftHint":"Invia il commento oppure prepara un messaggio da rivedere nell’Orchestrator.",
 "viewer.reviewPrepare":"Prepara messaggio",
 "viewer.reviewSend":"Invia all’Orchestrator",
 "viewer.reviewUnavailable":"Orchestrator non disponibile. Il commento resta qui: riprova.",

 "viewer.imageBefore":"Prima",
 "viewer.imageAfter":"Dopo",
 "report.image.select":"Seleziona area",
 "report.image.hint":"Trascina sull’immagine per selezionare un’area.",
 "report.image.clear":"Cancella selezione",
 "report.image.commentRegion":"Commenta area",
 "report.image.commentWhole":"Commenta immagine intera",

 
 'product.transcriptLoading':'Caricamento','product.transcriptEmpty':'Nessun messaggio ancora: scrivi qui sotto da dove partire.',
 
 
 'start.cancel':'Annulla',
 'readiness.unknown':'Disponibilità del motore non ancora verificata.','readiness.disabled':'disattivato','readiness.trust':'da autorizzare nelle impostazioni','readiness.configure':'da configurare su questo computer','readiness.signIn':'accesso necessario','readiness.ready':'installato e con accesso verificato','readiness.unchecked':'installazione o accesso da verificare','readiness.login':'Accedi',
 'viewer.title':'File','viewer.chooseFile':'Apri un file da una conversazione o da un collegamento alla fonte.','viewer.copyPath':'Copia il percorso','viewer.showInFolder':'Mostra nella cartella','viewer.folderError':'Non riesco a mostrare la cartella.','viewer.formatted':'Formattato','viewer.source':'Sorgente','viewer.table':'Tabella','viewer.mode':'Vista','viewer.readOnly':'Sola lettura','viewer.jsonlLine':'riga',
 
 'viewer.compare':'Confronta','viewer.compareHead':'Con HEAD','viewer.compareRef':'Con un commit o ramo','viewer.compareFile':'Con un altro file','viewer.refPlaceholder':'es. main, HEAD~1, a1b2c3d','viewer.filePlaceholder':'Percorso dell’altro file','viewer.compareRun':'Mostra le differenze','viewer.diffWorking':'Calcolo delle differenze…','viewer.diffSame':'Nessuna differenza.','viewer.diffSlow':'Troppe differenze da calcolare qui.','viewer.diffCut':(p:{n:number})=>`Mostro le prime ${p.n} righe del confronto.`,'viewer.diffBinary':'Uno dei due non è un file di testo.','viewer.diffBig':'Uno dei due supera i 2 MB del confronto.','viewer.diffRepo':'Il file non è in un repository git.','viewer.diffUntracked':'Il file non esiste in quella versione.','viewer.diffRef':'Commit o ramo non trovato.','viewer.diffGit':'git non ha potuto leggere quella versione.',
 'viewer.imageRemote':'Immagine esterna non caricata: il visualizzatore mostra solo file di questo PC.','viewer.imageType':'Immagine non mostrata: solo PNG, JPG o WebP.','viewer.imageNotShown':(p:{name:string;reason:string})=>`Immagine non mostrata (${p.name}): ${p.reason}`,'viewer.imageZoom':'Clic per vederla grande','viewer.report':'Report',
 'chat.items.outputLoading':'Caricamento dell’output completo…','chat.items.outputFailed':'Impossibile aggiornare l’output completo. ',
 'viewer.loading':'Apertura del file…','viewer.outside':'Solo file di questo computer: le cartelle di rete e i percorsi relativi senza cartella non si aprono.','viewer.unsupported':'Non è un file (una cartella o un dispositivo).','viewer.missing':'Il file non è disponibile.','viewer.changed':'Il file è cambiato durante l’apertura. Riaprilo.','viewer.binary':'Questo file non contiene testo leggibile.','viewer.image':'L’immagine non è supportata o supera i limiti del visualizzatore.','viewer.page':(p:{from:string;to:string;total:string})=>`Byte ${p.from}–${p.to} di ${p.total}`,'viewer.lines':(p:{first:number;last:number})=>`righe ${p.first}–${p.last}`,'viewer.pageFirst':'Inizio','viewer.pagePrevious':'Precedente','viewer.pageNext':'Successiva','viewer.pageLast':'Fine','viewer.pdf':'Questo PDF non si può mostrare (danneggiato o oltre 32 MB).','viewer.pdfPage':(p:{n:number})=>`Pagina ${p.n}`,'viewer.lineUnavailable':'La riga citata non è presente nella parte caricata.','viewer.window':(p:{first:number;last:number;total:number})=>`Righe ${p.first}–${p.last} di ${p.total}`,
 'ui.newBrowser':'Nuovo browser','ui.browserMine':'La tua scheda','ui.browserAddress':'Inserisci un indirizzo','ui.browserEditAddress':'Modifica indirizzo','ui.browserOpenError':(p:{error:string})=>`Browser non aperto: ${p.error}`,
 'ui.state.waiting':'ti aspetta','ui.state.queued':'in coda','ui.state.running':'al lavoro','ui.state.starting':'avvio…','ui.state.error':'errore','ui.state.closed':'chiusa','ui.state.orchestrator':'ti ascolta','ui.state.done':'finito','ui.state.children':'in attesa',
 
 'ui.close':'Chiudi','ui.other':'Altro…','ui.writeAnswer':'scrivi la tua risposta','ui.mapDetails':'Fonti e dettagli',
 'context.handoffBusy':"Passaggio di consegne in corso.",
 'context.native':'Codex gestisce la compattazione nativa. Non serve cambiare chat per la sola lunghezza.','context.passive':'Dimensione del contesto riportata dal motore; la ripresa in una nuova chat resta una scelta manuale.',
 'origin.user':'Utente','origin.unavailable':'Non disponibile','origin.missingHint':'La fonte non registra il modello di origine. Il modello attuale non viene attribuito allo storico.',
 'product.appearance':'Aspetto e disposizione','product.style':'Stile','product.standard':'Essenziale','product.calm':'Calmo','product.catalog':'Catalogo agenti','product.grid':'Schede','product.list':'Elenco','product.preview':'Anteprima','product.apply':'Applica','product.reset':'Ripristina aspetto',
 'product.research':'Ricerca','product.researchPurpose':'Fonti e sintesi per il tuo lavoro','product.organization':'Organizzazione','product.organizationPurpose':'Priorità e prossimi passi',
 'product.avatar':(p:{name:string})=>`Icona di ${p.name}`,
 'product.expand':'Apri lavoro','product.waitsYou':'Ti aspetta','product.waitsYouOpen':(p:{title:string})=>`Apri la decisione di ${p.title}`,'product.collapse':'Riduci a striscia','product.write':'Scrivi','product.details':'Dettagli e collaboratori','product.profiles':'Profili','product.purpose':'Scopo','product.model':'Modello',
 'product.workAssigned':'Incarico aperto','product.workWaiting':'In attesa di posta','product.workCompleted':'Incarico concluso','product.workDeclare':'Stato del lavoro','product.workUnset':'Stato non impostato','product.noTask':'Compito non riportato',
 'product.teamUnknown':'Sottoagenti: dati non disponibili','product.teamComplete':(p:{active:number;total:number})=>`Sottoagenti: ${p.active} attivi · ${p.total} totali`,'product.teamPartial':(p:{active:number;total:number})=>`Osservati: ${p.active} attivi · ${p.total} totali · dati parziali`,
 'product.observed':'Attività osservata','product.replayed':'osservazione ripristinata','product.parent':'Padre','product.notReported':'Non riportato','product.parentMissing':'Non presente nelle osservazioni',
 'product.running':'In attività','product.waiting':'In attesa','product.completed':'Concluso','product.failed':'Errore','product.stopped':'Fermato','product.unknown':'Stato non riportato',
 'product.teamExplain':'Collaboratori interni osservati dal motore. I dati mancanti non indicano zero attività.','product.teamEmpty':'Nessuna attività interna osservata.','product.teamIncomplete':'Il motore non fornisce un elenco completo.',
 'product.child.agent':'sottoagente','product.childNoAgent':'nessun agente','product.child.shell':'comando','product.child.unknown':'attività','product.childrenOf':(p:{title:string})=>`Sottoagenti di ${p.title}`,'product.childStarted':(p:{time:string})=>`avviato alle ${p.time}`,'product.childFor':(p:{d:string})=>`da ${p.d}`,
 'product.restoreLayout':'Torna alla colonna','product.noArea':'Senza progetto',
 'product.advanced':'Dettagli avanzati',
 'product.agents':'I tuoi agenti','product.agentsPurpose':'Un ruolo chiaro per ogni lavoro.','product.setup':'Configura il tuo lavoro',
};
