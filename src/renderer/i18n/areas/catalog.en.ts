// Catalogue overview strings for English users; parity checked against the Italian source.
import type { catalogIt } from './catalog.it';
export const catalogEn: typeof catalogIt = {
  'runs.version': 'Version pinned at launch',
  'runs.auto': 'Started by the Orchestrator', 'runs.outcome': 'How did it go?',
  'runs.success': 'Success', 'runs.partial': 'Partial', 'runs.fail': 'Failed',
  'runs.saved': 'Your outcome is saved', 'runs.error': 'Outcome not saved. Try again.',
  'runs.run': 'Run', 'runs.started': 'Started, on the home', 'runs.startedShort': 'Started', 'runs.open': 'Open',
  'runs.goal': 'Goal', 'runs.folder': 'Folder', 'runs.startError': 'Could not start. Try again.',
  'contextPulse.title': 'From Battito', 'contextPulse.error': 'Cards unavailable.', 'contextPulse.actionError': 'Action failed. Try again.',
  'contextPulse.save': 'Save to ideas', 'contextPulse.saved': 'Saved to ideas', 'contextPulse.act': 'Do it', 'contextPulse.dismiss': 'Not useful',
  'contextPulse.sources': 'Sources', 'contextPulse.app': 'App', 'contextPulse.cannotSave': 'Saving to ideas is unavailable.',
  'catalog.title': 'Agents',
  'catalog.intro': 'Every piece of work goes to one of these roles: the Orchestrator delegates it, and a role may delegate in turn to visible chats under its own. You can change their instructions, engine, model, tools and skills; “Restore default” goes back to the original.',
  'catalog.subtitle': 'The roles of your team, what they do and the observed results.',
  'catalog.engine': 'Engine',
  'catalog.active': 'Active',
  'catalog.runs': 'Ended runs', 'catalog.open': 'Open runs', 'catalog.success': 'Verified success',
  'catalog.cost': 'Median cost / run', 'catalog.last': 'Last observed start', 'catalog.unknown': 'Unavailable',
  'catalog.samples': ({ n, total }) => `${n} of ${total} runs`,
  'catalog.note': 'Statistics cover known versions. Success counts only verified outcomes; the last start covers available chats. Missing data does not mean zero.',
  'catalog.metricsError': 'Statistics unavailable. Please retry.', 'catalog.back': 'Back to catalogue',
};
