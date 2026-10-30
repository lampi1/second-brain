// German (de-AT) texts of «Flash» (was «Lampo»), the quick lane beside the Orchestrator (ADR 0105, 0107), and the model chip (lampo.it.ts).
import type { lampoIt } from './lampo.it';
export const lampoDe: typeof lampoIt = {
  'lampo.tab': 'Flash',
  'lampo.tabOrchestrator': 'Orchestrator',
  'lampo.tabsLabel': 'Orchestrator oder Flash',
  'lampo.title': 'Flash',
  'lampo.hint': 'Wie ein «übrigens»: sieht den Chat des Orchestrators, nur lesend.',
  'lampo.intro': 'Für Fragen, Erklärungen und schnelles Nachlesen, auch zur laufenden Arbeit: sieht den Chat des Orchestrators und antwortet sofort, mit eigenem Modell (oben oder auf seiner Karte unter Agenten wählen) und nur lesenden Tools. Wenn echte Arbeit nötig ist, übergibt «Mach eine Aufgabe draus» sie an den Orchestrator.',
  'lampo.start': 'Flash öffnen',
  'lampo.empty': 'Frag etwas: Die Antwort kommt in ein paar Sekunden.',
  'lampo.toWork': 'Mach eine Aufgabe draus',
  'lampo.toWorkTip': 'Flash schreibt aus dem ganzen Gespräch einen vollständigen Prompt für den Orchestrator (Ziel, Kontext, Aufgaben, Grenzen, fertig wenn): Er liegt als Entwurf bereit, du sendest ihn.',
  'lampo.draft': (p: { question: string; answer: string }) => `Aus Flash. Meine Frage: «${p.question}»${p.answer ? `\nDie Antwort: «${p.answer}»` : ''}\nMach eine Aufgabe draus: `,
  'lampo.clear': 'Kontext leeren (wie /clear)',
  'lampo.cleared': 'Flash geleert: beginnt bei null.',
  'lampo.clearFailed': (p: { error: string }) => `Flash nicht geleert: ${p.error}`,
  'modelChip.tip': (p: { engine: string; model: string }) => `${p.engine} · ${p.model}: klicken, um das Modell zu ändern`,
  'modelChip.label': (p: { name: string }) => `Modell von ${p.name}`,
  'modelChip.tier': 'Standard',
};
