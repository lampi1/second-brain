---
name: explain
description: Spiega a {{OWNER}} un argomento a domande, un pezzo per volta con un pannello "chiaro?" dopo ognuno. Use when {{OWNER}} says "/explain <argomento>", "spiegamelo a domande", "spiegami bene", or says he did not understand something (un piano, la risposta di un collega, una procedura, un concetto); always when explaining a plan to him. Not for a bug or technical analysis, «non ho capito» included (fixed-heading text, style owner.md) unless he says "spiegamelo a domande".
---

# Explain: spiegare a domande

Il modo che gli ha fatto capire l'IVA delle note di credito e che vuole sempre per i piani. Questa skill è l'unica
copia del metodo: lo stile `owner.md` punta solo qui.

## Prima di cominciare

1. Argomento: quello dopo `/explain`, o l'ultima cosa che non ha capito. Se non è chiaro di cosa parla, chiedilo con
   un pannello (2-3 argomenti probabili), non indovinare: una volta è stata spiegata la PR sbagliata.
2. Leggi adesso le fonti (piano, bug, messaggio del collega, codice, `now.md`). Ogni fatto viene da lì o porta
   "(da verificare)"; quello che non si sa lo dici ("non lo so ancora: serve X"), mai inventato.
3. Prepara 3-6 pezzi numerati, dal contesto al dettaglio, un'idea ciascuno: "1. Cos'è…", "2. Chi decide…",
   "3. Cosa cambia per te…". Non mostrarli tutti: il titolo del prossimo compare solo nel pannello.

## Un pezzo per turno

- In chat, mai un artifact lungo. Italiano, parole semplici: niente gergo, id, percorsi o nomi di classe (un termine
  necessario si spiega in 5 parole).
- Titolo `**N. …**`, poi 2-6 righe brevi, il punto chiave in **grassetto**; un esempio concreto o un'analogia di tutti
  i giorni prima di ogni regola o formula, mai la formula per prima né una formula spiegata con un'altra.
- Numeri (contabilità soprattutto) come proporzione a parole: "se 122 € contengono 100 € di prestazione, quanto ne
  contengono 50?". Se il calcolo non deve farlo lui, diglielo: "non devi farlo tu".
- Poi un pannello AskUserQuestion "Il pezzo N ti è chiaro?": "Chiaro, vai avanti" (descrizione: di cosa parla il
  pezzo dopo) e "Rispiegamelo diverso" (descrizione: con un esempio o da un altro lato).
- "Rispiegamelo": stesso pezzo, altro esempio o analogia, più corto; non passare oltre.
- Se risponde con una domanda o un dubbio: riparti da quello, breve, poi riprendi dal pezzo dove eri.
- Ultimo pezzo: chiudi con la regola in una frase ("In breve: …").
- Solo se lo chiede ("fammi delle domande", "verifica se ho capito"): quiz di 3-4 domande brevi a risposta multipla in
  un pannello; se sbaglia, riprendi solo quel pezzo.
- Un testo da mandare a qualcuno (mail, Teams, commento) va nel blocco di codice col copia (`owner.md`).

## Chat di lavoro

Le domande le fai qui, nella tua chat (il pezzo, "chiaro?" e le due opzioni): l'app le mostra in popup o in coda;
mai alla Regia (13/10, `me.md`).
