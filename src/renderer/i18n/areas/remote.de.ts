// German texts of «Fernsteuerung» (ADR 0229): the phone button on the Orchestrator's head and the line under it with
// the claude.ai link.
import type { remoteIt } from './remote.it';
export const remoteDe: typeof remoteIt = {
  'remote.turnOn': 'Fernsteuerung: den Orchestrator am Handy weiterführen (claude.ai)',
  'remote.starting': 'Fernsteuerung: wird eingeschaltet…',
  'remote.ready': 'Fernsteuerung an: öffne den Link am Handy, in der Claude-App oder auf claude.ai.',
  'remote.connected': 'Fernsteuerung verbunden: öffne den Link am Handy, in der Claude-App oder auf claude.ai.',
  'remote.paused': 'Fernsteuerung pausiert: sie verbindet sich wieder, wenn der Orchestrator neu startet.',
  'remote.failed': (p: { error: string }) => `Fernsteuerung nicht an: ${p.error}`,
  'remote.copy': 'Link kopieren',
  'remote.off': 'Ausschalten',
  'remote.retry': 'Erneut versuchen',
  'remote.noQr': 'Kein QR-Code: der App fehlt eine Bibliothek dafür. Kopiere den Link und öffne ihn am Handy.',
};
