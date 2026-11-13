# Successi dell'IA: il registro dei feedback positivi

Il gemello di `ai-errors.md` per quello che è andato bene. **Lo scrivono solo gli hook, mai il modello**: quando un
messaggio di {{OWNER}} è una lode esplicita, l'hook aggiunge una riga da solo, zero token (regex `positiveKind` in
`ops/tools/signals-regex.mjs`, scrittura in `ops/tools/feedback-log.mjs`). Storico permanente.

- **Read when:** una revisione, insieme a `ai-errors.md`; riepilogo `node ops/tools/feedback-stats.mjs` (su richiesta).
- **Write when:** mai a mano.

Formato: `- AAAA-MM-GG HH:MM · harness · chat · area · tipo · parole: "le prime 15 parole" · consegnato: prima riga dell'ultima risposta`
