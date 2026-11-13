// Italian texts of Settings → Avanzate «Coda e avvii» (ADR 0222): the cold-start slots and the emergency brake.
// The source: the other languages are typed by it.
export const queueSettingsIt = {
  'queueSt.title': 'Coda e avvii',
  'queueSt.lead': 'Le chat nuove aperte da agenti partono poche alla volta; le altre aspettano in coda. Una chat già avviata e i tuoi messaggi non aspettano mai.',
  'queueSt.slots': 'Avvii a freddo insieme',
  'queueSt.slotsHint': (p: { cores: number; auto: number }) => `Questo PC ha ${p.cores} core: in automatico partono ${p.auto} chat alla volta.`,
  'queueSt.slotsAuto': (p: { auto: number }) => `Automatico (${p.auto})`,
  'queueSt.cpu': 'Freno d’emergenza: CPU oltre',
  'queueSt.cpuHint': 'Sopra questa CPU (media degli ultimi secondi) anche gli avvii in coda aspettano.',
  'queueSt.ram': 'Freno d’emergenza: RAM libera sotto',
  'queueSt.ramHint': 'Sotto questa memoria libera anche gli avvii in coda aspettano.',
  'queueSt.ramOff': 'Non guardare la RAM',
  'queueSt.pct': (p: { n: number }) => `${p.n}%`,
};
