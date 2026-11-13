# Proposte di miglioramento: registro

Ogni cambio proposto al modo di lavorare (regola, struttura, hook, script, agente, permesso), con il suo esito: per
**non riproporre ciò che {{OWNER}} ha scartato** e **tenere solo ciò che ha migliorato davvero**.

- **Read when:** prima di proporre qualunque miglioramento; "cosa ha funzionato?".
- **Write when:** nasce una proposta, {{OWNER}} risponde, viene applicata, misurata o tolta. Aggiorna la riga.

Formato, una riga per proposta (id progressivo, mai riusato):
`- **P-NNN** · data · titolo semplice · tipo · fonte · **stato** · metrica: cosa si conta, valore prima → valore dopo (data)`

Regole: ogni proposta dichiara quale numero muove (di default "interventi forzati al giorno",
`node ops/tools/flow-signals.mjs --forced`); se cambia un comportamento ha un caso in `tests/behavior.md`;
rifiutata = non si ripropone senza prove nuove; si misura solo quando {{OWNER}} lo chiede.

## Registro

Vuoto il primo giorno: la prima proposta nasce dalla prima revisione ("fai la revisione", `routines.md`) o da un
errore che torna due volte in `ai-errors.md`. La pagina Qualità dell'app conta le proposte e i loro esiti da qui.
