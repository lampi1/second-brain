# Journal: il diario della giornata

Cosa fa {{OWNER}} ogni giorno: lavoro, interruzioni, attriti, idee, decisioni. Serve a una cosa sola: **dati che lo
migliorano**. La revisione (solo su richiesta) li trasforma in regole, routine e automatismi.

- **Read when:** "cosa ho fatto oggi" / "com'è andata" (`routines.md`), "cosa devo fare oggi" (il file di ieri).
- **Write when:** solo righe `fatto` (ogni esito, non ogni turno), `attrito`/`interruzione` (minuti stimati + fonte),
  `decisione`, `lezione`, da qualunque chat, con `node {{BRAIN}}/ops/tools/mem.mjs`; oppure quando lo dice {{OWNER}}.

## Regole

- Un file al giorno: `journal/AAAA-MM-GG.md`, titolo `# AAAA-MM-GG (giorno)`.
- Due aree: una riga è **lavoro** se non dice altro; le righe personali iniziano il testo con `[personale]`.
- **Solo append**, una riga per evento: `- HH:MM · tag · testo`.

## Com'è fatto un giorno

Il primo file nasce con la prima riga del giorno. Il report di fine giornata (`routines.md`) lo legge con le chat e i
commit del giorno. Un esempio inventato, per vedere la forma:

```
# 2026-01-15 (giovedì)
- 09:20 · fatto · PR "Correggi il login scaduto" aperta, test verdi, review senza rilievi
- 10:05 · interruzione · 20 min · chiamata non prevista sul rilascio · fonte: telefono
- 11:40 · decisione · il rilascio slitta a lunedì: manca il collaudo
- 15:10 · attrito · 15 min · ambiente di test giù, rifatto il login due volte · fonte: tool
- 17:30 · lezione · prima del rilascio rileggere le note di collaudo, non solo i test
- 18:00 · fatto · [personale] prenotata la visita
```
