// German (de-AT) UI texts of the statistics redesign: the same keys as stats.it.ts (typed by it), spread into de.ts.
import type { statsIt } from './stats.it';
type N = { n: number };

export const statsDe: typeof statsIt = {
  'stats.cost.factDay': (p: { day: string; usd: string; x: string }) => `Der teuerste Tag war ${p.day}: ${p.usd}, ${p.x}× der Durchschnitt des Zeitraums.`,
  'stats.cost.factModel': (p: { model: string; pct: string }) => `${p.model} macht ${p.pct} der Ausgaben des Zeitraums aus.`,
  'stats.cost.factKind': (p: { kind: string; usd: string }) => `Die teuerste Arbeitsart ist "${p.kind}": ${p.usd} im Zeitraum.`,

  'stats.err.recurring': 'Wiederkehrende Fehler',
  'stats.err.recurringHelp': 'Gruppen von App- und Tool-Fehlern mit derselben Ursache (Nutzungslimit, Netzwerk, Login…) oder, bei unbekannter Ursache, demselben Text ohne Zahlen, IDs, Pfade und Links; es zählen die, die in den gespeicherten Daten (Feed und offene Chats) mindestens zweimal vorkommen.',
  'stats.err.events': 'Fehlerereignisse',
  'stats.err.eventsHelp': 'Jeder Fehler, der im Feed der App und in den Nachrichten der noch geladenen Chats gespeichert ist: ein schlecht beendeter Turn, ein fehlgeschlagenes Tool, eine Systemwarnung. Nicht der komplette Log-Verlauf.',
  'stats.err.recurringNote': 'Mindestens zweimal in den gespeicherten Daten', 'stats.err.eventsNote': 'Im Feed und in den geladenen Chats',
  'stats.err.groups': 'App- und Tool-Fehler, gruppiert',
  'stats.err.groupsLead': 'Jede Karte ist ein wiederkehrender Fehler: wie oft, wann zuletzt, wo, was er bedeutet und was zu tun ist.',
  'stats.err.groupsEmpty': 'Kein App- oder Tool-Fehler in den gespeicherten Daten. Tritt einer auf, findest du hier, was er bedeutet und was zu tun ist.',
  'stats.err.times': (p: N) => (p.n === 1 ? 'einmal' : `${p.n}-mal`),
  'stats.err.last': (p: { at: string }) => `zuletzt ${p.at}`,
  'stats.err.first': (p: { at: string }) => `zuerst gesehen ${p.at}`,
  'stats.err.where': 'Wo',
  'stats.err.skills': 'Genutzte Skills',
  'stats.err.what': 'Was er bedeutet',
  'stats.err.todo': 'Was zu tun ist',
  'stats.err.trend.up': 'steigend', 'stats.err.trend.down': 'fallend', 'stats.err.trend.flat': 'stabil',
  'stats.err.trendHelp': 'Vergleicht die letzten 7 Tage mit den 7 davor: steigend bei mehr, fallend bei weniger. Jeder Balken ist ein Tag, heute ist der letzte.',
  'stats.err.memory': 'Jeder erfasste Fehler mit der jeweils erzeugten Regel steht auch auf der Seite Gedächtnis.',
  'stats.err.openMemory': 'Gedächtnis öffnen',
  'stats.err.factWorst': (p: { pct: string; what: string }) => `${p.pct} der App-Fehler haben eine Ursache: ${p.what}.`,

  'stats.cause.rateLimit.t': 'Nutzungslimit erreicht', 'stats.cause.rateLimit.w': 'Die Engine hat eine Weile weitere Anfragen abgelehnt: Du hast das Kontingent des Plans aufgebraucht oder zu viele Chats fragen gleichzeitig.', 'stats.cause.rateLimit.f': 'Warte auf den Reset (oben in der Leiste) oder pausier die weniger dringenden Chats; passiert es oft, verschieb leichte Jobs auf ein günstigeres Modell.',
  'stats.cause.overloaded.t': 'Dienst überlastet', 'stats.cause.overloaded.w': 'Der Modellanbieter war vorübergehend voll: Das liegt weder an dir noch an der App.', 'stats.cause.overloaded.f': 'Versuch es in ein paar Minuten nochmal; hält es an, schau auf die Statusseite des Anbieters.',
  'stats.cause.context.t': 'Kontext voll', 'stats.cause.context.w': 'Der Chat hat das Maximum erreicht, das das Modell auf einmal lesen kann.', 'stats.cause.context.f': 'Mach in einem neuen Chat weiter (die Übergabe nimmt die Zusammenfassung mit) oder senk "Max. Kontext" im Profil der Rolle.',
  'stats.cause.auth.t': 'Login abgelaufen oder abgelehnt', 'stats.cause.auth.w': 'Die Engine oder ein Dienst erkennt deinen Login nicht mehr.', 'stats.cause.auth.f': 'Meld dich über die Kommandozeile der Engine oder Einstellungen → Engines neu an; die App rührt deine Zugangsdaten nie an.',
  'stats.cause.timeout.t': 'Zeitüberschreitung', 'stats.cause.timeout.w': 'Ein Befehl oder eine Anfrage hat länger als erlaubt gedauert und wurde gestoppt.', 'stats.cause.timeout.f': 'Versuch es nochmal; kommt es beim selben Befehl wieder, bitte den Agenten, ihn in kleinere Schritte aufzuteilen.',
  'stats.cause.network.t': 'Netzwerkproblem', 'stats.cause.network.w': 'Ein Dienst war nicht erreichbar: kein Netz, VPN aus oder falsche Adresse.', 'stats.cause.network.f': 'Prüf die Verbindung und das VPN, dann versuch es nochmal.',
  'stats.cause.notFound.t': 'Datei oder Ressource fehlt', 'stats.cause.notFound.w': 'Ein Agent hat eine Datei, einen Ordner oder eine Seite gesucht, die es nicht gibt (oft ein aus dem Gedächtnis geschriebener Pfad).', 'stats.cause.notFound.f': 'Kommt es beim selben Pfad wieder, schreib ihn in eine Regel oder ins Gedächtnis des Agenten.',
  'stats.cause.permission.t': 'Berechtigung verweigert', 'stats.cause.permission.w': 'Eine Aktion wurde blockiert: von dir, von der Rolle (nur lesen) oder vom Betriebssystem.', 'stats.cause.permission.f': 'Braucht die Rolle es wirklich, erweitere ihre Berechtigungen auf ihrer Karte unter Agenten; sonst passt es so.',
  'stats.cause.mcp.t': 'MCP-Tool nicht verfügbar', 'stats.cause.mcp.w': 'Ein Tool-Server (MCP) hat nicht geantwortet oder die Verbindung getrennt.', 'stats.cause.mcp.f': 'Starte den Chat neu; ist es immer derselbe Server, prüf ihn unter Einstellungen → Konnektoren.',
  'stats.cause.turn.t': 'Turn mit Fehler beendet', 'stats.cause.turn.w': 'Die Engine hat ihre Antwort mit einem Fehler abgeschlossen, ohne zu sagen, welchem.', 'stats.cause.turn.f': 'Öffne den Chat und lies die letzte Nachricht; die Logs der App (npm run logs) haben die Details.',
  'stats.cause.tool.t': 'Tool fehlgeschlagen', 'stats.cause.tool.w': 'Ein Tool-Aufruf (Befehl, Lesen, Suche) kam mit einem Fehler zurück; der Agent versucht es meist selbst nochmal.', 'stats.cause.tool.f': 'Wiederholt es sich beim selben Tool, schau dir das Beispiel an: oft ein Befehl oder Pfad, der in einem Skill zu korrigieren ist.',
  'stats.cause.other.t': 'Fehler', 'stats.cause.other.w': 'Ein Fehler ohne erkannte Ursache: Der Text sagt, was passiert ist.', 'stats.cause.other.f': 'Kommt er wieder, besprich ihn mit dem Orchestrator: Er hat die Details und kann eine Regel vorschlagen.',
};
