// English counterpart of the role pack review labels.
import type { agentPackIt } from './agent-pack.it';
export const agentPackEn: typeof agentPackIt = {
  'pack.import': 'Import…', 'pack.export': 'Export…', 'pack.drop': 'Drop to import',
  'pack.target': 'Format', 'pack.prepare': 'Prepare export', 'pack.save': 'Save package',
  'pack.close': 'Close', 'pack.stats': 'Include anonymous results summary', 'pack.statsHint': 'Counts only, without conversations, project names or feedback.',
  'pack.include': 'Included content', 'pack.warnings': 'Notes', 'pack.findings': 'Items to review',
  'pack.exclude': 'Exclude', 'pack.open': 'Open', 'pack.rescan': 'Scan again', 'pack.allow': 'False positive',
  'pack.review': 'Review import', 'pack.scripts': 'Scripts for approval', 'pack.approveScripts': 'I approve these scripts',
  'pack.scriptHint': 'Without approval they will be removed. The app does not execute them.', 'pack.ignored': 'Ignored',
  'pack.rules': 'Rules', 'pack.rulesHint': 'They go to the brain\'s rules/ folder; a file of the same name already there stays yours.',
  'pack.permissions': 'Permissions', 'pack.personal': 'I reviewed the personal data and approve importing it',
  'pack.apply': 'Import as a trial', 'pack.role': 'Role that gets the skills',
  'pack.roleHint': 'The role keeps its own text, tools and permissions; its next version uses these skills, as a trial you keep or roll back.', 'pack.present': 'Package already present',
  'pack.error': 'The operation failed. Review the details and retry.', 'pack.saved': 'Package exported', 'pack.imported': 'Imported on probation',
  'pack.trial': 'Trial version', 'pack.rollback': 'Go back to the previous version',
  'pack.keepTrial': 'Keep', 'pack.working': 'Checking…',
};
