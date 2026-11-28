// English UI texts of the "brainPages" area (ADR 0057): the same keys as brainPages.it.ts (typed by it), spread into en.ts.
import type { brainPagesIt } from './brainPages.it';

export const brainPagesEn: typeof brainPagesIt = {
  // index.tsx - brain page labels
  'brainPages.nav.home': 'Grindhouse',
  'brainPages.nav.dashboard': 'Dashboard',
  'brainPages.nav.mappa3d': '3D map',
  'brainPages.nav.scacchi': 'Chess',
  'brainPages.nav.registrazioni': 'Recordings',
  'brainPages.registrazioni.subtitle': 'Recorded calls (PC audio + microphone) and imported files, transcribed on the PC at zero tokens: «Record call», the You/Others transcript, «Ask the Orchestrator», «Found on the PC».',
  'brainPages.nav.browser': 'Browser',
  'brainPages.nav.task': 'Tasks',
  'brainPages.nav.andamento': 'Trends',
  'brainPages.nav.script': 'Scripts',
  'brainPages.nav.log': 'Log',
  'brainPages.nav.agenti': 'Agents',
  'brainPages.nav.skill': 'Skills',
  'brainPages.nav.impostazioni': 'Settings',
  'brainPages.nav.memoria': 'Memory',
  'brainPages.nav.piani': 'Plans',
  'brainPages.nav.collegamenti': 'Links',

  // Esplora.tsx

  // Discuss.tsx
  'brainPages.discuss.discussBtn': 'Discuss',
  'brainPages.discuss.discussButtonLabel': (p: { topic: string }) => `Discuss with Orchestrator: ${p.topic}`,
  'brainPages.discuss.discussButtonTitle': 'Opens the Orchestrator next to the page with a ready message: edit and send it',
  'brainPages.discuss.discussButtonTitleDisabled': 'You need the Orchestrator open in the app',
  'brainPages.discuss.discussedNeutral': 'Discussed',
  'brainPages.discuss.discussedTimes': (p: { n: number }) => ` ${p.n} times`,
  'brainPages.discuss.withOrchestrator': 'with Orchestrator',
  'brainPages.discuss.inChat': (p: { title: string }) => `in «${p.title}»`,
  'brainPages.discuss.chatClosed': '(closed)',
  'brainPages.discuss.boxAriaLabelOrchestrator': 'Message to Orchestrator',
  'brainPages.discuss.boxTitleOrchestrator': 'To Orchestrator',
  'brainPages.discuss.boxLabel': 'Text',
  'brainPages.discuss.boxDescOrchestrator': 'arrives as your message',
  'brainPages.discuss.boxConfirmOrchestrator': 'Send to Orchestrator',
  'brainPages.discuss.boxCancelBtn': 'Cancel',
  'brainPages.discuss.shortcutKey': 'Ctrl+Enter',
  'brainPages.discuss.shortcutSend': 'sends',
  'brainPages.discuss.shortcutEscKey': 'Esc',
  'brainPages.discuss.shortcutCancel': 'cancels',
  'brainPages.discuss.errorNoOrchestrator': 'no Orchestrator open in the app',
  'brainPages.discuss.successOrchestratorSent': 'Sent to Orchestrator',
  'brainPages.discuss.errorOrchestratorNotOpen': 'Open the Orchestrator in the app to discuss: Ctrl+R',
};
