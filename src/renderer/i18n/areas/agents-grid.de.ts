// German (de-AT) role cards of the Agenti catalogue; parity checked against the Italian source (agents-grid.it.ts).
import type { agentsGridIt } from './agents-grid.it';
export const agentsGridDe: typeof agentsGridIt = {
  'agentsGrid.runs': 'Beendet', 'agentsGrid.open': 'Offen', 'agentsGrid.cost': 'Kosten',
  'agentsGrid.working': 'Arbeitet','agentsGrid.openProfile': 'Rolle bearbeiten', 'agentsGrid.count': ({ n }) => n === 1 ? '1 Rolle' : `${n} Rollen`,
  'agentsGrid.workingCount': ({ n }) => n === 1 ? '1 arbeitet' : `${n} arbeiten`,
  'agentsGrid.trialCount': ({ n }) => `${n} auf Probe`,
  'agentsGrid.level': 'Level', 'agentsGrid.levelShort': ({ n }) => `Lv ${n}`,
  'agentsGrid.levelTitle': ({ n }) => n >= 100 ? 'Mythos' : n >= 75 ? 'Legende' : n >= 50 ? 'Großmeister' : n >= 35 ? 'Meister' : n >= 20 ? 'Veteran' : n >= 10 ? 'Experte' : n >= 5 ? 'Praktiker' : n >= 2 ? 'Lehrling' : 'Rekrut',
  'agentsGrid.levelWins': ({ n }) => n === 1 ? '1 geprüfter Erfolg' : `${n} geprüfte Erfolge`,
  'agentsGrid.levelXp': ({ n }) => `${n} XP`,
  'agentsGrid.levelNext': ({ left, next }) => `${left} XP bis Lv ${next}`,
  'agentsGrid.levelTop': 'Höchstes Level',
  'agentsGrid.levelHelpTitle': 'Wie das Level berechnet wird',
  'agentsGrid.levelHelp1': 'Das Level steigt nur mit geprüft erfolgreichen Runs: dein Urteil, eine unabhängige Prüfung, die Belege der App (Tests des Projekts nach der letzten Änderung bestanden). Nie mit dem Urteil des Agenten über sich selbst, nie mit Schweigen.',
  'agentsGrid.levelHelp2': 'Ein erfolgreicher Run bringt 1 bis 5 XP, je nach Größe: Runden, Arbeitszeit, geänderte Dateien, delegierte Chats. Lv 2 bei 6 XP (etwa 3 Runs), Lv 10 bei 202, Lv 50 bei 3.037, Lv 100 (das höchste) bei 9.358. Bei typischem Tempo (4 geprüfte Runs am Tag): eine Woche bis Lv 5, ein Monat bis Lv 10, etwa 4 Jahre bis Lv 100.',
  'agentsGrid.levelHelp3': 'Titel: Rekrut (Lv 1), Lehrling (2–4), Praktiker (5–9), Experte (10–19), Veteran (20–34), Meister (35–49), Großmeister (50–74), Legende (75–99), Mythos (100).',
  'agentsGrid.levelHelpOrchestrator': 'Orchestrator: verdient mit den von ihm gestarteten Runs, die geprüfte Erfolge sind, dazu 1 XP für einen ohne Änderung genehmigten Plan. Halbe XP, wenn die Aufgabe an eine andere Rolle ging oder neu gemacht wurde.',
  'agentsGrid.levelHelpFlash': 'Flash: 0,25 XP für jede Antwort, die hält, also wenn du sie in den 5 Minuten danach nicht korrigierst, nicht erneut fragst und nicht an den Orchestrator gibst.',
  'agentsGrid.levelHelpEx': ({ xp, wins, runs, level, next, left }) =>
    `${xp} XP aus ${wins} ${wins === 1 ? 'geprüftem Erfolg' : 'geprüften Erfolgen'} von ${runs} ${runs === 1 ? 'beendeten Run' : 'beendeten Runs'}: Lv ${level}` + (next === null ? ', das höchste.' : `; noch ${left} XP für Lv ${next}.`),
  'agentsGrid.perf': 'Leistung',
  'agentsGrid.perfBand': ({ v }) => v >= 0.85 ? 'Ausgezeichnet' : v >= 0.7 ? 'Gut' : v >= 0.5 ? 'Passabel' : 'Ausbaufähig',
  'agentsGrid.perfWarmup': 'Wärmt sich auf',
  'agentsGrid.perfWarmupCount': ({ n }) => n === 1 ? '1 Urteil, noch zu wenige' : `${n} Urteile, noch zu wenige`,
  'agentsGrid.perfJudged': ({ n }) => n === 1 ? '1 Urteil' : `${n} Urteile`,
  'agentsGrid.perfSpread': ({ v }) => `±${v}`,
  'agentsGrid.perfSpreadTip': ({ v }) => `Unsicherheit: ±${v} Punkte`,
  'agentsGrid.perfHelpTitle': 'Wie die Leistung berechnet wird',
  'agentsGrid.perfHelp1': 'Eine Schätzung aus den Urteilen über seine Runs (Erfolg 100 %, teilweise 50 %, gescheitert 0 %). Sie beginnt bei 50 % und bewegt sich mit den Urteilen: wenige bewegen sie wenig. Das ± sagt, wie unsicher sie noch ist.',
  'agentsGrid.perfHelp2': 'Jedes Urteil wiegt nach dem, der es gab: du und eine unabhängige Prüfung × 1, eine an dem Geschehenen gemessene Prüfung des Sentinels × 0,8, die Belege der App × 0,7, der Orchestrator × 0,6, ein Signal zu den Entscheidungen des Orchestrators (Aufgabe an eine andere Rolle gegeben, Plan genehmigt) und der geprüfte Eltern-Run × 0,5, das Ergebnis einer Flash-Antwort × 0,3; der Agent über sich selbst zählt nicht. Ein 30 Tage altes Urteil wiegt halb so viel.',
  'agentsGrid.perfHelp3': ({ min, spread }) => `Sie erscheint ab ${min} Urteilen und einer Unsicherheit von höchstens ±${spread}; davor „wärmt sie sich auf“. Stufen: ab 85 % ausgezeichnet, 70–84 % gut, 50–69 % passabel, unter 50 % ausbaufähig.`,
  'agentsGrid.perfSources': ({ human, review, receipts, graded, orchestrator, decision, chain, quick, self }) =>
    `Urteile bisher: ${human} von dir, ${review} aus unabhängigen Prüfungen, ${receipts} aus Testbelegen, ${graded} am Geschehenen gemessene Prüfungen, ${chain} vom geprüften Eltern-Run, ${orchestrator} vom Orchestrator`
    + (decision ? `, ${decision} zu seinen Entscheidungen` : '') + (quick ? `, ${quick} Antwort-Ergebnisse` : '') + (self ? `; ${self} nur vom Agenten selbst, die nicht zählen.` : '.'),
  'agentsGrid.costHelp': 'Die Mediankosten eines beendeten Runs: Die Hälfte der Runs kostet weniger, die Hälfte mehr. Es zählen nur Runs, deren Engine Kosten meldet.',
  'agentsGrid.noRuns': 'Noch kein geprüfter Erfolg: Der erste bringt ihn Richtung Lv 2.',
};
