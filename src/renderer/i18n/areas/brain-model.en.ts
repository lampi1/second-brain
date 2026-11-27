// English UI texts of the Brain section (ADR 0077): the same keys as brain-model.it.ts (typed by it), spread into en.ts.
import type { brainModelIt } from './brain-model.it';
type N = { n: number };

export const brainModelEn: typeof brainModelIt = {
  'bm.loading': 'Reading the brain…',
  'bm.noBrain': 'Choose the brain folder first.',
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


  'bm.mem.title': 'Memory',


  'bm.map.eyebrow': 'YOUR BRAIN, CONNECTED', 'bm.map.legendLabel': 'Legend',
  'bm.map.title': 'Links',
  'bm.map.lead': 'Who uses what: every agent with its skills, the rules it receives and its memory.',
  'bm.map.viewLabel': 'View', 'bm.map.view.links': 'Agents and skills', 'bm.map.view.notes': 'Brain notes',
  'bm.map.choose': 'Choose a node', 'bm.map.chooseHint': 'Select an agent, a skill, a rule or a memory to see its connections.',
  'bm.map.openAgent': 'Open the agent', 'bm.map.openSkill': 'Go to the skill', 'bm.map.openFile': 'Open the file',
  'bm.map.empty': 'The map appears once there is at least one agent.',
  'bm.map.allRules': 'Rules apply to every agent.',
  'bm.map.legend.agent': 'Agent', 'bm.map.legend.skill': 'Skill', 'bm.map.legend.rule': 'Rule', 'bm.map.legend.memory': 'Memory',
  'bm.map.usedBy': (p: N) => (p.n === 1 ? 'used by 1 agent' : `used by ${p.n} agents`),
  'bm.map.agentSkills': (p: N) => (p.n === 1 ? '1 skill' : `${p.n} skills`),
  
  // ADR 0326 · how far the project is: the percentage, the progress card and the plan card of the side panel
  // #443 · phases and steps in a line, the arrow to the following step, proofs and links, the panel's width

  'bm.card.flip': (p: { name: string }) => `Flip ${p.name}'s card: details and skills`,
  'bm.card.flipBack': (p: { name: string }) => `Back to the front of ${p.name}'s card`,
  'bm.card.skills': 'Skills', 'bm.card.noSkills': 'No declared skills: it works from its role.',

  'bm.card.back': 'Back',
};
