// The demo brain (SB_DEMO=1): a small made-up brain folder in the demo's userData (the same folder the demo's agent
// packs use), so the Brain pages (Skill, Regole, Memoria, Mappa) and the one-time migration of the former runbook and
// routines sections into skills (ADR 0077) run for real without the user's brain. Generic content only (no real
// customers, hosts or products). One line holds a fake connection string with a password, to show (and test) that it is
// masked in the skill made from it; one file named like credentials, to show it is never read. File dates are relative
// to `now` (frozen demo: the same dates every run). Used by demo-wiring.ts.
import fs from 'node:fs';
import path from 'node:path';

const DAY = 24 * 3600e3;
// built in pieces: a fake value, never a real one, and no secret pattern in this source file
const FAKE_CONN = `Server=tcp:db.example.test;Database=Demo;User ID=lettore;${'Pass'}${'word'}=${'demo-non-reale-42'};`;

/** relative path → [content, age in days] */
const FILES: Record<string, [string, number]> = {
  'runbook/index.md': [`# Runbook (indice)

Come si fanno le cose, imparate sul campo: un file per argomento.

| File | Argomento |
|------|-----------|
| \`rilasci.md\` | Rilasci e ambienti |
| \`database.md\` | Query sul database |
| \`funzionalita.md\` | Licenze e funzionalità |

Regressione dopo un rilascio: \`../flusso-hotfix.md\`.
`, 3],
  'runbook/rilasci.md': [`# Rilasci e ambienti

### Pubblicare una versione in test
Porta una pull request sull'ambiente di test per la verifica del QA.
1. Controlla che la build della pull request sia verde.
2. Avvia il rilascio verso l'ambiente di test:
\`\`\`powershell
az pipelines release create --definition-name "Demo-Test" --artifact-metadata-list "build=1234"
\`\`\`
3. Apri l'ambiente e verifica la pagina della funzione cambiata.

### Pubblicare su un anello di produzione
Porta la versione approvata sui clienti di un anello di produzione, un anello alla volta.
1. Scegli l'anello meno carico.
2. Lancia il rilascio (lo esegue solo il proprietario):
\`\`\`powershell
az pipelines release create --definition-name "Demo-Prod" --artifact-metadata-list "build=1234"
\`\`\`
3. Controlla i log dei primi 15 minuti.
`, 1],
  'runbook/database.md': [`# Query sul database

### Cercare un cliente con lookup
Trova cliente, licenza e database partendo da un testo (nome, email o codice).
\`\`\`sql
EXEC lookup '%testo%'
\`\`\`
Esito atteso: una riga per cliente trovato.

### Query in sola lettura su produzione
Una query di controllo sul database di un cliente: solo letture, sempre con l'ok del proprietario.
1. Scrivi la query in un file \`.sql\` e mostrala per intero.
2. Collegati con la stringa di connessione in sola lettura:
\`\`\`text
${FAKE_CONN}
\`\`\`
3. Esegui:
\`\`\`sql
SELECT TOP 10 Id, Nome, Creato FROM Clienti ORDER BY Creato DESC;
\`\`\`
`, 6],
  'runbook/funzionalita.md': [`# Licenze e funzionalità

### Attivare una funzionalità su una licenza
Accende una funzionalità per un cliente; il cliente rifà l'accesso per vederla.
1. Controlla le funzionalità già attive:
\`\`\`sql
SELECT Funzione, Attiva FROM FunzioniLicenza WHERE Licenza = '<CODICE>';
\`\`\`
2. Attivala (lo esegue solo il proprietario):
\`\`\`sql
UPDATE FunzioniLicenza SET Attiva = 1 WHERE Licenza = '<CODICE>' AND Funzione = '<FUNZIONE>';
\`\`\`
3. Chiedi al cliente di rifare l'accesso.

### Attivare l'integrazione con un servizio esterno
Collega la licenza di un cliente a un servizio esterno (immagini, firma, fatture).
- Prima: la licenza deve avere la funzionalità attiva (vedi sopra).
- Poi: \`node tools/integrazione.mjs attiva --licenza <CODICE>\` e verifica l'esito nel log.
`, 12],
  'flusso-hotfix.md': [`# Hotfix di una regressione

Il flusso classico quando un rilascio rompe qualcosa in produzione.

## 1. Trova l'eccezione vera
Leggi i log del nodo del cliente, non l'avviso generico.

## 2. Trova il commit
Confronta l'ultima versione buona con quella rotta: \`git log --oneline v1.4.0..v1.4.1\`.

## 3. Correggi e rilascia
Pull request con il test che prima falliva, poi rilascio su un anello.
`, 20],
  'routines.md': [`# Routine

## Brief mattutino
Il riepilogo della mattina: salute del servizio, novità, fili aperti.
1. \`node tools/brief.mjs\`
2. Leggi il file del giorno e scegli le prime tre cose.

## Report della giornata
Cosa è stato fatto oggi, diviso per area, da mandare alla fine della giornata.
1. \`node tools/day.mjs report\`
2. Correggi la bozza e aggiungi quello che manca.
`, 2],
  'rules/qa.md': [`# Regole di QA

## Provare un test case
1. Prendi l'ambiente di test libero.
2. Segui i passi del test case alla lettera.
3. Salva una schermata per ogni esito.

## Tono dei commenti
Commenti brevi e gentili, in inglese semplice.
`, 9],
  'playbooks/revisore.md': [`# Taccuino: revisore

## Punti
(nessuno)
`, 4],
  'runbook/credenziali-test.md': [`# Credenziali di test

Questo file non viene mai letto dalla migrazione.
`, 1],
  'clienti/alfa-shop.md': [`# Alfa Shop (cliente demo)

- Referente: ufficio acquisti, risponde entro il giorno dopo
- Ambiente di test: anello 2, aggiornato il lunedì
- Preferisce le note di rilascio in italiano semplice
`, 5],
  'ambienti/test.md': [`# Ambiente di test

- Un solo ambiente libero alla volta: prenotalo nel canale QA
- I dati si azzerano ogni notte alle 2
`, 8],
  'persone/team.md': [`# Team

- Giulia (QA): vuole i passi esatti per riprodurre
- Marco (sviluppo): preferisce una PR piccola per volta
`, 10],
  'now.md': [`# Fili aperti

- **Rimborsi parziali** · test e2e in corso, manca il caso di rimborso doppio
- **Totale ordine** · fix pronto, aspetta la revisione
`, 0],
  'journal/2026-10-08.md': [`# 2026-10-08

- Rilascio 1.4.1 in test, verificato il carrello
`, 1],
  'journal/2026-10-09.md': [`# 2026-10-09

- Corretto il totale dell'ordine con lo sconto
`, 0],
  'ai-errors.md': [`# AI errors

Date | agent | correction and prevention

- 2026-10-07 | Correzione bug | Ha letto l'avviso generico invece del log del nodo: leggere sempre il log del cliente
`, 2],
  'agents/default-bug-investigator/memory.md': [`# Memoria: Indagine

- Il nodo del cliente Alfa Shop scrive i log in UTC
- L'ambiente di test si azzera ogni notte alle 2
`, 3],
  'agents/default-reviewer/memory.md': [`# Memoria: Revisione

- Marco preferisce una PR piccola per volta
- L'ambiente di test si azzera ogni notte alle 2
`, 3],
  'rules/stile.md': [`---
when: {"prompt":["scrivi","bozza","mail"],"tools":[],"paths":[]}
---
# Stile dei testi

Frasi brevi, italiano semplice, niente gergo.
`, 6],
};

/** Writes the demo brain into `dir` (its own files written again, the rest of the folder kept) and returns it. */
export function writeDemoBrain(dir: string, now: number): string {
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, 'brain.json'))) fs.writeFileSync(path.join(dir, 'brain.json'), `${JSON.stringify({ machinery: 'product-v1', template: {}, rules: { topicFiles: ['rules/stile.md'], appRules: true } }, null, 2)}\n`);
  for (const [rel, [text, days]] of Object.entries(FILES)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    const t = new Date(now - days * DAY);
    fs.utimesSync(f, t, t);
  }
  return dir;
}
