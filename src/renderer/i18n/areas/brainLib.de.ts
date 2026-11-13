// German (de-AT) UI texts of the "brainLib" area (ADR 0057): the same keys as brainLib.it.ts (typed by it), spread into de.ts.
import type { brainLibIt } from './brainLib.it';

export const brainLibDe: typeof brainLibIt = {
  // Charts.tsx
  'brainLib.charts.dataToggle': 'Daten',
  'brainLib.charts.dataToggleTitle': 'Zahlen als Tabelle anzeigen',
  'brainLib.charts.csvDownloadTitle': 'Zahlen des Diagramms als CSV herunterladen',
  'brainLib.charts.voiceLabel': 'Eintrag',
  'brainLib.charts.valueLabel': 'Wert',
  'brainLib.charts.csvVoiceHeader': 'Eintrag',
  'brainLib.charts.noData': 'Keine Daten.',
  'brainLib.charts.nValuesMax': (p: { n: number; max: string; values: string }) => `${p.n} Werte; höchster ${p.max}: ${p.values}`,
  'brainLib.charts.nBarsRange': (p: { n: number; from: string; to: string }) => `${p.n} Balken; von ${p.from} bis ${p.to}.`,
  'brainLib.charts.firstLabel': (p: { n: number; first: string; value: string }) => `${p.n} Einträge; erster: ${p.first}, ${p.value}.`,

  // record-discuss.ts
  'brainLib.recordDiscuss.untitled': 'ohne Titel',

  // stats.ts
  'brainLib.stats.trendStable': 'stabil',
  'brainLib.stats.trendUp': 'steigend',
  'brainLib.stats.trendDown': 'sinkend',
  'brainLib.stats.trendNoData': (p: { value: string; before: string }) => `${p.value}; ${p.before} keine Daten zum Vergleichen`,
  'brainLib.stats.trendWithData': (p: { word: string; cur: string; prev: string }) => `${p.word}: ${p.cur} gegenüber ${p.prev}`,
  // Markdown.tsx
  'brainLib.markdown.copyBlock': 'Kopieren',
  'brainLib.markdown.copyBlockTitle': 'Block in die Zwischenablage kopieren',
  'brainLib.markdown.blockCopied': 'Kopiert',
  'brainLib.markdown.blockCopiedToast': 'Block kopiert',
  'brainLib.markdown.copyFailed': 'Kopieren fehlgeschlagen',
};
