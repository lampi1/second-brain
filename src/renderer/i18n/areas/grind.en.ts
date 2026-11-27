// English texts of the restyled shell (ADR 0366, issue #491): the Grindhouse sections and the ⓘ of a strip, the
// version chip of the top bar.
import type { grindIt } from './grind.it';
export const grindEn: typeof grindIt = {
  'grind.sec.wait': 'Waiting for you',
  'grind.sec.work': 'At work',
  'grind.sec.done': 'Done today',
  'grind.info': 'Details: model, estimate, skills',
  'grind.est': p => `estimate ${p.est}`,
  'grind.skills': p => `skills: ${p.list}`,
  'grind.skillsLoaded': p => `skills loaded (use not tracked): ${p.list}`,
  'grind.where': p => `project: ${p.where}`,
  'grind.subs': p => p.n === 1 ? '1 sub-agent at work' : `${p.n} sub-agents at work`,
  'grind.helpers': p => p.n === 1 ? '1 helper' : `${p.n} helpers`,
  'grind.helpersTip': 'Show or hide the chats it delegated',
  'version.updated': 'Updated to',
  'version.news': 'What’s new',
  'version.newsTip': 'What is new: opens Settings → Updates',
  'version.new': 'New version',
  'version.update': 'Update',
  'version.newTip': p => `A new version is on GitHub: ${p.subject}`,
  'version.dismiss': 'Dismiss the version notice',
};
