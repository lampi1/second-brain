// English UI texts of the "Manutenzione" button: the same keys as memory.it.ts (typed by
// it), spread into en.ts.
import type { memoryIt } from './memory.it';
type N = { n: number };
export const memoryEn: typeof memoryIt = {
  'mm.maint.button': 'Maintenance', 'mm.maint.running': 'Maintenance running…',
  'mm.maint.helpTitle': 'What maintenance does',
  'mm.maint.help1': 'One click and that is all: the app tidies skills, rules and memory, reads its logs and an invisible agent studies your history to propose improvements. It works in the background: you can keep doing other things.',
  'mm.maint.help2': 'Everything arrives as cards in Memoria → Proposte: new skills, what to forget, and the issues to open on GitHub (your yes opens them at once). Ideas about the app also land in Ideas, on the AI\'s side. Nothing changes without your yes.',
  'mm.maint.help3': 'It happens only when you press it: ideas, proposals and the memory cleanup never start by themselves. The research uses tokens, 5 $ at most each time; you get a notice when it ends.',
  'mm.one.tip': 'Maintenance: one click, then it works by itself in the background',
  'mm.one.tipCleanup': 'Tidying skills, rules and memory…',
  'mm.one.tipResearch': (p: { cost: string; cap: string }) => `An agent is looking for improvements: ${p.cost} spent of ${p.cap}. You get a notice when it ends.`,
  'mm.one.liveResearch': (p: { cost: string; cap: string; n: number }) => `Working in the background · ${p.n === 1 ? '1 card' : `${p.n} cards`} so far · ${p.cost} of ${p.cap}`,
  'mm.one.started': 'Maintenance started: it works in the background, you get a notice when it ends.',
  'mm.one.stop': 'Stop',
  'mm.one.last': (p: { at: string; what: string }) => `Last: ${p.at} · ${p.what}`,
  'mm.done.proposals': (p: N) => (p.n === 1 ? '1 proposal' : `${p.n} proposals`),
  'mm.done.ideas': (p: N) => (p.n === 1 ? '1 idea' : `${p.n} ideas`),
  'mm.done.issues': (p: N) => (p.n === 1 ? '1 issue to open' : `${p.n} issues to open`),
  'mm.done.made': (p: { what: string }) => `Maintenance done: ${p.what}`,
  'mm.done.nothing': 'Maintenance done: everything was already in order.',
  'mm.done.failed': 'Maintenance done, but the research failed',
  'mm.done.stopped': 'Maintenance stopped before the end',
  'mm.done.capped': 'Maintenance stopped at the spending cap',
  'mm.done.label': 'Maintenance done', 'mm.done.title': 'Your brain is in order',
  'mm.done.open': 'Open Memoria',

  // the one-click maintenance (ADR 0132, 0153)
};
