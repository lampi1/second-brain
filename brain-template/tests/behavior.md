# Behaviour tests

One case per real correction by {{OWNER}}: the situation, what the agent must do, when it fails, the rule it tests
and its state (`nuovo` · `verde AAAA-MM-GG` · `rosso AAAA-MM-GG` · `ritirato`). Read when: before changing a rule, a
brain file, an agent or an output style. Write when: {{OWNER}} corrects a behaviour (`brain-rules.md` 5).

Template:

```
### B-NN · titolo breve
- **Situazione:** cosa succede.
- **Atteso:** cosa fa l'agente.
- **Fallisce se:** il comportamento sbagliato, osservabile.
- **Regola:** file e riga che lo rende vero.
- **Stato:** nuovo
```

## Casi

Vuoto il primo giorno: il primo caso nasce dalla prima correzione ("d'ora in poi...", "non fare più..."), scritto
dall'agente `brain-editor` insieme alla regola. "Testa il cervello" rilegge i casi e dice quali sono verdi.
