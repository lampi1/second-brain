// German (de-AT) UI texts of the Brain section (ADR 0077): the same keys as brain-model.it.ts (typed by it), spread into de.ts.
import type { brainModelIt } from './brain-model.it';
type N = { n: number };

export const brainModelDe: typeof brainModelIt = {
  'bm.loading': 'Lese das Brain…',
  'bm.noBrain': 'Wähl zuerst den Brain-Ordner.',
  'bm.lines': (p: N) => (p.n === 1 ? '1 Zeile' : `${p.n} Zeilen`),
  'bm.changed': (p: { at: string }) => `geändert ${p.at}`,

  'bm.job.upgrade': 'Brain-Aktualisierung', 'bm.job.migration': 'Migration', 'bm.job.corrections': 'Korrekturen', 'bm.job.repeated-task': 'Wiederholte Arbeit',
  'bm.job.merge-skills': 'Doppelte Skills', 'bm.job.merge-memory': 'Doppelte Erinnerungen', 'bm.job.user': 'Du', 'bm.job.research': 'Wartung, von dir bestätigt', 'bm.job.orchestrator': 'Orchestrator',
  'bm.kind.skill': 'Skill', 'bm.kind.agent': 'Agent', 'bm.kind.rule': 'Regel', 'bm.kind.memory': 'Gedächtnis', 'bm.kind.script': 'Skript',

  'bm.maint.title': 'Wartung',
  'bm.maint.lead': 'Sie läuft nur, wenn du „Wartung“ drückst: Sie räumt das Gedächtnis auf und schlägt als Karten unter Gedächtnis → Vorschläge neue Skills, Ideen und zu öffnende Issues vor. Nichts ändert Skills vor deinem Ja. Jede gemachte Änderung steht hier, mit Grund und „Rückgängig“.',
  'bm.maint.approvalNote': 'Sie fragt dich auch bei Aktionen in Produktion, Berechtigungen (Tools und Berechtigungsobergrenze eines Agenten), Einstellungen und Hooks (inklusive der Engine eines Agenten) und Texten für Kollegen oder externe Systeme.',
  'bm.maint.last': (p: { at: string }) => `Letzter Durchlauf: ${p.at}`,
  'bm.maint.never': 'Noch kein Durchlauf: startet, wenn du „Wartung“ drückst.',
  'bm.maint.empty': 'Noch keine Änderungen.',
  'bm.maint.listLabel': 'Änderungen der Wartung',
  'bm.maint.undo': 'Rückgängig', 'bm.maint.undone': 'Rückgängig gemacht', 'bm.maint.undoneToast': 'Änderung rückgängig gemacht.',
  'bm.maint.locked': 'Nicht mehr rückgängig zu machen: seitdem geändert',
  'bm.maint.evidence': 'Belege', 'bm.maint.why': 'Warum',
  'bm.maint.more': (p: N) => `${p.n} weitere anzeigen`,

  'bm.mig.title': 'Runbooks und Routinen, die zu Skills wurden',
  'bm.mig.lead': (p: { moved: number; existing: number; skipped: number; at: string }) => `${p.at}: ${p.moved} verschoben${p.existing ? `, ${p.existing} schon vorhanden` : ''}${p.skipped ? `, ${p.skipped} übersprungen` : ''}. Die Originaldateien bleiben unverändert, wo sie waren.`,
  'bm.mig.moved': 'Verschoben', 'bm.mig.existing': 'Schon vorhanden', 'bm.mig.skipped': 'Übersprungen',
  'bm.mig.lessons': (p: { lines: number; agents: number }) => `${p.lines} gelernte Regeln in die Rolle von ${p.agents === 1 ? '1 Agenten' : `${p.agents} Agenten`} verschoben.`,
  'bm.mig.noAgent': 'kein Agent',


  'bm.mem.title': 'Gedächtnis',


  'bm.map.eyebrow': 'DEIN BRAIN, VERNETZT', 'bm.map.legendLabel': 'Legende',
  'bm.map.title': 'Verbindungen',
  'bm.map.lead': 'Wer nutzt was: jeder Agent mit seinen Skills, den Regeln, die er bekommt, und seinem Gedächtnis.',
  'bm.map.viewLabel': 'Ansicht', 'bm.map.view.links': 'Agenten und Skills', 'bm.map.view.notes': 'Brain-Notizen',
  'bm.map.choose': 'Wähl einen Knoten', 'bm.map.chooseHint': 'Wähl einen Agenten, einen Skill, eine Regel oder ein Gedächtnis, um die Verbindungen zu sehen.',
  'bm.map.openAgent': 'Agent öffnen', 'bm.map.openSkill': 'Zum Skill', 'bm.map.openFile': 'Datei öffnen',
  'bm.map.empty': 'Die Karte erscheint, sobald es mindestens einen Agenten gibt.',
  'bm.map.allRules': 'Regeln gelten für jeden Agenten.',
  'bm.map.legend.agent': 'Agent', 'bm.map.legend.skill': 'Skill', 'bm.map.legend.rule': 'Regel', 'bm.map.legend.memory': 'Gedächtnis',
  'bm.map.usedBy': (p: N) => (p.n === 1 ? 'genutzt von 1 Agenten' : `genutzt von ${p.n} Agenten`),
  'bm.map.agentSkills': (p: N) => (p.n === 1 ? '1 Skill' : `${p.n} Skills`),
  
  'skills.untracked': 'Nutzung nicht erfasst', 'skills.untrackedTip': 'Diese Engine sagt nicht, welche Skills sie nutzt: nur die, die sie über das Lesen einer SKILL.md öffnet, erscheinen hier.',
  // ADR 0326 · how far the project is: the percentage, the progress card and the plan card of the side panel
  // #443 · phases and steps in a line, the arrow to the following step, proofs and links, the panel's width

  'bm.card.flip': (p: { name: string }) => `Karte von ${p.name} umdrehen: Details und Skills`,
  'bm.card.flipBack': (p: { name: string }) => `Zurück zur Vorderseite der Karte von ${p.name}`,
  'bm.card.skills': 'Skills', 'bm.card.noSkills': 'Keine angegebenen Skills: arbeitet mit seiner Rolle.',

  'bm.card.back': 'Zurück',
};
