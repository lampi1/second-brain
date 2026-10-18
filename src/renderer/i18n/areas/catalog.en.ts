// Catalogue overview strings for English users; parity checked against the Italian source.
import type { catalogIt } from './catalog.it';
export const catalogEn: typeof catalogIt = {
  'runs.legacy': 'Legacy version: definition cannot be verified', 'runs.version': 'Version pinned at launch',
  'runs.auto': 'Started by the Orchestrator', 'runs.outcome': 'How did it go?',
  'runs.success': 'Success', 'runs.partial': 'Partial', 'runs.fail': 'Failed',
  'runs.saved': 'Your outcome is saved', 'runs.error': 'Outcome not saved. Try again.',
  'runs.run': 'Run', 'runs.started': 'Started, on the home', 'runs.startedShort': 'Started', 'runs.open': 'Open',
  'runs.goal': 'Goal', 'runs.folder': 'Folder', 'runs.startError': 'Could not start. Try again.',
  'contextPulse.title': 'From Battito', 'contextPulse.error': 'Cards unavailable.', 'contextPulse.actionError': 'Action failed. Try again.',
  'contextPulse.save': 'Save to ideas', 'contextPulse.saved': 'Saved to ideas', 'contextPulse.act': 'Do it', 'contextPulse.dismiss': 'Not useful',
  'contextPulse.sources': 'Sources', 'contextPulse.app': 'App', 'contextPulse.cannotSave': 'Saving to ideas is unavailable.',
  'catalog.title': 'Agents', 'catalog.create': 'Create agent',
  'catalog.intro': 'Agents are reusable assistants with a role, instructions and an engine: start with a preset or create one with the Orchestrator.',
  'catalog.subtitle': 'Your team, its specialties and observed results.',
  'catalog.role': 'Role', 'catalog.engine': 'Engine', 'catalog.all': 'All', 'catalog.sort': 'Sort by', 'catalog.name': 'Name',
  'catalog.empty': 'No agents match these filters.', 'catalog.active': 'Active', 'catalog.presetUpdate': 'Preset update available', 'catalog.probation': 'On probation',
  'catalog.runs': 'Ended runs', 'catalog.open': 'Open runs', 'catalog.success': 'Verified success',
  'catalog.cost': 'Median cost / run', 'catalog.last': 'Last observed start', 'catalog.unknown': 'Unavailable',
  'catalog.samples': ({ n, total }) => `${n} of ${total} runs`,
  'catalog.note': 'Statistics cover known versions. Success counts only verified outcomes; the last start covers available chats. Missing data does not mean zero.',
  'catalog.metricsError': 'Statistics unavailable. Please retry.', 'catalog.back': 'Back to catalogue',
  'catalog.preset': 'Preset', 'catalog.custom': 'Custom',
};
