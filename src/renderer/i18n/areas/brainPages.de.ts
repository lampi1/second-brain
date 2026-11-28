// German (de-AT) UI texts of the "brainPages" area (ADR 0057): the same keys as brainPages.it.ts (typed by it), spread into de.ts.
import type { brainPagesIt } from './brainPages.it';

export const brainPagesDe: typeof brainPagesIt = {
  // index.tsx - brain page labels
  'brainPages.nav.home': 'Grindhouse',
  'brainPages.nav.dashboard': 'Dashboard',
  'brainPages.nav.mappa3d': '3D-Karte',
  'brainPages.nav.scacchi': 'Schach',
  'brainPages.nav.registrazioni': 'Aufnahmen',
  'brainPages.registrazioni.subtitle': 'Aufgenommene Calls (PC-Audio + Mikrofon) und importierte Dateien, auf dem PC ohne Tokens transkribiert: «Call aufnehmen», Transkript Du/Andere, «Orchestrator fragen», «Auf dem PC gefunden».',
  'brainPages.nav.browser': 'Browser',
  'brainPages.nav.task': 'Tasks',
  'brainPages.nav.andamento': 'Verlauf',
  'brainPages.nav.script': 'Skripte',
  'brainPages.nav.log': 'Log',
  'brainPages.nav.agenti': 'Agenten',
  'brainPages.nav.skill': 'Skills',
  'brainPages.nav.impostazioni': 'Einstellungen',
  'brainPages.nav.memoria': 'Gedächtnis',
  'brainPages.nav.piani': 'Pläne',
  'brainPages.nav.collegamenti': 'Verbindungen',

  // Esplora.tsx

  // Discuss.tsx
  'brainPages.discuss.discussBtn': 'Besprechen',
  'brainPages.discuss.discussButtonLabel': (p: { topic: string }) => `Mit dem Orchestrator besprechen: ${p.topic}`,
  'brainPages.discuss.discussButtonTitle': 'Öffnet den Orchestrator neben der Seite mit einer fertigen Nachricht: bearbeiten und senden',
  'brainPages.discuss.discussButtonTitleDisabled': 'Der Orchestrator muss in der App offen sein',
  'brainPages.discuss.discussedNeutral': 'Besprochen',
  'brainPages.discuss.discussedTimes': (p: { n: number }) => (p.n === 1 ? ' 1 Mal' : ` ${p.n} Mal`),
  'brainPages.discuss.withOrchestrator': 'mit dem Orchestrator',
  'brainPages.discuss.inChat': (p: { title: string }) => `in «${p.title}»`,
  'brainPages.discuss.chatClosed': '(geschlossen)',
  'brainPages.discuss.boxAriaLabelOrchestrator': 'Nachricht an den Orchestrator',
  'brainPages.discuss.boxTitleOrchestrator': 'An den Orchestrator',
  'brainPages.discuss.boxLabel': 'Text',
  'brainPages.discuss.boxDescOrchestrator': 'kommt als deine Nachricht an',
  'brainPages.discuss.boxConfirmOrchestrator': 'An den Orchestrator senden',
  'brainPages.discuss.boxCancelBtn': 'Abbrechen',
  'brainPages.discuss.shortcutKey': 'Strg+Eingabe',
  'brainPages.discuss.shortcutSend': 'sendet',
  'brainPages.discuss.shortcutEscKey': 'Esc',
  'brainPages.discuss.shortcutCancel': 'bricht ab',
  'brainPages.discuss.errorNoOrchestrator': 'kein Orchestrator in der App offen',
  'brainPages.discuss.successOrchestratorSent': 'An den Orchestrator gesendet',
  'brainPages.discuss.errorOrchestratorNotOpen': 'Öffne den Orchestrator in der App, um es zu besprechen: Strg+R',
};
