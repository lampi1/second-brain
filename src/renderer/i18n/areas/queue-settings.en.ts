// English texts of Settings → Advanced «Queue and starts» (ADR 0222): the cold-start slots and the emergency brake.
import type { queueSettingsIt } from './queue-settings.it';
export const queueSettingsEn: typeof queueSettingsIt = {
  'queueSt.title': 'Queue and starts',
  'queueSt.lead': 'New chats opened by agents start a few at a time; the others wait in a queue. A chat already started and your own messages never wait.',
  'queueSt.slots': 'Cold starts at once',
  'queueSt.slotsHint': (p: { cores: number; auto: number }) => `This PC has ${p.cores} cores: on automatic, ${p.auto} chats start at a time.`,
  'queueSt.slotsAuto': (p: { auto: number }) => `Automatic (${p.auto})`,
  'queueSt.cpu': 'Emergency brake: CPU above',
  'queueSt.cpuHint': 'Above this CPU (average of the last seconds) even the queued starts wait.',
  'queueSt.ram': 'Emergency brake: free RAM below',
  'queueSt.ramHint': 'Below this free memory even the queued starts wait.',
  'queueSt.ramOff': 'Ignore RAM',
  'queueSt.pct': (p: { n: number }) => `${p.n}%`,
};
