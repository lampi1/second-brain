// The one order of the engines (ADR 0358, EngineOrder.tsx), in German.
import type { engineOrderIt } from './engine-order.it';
export const engineOrderDe: typeof engineOrderIt = {
  'engineOrder.title': 'Reihenfolge der Engines',
  'engineOrder.hint': 'Jede Rolle probiert die Engines in dieser Reihenfolge und startet auf der ersten verfügbaren. Gilt ab dem nächsten Start, der nächsten Wiederverwendung oder «Fortsetzen».',
  'engineOrder.off': 'Keine Reihenfolge: jede Rolle folgt den Listen ihrer Stufen.',
  'engineOrder.use': 'Eine Reihenfolge nutzen',
  'engineOrder.clear': 'Reihenfolge entfernen',
  'engineOrder.threshold': 'Zur nächsten ab',
  'engineOrder.noThreshold': 'Erst am Limit',
  'engineOrder.orchestrator': 'Der Orchestrator bleibt auf der Engine, die für seinen Chat gewählt wurde.',
  'engineOrder.role': 'Reihenfolge der Engines',
  'engineOrder.roleOwn': 'Ausnahme für diese Rolle',
  'engineOrder.roleClear': 'Ausnahme entfernen',
  'engineOrder.roleOwnHint': 'Ausnahme: diese Rolle folgt nicht der Reihenfolge aller.',
  'engineOrder.up': (p: { engine: string }) => `${p.engine} nach oben`,
  'engineOrder.down': (p: { engine: string }) => `${p.engine} nach unten`,
  'engineOrder.thresholdOf': (p: { engine: string }) => `Schwelle von ${p.engine}`,
  'engineOrder.roleAll': (p: { order: string }) => `Folgt der Reihenfolge aller: ${p.order}.`,
  'engineOrder.exception': (p: { role: string; order: string }) => `Ausnahme: ${p.role} nutzt ${p.order}`,
  'engineOrder.held': (p: { n: number }) => p.n === 1 ? 'Eine Änderung wartet noch: antworte auf ihr Fenster.' : `${p.n} Änderungen warten noch: antworte auf ihre Fenster.`,
};
