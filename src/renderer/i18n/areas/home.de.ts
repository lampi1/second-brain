// German (de-AT) counterparts of the Home dashboard dictionary (home.it.ts).
import type { homeIt } from './home.it';
export const homeDe: typeof homeIt = {
  
  
  'home.emptyAgents': 'Sag dem Orchestrator, was du tun willst, oder erstell deinen ersten Agenten.',
  'home.startHere': 'Dein Ausgangspunkt',
  'home.orchestratorWidth': 'Breite des Orchestrators', 'home.orchestratorStart': 'Womit fangen wir an?',
  'home.orchestratorIntro': 'Ein Ort für deine Ideen, Agenten und den nächsten Schritt. Dein Orchestrator bleibt hier, während du arbeitest.',
  'home.headlineBy': (p: { model: string }) => `Witz von ${p.model} zu den heutigen Ereignissen; einer pro Tag, im ersten Aufruf von Battito.`,
  'home.headlineBuiltin': 'Ein Witz aus der eigenen Liste der App: der des Modells kommt mit der nächsten Aktualisierung.',
  'home.orchestrator': 'Orchestrator',
  'home.agents': 'Agenten', 'home.manageAgents': 'Agenten verwalten', 'home.back': 'Zurück zum Grindhouse', 'home.workspace': 'Deine Agenten bei der Arbeit und der Orchestrator',
  'home.chooseEngine': 'Engine des Orchestrators wählen', 
  
  
  'home.works': 'Was funktioniert', 
  'home.rulesReading': (p: { days: number; pending: number }) => `Regeln, deren Fehler innerhalb von ${p.days} beobachteten Tagen nicht wiederkam; ${p.pending} sind noch nicht bewertbar. Das belegt keinen ursächlichen Erfolg.`,
  
  
  
  
  
};
