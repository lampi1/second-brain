// English counterpart of the portable agent review labels.
import type { agentPackIt } from './agent-pack.it';
export const agentPackEn: typeof agentPackIt = {
  'pack.staleEditor': 'The agent changed while you were editing. Saving is paused to protect the new version.',
  'pack.copyDraft': 'Keep draft as a new agent', 'pack.reloadDraft': 'Discard draft and reload agent',
  'pack.import': 'Import…', 'pack.export': 'Export…', 'pack.drop': 'Drop to import',
  'pack.target': 'Format', 'pack.prepare': 'Prepare export', 'pack.save': 'Save package',
  'pack.close': 'Close', 'pack.stats': 'Include anonymous results summary', 'pack.statsHint': 'Counts only, without conversations, project names or feedback.',
  'pack.include': 'Included content', 'pack.warnings': 'Notes', 'pack.findings': 'Items to review',
  'pack.exclude': 'Exclude', 'pack.open': 'Open', 'pack.rescan': 'Scan again', 'pack.allow': 'False positive',
  'pack.review': 'Review import', 'pack.scripts': 'Scripts for approval', 'pack.approveScripts': 'I approve these scripts',
  'pack.scriptHint': 'Without approval they will be removed. The app does not execute them.', 'pack.ignored': 'Ignored',
  'pack.permissions': 'Permissions', 'pack.personal': 'I reviewed the personal data and approve importing it',
  'pack.apply': 'Import on probation', 'pack.collision': 'Import choice', 'pack.update': 'Update with a trial version',
  'pack.copy': 'Import a copy', 'pack.rename': 'Import with an available name', 'pack.present': 'Package already present',
  'pack.error': 'The operation failed. Review the details and retry.', 'pack.saved': 'Package exported', 'pack.imported': 'Imported on probation',
  'pack.learned': 'Learned rules', 'pack.pending': 'Pending approval', 'pack.none': 'No proposals awaiting approval.',
  'pack.approve': 'Approve', 'pack.edit': 'Edit', 'pack.discard': 'Discard', 'pack.applyEdit': 'Approve edit',
  'pack.preset': 'Preset', 'pack.mine': 'Mine · from preset',
  'pack.trial': 'Trial version', 'pack.rollback': 'Go back to the previous version', 'pack.retireReason': 'Retired by Brother from the card',
  'pack.probation': 'On probation', 'pack.keepTrial': 'Keep', 'pack.retire': 'Retire', 'pack.working': 'Checking…',
};
