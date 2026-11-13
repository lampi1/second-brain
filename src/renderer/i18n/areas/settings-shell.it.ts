// The Settings page's frame (ADR 0207): the left navigation's groups, the search, the quiet «Salvato · Annulla», the
// shield of protected settings and the one-line descriptions of the appearance rows. Used by SettingsPage.tsx and
// SettingsSaved.tsx.
export const settingsShellIt = {
  'stx.nav.you': 'Tu', 'stx.nav.work': 'Lavoro', 'stx.nav.tools': 'Strumenti', 'stx.nav.app': 'App',
  'stx.searchHint': 'Cerca', 'stx.lead': 'Ogni modifica si salva subito.',
  'stx.results': (p: { n: number }) => (p.n === 1 ? '1 sezione trovata' : `${p.n} sezioni trovate`),
  'stx.rows': (p: { n: number }) => (p.n === 1 ? '1 riga' : `${p.n} righe`),
  'stx.undo': 'Annulla', 'stx.undone': 'Annullato', 'stx.savedByAgent': 'Modificato dall’Orchestrator',
  'stx.protected': 'Protetta', 'stx.protectedTip': 'Un agente può solo proporla: la cambia un tuo clic o una tua richiesta all’Orchestrator.',
  'stx.themeHint': 'Chiaro, scuro o come Windows.', 'stx.languageHint': 'La lingua dell’app; gli agenti ti rispondono nella tua.',
  'stx.densityHint': 'Quanto spazio tra righe e pannelli.',
};
