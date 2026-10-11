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
