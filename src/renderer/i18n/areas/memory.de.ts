// German (de-AT) UI texts of the "Manutenzione" button: the same keys as memory.it.ts (typed by
// it), spread into de.ts.
import type { memoryIt } from './memory.it';
type N = { n: number };
export const memoryDe: typeof memoryIt = {
  'mm.maint.button': 'Wartung', 'mm.maint.running': 'Wartung läuft…',
  'mm.maint.helpTitle': 'Was die Wartung macht',
  'mm.maint.help1': 'Ein Klick und fertig: Die App räumt Skills, Regeln und Gedächtnis auf, liest ihre Logs, und ein unsichtbarer Agent studiert deinen Verlauf, um Verbesserungen vorzuschlagen. Er arbeitet im Hintergrund: Du kannst weiterarbeiten.',
  'mm.maint.help2': 'Alles kommt als Karten in Memoria → Proposte: neue Skills, was vergessen werden kann, und die Issues für GitHub (mit deinem Ja werden sie sofort angelegt). Ideen zur App landen auch in Ideen, auf der Seite der KI. Ohne dein Ja ändert sich nichts.',
  'mm.maint.help3': 'Das passiert nur, wenn du drückst: Ideen, Vorschläge und das Aufräumen des Gedächtnisses starten nie von selbst. Die Recherche verbraucht Tokens, höchstens 5 $ pro Mal; wenn sie fertig ist, sagt die App Bescheid.',
  'mm.one.tip': 'Wartung: ein Klick, dann arbeitet sie allein im Hintergrund',
  'mm.one.tipCleanup': 'Skills, Regeln und Gedächtnis werden aufgeräumt…',
  'mm.one.tipResearch': (p: { cost: string; cap: string }) => `Ein Agent sucht nach Verbesserungen: ${p.cost} von ${p.cap} ausgegeben. Du bekommst Bescheid, wenn er fertig ist.`,
  'mm.one.liveResearch': (p: { cost: string; cap: string; n: number }) => `Arbeitet im Hintergrund · bisher ${p.n === 1 ? '1 Karte' : `${p.n} Karten`} · ${p.cost} von ${p.cap}`,
  'mm.one.started': 'Wartung gestartet: Sie arbeitet im Hintergrund, du bekommst Bescheid, wenn sie fertig ist.',
  'mm.one.stop': 'Stopp',
  'mm.one.last': (p: { at: string; what: string }) => `Zuletzt: ${p.at} · ${p.what}`,
  'mm.done.proposals': (p: N) => (p.n === 1 ? '1 Vorschlag' : `${p.n} Vorschläge`),
  'mm.done.ideas': (p: N) => (p.n === 1 ? '1 Idee' : `${p.n} Ideen`),
  'mm.done.issues': (p: N) => (p.n === 1 ? '1 Issue zum Anlegen' : `${p.n} Issues zum Anlegen`),
  'mm.done.made': (p: { what: string }) => `Wartung fertig: ${p.what}`,
  'mm.done.nothing': 'Wartung fertig: Es war schon alles in Ordnung.',
  'mm.done.failed': 'Wartung fertig, aber die Recherche hat nicht geklappt',
  'mm.done.stopped': 'Wartung vor dem Ende gestoppt',
  'mm.done.capped': 'Wartung beim Ausgabenlimit gestoppt',
  'mm.done.label': 'Wartung fertig', 'mm.done.title': 'Dein Brain ist in Ordnung',
  'mm.done.open': 'Memoria öffnen',

  // the one-click maintenance (ADR 0132, 0153)
};
