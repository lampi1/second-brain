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

  // learn.ts
  'brainLib.learn.waiting': (p: { n: number }) => `waiting for the first ${p.n} cases after the change`,
  'brainLib.learn.helpIntro': 'Here the brain checks how far off its learned rules are (the model choice, the notification thresholds). Now and then it redoes them on past chats with other methods: when one is clearly less wrong, a proposal is born. Nothing changes until you approve it in Memory → Proposals; every change is undone with Restore and checked by itself after 20 chats.',
  'brainLib.learn.helpTypical': 'By how much the estimate is off from the truth, in the middle of chats: ×1.7 means that half the time the truth is between the estimate divided by 1.7 and the estimate times 1.7. Closer to ×1 is better.',
  'brainLib.learn.helpCover': 'The range «from … to …» of the estimate is built to contain the real value 8 out of 10 times. Here you see how many times it actually did on the last chats.',
  'brainLib.learn.helpOut': 'Chats you do not know how they ended, or too old to have an estimate made before: they do not enter the numbers, but remain counted here.',
  'brainLib.learn.helpNoData': (p: { min: number }) => `To say anything, we need at least ${p.min} chats with the result known: with less, the numbers would be noise.`,
  'brainLib.learn.helpProposal': 'The brain redid the computation on the same past chats (at least 30) with the method in use and the new one. It proposes the new one only when it is clearly less wrong, not by chance: even at the worst end of the margin ("between … and …") it stays better, and nothing else gets worse.',
  'brainLib.learn.helpCheck': 'After a change, on the 20 chats that follow it compares the new method with the one before. If the new is worse, it proposes to revert: it never does it by itself.',
  'brainLib.learn.helpRollback': 'Return to the previous version with one click. No data is lost and you can re-apply the proposal whenever you like.',
  'brainLib.learn.helpDrift': 'The last 20 chats are 1.5× more wrong than the 60 before: the kind of work has changed and estimates need to be recalibrated.',
  'brainLib.learn.policyEstimates': 'Time and cost estimates',
  'brainLib.learn.policyRouting': 'Model selection',
  'brainLib.learn.policyNotifications': 'Notification thresholds',
  'brainLib.learn.errorLineNoData': (p: { n: number; min: number }) => `no data: ${p.n} ${p.n === 1 ? 'measured' : 'measured'}, need ${p.min}`,
  'brainLib.learn.errorLineUnmeasured': 'error not measured',
  'brainLib.learn.errorLineMeasured': (p: { factor: string; count: number }) => `typical error ${p.factor} on the last ${p.count}`,
  'brainLib.learn.coverageLine': (p: { rate: string; n: number }) => `the 80% range contained the real value ${p.rate} of the time (on ${p.n})`,
  'brainLib.learn.gainLineNoShared': 'measure not available',
  'brainLib.learn.gainLineWithShared': (p: { shared: number }) => `on ${p.shared} items in common`,
  'brainLib.learn.gainLineBetter': (p: { pct: number; lo: number; hi: number; shared?: number }) => `${p.pct}% smaller error (between ${p.lo}% and ${p.hi}%)${p.shared ? `, on ${p.shared} items in common` : ''}`,
  'brainLib.learn.gainLineWorse': (p: { pct: number; lo: number; hi: number; shared?: number }) => `${p.pct}% larger error (between ${p.lo}% and ${p.hi}%)${p.shared ? `, on ${p.shared} items in common` : ''}`,
  'brainLib.learn.checkLineWaiting': (p: { n: number; need: number }) => `waiting: ${p.n} cases after the change out of ${p.need} needed`,
  'brainLib.learn.checkLineFailed': (p: { n?: number }) => `worsened${p.n ? ` (on ${p.n} cases)` : ''}: there is a revert proposal`,
  'brainLib.learn.checkLineOther': (p: { state: string; n?: number }) => `${p.state}${p.n ? ` (on ${p.n} cases)` : ''}`,

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
