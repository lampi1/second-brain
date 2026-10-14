# Errori dell'IA: il registro

Ogni errore di un agente o di una chat, una riga, per analizzarli nel dettaglio: bug non trovati, test dati per
passati a torto, fatti inventati. **Storico permanente**: non si sfoltisce e non si riassume; una riga sbagliata si
corregge, non si toglie.

- **Read when:** `flow-optimizer` o una revisione (per primo); "che errori fa l'IA?".
- **Write when:** {{OWNER}} corregge un agente, un reviewer dimostra falsa un'affermazione, o l'agente scopre di aver
  sbagliato. Scrive **subito la chat che lo riceve**, con
  `node {{BRAIN}}/ops/tools/mem.mjs error --text "<riga>"`. Mai segreti o dati di terzi.
- **Seconda volta = proposta di regola**: stesso tipo e stessa area già nel registro → proposta alla Regia
  (`brain-rules.md`). La regola è servita? `node ops/tools/recurrence.mjs`.

Vuoto il primo giorno. La pagina Qualità dell'app legge da qui quante volte hai dovuto correggere l'IA e se le
regole nate da un errore lo hanno fermato davvero.

Formato: `- AAAA-MM-GG HH:MM · chat/agente · area · tipo · detto: … · vero: … · visto da: chi e come [· regola: quella nata]`
