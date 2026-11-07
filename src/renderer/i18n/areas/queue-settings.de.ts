// German texts of Settings → Erweitert «Warteschlange und Starts» (ADR 0222): the cold-start slots and the emergency
// brake.
import type { queueSettingsIt } from './queue-settings.it';
export const queueSettingsDe: typeof queueSettingsIt = {
  'queueSt.title': 'Warteschlange und Starts',
  'queueSt.lead': 'Neue Chats, die Agenten öffnen, starten wenige auf einmal; die anderen warten in der Warteschlange. Ein schon gestarteter Chat und deine eigenen Nachrichten warten nie.',
  'queueSt.slots': 'Kaltstarts gleichzeitig',
  'queueSt.slotsHint': (p: { cores: number; auto: number }) => `Dieser PC hat ${p.cores} Kerne: automatisch starten ${p.auto} Chats gleichzeitig.`,
  'queueSt.slotsAuto': (p: { auto: number }) => `Automatisch (${p.auto})`,
  'queueSt.cpu': 'Notbremse: CPU über',
  'queueSt.cpuHint': 'Über dieser CPU (Mittel der letzten Sekunden) warten auch die Starts in der Warteschlange.',
  'queueSt.ram': 'Notbremse: freier RAM unter',
  'queueSt.ramHint': 'Unter diesem freien Speicher warten auch die Starts in der Warteschlange.',
  'queueSt.ramOff': 'RAM nicht beachten',
  'queueSt.pct': (p: { n: number }) => `${p.n} %`,
};
