// English texts of «Remote control» (ADR 0222): the phone button on the Orchestrator's head and the line under it with
// the claude.ai link.
import type { remoteIt } from './remote.it';
export const remoteEn: typeof remoteIt = {
  'remote.turnOn': 'Remote control: continue the Orchestrator from your phone (claude.ai)',
  'remote.turnOff': 'Turn remote control off',
  'remote.starting': 'Remote control: turning on…',
  'remote.ready': 'Remote control on: open the link on your phone, in the Claude app or at claude.ai.',
  'remote.connected': 'Remote control connected: open the link on your phone, in the Claude app or at claude.ai.',
  'remote.paused': 'Remote control paused: it reconnects when the Orchestrator starts again.',
  'remote.failed': (p: { error: string }) => `Remote control not on: ${p.error}`,
  'remote.copy': 'Copy link',
  'remote.off': 'Turn off',
  'remote.retry': 'Try again',
  'remote.noQr': 'No QR code: the app has no library to draw one. Copy the link and open it on your phone.',
};
