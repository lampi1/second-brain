// Italian texts of the restyled shell (ADR 0366, issue #491): the Grindhouse sections and the ⓘ of a strip
// (GrindStrip.tsx), the version chip of the top bar (VersionChip.tsx). The source: the other languages are typed by it.
export const grindIt = {
  'grind.sec.wait': 'Ti aspetta',
  'grind.sec.work': 'Al lavoro',
  'grind.sec.done': 'Finite oggi',
  'grind.info': 'Dettagli: modello, stima, skill',
  'grind.est': (p: { est: string }) => `stima ${p.est}`,
  'grind.skills': (p: { list: string }) => `skill: ${p.list}`,
  'grind.skillsLoaded': (p: { list: string }) => `skill caricate (uso non tracciato): ${p.list}`,
  'grind.where': (p: { where: string }) => `progetto: ${p.where}`,
  'grind.subs': (p: { n: number }) => p.n === 1 ? '1 sottoagente al lavoro' : `${p.n} sottoagenti al lavoro`,
  'grind.helpers': (p: { n: number }) => p.n === 1 ? '1 aiutante' : `${p.n} aiutanti`,
  'grind.helpersTip': 'Mostra o nascondi le chat che ha delegato',
  'version.updated': 'Aggiornata a',
  'version.news': 'Novità',
  'version.newsTip': 'Cosa c’è di nuovo: apre Impostazioni → Aggiornamenti',
  'version.new': 'Versione nuova',
  'version.update': 'Aggiorna',
  'version.newTip': (p: { subject: string }) => `Su GitHub c’è una versione nuova: ${p.subject}`,
  'version.dismiss': 'Chiudi l’avviso della versione',
};
