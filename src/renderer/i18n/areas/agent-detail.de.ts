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
  'agentDetail.presets.saved': ({ preset }: { preset: string }) => `${preset} gespeichert.`,
  'agentDetail.presets.undo': 'Rückgängig',
  'agentDetail.results': 'Beobachtete Ergebnisse',
  'agentDetail.tools': 'Tools',
  'agentDetail.toolsNone': 'Keine',
  
  'agentDetail.version': 'Version',
  'agentDetail.updated': 'Zuletzt bearbeitet',
  'agentDetail.closeEditor': 'Ohne Speichern schließen',
};
