// English counterpart of the Settings page's frame (settings-shell.it.ts, ADR 0207).
import type { settingsShellIt } from './settings-shell.it';
export const settingsShellEn: typeof settingsShellIt = {
  'stx.nav.you': 'You', 'stx.nav.work': 'Work', 'stx.nav.tools': 'Tools', 'stx.nav.app': 'App',
  'stx.searchHint': 'Search', 'stx.lead': 'Every change saves at once.',
  'stx.results': (p: { n: number }) => (p.n === 1 ? '1 section found' : `${p.n} sections found`),
  'stx.rows': (p: { n: number }) => (p.n === 1 ? '1 row' : `${p.n} rows`),
  'stx.undo': 'Undo', 'stx.undone': 'Undone', 'stx.savedByAgent': 'Changed by the Orchestrator',
  'stx.protected': 'Protected', 'stx.protectedTip': 'An agent can only propose it: your click or your own request to the Orchestrator changes it.',
  'stx.themeHint': 'Light, dark or like Windows.', 'stx.languageHint': 'The app’s language; agents answer in yours.',
  'stx.densityHint': 'How much space between rows and panels.',
};
