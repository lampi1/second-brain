// Catalogue overview strings for English users; parity checked against the Italian source.
import type { catalogIt } from './catalog.it';
export const catalogEn: typeof catalogIt = {
  'catalog.title': 'Agents', 'catalog.create': 'Create agent', 'catalog.studio': 'Open Agent Studio',
  'catalog.intro': 'Agents are reusable assistants with a role, instructions and an engine: start with a preset or create one with the Orchestrator.',
  'catalog.subtitle': 'Your team, its specialties and observed results.',
  'catalog.role': 'Role', 'catalog.engine': 'Engine', 'catalog.all': 'All', 'catalog.sort': 'Sort by', 'catalog.name': 'Name',
  'catalog.empty': 'No agents match these filters.', 'catalog.active': 'Active', 'catalog.probation': 'On probation',
  'catalog.runs': 'Ended runs', 'catalog.open': 'Open runs', 'catalog.success': 'Verified success',
  'catalog.cost': 'Median cost / run', 'catalog.last': 'Last observed start', 'catalog.unknown': 'Unavailable',
  'catalog.samples': ({ n, total }) => `${n} of ${total} runs`,
  'catalog.note': 'Statistics cover known versions. Success counts only verified outcomes; the last start covers available chats. Missing data does not mean zero.',
  'catalog.metricsError': 'Statistics unavailable. Please retry.', 'catalog.back': 'Back to catalogue',
  'catalog.task': 'What should it do?', 'catalog.area': 'Which repository or area?',
  'catalog.guide': 'Open Orchestrator', 'catalog.guideNote': 'The Orchestrator helps define the profile. Then save it in Agent Studio: it will appear here automatically.',
  'catalog.cancel': 'Cancel', 'catalog.createError': 'Unable to open the Orchestrator. Please retry.',
  'catalog.noRoot': 'Choose the brain folder in Settings before opening the Orchestrator.',
  'catalog.preset': 'Preset', 'catalog.custom': 'Custom',
};
