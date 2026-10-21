# second-brain · Analisi profonda e proposte

Oct 20, 2026 · @Davide

L'app ha già quasi tutto quello che serve: il problema non sono le funzioni mancanti, ma tre cose. La macchina che lavora da sola è invisibile o scollegata, il percorso più usato (tu → Orchestrator → nuovo agente) paga un avvio a freddo e giri di modello inutili, e molte statistiche non misurano quello che dicono. Le correzioni sono quasi tutte piccole e quasi tutte a zero token.

## Le 12 mosse, in ordine

Se fai solo le prime sei, l'app diventa sensibilmente più veloce e più economica senza toccare i modelli. Le altre sei la rendono viva, leggibile e credibile.

| # | Mossa | Area | Effetto atteso | Sforzo |
| --- | --- | --- | --- | --- |
| 1 | La stima la calcola l'app e la mette in una riga del messaggio all'Orchestrator, invece di fargli chiamare `task_estimate` | Velocità, token | −1 giro di modello per ogni richiesta (\~2-3 s, stima) | S |
| 2 | Motore caldo per ruolo e Orchestrator avviato all'apertura dell'app (oggi il motore caldo non serve mai le chat di ruolo) | Velocità | −10-17 s su ogni lavoro delegato (misura dell'ADR 0025), 0 token | M |
| 3 | Corsia "Lampo": una sessione sempre accesa, sola lettura, pochi tool, per le domande | Velocità | Primo token come un messaggio in Claude Code (2,2-3,8 s, ADR 0025) | M |
| 4 | Hook di prodotto dentro l'app invece di un processo `node` per ogni tool | Velocità | Fino a 4 processi in meno per ogni tool e turno; tempo da misurare | M |
| 5 | Un report "fatto, tutto ok" non sveglia l'Orchestrator; i report dei figli arrivano al genitore tutti insieme | Token | 18-43 $/settimana (stima) | S-M |
| 6 | Prefisso più leggero: tool search attivo, niente browser sull'Orchestrator, niente tool che un ruolo non può usare | Token | 30-50 $/settimana (stima) | S-M |
| 7 | Misurare la cache per chat e compattare l'Orchestrator mentre la cache è ancora calda | Token | 8-25 $/settimana, più fino a 75 se il prefisso tra sessioni oggi non è condiviso | S |
| 8 | Sicurezza senza popup: `acceptEdits` di default, letture approvate dall'app, comandi distruttivi negati, checkpoint git per turno, worktree per chi scrive | Agenti | Popup solo per le azioni verso l'esterno | M |
| 9 | "Mentre eri via" disegnato dall'app al mattino, e strisce che dicono cosa stanno facendo e da quanto sono ferme | Vita | 0 token | S-M |
| 10 | Battito: mostrarlo dove serve o spegnerlo (oggi spende per carte che nessuna pagina disegna) | Vita, token | Lo stesso budget diventa utile | S |
| 11 | Un glossario, un formato per i soldi, via i livelli "Lv 6 Maestro", una pagina Andamento con 5 numeri | UX | Statistiche leggibili e coerenti | M |
| 12 | Strato di evidenza: ogni cosa che l'app impara mostra ipotesi, n e intervallo, oppure "dati insufficienti" | Apprendimento | Fiducia e senso di progressione veri | M |

Risparmio di token stimato per le mosse 1-7 e gli altri fix della sezione Token: **175-370 $ a settimana**, circa il 6-12% della settimana misurata nel tuo `zero-token-audit.md` (2987 $). Sono stime con ipotesi dichiarate, non misure: la mossa 7 serve proprio a misurarle.

## Token: dove si sprecano

Il costo vero non è il testo che scrivi, è il contesto che ogni chiamata rilegge e quello che si riscrive in cache dopo una pausa. Ogni chiamata dell'Orchestrator rilegge circa 13 000 token di soli strumenti MCP; una chat di lavoro circa 9 000.

**Quanto pesa il contesto fisso** (misurato dal codice, token ≈ caratteri/4):

| Pezzo | Token | Quando |
| --- | --- | --- |
| Prefisso base di una chat Claude dell'app (ADR 0025) | \~38 000 | scritto a ogni sessione nuova, riletto a ogni chiamata |
| Strumenti MCP + istruzioni dell'Orchestrator | \~13 000 | ogni chiamata dell'Orchestrator |
| · di cui 24 strumenti browser, che le sue regole gli vietano di usare | \~4 200 | ogni chiamata |
| Strumenti MCP di una chat di lavoro | \~9 000 | ogni chiamata |
| Strumenti di delega visti da Scout e Judge, che non possono delegare | \~1 500 | ogni chiamata |
| `AGENTS.md` di questo repo, che il preambolo dei ruoli dice di rileggere anche se Claude Code l'ha già caricato | \~3 100 | ogni chat di ruolo nel repo |
| Una `read_page` del browser | fino a 5 000 | ogni lettura, resta nel contesto |

**I fix, dal più redditizio** (risparmi stimati con il modello di costo del repo: 8 $/M scrittura in cache a 1 h, 0,2 $/M lettura):

| Fix | Evidenza | Risparmio stimato | Sforzo |
| --- | --- | --- | --- |
| Misurare se le sessioni nuove condividono il prefisso; se no, allinearlo per ruolo | 38k scritti a ogni sessione (ADR 0025); nessuna misura di `cache_read` alla prima chiamata | fino a 75 $/sett (ipotesi) | S + M |
| Tool search di Claude Code attivo, browser tolto all'Orchestrator, strumenti inutilizzabili nascosti per ruolo | `tool-policy.ts:128` ha già `ToolSearch`; `chatToolShown` nasconde poco | 30-50 $ | S-M |
| "Pacchetto di review" deterministico per Sentinel e Judge (ramo, base, diff, test) | \~4 200 chiamate `git diff/show` a settimana, soprattutto revisori (`zero-token-audit.md`) | 30-45 $ | M |
| Router solo per lotti grandi, Judge solo quando il report non è verificato | regola in `orchestrator-role.ts:20` (ADR 0097) | 20-50 $ | S |
| Letture di pagina incrementali (solo i nodi cambiati) | `read_page` 20 000 caratteri ripetuta dopo ogni azione; una chat QA arrivò a 898k (ADR 0031) | 15-35 $ | M |
| `now.md` scritto dall'app, non dalle chat con chiamate shell | `appBoot` e `compact-now.mjs` lo chiedono a ogni chat | 15-20 $ | M |
| Report "fatto pulito" = notizia silenziosa; report raggruppati 30 s come la posta | `manager.ts:1563` e `:1535` scavalcano `orchestrator-delivery.ts` | 18-43 $ | S-M |
| Compattare l'Orchestrator a \~50 min di quiete, mentre la cache è calda | `continuity.ts:54` lo esclude dalle note fredde; la compattazione del giorno dopo paga una riscrittura di 100-160k | 8-25 $ | S |
| Il preambolo non fa rileggere `AGENTS.md` ai ruoli Claude | `roles.ts:160` | 8-15 $ | S |
| Stima e skill messe dall'app nel messaggio, non chiamate come tool | `orchestrator-role.ts:16` | 5-15 $ | S |
| JSON compatto nelle risposte degli strumenti app; `app_create_chat` risponde solo id e titolo | `wiring.ts:164` (+31% caratteri) | 5-15 $ | S |
| Estratti dei file già letti dal genitore allegati al contratto del figlio | il figlio rifà Glob/Grep/Read | 5-15 $ | M |
| Elenchi di skill duplicati (utente + progetto + plugin) | `install.mjs:107-110` copia in due posti | 5-25 $ (da misurare) | M |
| I Judge a campione non svegliano l'Orchestrator e non provano un `agent_report` che viene rifiutato | `manager.ts:1547` | \~4 $ | S |
| Hook legacy `chat-feed` che inietta un secondo feed di stato nell'Orchestrator dell'app | `chat-feed.mjs:79-80` | 2-5 $ | S |
| Testi duplicati (`SCREENSHOT_HINT` due volte, fast path in 4 posti) | `browser/service.ts:88`, `genui/artifacts.ts:234` | 3-5 $ | S |

Un compito delegato semplice oggi costa all'Orchestrator **2 turni e 4-6 chiamate**: `task_estimate`, a volte `skills_suggest`, `app_create_chat`, "👀", poi un turno intero solo per dire "fatto". Con le mosse 1 e 5 diventa 1 turno e 1-2 chiamate.

Il lavoro in background che spende davvero è piccolo: il Battito ha un tetto di 0,25 $ al giorno; manutenzione, classificatori, stime e motore caldo non chiamano modelli.

## Velocità: perché non sembra Claude Code

La tua impressione è giusta, e la causa è precisa: ogni lavoro nuovo passa dall'Orchestrator e poi da un avvio a freddo della CLI, che l'ADR 0025 ha misurato in 13-22 s. Un messaggio successivo nel terminale di Claude Code impiega 2,2-3,8 s (stessa misura).

_[grafico non esportato: misure dell'ADR 0025 e stime di questa analisi]_

La distanza viene quasi tutta dall'avvio a freddo e dal giro extra di `task_estimate`: le mosse 1-3 la riportano vicina a Claude Code.

**Le cinque cause, in ordine di peso:**

1. **Il motore caldo non serve mai i ruoli.** `create()` lo usa solo se la chat non ha una policy (`manager.ts:546-551`), ma dall'ADR 0085 ogni ruolo ha `tools: {allow: ALL}` (`catalog.ts:163`). Quindi ogni lavoro delegato parte a freddo, e il motore caldo generico si ricicla ogni 30 minuti consumando CPU per niente. L'ho verificato di persona nel codice.
2. **Un giro di modello in più per ogni messaggio.** La regola "prima chiama `task_estimate`" (`orchestrator-role.ts:16`) obbliga a un giro tool → modello anche quando la risposta è immediata. La stima è pura e deterministica: la può calcolare l'app.
3. **Hook `node` su ogni tool.** Un brain nuovo installa un comando `node runner.mjs` su UserPromptSubmit, PreToolUse, PostToolUse e Stop (`rules/delivery.ts:38-40`): 2 processi per ogni tool e 2 per turno. Su Linux 64-86 ms l'uno; su Windows l'ADR 0025 ha misurato 1-2 s per gli hook `node` dell'utente. Il benchmark di avvio li spegne (`bench-claude-start.mjs:24`), quindi nessuno li ha mai misurati. Esiste già la via in-process (`hook_callback`, usata per il budget dell'Orchestrator).
4. **L'admission CPU mette in fila gli avvii.** Un claude.exe che parte carica la CPU per 10-17 s e la soglia è 75% di media (`admission.ts`): sotto carico i figli di un albero partono uno ogni 4 s o più, cioè in serie.
5. **Lo stream arriva a scatti.** 100 ms di accorpamento in main più 100 ms nel renderer (`manager.ts:2094`, `store.ts:25`): 5-10 aggiornamenti al secondo contro il flusso continuo del terminale.

**La corsia "Lampo" (la fast chat che ti manca).** Una seconda sessione fissa nella colonna dell'Orchestrator, avviata all'apertura e mai rilasciata:

- strumenti solo di lettura (`Read, Grep, Glob, WebSearch, WebFetch`): nessun popup possibile;
- `--strict-mcp-config` con il solo endpoint della chat, nessuna skill, cornice di 3 righe;
- modello medio o effort basso (da misurare entrambi);
- un pulsante "Fanne un lavoro" passa all'Orchestrator un contratto già scritto, con il meccanismo di hand-off che esiste (`handoff.ts`).

Non viola l'ADR 0083: Lampo non scrive e non delega, il lavoro parte comunque dall'Orchestrator. Effetto atteso: il primo token di una domanda come in Claude Code, e un prefisso più corto, quindi anche più economico.

**Altri guadagni piccoli:** avviare il nuovo motore mentre il vecchio esce (`manager.ts:1377`, −3-5 s sulle chat fredde); cadenza dello stream a 33-50 ms per la chat in primo piano; i primi avvii chiesti dall'utente saltano la coda CPU; pre-avvio quando metti il cursore in una chat il cui motore è stato rilasciato.

## Agenti e multi-agente

Il disegno della delega è buono (contratto autosufficiente, un solo report, revisione in sessione pulita): segue quello che Anthropic descrive nel suo sistema di ricerca multi-agente. Per il codice però mancano due pezzi, un worktree per ogni figlio che scrive e un passo di integrazione, e alcune tappe (Router, Judge sistematico) aggiungono costo senza valore.

**Cosa dicono le fonti, in breve.** Anthropic misura che un agente usa circa 4× i token di una chat e un sistema multi-agente circa 15×; conviene per compiti in ampiezza e parallelizzabili, poco per "la maggior parte dei compiti di coding", dove tutti devono condividere lo stesso contesto ([fonte](https://www.anthropic.com/engineering/multi-agent-research-system)). Cognition arriva alla stessa conclusione: le letture e le revisioni si possono parallelizzare, le scritture devono restare su un solo filo ([fonte](https://cognition.ai/blog/dont-build-multi-agents)). Nel tuo codice due Artisan fratelli scrivono nella stessa checkout (`delegation.ts:135-137`): è esattamente il caso che entrambe le fonti sconsigliano.

**Il modello operativo che propongo** (la quadra tra velocità, economia ed efficacia):

| Livello | Quando | Come | Revisione |
| --- | --- | --- | --- |
| 0 · Lampo | domanda, spiegazione, "dov'è", "cosa fa" | corsia Lampo o Orchestrator in un giro solo | nessuna |
| 1 · Un agente (il default, anche per il codice) | una parte, anche lunga; tutto il codice accoppiato | un Artisan o Scout caldo, in un worktree se scrive, ricerche con i sub-agenti Explore nativi | Judge solo se il diff supera \~100 righe o tocca contract, sicurezza, IPC |
| 2 · Parallelo | parti davvero indipendenti, ricerca in ampiezza | l'Orchestrator apre N chat direttamente, un worktree per chi scrive, risultati raccolti, poi integrazione e Sentinel | Judge sempre sul risultato unito |
| 3 · Più tentativi | compito difficile con test che lo verificano | 2-3 Artisan sullo stesso contratto, vince chi passa i test con il diff più piccolo | test + Judge sulla scelta |

Il livello 3 ha senso solo con un verificatore: OpenHands passa dal 60,6% al 66,4% su SWE-bench Verified con 5 tentativi e un critic ([fonte](https://openhands.dev/blog/sota-on-swe-bench-verified-with-inference-time-scaling-and-critic-model)); senza oracolo la selezione si appiattisce.

**I nove ruoli.** Teniamoli come volti e nomi, ma instradiamo il lavoro su 4-5 corsie: Scout, Artisan, Sentinel/Judge, Herald, raramente Strategist. Router fa il mestiere dell'Orchestrator (l'ADR 0097 dice che non era mai stato usato): togliere la regola "più richieste → una chat Router" elimina un avvio a freddo e una catena di report. Scribe è coperto da Artisan con una skill del brain. Gli Explore nativi oggi non esistono nelle chat di ruolo, anche se gli ADR 0083 e 0090 li permettono: `--tools` non include `Agent` (`tool-policy.ts:128-141`).

**Permessi: "tutto concesso" non toglie i popup.** La policy di ruolo è aperta, ma la modalità vera resta quella del `settings.json` dell'utente (`manager.ts:2159-2164`): con `default` ogni Edit e ogni Bash chiede. E nel dev non c'è nessuna rete: niente checkpoint, niente blocco dei comandi distruttivi. Proposta, tutto senza popup:

| # | Rete | Come |
| --- | --- | --- |
| G1 | Modalità `acceptEdits` per le chat lanciate dall'app, e i comandi di sola lettura approvati dall'app | il role gate vede già ogni richiesta; `readOnlyCommand` esiste |
| G2 | Comandi negati con la ragione | `git push --force`, `reset --hard`, `clean -fdx`, `rm -rf` fuori dalla cartella, `npm publish`, `az` in scrittura, `kubectl delete`; il parser di `vendor.mjs` è già robusto |
| G3 | Checkpoint git per turno, con "Annulla questo turno" | indice temporaneo → `commit-tree` → `refs/sb/cp/<chat>/<n>`; non tocca l'indice dell'utente |
| G4 | Worktree di default per chi scrive in un repo | il figlio lavora isolato fino al merge |
| G5 | Card "Azioni rischiose" a fine turno, solo se ce ne sono | letta dalla trascrizione, zero token |
| G6 | Popup solo per gli effetti esterni | push, PR, posta, scritture su DevOps |

**Agenti creati dall'utente: no alla creazione libera, sì agli "specialisti".** Uno specialista è un ruolo fisso più nome, skill e memoria propri ("Artisan · Frontend React"), creato con una frase, in prova all'inizio, annullabile con un clic, al massimo 3 per ruolo. Agenti liberi frammenterebbero cache e motori caldi (meno velocità), diluirebbero i campioni delle statistiche e allargherebbero la superficie dei permessi. Gli specialisti realizzano il "role-first, adattato parlando" della tua VISION senza questi costi.

## App viva: la vita c'è già, ma non si vede

L'app ha 37 meccanismi che lavorano senza un tuo prompt, quasi tutti a zero token. Il punto è che quasi nessuno arriva ai tuoi occhi. La leva più forte non è aggiungere: è far vedere quello che già succede.

**Cosa lavora già da solo e dove si perde:**

| Meccanismo | Cosa fa | Perché non lo senti |
| --- | --- | --- |
| Battito (carte, 3 volte al giorno) | spende fino a 0,25 $/giorno per carte idea, consiglio, promemoria | le carte vanno nel posto `board`, che **nessuna pagina disegna** (verificato: solo agente, file e Ctrl+K chiamano `pulse:list`); niente impostazioni in UI; le sue proposte "Da approvare" non hanno UI |
| Manutenzione del brain (ogni 6 h) | crea e fonde skill, applica lezioni, con Annulla | non pubblica nulla nel feed: gli eventi `agent-updated` e `agent-proposal` sono dichiarati ma mai emessi |
| Eventi "mentre eri via" | il diff del brain dall'ultima sessione | `notify.ts:65` non li conta come non letti: la campanella resta a 0 |
| `app_digest` | costruisce già a zero token il testo "cosa è successo" | lo legge solo l'Orchestrator, pagando token |
| Passi leggibili (`run-steps.ts`) | traduce piano e tool in "Lancia npm test · 1:42" | li usa solo la card delle deleghe; una striscia normale dice solo "sta lavorando…" |
| Rilevamento stallo | `stalledMin` per le chat delegate | va solo al genitore LLM; niente in UI, niente per le chat radice |
| Judge a campione (3 al giorno) | apre strisce "Revisione · …" da solo | nessuna riga dice chi l'ha avviata: sembra comparsa dal nulla |
| Avvisi Task (PR, build, menzioni) | zero token | spenti di default |
| `Headline` legacy | — | codice morto: `start()` mai chiamato, ma le sue impostazioni sono ancora nello schema |

**La mattina oggi.** La chiusura automatica (2 min + 2 min di avviso) svuota la Grindhouse durante la notte, quindi ogni mattina un utente con centinaia di lavori alle spalle legge il testo del primo avvio: "Racconta all'Orchestrator cosa vuoi fare, oppure crea il tuo primo agente" (`AgentStrips.tsx:92`). Nessun "ecco cosa è successo, ecco cosa ti aspetta", anche se tutti i dati per dirlo sono in memoria.

**Proposte, tutte costruite su pezzi che esistono:**

1. **Strisce che dicono cosa fanno** (S, 0 token): al posto di "sta lavorando…" il passo corrente di `runSteps`, "passo 3/7" quando c'è un piano, e "ferma da 6 min" in ambra oltre la soglia di stallo. È la differenza tra "pensa" e "è bloccata", oggi indistinguibili.
2. **"Mentre eri via", disegnato dall'app** (M, 0 token): un blocco unico alla prima presenza del giorno, nello spazio vuoto della Grindhouse. Righe cliccabili: lavori finiti con esito, cosa ti aspetta, PR con build rossa, idee da riprendere oggi, agenti cloud finiti, cosa ha cambiato la manutenzione (con Annulla), spesa di ieri. Più un pulsante "Parliamone" che prepara una bozza per l'Orchestrator, mai inviata da sola. Serve un canale IPC in `contract.ts`.
3. **Ctrl+J non finisce mai nel vuoto** (S): senza richieste aperte, apre la prima voce del blocco del mattino. È un "prossima cosa da fare" costruito su dati che ci sono.
4. **L'auto-miglioramento si vede** (S): una notizia silenziosa nel centro notifiche per ogni passata di manutenzione che cambia qualcosa, con Annulla.
5. **"Avviata dall'app"** sulle strisce dei Judge a campione e delle chat riprese dopo un riavvio (S).
6. **Battito: mostralo o spegnilo** (S-M): al massimo 3 carte nello stato vuoto della Grindhouse, il campo `action` nel prompt così il pulsante "Affida" compare, le sue impostazioni in Notifiche. Finché non si vede, `pulse.on` a false. La frase "macabra" della Dashboard una volta al giorno, non 10-24.
7. **Presenza fuori dalla finestra** (S): icona sovrapposta nella barra di Windows con il numero di "ti aspetta" e barra di progresso mentre un agente lavora. Mai lampeggio, mai focus.

Lavoro notturno autonomo sulla tua to-do: lo sconsiglio, violerebbe "il lavoro parte solo dall'Orchestrator" e "permessi mai allargati in silenzio". L'alternativa coerente: lo slot serale del Battito prepara carte "per domani" con "Affida", e al mattino sei tu a dare il via.

## UX e statistiche: perché confondono

Ho avviato l'app vera (demo congelata e un profilo nuovo vuoto) e misurato le pagine dal DOM. La home mostra **108 numeri e 93 pulsanti** nello stesso istante, la colonna dell'Orchestrator ne aggiunge \~31 su ogni pagina, Qualità ne mostra 169. Il testo non manca (3 345 chiavi italiane, \~20 500 parole): spiega le formule, non il modello mentale.

**Lo stesso concetto, numeri diversi** (stessa istantanea della demo):

| Concetto | Valori mostrati | Perché divergono |
| --- | --- | --- |
| Errori dell'IA | 46 · 49 · 25+13 · 23 · 12 | finestre e filtri diversi, mai scritti accanto al numero |
| Skill usate | "0 su 16" (Skill) · "11 su 12" (Memoria) | "usata" = dichiarata in un posto, caricata nell'altro |
| Precisione delle stime | 68% · 84% · ×1,7 · 24% | due stimatori visibili, anche se l'ADR 0053 ne aveva tolto uno |
| Successo | 89% · 72% · 86% | pesi diversi, fonti diverse |
| Agenti | 5 · 4 · 4 · 2 · 3 | cinque regole di conteggio |

Un lavoro ha 6 nomi (task, lavori, run, chat, turni, decisioni), i soldi 4 formati (`0,35 $`, `40,04 USD`, `$0.00`, `≈ 1,84 $ ±9%`), il brain 3 (brain, Cervello, memoria). "Livello" sulla stessa card vuol dire sia il tier del modello sia "Lv 6 Maestro".

**Gamification contro la tua VISION.** Le card Agenti mostrano "Recluta → Maestro → Leggenda", barre XP, "Massimo Lv 50". Il livello cresce anche con i lavori falliti: misura il volume, non il miglioramento. La VISION dice "no gamification: only useful, truthful statistics" e `docs/agent-evidence.md` esclude livelli e punteggi. Anche il README li promette ("Agents that level up"): va allineato.

**Perché la UI sembra disallineata.** Il 57% dei valori di padding, gap e margin (1 590 su 2 774) è fuori dalla griglia di 4 px che `ux-principles.md` dichiara; i token di spazio sono usati \~15 volte; ci sono due scale tipografiche e 8 componenti diversi per un "riquadro numero". I titoli delle pagine partono a 3 x diverse (233, 237, 265 px). Bug riprodotti: card di Regole che escono a destra, colonna di Qualità con una parola per riga, etichette di Task che toccano i controlli, pulsante JSON di Idee che va a capo da solo, card orfana in Costi, legenda della Mappa sopra i nodi, piano dell'Orchestrator sopra i messaggi, "Esempio: Esempio:" nel tooltip della stima, data in formato USA in Fatto.

**Spiegare le funzioni.** Gli strumenti ci sono ma sono isole: 62 "?" che non portano mai alla Guida, una Guida che mostra nomi di tool interni (`agent_report`, `app_create_chat`) e nessun dato reale, una configurazione iniziale di 7 passi che finisce su una Grindhouse vuota e chiede di nuovo "Scegli il motore per l'Orchestrator". Mancano nella Guida: manutenzione, chiusura automatica, novità trattenute, versioni in prova, contesto e passaggio di chat lunga.

**Proposte:**

1. **Glossario unico e un solo formato per i soldi** (M): "lavoro" ovunque, "brain" sempre, "riuscito verificato" contro "non verificato", un solo `money()`.
2. **Via i livelli** (S): al loro posto "12 riusciti verificati su 15, ultimi 30 giorni". La Performance senza l'autovalutazione dell'agente (oggi pesa 0,3, `standing.ts:21`).
3. **Pagina Andamento con 5 numeri, in sidebar** (M). Sempre visibili in alto solo 2: "ti aspettano N" e "margine del piano: sessione 42% fino alle 10:43". Su Andamento, ognuno "contro 4 settimane fa" con n e fonte:
   - lavori riusciti verificati;
   - errori che hai dovuto correggere tu, ogni 10 lavori;
   - costo per lavoro riuscito;
   - tempo in cui gli agenti ti hanno aspettato (oggi non registrato: va aggiunto);
   - cosa ha imparato il sistema, e se ha funzionato.
4. **Un solo `StatTile`** (M): ogni numero con una riga fissa "Reale · ultimi 30 gg · n=46" o "Stima a listino" o "Quota Anthropic", una lettura in parole e "Come funziona →" che apre la Guida. Uno script nel `check:branch` blocca un numero nuovo senza fonte.
5. **Primo avvio con un lavoro vero** (M): la configurazione finisce con un compito piccolo in sola lettura, l'utente vede tutto il ciclo e il pulsante "Riuscito / In parte / Fallito" viene evidenziato con "Il tuo voto è ciò da cui l'app impara". Il motore dell'Orchestrator si sceglie dentro la configurazione.
6. **La Guida con i dati veri** (M): il diagramma che c'è già, riempito con i numeri della settimana ("7 compiti → 4 via rapida, 3 delegati → 5 riusciti → 2 regole nuove, 1 annullata").
7. **Correggere i bug di allineamento e una griglia vera** (S + M): uno script che conta i px fuori griglia e impedisce che crescano.
8. **Meno rumore** (S): il piano dell'Orchestrator compresso in una riga, un solo "?" per striscia, la striscia finita mostra "stima \~30 min → 41 min", un "Discuti" per sezione e non per grafico, via "Token spesi 0" e la "Battuta del Grindhouse". Impostazioni tornate ai 4 gruppi della VISION (oggi 8).

## Auto-apprendimento: impara, ma non sa se migliora

Il cuore dell'apprendimento (lezioni dalle correzioni, skill da lavoro ripetuto, memoria dei ruoli) non ha nessuna misura d'effetto. E l'unico confronto prima/dopo che esiste decide su rumore: hai ragione a sentire che le tecniche "non hanno fonti".

**I problemi, verificati nel codice e in simulazione:**

- **Le modifiche della manutenzione non vengono mai valutate.** Diventano una versione `active`, non `trial` (`catalog.ts:362`), quindi `trials.ts` non le guarda. Skill, regole e memoria non sono nemmeno versioni.
- **La prova delle versioni sceglie a caso un caso su due.** `evaluateTrial` decide su 5-10 esecuzioni con 4 metriche in OR e soglie fisse. Con due versioni identiche (Monte Carlo, regole copiate da `trials.ts:47-55`) propone "tieni" nel 20-30% dei casi, e nel **49%** se si guarda dopo ogni esecuzione, come fa `loop.ts:56-57`. Più dati peggiorano il risultato, perché l'OR di 4 metriche non converge.
- **Il Judge è un LLM che giudica LLM, e vale come te.** Il suo verdetto pesa 1 come quello dell'utente (`standing.ts:21`), il suo prompt include l'auto-valutazione della run (`judge-sample.ts:65`), può girare sullo stesso modello, e l'accordo Judge-utente non è mai misurato. La letteratura documenta bias di posizione, verbosità e auto-preferenza nei giudici LLM ([Zheng et al. 2023](https://arxiv.org/abs/2306.05685)) e che un modello favorisce le proprie generazioni ([Panickssery et al. 2024](https://arxiv.org/abs/2404.13076)).
- **Statistiche che non misurano quello che dicono.** Il "hit" dei classificatori è "non è finito in altro" (copertura, non accuratezza, `classifier-cards.ts:98,106`); "Sta imparando" appare su un classificatore a regex fisse che non può imparare; il trend delle stime è "ultima settimana meno prima" a qualsiasi n (`estimate-accuracy.ts:51`); le skill suggerite sono ricalcolate usando anche la run che si sta valutando (leakage, `skills/suggest.ts:130` + `wiring.ts:412`).
- **Le stime non sono mai confrontate con la stima ingenua.** È proprio ciò che l'ADR 0053 aveva scoperto sulla versione precedente: non batteva la mediana globale. Lo schermo oggi non lo direbbe.
- **La memoria è solo recency.** Si iniettano gli ultimi 4 000 caratteri (`flows.ts:97`), e `remember` scrive senza passare dal change log, quindi senza Annulla.
- **La parte statisticamente seria non è nel prodotto.** Il loop dell'ADR 0030 (backtest, conformal, bootstrap appaiato al 90%, almeno 30 casi) vive solo nel tuo brain privato; il template non lo ha. La calibrazione dell'ADR 0074 è stata cancellata dal commit `bb953da`, ma l'ADR risulta ancora "accepted" e il misuratore "Pronto a calibrare" in UI non porta a nulla.

**Il limite onesto da dire a schermo.** Con il volume di una persona, per vedere +15 punti di successo (da 60% a 75%) servono \~152 esecuzioni giudicate per lato; per dimezzare le correzioni per esecuzione \~94. Una singola regola quasi mai arriva a una prova. Il giudizio affidabile si fa per meccanismo ("tutte le lezioni insieme riducono le correzioni?"), su metriche frequenti come correzioni e turni dell'utente.

**La proposta: uno strato di evidenza** (M), appeso a `BrainChange` e alle versioni di ruolo che esistono già:

1. Ogni cambiamento appreso nasce con un'ipotesi, una metrica (correzioni per esecuzione, turni dell'utente, tempo, successo verificato), una baseline congelata e un n minimo (20).
2. Ogni esecuzione registra quali cambiamenti aveva caricati (`AgentRunTags.changes`), più `userTurns` e le correzioni rilevate.
3. Il verdetto arriva solo a tappe fisse (20, 40, 80 esecuzioni), con intervallo di Wilson o bootstrap: "aiuta", "nessun effetto", "peggiora" (con Annulla proposto, mai silenzioso), altrimenti "in raccolta 7/20".
4. A schermo: "Regola X · Artisan · −0,4 correzioni per esecuzione su 23 (IC 90% da −0,7 a −0,1) · aiuta".
5. Una pagina **Apprendimento**: per ruolo la curva delle correzioni per esecuzione con i cambiamenti come marcatori, e il contatore "beneficio provato 3 · senza effetto 5 · in raccolta 12 · annullati 2". È la progressione vera che chiedi, senza livelli.

**Altri fix piccoli:** il Judge non legge più l'auto-report, e finché l'accordo con i tuoi voti (chiesti su \~1 lavoro giudicato su 5) non supera una soglia, i suoi verdetti restano "non verificati" (M); le stime confrontate con la stima ingenua e con la copertura reale del range (S); una skill nasce da lavoro ripetuto solo con almeno 2 successi verificati, oggi l'assenza di verdetto conta come successo (`jobs.ts:207`), come chiede anche il metodo Voyager ([Wang et al. 2023](https://arxiv.org/abs/2305.16291)) (S); la memoria iniettata per pertinenza al compito con la ricerca ibrida che già hai (S); "errori ogni 100 turni" diventa "ogni 10 lavori", perché il denominatore "turni" cambia con il modo di lavorare (S).

**Da togliere subito** (S): livelli Lv 1-50, Performance % mista, "hit" presentato come accuratezza, "Sta imparando" e i "Lo sapevi?" su 5 casi, trend e "precisione" delle stime, misuratore di calibrazione, "richiami" della memoria, skill "utile/debole" su 2 esiti, conteggi di `ai-wins.md` (misurano la cortesia, non l'esito).

## Il mercato: cosa prendere dai migliori

Nessun prodotto fa tutto quello che fa second-brain in un posto solo; ognuno però fa meglio un pezzo. Worktree per agente, notifiche solo azionabili, revisore in sessione pulita e motore avviato in anticipo li hai già: il mercato li conferma.

| Idea | Da chi | Cosa diventa in second-brain | Fonte |
| --- | --- | --- | --- |
| La cache come statistica: % di input da cache, miss con causa probabile, calda o fredda | Claude Code `/usage` | una riga per chat e per l'Orchestrator; guida le mosse 6 e 7 | [costs](https://code.claude.com/docs/en/costs), [prompt caching](https://code.claude.com/docs/en/prompt-caching.md) |
| Figli simili lanciati a pochi secondi l'uno dall'altro, così condividono il prefisso in cache | Claude Code (fan-out) | Scout e Judge nella cartella del genitore, avvii scaglionati | [prompt caching](https://code.claude.com/docs/en/prompt-caching.md) |
| Vista unica degli agenti per stato, riassunto di una riga da un modello piccolo, "in attesa da X min" | Claude Code agent view | la riga "cosa sta facendo" delle strisce (meglio ancora: a zero token da `run-steps.ts`) | [agent view](https://code.claude.com/docs/en/agent-view.md) |
| Gate di qualità come hook a fine compito che rimanda l'agente al lavoro con il feedback | Claude Code agent teams (`TaskCompleted`) | `check:branch` automatico prima che un Artisan possa riportare "fatto" | [agent teams](https://code.claude.com/docs/en/agent-teams) |
| Task pianificati con recupero dell'ultima esecuzione mancata e una coda "Da rivedere" | Claude Code scheduled tasks, Codex Automations | il Battito diventa "routine del brain" con risultati in Da approvare | [scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks.md) |
| Brief del mattino finito, 5-10 carte con pollice su/giù | ChatGPT Pulse | il blocco "mentre eri via" con feedback che orienta il giorno dopo | [Pulse](https://openai.com/index/introducing-chatgpt-pulse/) |
| Piano mostrato in pochi secondi e modificabile prima che l'agente parta | Devin Interactive Planning, Cursor | il "piano trascinabile" della tua VISION, applicato ai lavori livello 2 | [Devin 2.0](https://cognition.ai/blog/devin-2) |
| Handoff invece di compattazione: nuovo thread con bozza modificabile ed elenco file | Amp | da confrontare con l'ADR 0014 sul passaggio delle chat lunghe | [Amp handoff](https://ampcode.com/news/handoff) |
| Più tentativi solo con un verificatore | OpenHands | livello 3 del modello operativo | [OpenHands](https://openhands.dev/blog/sota-on-swe-bench-verified-with-inference-time-scaling-and-critic-model) |
| Memoria riordinata in background da un agente separato | Letta (sleep-time agents) | la manutenzione notturna del brain, misurata con lo strato di evidenza | [Letta](https://docs.letta.com/guides/agents/architectures/sleeptime) |
| Blocchi "Insight" che spiegano il perché mentre si lavora | Claude Code output style Explanatory/Learning | un modo "spiegami" per i nuovi utenti, in linea con la Guida con dati veri | [output styles](https://code.claude.com/docs/en/output-styles.md) |
| Ciclo completo review → check → PR → merge → archivio per ogni workspace | Conductor | l'integratore che manca al livello 2 | [Conductor](https://www.conductor.build/workflows/run-parallel-claude-codes) |

Stato dei concorrenti verificato oggi: Vibe Kanban dichiara nel README che è in dismissione, Crystal è stato sostituito da Nimbalyst, claude-flow si chiama ora Ruflo, MemGPT è Letta. Alcuni siti (cognition.ai, openai.com, conductor.build, ampcode.com) non erano raggiungibili da qui: per quelle righe la fonte è il risultato di ricerca, non la pagina letta.

## Da non toccare, limiti e fonti

**Già fatto bene, lascialo com'è:** notifiche solo azionabili (ADR 0022); novità trattenute e visibili in `HeldNews`; testo del ruolo una sola volta per contesto e nome del plugin stabile per la cache (ADR 0089); il budget di 3 tool per turno dell'Orchestrator; ogni metrica con valore, n e copertura (`run-metrics.ts`); fonti dei verdetti separate (ADR 0095); backtest delle stime che usa solo il passato; change log con Annulla; ricerca ibrida BM25 + embedding con fusione RRF k=60; un solo battito per le animazioni (`beat.ts`).

**Limiti di questa analisi.**

- Nessun modello è stato chiamato e su questa macchina non ci sono le tue trascrizioni: i risparmi in dollari sono **stime** con ipotesi scritte (\~40 000 chiamate e \~300 sessioni nuove a settimana, ricavate dai tuoi `zero-token-audit.md` e ADR 0031). La mossa 7 le trasforma in misure.
- I tempi di latenza vengono dalle misure del tuo ADR 0025 (Windows) o sono stime dal codice; gli hook `node` su Windows non li ha mai misurati nessuno.
- L'app è stata avviata in Linux, con dati demo: densità e bug visivi sono riprodotti, l'uso reale no.
- Le sei analisi sono state fatte da agenti separati; ho verificato di persona nel codice le affermazioni più forti (motore caldo mai usato dai ruoli, carte del Battito senza pagina, regola `task_estimate`, hook `node` su ogni tool, livelli Lv, figli senza worktree propri).
- Una contraddizione risolta: la doc di Claude Code dice che sui modelli 5.5 cambiare effort non invalida la cache, quindi ho tolto quel finding.

**Fonti principali:**

- Anthropic, [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system): multi-agente \~15× i token di una chat, poco adatto al coding accoppiato.
- Cognition, [Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents): condividere il contesto, scritture su un solo filo.
- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): partire dalla soluzione più semplice.
- Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): recupero just-in-time, sub-agenti che restituiscono 1-2k token.
- Anthropic, [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents): risposte concise, paginazione.
- [Prompt caching (API)](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) e [prompt caching in Claude Code](https://code.claude.com/docs/en/prompt-caching.md): TTL, prezzi, cosa invalida il prefisso.
- Zheng et al. 2023, [Judging LLM-as-a-Judge](https://arxiv.org/abs/2306.05685); Panickssery et al. 2024, [LLM Evaluators Recognize and Favor Their Own Generations](https://arxiv.org/abs/2404.13076).
- Wang et al. 2023, [Voyager](https://arxiv.org/abs/2305.16291); Park et al. 2023, [Generative Agents](https://arxiv.org/abs/2304.03442).
- Johari et al. 2017, "Peeking at A/B Tests" (KDD), sul perché guardare dopo ogni esecuzione gonfia i falsi positivi.

Le analisi complete per area, con ogni riferimento `file:riga`, sono nei 6 file di lavoro di questa sessione: se vuoi le porto nel repo o ne apro una issue per mossa.
