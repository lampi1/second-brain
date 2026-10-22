// English counterparts of the Home dashboard dictionary.
import type { homeIt } from './home.it';
export const homeEn: typeof homeIt = {
  
  
  'home.emptyAgents': 'Tell the coordinator what you want to do, or create your first agent.',
  'home.startHere': 'Your starting point',
  'home.orchestratorWidth': 'Coordinator width', 'home.orchestratorStart': 'Where shall we start?',
  'home.orchestratorIntro': 'One place for your ideas, agents and next step. Your coordinator stays here while you work.',
  'home.headlineBy': (p: { model: string }) => `Joke written by ${p.model} on today's events; one a day, in the Pulse's first call.`,
  'home.headlineBuiltin': 'A joke from the app’s own list: the model’s one arrives with the next refresh.',
  'home.orchestrator': 'Orchestrator',
  'home.agents': 'Agents', 'home.manageAgents': 'Manage agents', 'home.back': 'Back to the Grindhouse', 'home.workspace': 'Your agents at work and the Orchestrator',
  'home.chooseEngine': 'Choose the coordinator engine', 
  
  
  'home.works': 'What works', 
  'home.rulesReading': (p: { days: number; pending: number }) => `Rules whose error did not recur within ${p.days} observed days; ${p.pending} cannot yet be assessed. This does not establish causal success.`,
  
  
  
  
  
};
