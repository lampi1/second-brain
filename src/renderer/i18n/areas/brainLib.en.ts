// English UI texts of the "brainLib" area (ADR 0057): the same keys as brainLib.it.ts (typed by it), spread into en.ts.
import type { brainLibIt } from './brainLib.it';

export const brainLibEn: typeof brainLibIt = {
  // Charts.tsx
  'brainLib.charts.dataToggle': 'Data',
  'brainLib.charts.dataToggleTitle': 'Show numbers as a table',
  'brainLib.charts.csvDownloadTitle': 'Download chart numbers as CSV',
  'brainLib.charts.voiceLabel': 'Item',
  'brainLib.charts.valueLabel': 'value',
  'brainLib.charts.csvVoiceHeader': 'item',
  'brainLib.charts.noData': 'No data.',
  'brainLib.charts.nValuesMax': (p: { n: number; max: string; values: string }) => `${p.n} values; highest ${p.max}: ${p.values}`,
  'brainLib.charts.nBarsRange': (p: { n: number; from: string; to: string }) => `${p.n} bars; from ${p.from} to ${p.to}.`,
  'brainLib.charts.firstLabel': (p: { n: number; first: string; value: string }) => `${p.n} items; first: ${p.first}, ${p.value}.`,

  // record-discuss.ts
  'brainLib.recordDiscuss.untitled': 'untitled',

  // stats.ts
  'brainLib.stats.trendStable': 'stable',
  'brainLib.stats.trendUp': 'increasing',
  'brainLib.stats.trendDown': 'declining',
  'brainLib.stats.trendNoData': (p: { value: string; before: string }) => `${p.value}; ${p.before} no data to compare`,
  'brainLib.stats.trendWithData': (p: { word: string; cur: string; prev: string }) => `${p.word}: ${p.cur} versus ${p.prev}`,
  // Markdown.tsx
  'brainLib.markdown.copyBlock': 'Copy',
  'brainLib.markdown.copyBlockTitle': 'Copy the block to the clipboard',
  'brainLib.markdown.blockCopied': 'Copied',
  'brainLib.markdown.blockCopiedToast': 'Block copied',
  'brainLib.markdown.copyFailed': 'Copy failed',
};
