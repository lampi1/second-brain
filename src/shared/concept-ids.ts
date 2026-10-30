// The ids of the Guida's cards (concept-guide.ts CONCEPTS), apart from their texts: GuideLink checks a "?" link's id
// against this list without loading the three-language guide (~0.3 MB) with the first screen; the guide itself is
// loaded when the Guida opens. test/unit/guide-link.test.ts keeps the two lists equal.
export const CONCEPT_IDS: readonly string[] = [
  'every-task-agent', 'delegation', 'agents', 'skills', 'orchestrator', 'runs', 'metrics', 'errors-rules', 'brain-scripts',
  'classifiers', 'permissions', 'questions', 'grindhouse', 'memory-hub', 'tasks', 'setup', 'brain',
  'search', 'file-viewer', 'routing', 'costs', 'mcp-servers', 'updates', 'maintenance', 'proposals', 'trials', 'auto-close',
  'log', 'impara', 'held-news', 'context', 'quality', 'flash', 'orchestrator-app', 'voice', 'recordings', 'personal-browser',
  'notifications', 'routines', 'settings', 'guide', 'brain-map',
];
