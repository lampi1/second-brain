// Deutsche Texte der überarbeiteten Oberfläche (ADR 0366, Issue #491): die Abschnitte des Grindhouse und das ⓘ eines
// Streifens, der Versions-Chip der oberen Leiste.
import type { grindIt } from './grind.it';
export const grindDe: typeof grindIt = {
  'grind.sec.wait': 'Wartet auf dich',
  'grind.sec.work': 'Bei der Arbeit',
  'grind.sec.done': 'Heute fertig',
  'grind.info': 'Details: Modell, Schätzung, Skills',
  'grind.est': p => `Schätzung ${p.est}`,
  'grind.skills': p => `Skills: ${p.list}`,
  'grind.skillsLoaded': p => `geladene Skills (Nutzung nicht erfasst): ${p.list}`,
  'grind.where': p => `Projekt: ${p.where}`,
  'version.updated': 'Aktualisiert auf',
  'version.news': 'Neuigkeiten',
  'version.newsTip': 'Was neu ist: öffnet Einstellungen → Aktualisierungen',
  'version.new': 'Neue Version',
  'version.update': 'Aktualisieren',
  'version.newTip': p => `Auf GitHub gibt es eine neue Version: ${p.subject}`,
  'version.dismiss': 'Versionshinweis schließen',
};
