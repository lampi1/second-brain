---
when: {"prompt":["da dove comincio","primo giorno","inizia da qui","pagina vuota"],"tools":[],"paths":["**/START-HERE.md"]}
---
# Inizia da qui

La guida del primo giorno di {{BRAIN_NAME}}, il cervello di {{OWNER}}: cosa fare nei primi minuti, cosa mostra ogni
pagina dell'app e quando si riempie. Read when: il primo giorno, o quando una pagina dell'app è vuota e non sai perché.
Write when: mai di routine; quando ti orienti da solo puoi cancellarlo (togli anche la sua riga in `map.md`).

## Il cervello in una frase

Una cartella di file di testo che tutte le chat (Claude Code, Cursor) leggono e scrivono: chi sei e come vuoi lavorare
(`me.md`), cosa c'è in corso (`now.md`), cosa è successo (`journal/`), le idee (`ideas.md`), gli errori dell'IA
(`ai-errors.md`). Le chat scrivono da sole, con `ops/tools/mem.mjs`; tu parli normalmente. Ogni modifica finisce nel
git locale della cartella: niente si perde, niente esce dal PC.

## I primi dieci minuti

1. **Apri una chat nella cartella del cervello** («Nuovo agente» nella Grindhouse dell'app, o Ctrl+N) e scrivi "cosa devo fare oggi?".
   Il primo giorno la risposta è corta: è normale, il cervello è vuoto.
2. **Dì come vuoi lavorare.** Leggi `me.md` e correggi a voce: "d'ora in poi rispondimi in tre righe", "non fare mai
   commit da solo". La chat la scrive al posto giusto con un test, seguendo la skill `brain-edit`.
3. **Apri il primo filo.** "Sto lavorando a X, il prossimo passo è Y": la chat scrive una riga in `now.md` e da lì
   la pagina Da fare la mostra.
4. **Segna un'idea.** "Segnatelo: ..." e l'idea finisce in `ideas.md` (pagina Idee), con una data per riprenderla.
5. **A fine giornata**: "cosa ho fatto oggi?". La chat legge il diario e le chat del giorno e scrive il report.

## Le pagine dell'app: cosa mostrano e quando si riempiono

| Pagina | Mostra | Il primo giorno | Si riempie quando |
|--------|--------|-----------------|-------------------|
| Da fare | Decisioni che ti aspettano, fili aperti, idee da riprendere | Vuota | Una chat apre un filo in `now.md` o un'idea ha una data passata |
| Fatto e standup | Gli esiti del giorno e le frasi per lo standup | Vuota | Le chat scrivono righe `fatto` nel diario (`journal/`) |
| Idee | Le tue idee e quelle dell'IA | Vuota | Dici "segnatelo", o una chat propone una sua idea |
| Qualità | Quante volte hai dovuto correggere l'IA, se le regole funzionano | Trattini | Una correzione finisce in `ai-errors.md`, una proposta in `proposals.md` |
| Costi | Quanto costano le chat a prezzo di listino, dove risparmiare | Quasi vuota | Usi le chat: legge le trascrizioni sul PC, zero token |
| Comunicazione | I messaggi tra le chat e l'Orchestrator | Vuota | Una chat scrive a un'altra (`ops/tools/inbox.mjs`) |
| DevOps | PR e work item da Azure DevOps | Da leggere | Hai un progetto Azure DevOps e fai `az login` |
| Confronto modelli | Lo stesso lavoro fatto da due modelli, giudicato alla cieca | Vuota | Fai un confronto tra modelli |
| Esplora | Tutti i file del cervello, con la ricerca | Piena | Sempre: è il modo più rapido per capire cosa c'è |
| Mappa 3D | Regole, memoria, tool e agenti, collegati | Piena | Sempre: cresce con il cervello |

Una pagina vuota non è un errore: vuol dire che quella memoria non ha ancora righe. Se invece mostra un errore, guarda
`ops/runbook/brain.md`.

## Frasi che il cervello capisce

| Dici | Succede |
|------|---------|
| "Cosa devo fare oggi?" | Legge `now.md`, le idee scadute e il diario di ieri; propone i primi tre |
| "Riprendiamo X" / "a che punto eravamo?" | Cerca il filo in `now.md` e le chat vecchie (`ops/tools/session-find.mjs`) |
| "Segnatelo" | Un'idea in `ideas.md` |
| "Segna nel diario: ..." | Una riga nel diario di oggi |
| "D'ora in poi fai X" / "non fare più Y" | Una regola nuova, al posto giusto, con il suo test (`brain-rules.md`) |
| "Cosa ho fatto oggi?" | Il report della giornata (`routines.md`) |
| "Fai la revisione" | Errori, successi e costi della settimana, con al massimo 5 proposte (`routines.md`) |
| "Fai manutenzione" | Controlli del cervello: file troppo lunghi, doppioni, test (`routines.md`) |

## Come cresce

- **Le regole nascono dalle correzioni.** Ogni volta che correggi un agente, l'errore va in `ai-errors.md`; la seconda
  volta che succede la stessa cosa, l'Orchestrator ti propone una regola. Non scrivere regole in anticipo.
- **Le procedure nascono dal lavoro.** Quando risolvi un problema che tornerà, chiedi "salvalo nel runbook": nasce un
  file in `ops/runbook/` (c'è già `ops/runbook/brain.md`, sul cervello stesso, come esempio).
- **Dove sta cosa**: `map.md` è l'unico indice. Il registro di ogni file dice quando leggerlo e quando scriverlo.
