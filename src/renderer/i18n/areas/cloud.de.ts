// German (de-AT) counterparts of the cloud agents' dictionary (ADR 0080, cloud.it.ts).
import type { cloudIt } from './cloud.it';
export const cloudDe: typeof cloudIt = {
  'cloud.badge': 'Cloud',
  'cloud.badgeTip': 'Läuft in der Cloud des Anbieters, nicht auf diesem PC',
  'cloud.area': (p: { area: string }) => `${p.area} · Cloud`,
  'cloud.status.queued': 'in Warteschlange', 'cloud.status.running': 'arbeitet', 'cloud.status.waiting': 'wartet auf dich',
  'cloud.status.done': 'fertig', 'cloud.status.failed': 'Fehler', 'cloud.status.stopped': 'gestoppt', 'cloud.status.unknown': 'Status auf claude.ai',
  'cloud.fromPlan': 'aus deinem Abo',
  'cloud.open': 'Öffnen', 'cloud.openTip': 'Öffnet die Seite des Anbieters in einem internen Browser-Tab',
  'cloud.stop': 'Stoppen', 'cloud.apply': 'Heimholen', 'cloud.applyTip': 'Übernimmt das Ergebnis in einen neuen Worktree neben dem Repository (nie in den verwendeten Ordner)',
  'cloud.dismiss': 'Aus der Liste entfernen', 'cloud.expand': 'Ausklappen', 'cloud.collapse': 'Einklappen',
  'cloud.followUp': 'Dem Agenten schreiben…', 'cloud.send': 'Senden',
  'cloud.webOnly': (p: { engine: string }) => `Nachrichten und Stopp für ${p.engine} gehen über seine Seite: „Öffnen“.`,
  'cloud.noOutput': 'Der Anbieter zeigt der App seine Nachrichten nicht: Öffne sie auf seiner Seite.',
  'cloud.noMessages': 'Noch keine Nachrichten: Sie aktualisieren sich, solange die Leiste offen ist.',
  'cloud.by.agent': 'vom Orchestrator geöffnet', 'cloud.by.user': 'von dir geöffnet', 'cloud.by.vendor': 'außerhalb der App geöffnet',
  'cloud.failed': (p: { why: string }) => `Cloud-Agent: ${p.why}`,
  'cloud.applied': (p: { path: string }) => `Ergebnis heimgeholt: ${p.path}`,
  
  
  
  
  'cloud.key': 'Schlüssel für Cursor Cloud Agents',
  'cloud.keyHint': 'Aus dem Cursor Dashboard → Integrations. Nur für Cloud-Agenten (API-Preise, zählen zum Cursor-Ausgabenlimit); verschlüsselt auf diesem PC, nie angezeigt.',
};
