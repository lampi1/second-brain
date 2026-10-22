// German (de-AT) counterpart of the owner's profile texts (profile.it.ts).
import type { profileIt } from './profile.it';
export const profileDe: typeof profileIt = {
 'profile.group':'Mein Profil',
 'profile.lead':'Wie deine Agenten dich kennen: die Datei me.md in deinem Gedächtnis, gelesen am Anfang jedes Chats.',
 'profile.name':'Name','profile.role':'Rolle','profile.language':'Chat-Sprache','profile.mainWork':'Arbeitsbereiche','profile.replyStyle':'Antwortstil',
 'profile.mainWorkHint':'Eine Zeile pro Bereich: Projekte, Kunden oder Themen, die du betreust.','profile.empty':'Noch nicht festgelegt',
 'profile.edit':'Bearbeiten','profile.save':'Profil speichern','profile.saved':'Profil in me.md gespeichert.','profile.open':'me.md öffnen',
 'profile.rules':p=>p.n===1?'1 Regel, wie man mit dir arbeitet':`${p.n} Regeln, wie man mit dir arbeitet`,
 'profile.growth':'Dein Profil wächst mit der Nutzung: Wenn du in einem Chat „ab jetzt…“ sagst, schreibt der Skill brain-edit die Regel hierher; das Journal hält die Arbeit jedes Tages fest.',
 'profile.updated':p=>`Profil zuletzt geändert: ${p.date}`,
 'profile.journal':p=>p.n===1?`Journal: 1 Tag, zuletzt ${p.date}`:`Journal: ${p.n} Tage, zuletzt ${p.date}`,
 'profile.journalNone':'Journal: noch kein Tag geschrieben',
 'profile.locked':'Dieses Feld hat in me.md ein eigenes Layout: Ändere es, indem du in einem Chat fragst (Skill brain-edit).',
 'profile.noBrain':'Verbinde ein Arbeitsgedächtnis, um dein Profil zu sehen und zu bearbeiten.',
 'profile.missing':'Das verbundene Gedächtnis hat keine Datei me.md.',
 'profile.unreadable':'me.md kann nicht sicher gelesen werden (Link, Größe oder Berechtigungen).',
 'profile.changed':'me.md hat sich inzwischen geändert: Die neue Version ist geladen, deine Änderungen sind noch da. Prüf und speichere noch einmal.',
 'profile.tooMany':p=>`Höchstens ${p.n} Arbeitsbereiche: Leg ähnliche zusammen.`,
 'profile.invalid':'Einige Felder sind ungültig: ein Name ohne Symbole, jedes Feld in einer Zeile.',
 'profile.error':'Speichern fehlgeschlagen. Die Datei wurde nicht geändert.',
};
