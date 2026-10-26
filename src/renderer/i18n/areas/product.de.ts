// German (de-AT) counterpart of the agent workspace and packaged appearance UI (product.it.ts).
import type{productIt}from'./product.it';
export const productDe:typeof productIt={
 "viewer.reviewSelection":"Auswahl kommentieren",
 "viewer.reviewTitle":"Diesen Teil kommentieren",
 "viewer.reviewRegion":"Ausgewählter Bildbereich",
 "viewer.reviewComment":"Dein Kommentar",
 "viewer.reviewPlaceholder":"Was soll geprüft oder geändert werden?",
 "viewer.reviewDraftHint":"Sende deinen Kommentar oder bereite eine Nachricht vor, die du im Orchestrator prüfst.",
 "viewer.reviewPrepare":"Nachricht vorbereiten",
 "viewer.reviewSend":"An den Orchestrator senden",
 "viewer.reviewUnavailable":"Orchestrator nicht verfügbar. Dein Kommentar bleibt hier; versuch es erneut.",

 "viewer.imageBefore":"Vorher",
 "viewer.imageAfter":"Nachher",
 "report.image.select":"Bereich auswählen",
 "report.image.hint":"Zieh über das Bild, um einen Bereich auszuwählen.",
 "report.image.clear":"Auswahl aufheben",
 "report.image.commentRegion":"Bereich kommentieren",
 "report.image.commentWhole":"Ganzes Bild kommentieren",

 
 'product.transcriptLoading':'Lade','product.transcriptEmpty':'Noch keine Nachrichten: Beschreib unten, womit du anfangen willst.',
 
 
 'start.cancel':'Abbrechen',
 'readiness.unknown':'Die Verfügbarkeit der Engine wurde nicht überprüft.','readiness.disabled':'deaktiviert','readiness.trust':'braucht eine Freigabe in den Einstellungen','readiness.configure':'muss auf diesem Computer konfiguriert werden','readiness.signIn':'Anmeldung nötig','readiness.ready':'installiert und Anmeldung überprüft','readiness.unchecked':'Installation oder Anmeldung muss überprüft werden','readiness.login':'Anmelden',
 'viewer.title':'Datei','viewer.chooseFile':'Öffne eine Datei aus einer Unterhaltung oder einem Quell-Link.','viewer.copyPath':'Pfad kopieren','viewer.showInFolder':'Im Ordner anzeigen','viewer.folderError':'Der Ordner konnte nicht angezeigt werden.','viewer.formatted':'Formatiert','viewer.source':'Quelltext','viewer.table':'Tabelle','viewer.mode':'Ansicht','viewer.readOnly':'Schreibgeschützt','viewer.jsonlLine':'Zeile',
 
 'viewer.compare':'Vergleichen','viewer.compareHead':'Mit HEAD','viewer.compareRef':'Mit einem Commit oder Branch','viewer.compareFile':'Mit einer anderen Datei','viewer.refPlaceholder':'z. B. main, HEAD~1, a1b2c3d','viewer.filePlaceholder':'Pfad der anderen Datei','viewer.compareRun':'Unterschiede anzeigen','viewer.diffWorking':'Berechne die Unterschiede…','viewer.diffSame':'Keine Unterschiede.','viewer.diffSlow':'Zu viele Unterschiede, um sie hier zu berechnen.','viewer.diffCut':p=>`Zeige die ersten ${p.n} Zeilen des Vergleichs.`,'viewer.diffBinary':'Eine der beiden ist keine Textdatei.','viewer.diffBig':'Eine der beiden überschreitet das Vergleichslimit von 2 MB.','viewer.diffRepo':'Die Datei liegt in keinem git-Repository.','viewer.diffUntracked':'Die Datei existiert in dieser Version nicht.','viewer.diffRef':'Commit oder Branch nicht gefunden.','viewer.diffGit':'git konnte diese Version nicht lesen.',
 'viewer.imageRemote':'Externes Bild nicht geladen: Der Viewer zeigt nur Dateien auf diesem PC.','viewer.imageType':'Bild nicht angezeigt: nur PNG, JPG oder WebP.','viewer.imageNotShown':(p:{name:string;reason:string})=>`Bild nicht angezeigt (${p.name}): ${p.reason}`,'viewer.imageZoom':'Klicken, um es groß zu sehen','viewer.report':'Bericht',
 'chat.items.outputLoading':'Vollständige Ausgabe wird geladen…','chat.items.outputFailed':'Teilvorschau: Vollständige Ausgabe konnte nicht geladen werden. ',
 'viewer.loading':'Öffne Datei…','viewer.outside':'Nur Dateien auf diesem Computer: Netzwerkfreigaben und relative Pfade ohne Ordner werden nicht geöffnet.','viewer.unsupported':'Das ist keine Datei (ein Ordner oder ein Gerät).','viewer.missing':'Die Datei ist nicht verfügbar.','viewer.changed':'Die Datei hat sich beim Öffnen geändert. Öffne sie erneut.','viewer.binary':'Diese Datei enthält keinen lesbaren Text.','viewer.image':'Das Bild wird nicht unterstützt oder überschreitet die Limits des Viewers.','viewer.page':p=>`Bytes ${p.from}–${p.to} von ${p.total}`,'viewer.lines':p=>`Zeilen ${p.first}–${p.last}`,'viewer.pageFirst':'Anfang','viewer.pagePrevious':'Zurück','viewer.pageNext':'Weiter','viewer.pageLast':'Ende','viewer.pdf':'Dieses PDF kann nicht angezeigt werden (beschädigt oder über 32 MB).','viewer.pdfPage':p=>`Seite ${p.n}`,'viewer.lineUnavailable':'Die zitierte Zeile liegt außerhalb des geladenen Teils.','viewer.window':p=>`Zeilen ${p.first}–${p.last} von ${p.total}`,
 'ui.newBrowser':'Neuer Browser','ui.browserMine':'Dein Tab','ui.browserAddress':'Adresse eingeben','ui.browserEditAddress':'Adresse bearbeiten','ui.browserOpenError':p=>`Browser konnte nicht geöffnet werden: ${p.error}`,
 'ui.state.waiting':'wartet auf dich','ui.state.queued':'in der Warteschlange','ui.state.running':'arbeitet','ui.state.starting':'startet…','ui.state.error':'Fehler','ui.state.closed':'geschlossen','ui.state.orchestrator':'hört zu','ui.state.done':'fertig','ui.state.children':'wartet auf Subagenten',
 
 'ui.close':'Schließen','ui.other':'Andere…','ui.writeAnswer':'schreib deine Antwort','ui.mapDetails':'Quellen und Details',
 'context.handoffBusy':"Bereite die Übergabe vor.",
 'context.native':'Codex verwaltet die native Komprimierung. Die Kontextlänge allein erfordert keinen neuen Chat.','context.passive':'Von der Engine gemeldete Kontextgröße; in einem neuen Chat fortzusetzen bleibt eine manuelle Entscheidung.',
 'origin.user':'Benutzer','origin.unavailable':'Nicht verfügbar','origin.missingHint':'Die Quelle verzeichnet das ursprüngliche Modell nicht. Das aktuelle Modell wird historischen Einträgen nie zugeordnet.',
 'product.appearance':'Aussehen und Layout','product.style':'Stil','product.standard':'Schlicht','product.calm':'Ruhig','product.catalog':'Agentenkatalog','product.grid':'Karten','product.list':'Liste','product.preview':'Vorschau','product.apply':'Anwenden','product.reset':'Aussehen zurücksetzen',
 'product.research':'Recherche','product.researchPurpose':'Quellen und Zusammenfassungen für deine Arbeit','product.organization':'Planung','product.organizationPurpose':'Prioritäten und nächste Schritte',
 'product.avatar':p=>`Symbol für ${p.name}`,
 'product.expand':'Arbeit öffnen','product.waitsYou':'Wartet auf dich','product.waitsYouOpen':(p:{title:string})=>`Entscheidung von ${p.title} öffnen`,'product.collapse':'Zur Leiste einklappen','product.write':'Schreiben','product.details':'Details und Mitwirkende','product.profiles':'Profile','product.purpose':'Zweck','product.model':'Modell',
 'product.workAssigned':'Offene Aufgabe','product.workWaiting':'Wartet auf Post','product.workCompleted':'Aufgabe erledigt','product.workDeclare':'Arbeitsstatus','product.workUnset':'Status nicht gesetzt','product.noTask':'Aufgabe nicht gemeldet',
 'product.teamUnknown':'Subagenten: Daten nicht verfügbar','product.teamComplete':p=>`Subagenten: ${p.active} aktiv · ${p.total} gesamt`,'product.teamPartial':p=>`Beobachtet: ${p.active} aktiv · ${p.total} gesamt · Teildaten`,
 'product.observed':'Beobachtete Aktivität','product.replayed':'wiederhergestellte Beobachtung','product.parent':'Übergeordnet','product.notReported':'Nicht gemeldet','product.parentMissing':'In den Beobachtungen nicht vorhanden',
 'product.running':'Arbeitet','product.waiting':'Wartet','product.completed':'Erledigt','product.failed':'Fehler','product.stopped':'Gestoppt','product.unknown':'Status nicht gemeldet',
 'product.teamExplain':'Von der Engine beobachtete interne Mitwirkende. Fehlende Daten bedeuten nicht null Aktivität.','product.teamEmpty':'Keine interne Aktivität beobachtet.','product.teamIncomplete':'Die Engine liefert keine vollständige Liste.',
 'product.child.agent':'Subagent','product.childNoAgent':'kein Agent','product.child.shell':'Befehl','product.child.unknown':'Aktivität','product.childrenOf':p=>`Subagenten von ${p.title}`,'product.childStarted':p=>`gestartet um ${p.time}`,'product.childFor':p=>`seit ${p.d}`,
 'product.restoreLayout':'Zurück zur Spalte','product.noArea':'Kein Projekt',
 'product.advanced':'Erweiterte Details',
 'product.agents':'Deine Agenten','product.agentsPurpose':'Eine klare Rolle für jede Aufgabe.','product.setup':'Richte deine Arbeit ein',
};
