// German (de-AT) labels of an agent's own page and the browser marker of a strip; parity checked against agent-detail.it.ts.
import type { agentDetailIt } from './agent-detail.it';
export const agentDetailDe: typeof agentDetailIt = {
  'agentDetail.back': 'Alle Rollen',
  'agentDetail.prompt': 'Anweisungen der Rolle',
  'agentDetail.promptHint': 'Was die Engine bei jedem Start dieser Rolle bekommt, nach den Regeln, die alle Rollen teilen.',
  'agentDetail.promptEmpty': 'Für diese Rolle sind keine Anweisungen geschrieben.',
  'agentDetail.promptSize': ({ n }) => n === 1 ? '1 Zeichen' : `${n} Zeichen`,
  'agentDetail.config': 'Konfiguration',
  'agentDetail.presets.hint': 'Wer delegiert, wählt Minimum, Basis oder Maximum für die Aufgabe; ohne Wahl Basis. Basis ist Modell und Effort der Rolle; leeres Minimum und Maximum = wie Basis.',
  'agentDetail.presets.baseOnly': 'Der Orchestrator erhält keine Delegationen: nur Basis, sein Modell und sein Effort.',
  'agentDetail.codeMode': 'Code Mode',
  'agentDetail.codeMode.hint': 'Die neuen Chats dieser Rolle arbeiten mit einem Skript: viele Lese-, Such- und Tool-Aufrufe in einem Aufruf (run_code), in einer Sandbox. Jeder Aufruf durchläuft dieselben Berechtigungsregeln; eine Esegui-Aktion stoppt das Skript und hinterlässt die übliche Schaltfläche.',
  'agentDetail.codeMode.partial': 'Auf dieser Engine teilweise: die Rolle soll run_code nutzen, und die App lehnt die nativen Tools ab, die sie selbst genehmigt; Tools, die die Engine selbst genehmigt, bleiben.',
  'agentDetail.fast': 'Fast',
  'agentDetail.fast.hint': 'Die neuen Cursor-Chats dieser Rolle starten im schnellen Modus des Modells.',
  'agentDetail.presets.saved': ({ preset }: { preset: string }) => `${preset} gespeichert.`,
  'agentDetail.presets.undo': 'Rückgängig',
  'agentDetail.results': 'Beobachtete Ergebnisse',
  'agentDetail.tools': 'Tools',
  'agentDetail.toolsNone': 'Keine',
  
  'agentDetail.version': 'Version',
  'agentDetail.updated': 'Zuletzt bearbeitet',
  'agentDetail.closeEditor': 'Ohne Speichern schließen',
};
