# Playbooks

One notebook per specialist agent (`<agent>.md`), created and changed only by `ops/tools/playbook.mjs`: numbered
points, each with its source (an `ai-errors.md`/`ai-wins.md` line or {{OWNER}}'s words) and helpful/harmful votes.
A point enters only after {{OWNER}}'s yes (`playbook.mjs propose` → `accept`). Read only by that specialist at its start.

## Il primo giorno

Nessun taccuino: il primo nasce quando un errore di uno specialista (riga in `ai-errors.md`) o una tua lode
(`ai-wins.md`) diventa un consiglio per la volta dopo. Il giro, sempre lo stesso:

1. una chat propone il punto: `node ops/tools/playbook.mjs propose reviewer --text "<consiglio>" --source "<riga di ai-errors.md o le tue parole>"`;
2. l'Orchestrator te lo chiede in un pannello; al tuo sì: `playbook.mjs accept reviewer <id>`;
3. ogni volta che lo specialista usa il punto, la chat che l'ha lanciato lo vota (`vote ... helpful|harmful`);
4. in manutenzione, `playbook.mjs list` mostra i punti con più voti contrari che a favore: tornano a te.

Specialisti con un taccuino: `reviewer`, `code-investigator`, `brain-editor`, `flow-optimizer`. Un punto è al
massimo 300 caratteri, un taccuino al massimo 2500: costringe a tenere solo ciò che serve.
