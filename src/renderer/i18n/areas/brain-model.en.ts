// English UI texts of the Brain section (ADR 0077): the same keys as brain-model.it.ts (typed by it), spread into en.ts.
import type { brainModelIt } from './brain-model.it';
type N = { n: number };

export const brainModelEn: typeof brainModelIt = {
  'bm.loading': 'Reading the brain…',
  'bm.noBrain': 'Choose the brain folder first.',
  'bm.open': 'Open',
  'bm.noData': 'no data yet',
  'bm.lines': (p: N) => (p.n === 1 ? '1 line' : `${p.n} lines`),
  'bm.changed': (p: { at: string }) => `changed ${p.at}`,

  'bm.job.upgrade': 'Brain upgrade', 'bm.job.migration': 'Migration', 'bm.job.corrections': 'Corrections', 'bm.job.repeated-task': 'Repeated task',
  'bm.job.merge-skills': 'Duplicate skills', 'bm.job.merge-memory': 'Duplicate memories', 'bm.job.user': 'You', 'bm.job.research': 'Maintenance, approved by you', 'bm.job.orchestrator': 'Orchestrator',
  'bm.kind.skill': 'Skill', 'bm.kind.agent': 'Agent', 'bm.kind.rule': 'Rule', 'bm.kind.memory': 'Memory', 'bm.kind.script': 'Script',

  'bm.maint.title': 'Maintenance',
  'bm.maint.lead': 'It runs only when you press "Maintenance": it tidies memory and proposes, as cards in Memory → Proposals, new skills, ideas and issues to open. Nothing changes skills before your yes. Every change made is here, with its reason and "Undo".',
  'bm.maint.approvalNote': 'It also asks you for production actions, permissions (an agent\'s tools and permission ceiling), settings and hooks (an agent\'s engine included), and texts for colleagues or external systems.',
  'bm.maint.last': (p: { at: string }) => `Last pass: ${p.at}`,
  'bm.maint.never': 'No pass yet: it starts when you press "Maintenance".',
  'bm.maint.empty': 'No changes yet.',
  'bm.maint.listLabel': 'Maintenance changes',
  'bm.maint.undo': 'Undo', 'bm.maint.undone': 'Undone', 'bm.maint.undoneToast': 'Change undone.',
  'bm.maint.locked': 'Can no longer be undone: it changed since',
  'bm.maint.evidence': 'Evidence', 'bm.maint.why': 'Why',
  'bm.maint.more': (p: N) => `Show ${p.n} more`,

  'bm.mig.title': 'Runbooks and routines turned into skills',
  'bm.mig.lead': (p: { moved: number; existing: number; skipped: number; at: string }) => `${p.at}: ${p.moved} moved${p.existing ? `, ${p.existing} already there` : ''}${p.skipped ? `, ${p.skipped} skipped` : ''}. The original files stay where they were, unchanged.`,
  'bm.mig.moved': 'Moved', 'bm.mig.existing': 'Already there', 'bm.mig.skipped': 'Skipped',
  'bm.mig.lessons': (p: { lines: number; agents: number }) => `${p.lines} learned rules moved into the role of ${p.agents === 1 ? '1 agent' : `${p.agents} agents`}.`,
  'bm.mig.noAgent': 'no agent',

  'bm.rules.lead': (p: { n: number; chars: number; budget: number; app: boolean }) => `What every chat gets when it starts: ${p.n === 1 ? '1 file' : `${p.n} files`} of your brain, ${p.chars.toLocaleString('en-US')} characters of ${p.budget.toLocaleString('en-US')}${p.app ? ', plus the app’s fixed rules' : ''}. Everything else is skills, loaded when needed.`,
  'bm.rules.lead0': 'What every chat gets when it starts. Everything else is skills, loaded when needed.',
  'bm.rules.loaded.always': 'Always', 'bm.rules.loaded.topic': 'When relevant', 'bm.rules.loaded.none': 'No longer loaded',
  'bm.rules.loadedHint.always': 'Part of every chat from the start.',
  'bm.rules.loadedHint.topic': 'Added to a chat when the request, a tool or a file concerns it.',
  'bm.rules.loadedHint.none': 'No longer part of chats: topic rules became skills. The migration moves its procedures into skills.',
  'bm.rules.oldTitle': 'No longer loaded',
  'bm.rules.empty': 'No fixed files in the brain: every chat gets only the app’s fixed rules.',

  'bm.mem.title': 'Memory',

  'bm.cls.col.kind': 'Work',
  'bm.cls.kinds': 'Outcomes per kind of work',
  'bm.cls.kindsLead': 'The app’s chats per kind of work, how many have a known outcome and how many succeeded.',
  'bm.cls.col.chats': 'Chats', 'bm.cls.col.known': 'Known outcome', 'bm.cls.col.ok': 'Succeeded',
  'bm.cls.kindsEmpty': 'No chat recorded yet.',

  'bm.map.eyebrow': 'YOUR BRAIN, CONNECTED', 'bm.map.legendLabel': 'Legend',
  'bm.map.title': 'Map',
  'bm.map.lead': 'Who uses what: every agent with its skills, the rules it receives and its memory.',
  'bm.map.viewLabel': 'View', 'bm.map.view.links': 'Agents and skills', 'bm.map.view.notes': 'Brain notes',
  'bm.map.choose': 'Choose a node', 'bm.map.chooseHint': 'Select an agent, a skill, a rule or a memory to see its connections.',
  'bm.map.openAgent': 'Open the agent', 'bm.map.openSkill': 'Go to the skill', 'bm.map.openFile': 'Open the file',
  'bm.map.empty': 'The map appears once there is at least one agent.',
  'bm.map.allRules': 'Rules apply to every agent.',
  'bm.map.legend.agent': 'Agent', 'bm.map.legend.skill': 'Skill', 'bm.map.legend.rule': 'Rule', 'bm.map.legend.memory': 'Memory',
  'bm.map.usedBy': (p: N) => (p.n === 1 ? 'used by 1 agent' : `used by ${p.n} agents`),
  'bm.map.agentSkills': (p: N) => (p.n === 1 ? '1 skill' : `${p.n} skills`),

  'bm.card.flip': (p: { name: string }) => `Flip ${p.name}'s card: details and skills`,
  'bm.card.flipBack': (p: { name: string }) => `Back to the front of ${p.name}'s card`,
  'bm.card.skills': 'Skills', 'bm.card.noSkills': 'No declared skills: it works from its role.',

  'bm.card.back': 'Back',
  'bm.studio.manage': 'Manage skills',
};
