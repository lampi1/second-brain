// The demo brain (SB_DEMO=1): a small made-up brain folder in the demo's userData (the same folder the demo's agent
// packs use), so the Brain pages (Skill, Regole, Memoria, Mappa) and the one-time migration of the former runbook and
// routines sections into skills (ADR 0077) run for real without the user's brain. Generic content only (no real
// customers, hosts or products). One line holds a fake connection string with a password, to show (and test) that it is
// masked in the skill made from it; one file named like credentials, to show it is never read. File dates are relative
// to `now` (frozen demo: the same dates every run); a `{d:N}` in a path or a text is the date N days before `now`. The
// role memories, logged errors, a stale note, two older skills and made-up role runs (demoBrainRuns) feed the Memoria
// statistics. Used by demo-wiring.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRun, AgentRunOutcome } from '../../shared/agents';
import { tr } from '../demo-text';

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
`, 40],
  'now.md': [`# Fili aperti

- **Rimborsi parziali** · test e2e in corso, manca il caso di rimborso doppio
- **Totale ordine** · fix pronto, aspetta la revisione
`, 0],
  'journal/{d:15}.md': [`# Diario

- Prenotato l'ambiente di test per la settimana
- Rilascio 1.4.0 in test
`, 15],
  'journal/{d:8}.md': [`# Diario

- Rimborsi parziali: scritto il primo test e2e
`, 8],
  'journal/{d:3}.md': [`# Diario

- Rilascio 1.4.1 in test, verificato il carrello
- Trovato il bug del totale con lo sconto
`, 3],
  'journal/{d:1}.md': [`# Diario

- Corretto il totale dell'ordine con lo sconto
`, 1],
  'ai-errors.md': [`# Errori dell'IA: il registro

Ogni errore di un agente o di una chat, una riga.

- {d:68} | Scout | Ha letto l'avviso generico invece del log del nodo del cliente: leggere sempre il log del nodo
- {d:61} 09:40 · Artisan · rilasci · verifica mancata · detto: fatto · vero: nessuno screenshot della pagina cambiata · visto da: tu, a mano · regola: niente «fatto» senza screenshot
- {d:54} | Sentinel | Test dato per passato senza eseguirlo: la suite non era partita
- {d:47} | Scout | Di nuovo l'avviso generico al posto del log del nodo del cliente Alfa Shop
- {d:40} 15:05 · Artisan · rilasci · verifica mancata · detto: pronto per il test · vero: la build della pull request era rossa · visto da: revisione
- {d:33} | Artisan | Nota di rilascio in inglese tecnico: il cliente la vuole in italiano semplice
- {d:26} | Sentinel | Test dato per passato senza eseguirlo: mancava l'ambiente di test libero
- {d:19} | Scout | Log del nodo letto in ora locale: il nodo scrive in UTC, l'orario era sbagliato di due ore
- {d:12} 11:20 · Artisan · rilasci · verifica mancata · detto: fatto · vero: la pagina dava errore 500 · visto da: tu, dallo screenshot · regola: niente «fatto» senza screenshot
- {d:9} | Sentinel | Giudizio dato senza leggere i criteri del contratto
- {d:5} | Sentinel | Test dato per passato senza eseguirlo: suite filtrata su un solo file
- {d:2} | Scout | Ha letto l'avviso generico invece del log del nodo: il problema era nel nodo 3
`, 2],
  'agents/scout/memory.md': [`# Memoria: Scout

- {d:70} · Il nodo del cliente Alfa Shop scrive i log in **UTC**
- {d:52} · I log dei nodi stanno in \`logs/nodo-<n>/\`, uno per giorno
- {d:31} · L'ambiente di test si azzera ogni notte alle 2
- {d:18} · Prima di cercare nel codice, chiedi il numero di build: cambia tutto
- {d:4} · L'avviso generico non dice mai il nodo: apri sempre il log del nodo
`, 4],
  'agents/artisan/memory.md': [`# Memoria: Artisan

- {d:64} · Marco preferisce una PR piccola per volta
- {d:44} · Il carrello ha due calcoli del totale: \`cart.ts\` e \`checkout.ts\`, vanno cambiati insieme
- {d:23} · Screenshot della pagina cambiata **prima** di dire fatto
- {d:35} · Le note di rilascio per Alfa Shop vanno in *italiano semplice*
- {d:11} · Le pull request verso \`release/*\` vogliono il numero del work item nel titolo
`, 11],
  'agents/sentinel/memory.md': [`# Memoria: Sentinel

- {d:57} · L'ambiente di test si azzera ogni notte alle 2
- {d:27} · Un solo ambiente libero alla volta: prenotalo nel canale QA
- {d:6} · Controlla che la suite sia partita davvero: guarda il numero di test eseguiti
`, 6],
  'ambienti/vecchio-server.md': [`# Vecchio server di prova

- Spento a fine estate: i dati sono nell'ambiente di test
- Accesso solo dalla rete dell'ufficio
`, 75],
  '.claude/skills/note-di-rilascio/SKILL.md': [`---
name: note-di-rilascio
description: Scrive le note di rilascio per i clienti, in italiano semplice, partendo dalle pull request della versione.
---
# Note di rilascio

1. Elenca le pull request della versione.
2. Per ognuna una riga: cosa cambia per il cliente, senza gergo.
`, 50],
  '.claude/skills/pulizia-ambiente/SKILL.md': [`---
name: pulizia-ambiente
description: Riporta l'ambiente di test allo stato iniziale dopo una prova lunga.
---
# Pulizia dell'ambiente

1. Ferma i servizi di prova.
2. Ripristina i dati della notte.
`, 45],
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
  const dated = (t: string) => t.replace(/\{d:(\d+)\}/g, (_m, n: string) => new Date(now - Number(n) * DAY).toISOString().slice(0, 10));
  // in the UI language (demo-text.ts): Italian as written, English through its table (paths, headings and lines)
  for (const [rel, [text, days]] of Object.entries(FILES)) {
    const f = path.join(dir, dated(tr(rel)));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, dated(tr(text)));
    const t = new Date(now - days * DAY);
    fs.utimesSync(f, t, t);
  }
  return dir;
}

/** The demo runs' requests: all different, but the Scout's "log del nodo" searches repeat (the maintenance's repeated-task
 *  job turns them into a skill on the Manutenzione button). */
const GOALS = [
  'Cerca nel log del nodo l’errore del carrello', 'Correggi il totale dell’ordine con lo sconto', 'Esegui la suite dei rimborsi parziali',
  'Cerca nel log del nodo perché il rimborso fallisce', 'Aggiungi il test del rimborso doppio', 'Scrivi le note di rilascio della versione 1.4.1',
  'Giudica la pull request del totale ordine', 'Trova chi usa ancora la vecchia API dei pagamenti', 'Sistema il calcolo IVA per i clienti esteri',
  'Verifica il rilascio in test sul carrello', 'Cerca nel log del nodo l’errore delle notifiche SMS', 'Prepara la pull request del fix notifiche',
  'Aggiorna la pagina cliente Alfa Shop', 'Valuta il piano per i rimborsi parziali', 'Leggi la documentazione del corriere spedizioni',
  'Rinomina i campi del modulo indirizzo', 'Controlla le schermate dopo il rilascio', 'Cerca nel log del nodo il timeout del checkout',
  'Togli il codice morto del vecchio carrello', 'Riassumi le decisioni della riunione QA', 'Confronta due versioni della ricevuta PDF',
  'Elenca le dipendenze scadute del progetto', 'Migliora i messaggi di errore del pagamento', 'Riprova la suite notturna fallita',
  'Cerca nel log del nodo l’eccezione della fattura', 'Scrivi il test per lo sconto a soglia', 'Correggi il fuso orario nei report',
  'Rileggi il glossario per i nuovi colleghi', 'Esamina la copertura dei test del checkout', 'Trova i ticket duplicati del mese',
  'Semplifica la funzione di arrotondamento prezzi', 'Lancia i controlli di accessibilità del sito', 'Spiega il flusso degli ordini annullati',
  'Decidi se la correzione del magazzino è completa',
];

/** Made-up role runs for the demo's Memoria statistics (skills used, how they went, memories recalled): deterministic,
 *  spread over the last ten weeks. `skills` = the demo brain's skill names now (the migrated ones are named at start);
 *  the first three migrated ones get runs, «pulizia-ambiente» none (a skill never used). */
export function demoBrainRuns(now: number, skills: string[]): AgentRun[] {
  const notes = tr('note-di-rilascio'), migrated = skills.filter(s => s !== notes && s !== tr('pulizia-ambiente'));
  // [role, days ago, skill (index in migrated, or a name), verdict]
  const plan: [string, number, number | string, AgentRunOutcome['verdict'] | null][] = [];
  const verdicts: AgentRunOutcome['verdict'][] = ['success', 'success', 'partial', 'success', 'fail', 'success', 'success', 'unknown'];
  for (let i = 0; i < 34; i++) {
    // slot 5 is the release notes (an Artisan with the brain skill, ADR 0100), slot 6 an independent review (a Sentinel)
    const slot = i % 7, role = ['scout', 'artisan', 'sentinel', 'scout', 'artisan', 'artisan', 'sentinel'][slot]!;
    const skill: number | string = slot === 5 ? notes : slot === 2 ? 2 : slot === 1 || slot === 4 ? (i % 3 === 0 ? 1 : 0) : i % 5 === 0 ? 1 : 0;
    plan.push([role, 2 + Math.floor((i * 67) / 34), skill, slot === 2 ? (i % 2 ? 'fail' : 'partial') : verdicts[i % verdicts.length]!]);
  }
  return plan.map(([role, days, skill, verdict], i): AgentRun => {
    const name = typeof skill === 'number' ? migrated[skill] : skill;
    const startedAt = now - days * DAY - (i % 5) * 3600e3;
    return {
      source: 'chat', runId: `r_demo_${i}`, chatId: `demo-run-${i}`, agentId: role, version: 1, goal: tr(GOALS[i % GOALS.length]!), startedBy: 'orchestrator', startedAt,
      endedAt: startedAt + 40 * 60e3, endReason: 'completed', counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: null, tokens: null,
      ...(verdict ? { outcome: { verdict, basis: 'human', at: startedAt + 41 * 60e3, by: 'demo' } } : {}),
      tags: { skills: name ? [name] : [], app: null, repo: null },
    };
  });
}
