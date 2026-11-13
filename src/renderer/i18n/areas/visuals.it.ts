// Italian UI texts of the "visuals" area (ADR 0057): diagrams and charts in a chat reply (components/VisualBlock.tsx)
// and the opening splash (components/Splash.tsx). Spread into it.ts. Keys start with "visuals." or "splash.".
export const visualsIt = {
  'visuals.diagram': 'Diagramma',
  'visuals.chart': 'Grafico',
  'visuals.drawing': 'Lo disegno…',
  'visuals.showCode': 'Codice',
  'visuals.showVisual': 'Disegno',
  'visuals.copy': 'Copia',
  'visuals.copied': 'Copiato',
  'visuals.zoom': 'Apri in grande',
  'visuals.diagramAlt': 'Diagramma della risposta',
  'visuals.chartAlt': (p: { title: string }) => `Grafico: ${p.title}`,
  'splash.label': 'La frase del giorno',
  'splash.skip': 'Clic o un tasto per entrare',
  // the splash's own lines (one a day, in turn)
  'splash.line.0': 'Si macina. Il caffè è per i deboli, i token per i forti.',
  'splash.line.1': 'Oggi si affilano le idee e si limano i bug.',
  'splash.line.2': 'La mola gira, le scintille volano, i task cadono.',
  'splash.line.3': 'Un giorno senza macinare è un giorno con meno PR.',
  'splash.line.4': 'Gli ingranaggi sono oliati. Gli agenti un po’ meno.',
  'splash.line.5': 'Macinare oggi, festeggiare venerdì.',
  'splash.line.6': 'Ogni scintilla è un test che diventa verde.',
  'splash.line.7': 'Il backlog non si svuota da solo. Per fortuna ci sono gli agenti.',
  'splash.line.8': 'La smerigliatrice è accesa: occhiali di protezione consigliati.',
  'splash.line.9': 'Il grind non si ferma. Al massimo fa una pausa caffè.',
  'splash.line.10': 'Da qui si esce solo a lavoro finito. O con un riavvio.',
  'splash.line.11': 'Turno doppio per gli agenti. Il sindacato è stato avvisato.',
};
