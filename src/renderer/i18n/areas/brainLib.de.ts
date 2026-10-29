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


  // learn.ts
  'brainLib.learn.waiting': (p: { n: number }) => `wartet auf die ersten ${p.n} Fälle nach der Änderung`,
  'brainLib.learn.helpIntro': 'Hier prüft das Brain, wie weit seine gelernten Regeln danebenliegen (die Modellwahl, die Schwellen für Benachrichtigungen). Ab und zu rechnet es sie mit anderen Methoden auf vergangenen Chats neu: wenn eine klar weniger falsch liegt, entsteht ein Vorschlag. Nichts ändert sich, bis du ihn in Gedächtnis → Vorschläge freigibst; jede Änderung lässt sich mit Wiederherstellen rückgängig machen und wird nach 20 Chats von selbst geprüft.',
  'brainLib.learn.helpTypical': 'Wie weit die Schätzung bei der Hälfte der Chats von der Wahrheit abweicht: ×1,7 heißt, dass die Wahrheit in der Hälfte der Fälle zwischen Schätzung geteilt durch 1,7 und Schätzung mal 1,7 liegt. Je näher an ×1, desto besser.',
  'brainLib.learn.helpCover': 'Die Spanne «von … bis …» der Schätzung soll den echten Wert in 8 von 10 Fällen enthalten. Hier siehst du, wie oft sie das bei den letzten Chats wirklich getan hat.',
  'brainLib.learn.helpOut': 'Chats, bei denen unbekannt ist, wie sie ausgingen, oder die zu alt sind für eine vorher gemachte Schätzung: sie fließen nicht in die Zahlen ein, werden hier aber mitgezählt.',
  'brainLib.learn.helpNoData': (p: { min: number }) => `Um etwas zu sagen, braucht es mindestens ${p.min} Chats mit bekanntem Ergebnis: mit weniger wären die Zahlen nur Rauschen.`,
  'brainLib.learn.helpProposal': 'Das Brain hat die Berechnung auf denselben vergangenen Chats (mindestens 30) mit der aktuellen und der neuen Methode wiederholt. Es schlägt die neue nur vor, wenn sie klar weniger falsch liegt, nicht zufällig: auch am schlechtesten Ende der Spanne („zwischen … und …“) bleibt sie besser, und nichts anderes wird schlechter.',
  'brainLib.learn.helpCheck': 'Nach einer Änderung vergleicht es auf den 20 folgenden Chats die neue Methode mit der vorigen. Ist die neue schlechter, schlägt es vor, zurückzugehen: von selbst macht es das nie.',
  'brainLib.learn.helpRollback': 'Mit einem Klick zur vorigen Version zurück. Keine Daten gehen verloren, und du kannst den Vorschlag jederzeit wieder anwenden.',
  'brainLib.learn.helpDrift': 'Die letzten 20 Chats liegen 1,5-mal mehr daneben als die 60 davor: die Art der Arbeit hat sich geändert und die Schätzungen müssen neu kalibriert werden.',
  'brainLib.learn.policyEstimates': 'Zeit- und Kostenschätzungen',
  'brainLib.learn.policyRouting': 'Modellwahl',
  'brainLib.learn.policyNotifications': 'Schwellen für Benachrichtigungen',
  'brainLib.learn.errorLineNoData': (p: { n: number; min: number }) => `keine Daten: ${p.n} gemessen, ${p.min} nötig`,
  'brainLib.learn.errorLineUnmeasured': 'Fehler nicht gemessen',
  'brainLib.learn.errorLineMeasured': (p: { factor: string; count: number }) => `typischer Fehler ${p.factor} bei den letzten ${p.count}`,
  'brainLib.learn.coverageLine': (p: { rate: string; n: number }) => `die 80-%-Spanne enthielt den echten Wert in ${p.rate} der Fälle (bei ${p.n})`,
  'brainLib.learn.gainLineNoShared': 'Messung nicht verfügbar',
  'brainLib.learn.gainLineWithShared': (p: { shared: number }) => `bei ${p.shared} gemeinsamen Fällen`,
  'brainLib.learn.gainLineBetter': (p: { pct: number; lo: number; hi: number; shared?: number }) => `${p.pct} % kleinerer Fehler (zwischen ${p.lo} % und ${p.hi} %)${p.shared ? `, bei ${p.shared} gemeinsamen Fällen` : ''}`,
  'brainLib.learn.gainLineWorse': (p: { pct: number; lo: number; hi: number; shared?: number }) => `${p.pct} % größerer Fehler (zwischen ${p.lo} % und ${p.hi} %)${p.shared ? `, bei ${p.shared} gemeinsamen Fällen` : ''}`,
  'brainLib.learn.checkLineWaiting': (p: { n: number; need: number }) => `wartet: ${p.n} Fälle nach der Änderung von ${p.need} nötigen`,
  'brainLib.learn.checkLineFailed': (p: { n?: number }) => `verschlechtert${p.n ? ` (bei ${p.n} Fällen)` : ''}: es gibt einen Vorschlag zum Zurücksetzen`,
  'brainLib.learn.checkLineOther': (p: { state: string; n?: number }) => `${p.state}${p.n ? ` (bei ${p.n} Fällen)` : ''}`,

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
