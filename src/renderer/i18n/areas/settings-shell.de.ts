// German (de-AT) counterpart of the Settings page's frame (settings-shell.it.ts, ADR 0207).
import type { settingsShellIt } from './settings-shell.it';
export const settingsShellDe: typeof settingsShellIt = {
  'stx.nav.you': 'Du', 'stx.nav.work': 'Arbeit', 'stx.nav.tools': 'Werkzeuge', 'stx.nav.app': 'App',
  'stx.searchHint': 'Suchen', 'stx.lead': 'Jede Änderung wird sofort gespeichert.',
  'stx.results': (p: { n: number }) => (p.n === 1 ? '1 Bereich gefunden' : `${p.n} Bereiche gefunden`),
  'stx.rows': (p: { n: number }) => (p.n === 1 ? '1 Zeile' : `${p.n} Zeilen`),
  'stx.undo': 'Rückgängig', 'stx.undone': 'Rückgängig gemacht', 'stx.savedByAgent': 'Vom Orchestrator geändert',
  'stx.protected': 'Geschützt', 'stx.protectedTip': 'Ein Agent kann sie nur vorschlagen: Ändern kann sie dein Klick oder deine eigene Bitte an den Orchestrator.',
  'stx.themeHint': 'Hell, dunkel oder wie Windows.', 'stx.languageHint': 'Die Sprache der App; die Agenten antworten in deiner.',
  'stx.densityHint': 'Wie viel Abstand zwischen Zeilen und Bereichen.',
};
