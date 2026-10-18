---
when: {"prompt":["pagina vuota","hook","cervello non","brain page"],"tools":[],"paths":["**/ops/runbook/brain.md"]}
---
# Runbook: il cervello stesso

Problemi del cervello e dei suoi strumenti (pagine dell'app, memoria, hook, git), uno per voce. È anche l'esempio del
formato di ogni runbook: **sintomo → dove guardare → comando → esito atteso → note**. Read when: una pagina dell'app
mostra un errore, una chat dice che non riesce a scrivere la memoria, i commit del cervello non arrivano. Write when:
risolvi un problema del cervello che può tornare (una voce nuova o la correzione di una vecchia).

Tutti i comandi partono dalla cartella del cervello (`{{BRAIN}}`); sono in sola lettura salvo dove è scritto.

## Una pagina dell'app dice "Non riesco a leggere questi dati"

- **Dove**: il messaggio nomina lo script che è fallito (le pagine leggono il cervello con i suoi tool, in `ops/tools/`).
- **Comando**: lancia lo stesso script a mano e leggi l'errore intero:
  `node ops/tools/day.mjs report --json` (Fatto), `node ops/tools/day.mjs brief --json` (Da fare),
  `node ops/tools/cost.mjs --days 7 --json` (Costi), `node ops/tools/brain-map.mjs --json` (Mappa 3D).
- **Atteso**: un JSON. "Cannot find module" = manca un file del cervello: aggiorna il cervello dal prodotto invece di
  scriverlo a mano.
- **Note**: una pagina **vuota** non è un errore: quella memoria non ha ancora righe (`START-HERE.md`, la tabella delle
  pagine).

## Fatto o Da fare dicono "DevOps non letto"

- **Dove**: `day.mjs` legge PR e work item con il login di Azure CLI.
- **Comando**: `az login` (solo se usi Azure DevOps), poi "Aggiorna" nella pagina.
- **Atteso**: le PR e i work item del giorno compaiono.
- **Note**: senza Azure DevOps l'avviso resta ed è innocuo: il diario, i fili e le chat si vedono lo stesso.

## Una chat non riesce a scrivere `now.md` (o un'altra memoria)

- **Dove**: il messaggio di `ops/tools/mem.mjs` dice il motivo (riga oltre 250 caratteri, sezione che non esiste,
  formato sbagliato). L'hook `.claude/hooks/brain-limits.mjs` rifiuta anche le modifiche a mano.
- **Comando**: `node ops/tools/mem.mjs now me --label "<chat>" --text "<dove · stato · prossimo passo>"`.
- **Atteso**: "added" o "replaced line N".
- **Note**: i dettagli lunghi vanno nel file a cui la riga punta, non nella riga.

## Le modifiche del cervello non finiscono in git

- **Dove**: l'hook Stop `.claude/hooks/auto-commit.mjs`, cablato in `.claude/settings.json`; solo per Claude Code.
- **Comando**: `git log -5 --oneline` e `git status --short`.
- **Atteso**: un commit per turno che ha cambiato file.
- **Note**: le chat Cursor fanno il commit a mano (`AGENTS.md`, regola 3).

## Le chat non ricevono i messaggi delle altre chat

- **Dove**: le caselle di `ops/tools/inbox.mjs` (pagina Comunicazione).
- **Comando**: `node ops/tools/inbox.mjs list`.
- **Atteso**: ogni casella con i messaggi non letti e se qualcuno la sta ascoltando.
- **Note**: gli hook che consegnano la posta a fine turno li installa solo il proprietario:
  `node ops/tools/install-inbox-hooks.mjs --dry` mostra cosa cambierebbe.

## Cursor non vede gli agenti specialisti

- **Dove**: le copie generate in `.cursor/agents/` (le definizioni vere sono in `.claude/agents/`).
- **Comando**: `node ops/tools/brain-lint.mjs` (sezione "Puntatori agenti"); per rigenerarle (scrive):
  `node harness/cursor/sync-agents.mjs`.
- **Atteso**: "Puntatori agenti non allineati: 0".

## Controllo generale ("il cervello sta bene?")

- **Comando**: `node ops/tools/test.mjs` (test offline, cartelle temporanee) e `node ops/tools/brain-lint.mjs`
  (dimensioni, doppioni, file fuori dalla mappa, riferimenti rotti).
- **Atteso**: test verdi; il lint elenca solo cose da proporre, non corregge niente da solo.
