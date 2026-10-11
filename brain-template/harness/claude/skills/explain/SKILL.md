---
name: explain
description: Spiega a {{OWNER}} un argomento a domande, un pezzo per volta con un pannello "chiaro?" dopo ognuno. Use when {{OWNER}} says "/explain <argomento>", "spiegamelo a domande", "spiegami bene", or says he did not understand something (un piano, un bug, la risposta di un collega, una procedura, un concetto); always when explaining a plan to him.
---

# Explain: spiegare a domande

Il modo che funziona meglio per spiegare, e quello da usare sempre per i piani. Le regole di forma restano in
`~/.claude/output-styles/owner.md` "Spiegare un concetto": qui solo il metodo passo per passo, senza ripeterle.

## Prima di cominciare

1. Argomento: quello dopo `/explain`, o l'ultima cosa che non ha capito. Se non è chiaro di cosa parla, chiedilo con
   un pannello (2-3 argomenti probabili), non indovinare.
2. Leggi adesso le fonti (piano, bug, messaggio del collega, codice, `now.md`). Ogni fatto viene da lì o porta
   "(da verificare)"; quello che non si sa lo dici ("non lo so ancora: serve X"), mai inventato.
3. Prepara 3-6 pezzi numerati, dal contesto al dettaglio, un'idea ciascuno: "1. Cos'è…", "2. Chi decide…",
   "3. Cosa cambia per te…". Non mostrarli tutti: il titolo del prossimo compare solo nel pannello.

## Un pezzo per turno

- Italiano, parole semplici: niente gergo, id, percorsi o nomi di classe (un termine necessario si spiega in 5 parole).
- Titolo `**N. …**`, poi 2-6 righe brevi, il punto chiave in **grassetto**; un esempio concreto prima di ogni regola
  o formula.
- Poi un pannello AskUserQuestion "Il pezzo N ti è chiaro?": "Chiaro, vai avanti" (descrizione: di cosa parla il
  pezzo dopo) e "Rispiegamelo diverso" (descrizione: con un esempio o da un altro lato).
- "Rispiegamelo": stesso pezzo, altro esempio o analogia, più corto; non passare oltre.
- Se risponde con una domanda: rispondi prima a quella, breve, poi riprendi dal pezzo dove eri.
- Ultimo pezzo: chiudi con una riga di riassunto di tutto ("In breve: …").
- Un testo da mandare a qualcuno (mail, Teams, commento) va nel blocco di codice col copia (`owner.md`).

## Chat di lavoro

Come `{{BRAIN_WIN}}\me.md`: chiedi tramite la Regia (il pezzo, "chiaro?" e le due opzioni), salvo
che {{OWNER}} scriva in questa chat (focus); su Cursor la domanda resta qui.
