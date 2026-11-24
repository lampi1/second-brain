// German (de-AT) labels of an agent's own page and the browser marker of a strip; parity checked against agent-detail.it.ts.
import type { agentDetailIt } from './agent-detail.it';
export const agentDetailDe: typeof agentDetailIt = {
  'agentDetail.prompt': 'Anweisungen der Rolle',
  'agentDetail.promptEmpty': 'Für diese Rolle sind keine Anweisungen geschrieben.',
  'agentDetail.promptSize': ({ n }) => n === 1 ? '1 Zeichen' : `${n} Zeichen`,
  'agentDetail.codeMode': 'Code Mode',
  'agentDetail.codeMode.hint': 'Die neuen Chats dieser Rolle arbeiten mit einem Skript: viele Lese-, Such- und Tool-Aufrufe in einem Aufruf (run_code), in einer Sandbox. Jeder Aufruf durchläuft dieselben Berechtigungsregeln; eine Esegui-Aktion stoppt das Skript und hinterlässt die übliche Schaltfläche.',
  'agentDetail.codeMode.partial': 'Auf dieser Engine teilweise: die Rolle soll run_code nutzen, und die App lehnt die nativen Tools ab, die sie selbst genehmigt; Tools, die die Engine selbst genehmigt, bleiben.',
  'agentDetail.fast': 'Fast',
  'agentDetail.fast.hint': 'Die neuen Cursor-Chats dieser Rolle starten im schnellen Modus des Modells.',
  'agentDetail.presets.saved': ({ preset }: { preset: string }) => `${preset} gespeichert.`,
  'agentDetail.presets.undo': 'Rückgängig',
  
};
