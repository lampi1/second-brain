// German (de-AT) labels of an agent's own page and the browser marker of a strip; parity checked against agent-detail.it.ts.
import type { agentDetailIt } from './agent-detail.it';
export const agentDetailDe: typeof agentDetailIt = {
  'agentDetail.back': 'Alle Rollen',
  'agentDetail.prompt': 'Anweisungen der Rolle',
  'agentDetail.promptHint': 'Was die Engine bei jedem Start dieser Rolle bekommt, nach den Regeln, die alle Rollen teilen.',
  'agentDetail.promptEmpty': 'Für diese Rolle sind keine Anweisungen geschrieben.',
  'agentDetail.promptSize': ({ n }) => n === 1 ? '1 Zeichen' : `${n} Zeichen`,
  'agentDetail.purpose': 'Zweck',
  'agentDetail.config': 'Konfiguration',
  'agentDetail.results': 'Beobachtete Ergebnisse',
  'agentDetail.tools': 'Tools',
  'agentDetail.toolsNone': 'Keine',
  'agentDetail.ceiling': 'Höchste Berechtigungen',
  'agentDetail.ceilingNone': 'Deine Einstellungen',
  'agentDetail.ceiling.plan': 'Nur planen', 'agentDetail.ceiling.default': 'Fragt vorher', 'agentDetail.ceiling.acceptEdits': 'Akzeptiert Änderungen',
  'agentDetail.version': 'Version',
  'agentDetail.updated': 'Zuletzt bearbeitet',
  'agentDetail.closeEditor': 'Ohne Speichern schließen',
  'agentDetail.browserOn': ({ n }) => n === 1 ? 'Browser ausblenden' : `Die ${n} Browser ausblenden`,
  'agentDetail.browserOff': ({ n }) => n === 1 ? 'Verbundenen Browser anzeigen' : `Die ${n} verbundenen Browser anzeigen`,
};
