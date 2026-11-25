// The one order of the engines (ADR 0352, EngineOrder.tsx), in English.
import type { engineOrderIt } from './engine-order.it';
export const engineOrderEn: typeof engineOrderIt = {
  'engineOrder.title': 'Engine order',
  'engineOrder.hint': 'Every role tries the engines in this order and starts on the first available one. It counts from the next start, reuse or «Resume».',
  'engineOrder.off': 'No order: every role follows its own level lists.',
  'engineOrder.use': 'Use one order',
  'engineOrder.clear': 'Remove the order',
  'engineOrder.threshold': 'Go to the next past',
  'engineOrder.noThreshold': 'Only at the limit',
  'engineOrder.orchestrator': 'The Orchestrator stays on the engine chosen for its chat.',
  'engineOrder.role': 'Engine order',
  'engineOrder.roleOwn': 'Exception for this role',
  'engineOrder.roleClear': 'Remove the exception',
  'engineOrder.roleOwnHint': 'Exception: this role does not follow everybody’s order.',
  'engineOrder.up': (p: { engine: string }) => `Move ${p.engine} up`,
  'engineOrder.down': (p: { engine: string }) => `Move ${p.engine} down`,
  'engineOrder.thresholdOf': (p: { engine: string }) => `Threshold of ${p.engine}`,
  'engineOrder.roleAll': (p: { order: string }) => `It follows everybody’s order: ${p.order}.`,
  'engineOrder.exception': (p: { role: string; order: string }) => `Exception: ${p.role} uses ${p.order}`,
  'engineOrder.held': (p: { n: number }) => p.n === 1 ? 'One change is still to apply: answer its panel.' : `${p.n} changes are still to apply: answer their panels.`,
};
