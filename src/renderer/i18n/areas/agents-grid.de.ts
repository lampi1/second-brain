// German (de-AT) role cards of the Agenti catalogue; parity checked against the Italian source (agents-grid.it.ts).
import type { agentsGridIt } from './agents-grid.it';
export const agentsGridDe: typeof agentsGridIt = {
  'agentsGrid.runs': 'Beendet', 'agentsGrid.open': 'Offen', 'agentsGrid.cost': 'Kosten',
  'agentsGrid.working': 'Arbeitet','agentsGrid.openProfile': 'Rolle bearbeiten', 'agentsGrid.count': ({ n }) => n === 1 ? '1 Rolle' : `${n} Rollen`,
  'agentsGrid.workingCount': ({ n }) => n === 1 ? '1 arbeitet' : `${n} arbeiten`,
  'agentsGrid.trialCount': ({ n }) => `${n} auf Probe`,
  'agentsGrid.level': 'Level', 'agentsGrid.levelShort': ({ n }) => `Lv ${n}`,
  'agentsGrid.levelTitle': ({ n }) => n >= 10 ? 'Legende' : n >= 6 ? 'Meister' : ['Rekrut', 'Lehrling', 'Praktiker', 'Experte', 'Veteran'][n - 1] ?? 'Rekrut',
  'agentsGrid.levelWins': ({ n }) => n === 1 ? '1 geprüfter Erfolg' : `${n} geprüfte Erfolge`,
  'agentsGrid.levelNext': ({ left, next }) => left === 1 ? `1 Erfolg bis Lv ${next}` : `${left} Erfolge bis Lv ${next}`,
  'agentsGrid.levelTop': 'Höchstes Level',
  'agentsGrid.levelHelpTitle': 'Wie das Level berechnet wird',
  'agentsGrid.levelHelp1': 'Das Level steigt nur mit geprüft erfolgreichen Runs dieses Agenten, nie mit seinem Urteil über sich selbst oder mit Schweigen. Es zählen dein Urteil, eine unabhängige Prüfung oder die Belege der App (Tests des Projekts nach der letzten Änderung bestanden). Der Orchestrator hat keine eigenen Runs: Jeder von ihm gestartete Run, der ein geprüfter Erfolg ist, zählt für ihn.',
  'agentsGrid.levelHelp2': 'Jedes Level verlangt 5 Erfolge mehr als das vorige: Lv 2 bei 5, Lv 3 bei 15, Lv 4 bei 30, Lv 5 bei 50, Lv 6 bei 75 (Lv N braucht 5 × N × (N − 1) ÷ 2). Höchstes: Lv 50.',
  'agentsGrid.levelHelp3': 'Titel: Rekrut (Lv 1), Lehrling, Praktiker, Experte, Veteran (Lv 5), Meister (Lv 6–9), Legende (ab Lv 10). Es ist ein Spiel, aber nur mit geprüften Daten: Es sagt, wie viele Runs gelungen sind, nicht wie viele gemacht wurden.',
  'agentsGrid.levelHelpEx': ({ wins, runs, level, next, left }) =>
    `${wins} ${wins === 1 ? 'geprüfter Erfolg' : 'geprüfte Erfolge'} von ${runs} ${runs === 1 ? 'beendeten Run' : 'beendeten Runs'}: Lv ${level}` + (next === null ? ', das höchste.' : `; noch ${left} für Lv ${next}.`),
  'agentsGrid.perf': 'Leistung',
  'agentsGrid.perfBand': ({ v }) => v >= 0.85 ? 'Ausgezeichnet' : v >= 0.7 ? 'Gut' : v >= 0.5 ? 'Passabel' : 'Ausbaufähig',
  'agentsGrid.perfWarmup': 'Wärmt sich auf',
  'agentsGrid.perfWarmupCount': ({ n, min }) => `${n} von ${min} bewertet`,
  'agentsGrid.perfJudged': ({ n }) => n === 1 ? '1 bewerteter Run' : `${n} bewertete Runs`,
  'agentsGrid.perfHelpTitle': 'Wie die Leistung berechnet wird',
  'agentsGrid.perfHelp1': 'Der Durchschnitt der Urteile über seine Runs: Erfolg zählt 100 %, teilweise 50 %, gescheitert 0 %. Runs ohne Urteil zählen nicht. Die Zahl darunter sagt, auf wie vielen Runs sie beruht.',
  'agentsGrid.perfHelp2': 'Jedes Urteil wiegt nach dem, der es gab (du, eine unabhängige Prüfung × 1, eine Prüfung des Sentinels, an dem Geschehenen gemessen, × 0,8, die Belege der App (Tests und Prüfungen des Projekts nach der letzten Änderung bestanden) × 0,7, der Orchestrator × 0,6, der geprüfte Eltern-Run eines delegierten Runs × 0,5; der eigene Bericht des Agenten über sich zählt nicht), und nach seinem Alter: Ein 30 Tage altes Urteil wiegt halb so viel wie ein heutiges, ein 60 Tage altes ein Viertel.',
  'agentsGrid.perfHelp3': ({ min }) => `Sie erscheint nach ${min} bewerteten Runs; davor zeigt der Agent „Wärmt sich auf“. Stufen: ab 85 % ausgezeichnet, 70–84 % gut, 50–69 % passabel, unter 50 % ausbaufähig.`,
  'agentsGrid.perfSources': ({ human, review, receipts, graded, orchestrator, chain, self }) =>
    `Urteile bisher: ${human} von dir, ${review} aus unabhängigen Prüfungen, ${receipts} aus Testbelegen, ${graded} am Geschehenen gemessene Prüfungen, ${chain} vom geprüften Eltern-Run, ${orchestrator} vom Orchestrator` + (self ? `; ${self} nur vom Agenten selbst, die nicht zählen.` : '.'),
  'agentsGrid.costHelp': 'Die Mediankosten eines beendeten Runs: Die Hälfte der Runs kostet weniger, die Hälfte mehr. Es zählen nur Runs, deren Engine Kosten meldet.',
  'agentsGrid.noRuns': 'Noch kein geprüfter Erfolg: Der erste bringt ihn Richtung Lv 2.',
};
