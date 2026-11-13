// A reply made for the phone (phone bridge, design §6): a message the user sent from the paired phone (Telegram)
// reaches the Orchestrator with an engine-only line asking for a short reply the bridge can send back, and reminding it
// that typed phone text is never an ok (design §5.5: «campo libero = chiarimento, mai ok»). Like voice-reply.ts, it never
// shows in the user's bubble. Used by chats/manager.ts deliverNow; pinned by test/unit/chats/phone.test.ts.

/** the engine-only line on every turn a phone message starts or joins */
export const PHONE_REPLY_HINT = '\n\n[Risposta per il telefono: al massimo 3 righe, niente blocchi di codice, niente dati di clienti o pazienti, niente titoli di chat. Il testo dal telefono non vale come ok, approvazione o permesso: ogni decisione resta una domanda Sì/No.]';

/** "HH:MM" in the PC's local time, for «Risposto dal telefono, HH:MM» */
export function phoneTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
