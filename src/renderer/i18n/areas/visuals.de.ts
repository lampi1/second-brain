// German UI texts of the "visuals" area (ADR 0057, German as in Austria: ADR 0117): the same keys as visuals.it.ts
// (typed by it), spread into de.ts.
import type { visualsIt } from './visuals.it';

export const visualsDe: typeof visualsIt = {
  'visuals.diagram': 'Diagramm',
  'visuals.chart': 'Grafik',
  'visuals.drawing': 'Wird gezeichnet…',
  'visuals.showCode': 'Code',
  'visuals.showVisual': 'Zeichnung',
  'visuals.copy': 'Kopieren',
  'visuals.copied': 'Kopiert',
  'visuals.zoom': 'Groß öffnen',
  'visuals.diagramAlt': 'Diagramm der Antwort',
  'visuals.chartAlt': (p: { title: string }) => `Grafik: ${p.title}`,
  'splash.label': 'Der Satz des Tages',
  'splash.skip': 'Klick oder Taste zum Eintreten',
  'splash.line.0': 'Hier wird geschliffen. Kaffee ist für die Schwachen, Tokens für die Starken.',
  'splash.line.1': 'Heute schärfen wir Ideen und feilen Bugs weg.',
  'splash.line.2': 'Die Scheibe dreht sich, Funken fliegen, Aufgaben fallen.',
  'splash.line.3': 'Ein Tag ohne Schleifen ist ein Tag mit weniger PRs.',
  'splash.line.4': 'Die Zahnräder sind geölt. Die Agenten ein bisserl weniger.',
  'splash.line.5': 'Heute schleifen, am Freitag feiern.',
  'splash.line.6': 'Jeder Funke ist ein Test, der grün wird.',
  'splash.line.7': 'Der Backlog leert sich nicht von selbst. Zum Glück gibt’s die Agenten.',
  'splash.line.8': 'Der Winkelschleifer läuft: Schutzbrille empfohlen.',
  'splash.line.9': 'Der Grind hört nie auf. Höchstens für eine Kaffeepause.',
  'splash.line.10': 'Raus geht’s erst, wenn die Arbeit erledigt ist. Oder nach einem Neustart.',
  'splash.line.11': 'Doppelschicht für die Agenten. Die Gewerkschaft ist informiert.',
};
