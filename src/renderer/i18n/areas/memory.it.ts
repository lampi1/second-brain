// Italian UI texts of the "Manutenzione" button and its report (MaintenanceButton.tsx, MemoryPage.tsx); the Memoria
// statistics left with the Statistiche tab (ADR 0248). Spread into it.ts; memory.en.ts has the same keys (typed by this
// object).
type N = { n: number };
export const memoryIt = {
  // the maintenance button
  'mm.maint.button': 'Manutenzione', 'mm.maint.running': 'Manutenzione in corso…',
  'mm.maint.helpTitle': 'Cosa fa la manutenzione',
  'mm.maint.help1': 'Un clic e basta: l’app mette in ordine skill, regole e memoria, legge i suoi log e un agente invisibile studia la tua storia per proporre miglioramenti. Lavora in background: puoi continuare a fare altro.',
  'mm.maint.help2': 'Tutto arriva come card in Memoria → Proposte: skill nuove, cosa dimenticare, e le issue da aprire su GitHub (con il tuo sì si aprono subito). Le idee sull’app finiscono anche in Idee, dal lato IA. Niente cambia senza il tuo sì.',
  'mm.maint.help3': 'Succede solo quando la premi tu: idee, proposte e pulizia della memoria non partono mai da sole. La ricerca usa token, al massimo 5 $ per volta; quando finisce ti avviso.',
  'mm.one.tip': 'Manutenzione: un clic, poi lavora da sola in background',
  'mm.one.tipCleanup': 'Sto mettendo in ordine skill, regole e memoria…',
  'mm.one.tipResearch': (p: { cost: string; cap: string }) => `Un agente sta cercando miglioramenti: speso ${p.cost} su ${p.cap}. Ti avviso quando finisce.`,
  'mm.one.liveResearch': (p: { cost: string; cap: string; n: number }) => `Al lavoro in background · ${p.n === 1 ? '1 card' : `${p.n} card`} finora · ${p.cost} su ${p.cap}`,
  'mm.one.started': 'Manutenzione avviata: lavora in background, ti avviso quando ha finito.',
  'mm.one.stop': 'Ferma',
  'mm.one.last': (p: { at: string; what: string }) => `Ultima: ${p.at} · ${p.what}`,
  'mm.done.proposals': (p: N) => (p.n === 1 ? '1 proposta' : `${p.n} proposte`),
  'mm.done.ideas': (p: N) => (p.n === 1 ? '1 idea' : `${p.n} idee`),
  'mm.done.issues': (p: N) => (p.n === 1 ? '1 issue da aprire' : `${p.n} issue da aprire`),
  'mm.done.made': (p: { what: string }) => `Manutenzione finita: ${p.what}`,
  'mm.done.nothing': 'Manutenzione finita: era già tutto in ordine.',
  'mm.done.failed': 'Manutenzione finita, ma la ricerca non è riuscita',
  'mm.done.stopped': 'Manutenzione fermata prima della fine',
  'mm.done.capped': 'Manutenzione finita al tetto di spesa',
  'mm.done.label': 'Manutenzione finita', 'mm.done.title': 'Il tuo brain è in ordine',
  'mm.done.open': 'Apri Memoria',

  // shared bits
  
  
  

  // key numbers
  
  
  
  
  
  

  // Lo sapevi?
  
  
  
  
  
  
  
  
  
  
  
  

  // charts
  
  
  
  
  
  
  
  
  

  // cards and page
  
  
  
  
  // how well the launch memory finds the right fact (ADR 0235, RecallCheckCard in MemoryInsights.tsx)
  
  
  // the one-click maintenance (ADR 0132, 0153)
};
