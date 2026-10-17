// Localized everyday-work labels used by NewChatDialog; keeps the pure brief independent of renderer state.
import { lang } from '../i18n';

export function workLabels() {
  // The existing language resolver owns the locale; no second localStorage language preference.
  const it = lang() === 'it';
  return it ? {
    path: 'Che tipo di lavoro vuoi fare?', hint: 'Puoi partire da una richiesta: il contesto e il risultato sono facoltativi.', requestHint: 'Per esempio: prepara una riunione, confronta due offerte o scrivi una bozza per un cliente',
    paths: { general: 'Richiesta libera', organize: 'Organizzare il lavoro', write: 'Scrivere e preparare documenti', analyze: 'Analizzare e confrontare', client: 'Seguire clienti e incarichi', develop: 'Sviluppare software' },
    contextSummary: 'Aggiungi contesto e risultato atteso', context: 'Contesto di lavoro', contextHint: 'Progetto, destinatari, vincoli e informazioni da usare',
    outcome: 'Risultato atteso', outcomeHint: 'Per esempio: una bozza, un confronto o un piano di azioni', engineOptions: 'Assistente e scelta automatica',
  } : {
    path: 'What kind of work do you want to do?', hint: 'Start with a request. Context and deliverable are optional.', requestHint: 'For example: prepare a meeting, compare two offers or draft a client proposal',
    paths: { general: 'Open request', organize: 'Organize work', write: 'Write and prepare documents', analyze: 'Analyze and compare', client: 'Follow up clients and assignments', develop: 'Develop software' },
    contextSummary: 'Add context and a deliverable', context: 'Work context', contextHint: 'Project, audience, constraints and information to use',
    outcome: 'Expected deliverable', outcomeHint: 'For example: a draft, comparison or action plan', engineOptions: 'Assistant and automatic selection',
  };
}
