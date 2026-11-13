// What the agents' little people say (ADR 0300): two or three words of nonsense in a small bubble, each role in its
// own character. The owner asked for it (2026-11-13: «frasi divertenti e stupide esilaranti quasi nosense, ogni agente
// un carattere … umorismo informatico, macabro, nosense, esilarante, cringe»). One set for the whole app: the
// Grindhouse bubbles (renderer AgentSprite.tsx) and the chess section read it from here. Fixed text in code, never
// model or user content; pure data and two pure functions, no dependency. A new moment (a chess move, a win) is a new
// QuipKind with its lists here, in each role's character.
import type { Lang } from './contract/settings';

/** Who speaks: the roles' people and `plain`, the person of an agent without a role (the ids of the sprites). */
export type QuipRole = 'orchestrator' | 'strategist' | 'scout' | 'artisan' | 'sentinel' | 'herald' | 'plain';
export const QUIP_ROLES: readonly QuipRole[] = ['orchestrator', 'strategist', 'scout', 'artisan', 'sentinel', 'herald', 'plain'];
/** When: `work` now and then while it works, thinks or rests; `pat` and `whack` when the user clicks it (ADR 0297). */
export type QuipKind = 'work' | 'pat' | 'whack';
export const QUIP_KINDS: readonly QuipKind[] = ['work', 'pat', 'whack'];
/** A bubble stays small: no line is longer than this. */
export const QUIP_MAX = 24;

/** Each role's character, in one line: what its lines sound like (also usable as a hint in a prompt). */
export const QUIP_CHARACTER: Record<QuipRole, string> = {
  orchestrator: 'a pompous conductor: the code is a symphony, he delegates everything and expects applause',
  strategist: 'an over-planning chess nerd: everything was foreseen ten moves ago, conspiracies included',
  scout: 'an over-keen explorer who is always lost and proud of finding nothing',
  artisan: 'a gruff craftsman of few words: a hammer and some tape fix anything',
  sentinel: 'a paranoid guard with a macabre streak: trusts no process, counts the dead ones',
  herald: 'a melodramatic town crier who announces non-events as breaking news',
  plain: 'a burned-out office worker: meetings, tickets and quiet existential dread',
};

type Lines = Record<QuipKind, readonly string[]>;
const QUIPS: Record<Lang, Record<QuipRole, Lines>> = {
  it: {
    orchestrator: {
      work: ['Delego, quindi sono', 'Sinfonia in YAML', 'Tutti in battuta', 'Do maggiore, merge', 'Io dirigo, voi sudate', 'Applausi al cron', 'Fortissimo, deploy',
        'Ticket in fa diesis', 'Maestro del nulla', 'Silenzio, compilo', 'Orchestra di bug', 'Tempo: mai', 'Assolo di log', 'Bis del rollback'],
      pat: ['Ancora, plebeo', 'Bravo umano', 'Standing ovation'],
      whack: ['Stonato!', 'Ahi, la bacchetta', 'Fuori tempo'],
    },
    strategist: {
      work: ['Scacco al bug', 'Piano Z pronto', 'Era previsto', 'Mossa 47: caffè', 'Gambetto di null', 'Arrocco emotivo', 'Pedone sacrificabile',
        'Tutto calcolato, forse', 'Complotto dei tab', 'Matto in 3 sprint', 'Ho un Gantt', 'Zugzwang, colleghi', 'Variante siciliana', 'Diagramma del diagramma'],
      pat: ['Calcolato', 'Mossa gradita', 'Previsto, grazie'],
      whack: ['Non era previsto', 'Abbandono', 'Scacco… a me'],
    },
    scout: {
      work: ['Trovato niente!', 'Bussola in null', 'Mi sono perso', 'Sentiero 404', 'Grep nel bosco', 'Orme di bug', 'Mappa al contrario',
        'Nord? Forse', 'Ho visto un file', 'Funghi nel repo', 'Mi accampo qui', 'Tracce di TODO', 'Eco: eco eco', 'Lente appannata'],
      pat: ['Distintivo coccole!', 'Bau?', 'Sempre pronto'],
      whack: ['Ahi! Segnalo', 'Orso! Orso!', 'Bussola rotta'],
    },
    artisan: {
      work: ['Martello risolve', 'Funziona storto', 'Nastro adesivo', 'Dagli un colpo', 'Bullone avanzato', 'Legacy è ghisa', 'Refactor a mazzate',
        'Chiodo in prod', 'Saldo e prego', 'Tolleranza: boh', 'Limo il bug', 'Fatto a mano', 'Vite spanata', 'Colla e commit'],
      pat: ['Mh. Grazie.', 'Non mi sciolgo', 'Ok, capo'],
      whack: ['Giù dal martello', 'Ammaccato', 'Fuori garanzia'],
    },
    sentinel: {
      work: ['Nessuno passa', 'Kill meno nove', 'Vedo processi morti', 'Zombie sulla porta 80', 'Sospetto di te', 'Parola d’ordine: no', 'Firewall interiore',
        'Orfani da adottare', 'Chi va là?', 'Il log sa', 'Cimitero dei thread', 'Daemon sotto il letto', 'Fidarsi è un bug', 'Sepolto in /tmp'],
      pat: ['Contatto autorizzato', 'Minaccia: coccole', 'Abbasso lo scudo'],
      whack: ['Intrusione!', 'Elmo collaudato', 'A log. Per sempre.'],
    },
    herald: {
      work: ['Udite, udite!', 'Ultim’ora: niente', 'Edizione straordinaria', 'Squillino i log', 'Annuncio un annuncio', 'Notizia: compila', 'Popolo del repo!',
        'Proclamo il merge', 'Trombe, prego', 'Scoop: un refuso', 'Changelog epico', 'Fonte: fidati', 'Appena giunta: ieri', 'Titolone in arrivo'],
      pat: ['Il popolo mi ama!', 'Lieta novella', 'Inchino'],
      whack: ['Censura!', 'Stampa ferita', 'Ahi, in prima pagina'],
    },
    plain: {
      work: ['Lunedì eterno', 'Ho una riunione', 'Come da mail', 'Sinergia, credo', 'Caffè, poi esisto', 'Ticket dell’anima', 'Riunione sul nulla',
        'Tutti in copia', 'Allineiamoci mai', 'Vivo in staging', 'Pausa pranzo interiore', 'Venerdì, deploy', 'Spengo e riaccendo', 'Lo giro a qualcuno'],
      pat: ['Finalmente, le HR', 'Bonus coccola', 'Lo metto nel CV'],
      whack: ['Apro un ticket', 'Infortunio sul lavoro', 'Me lo segno'],
    },
  },
  en: {
    orchestrator: {
      work: ['I delegate, ergo sum', 'Symphony in YAML', 'All on my beat', 'C major, merge', 'I conduct, you sweat', 'Applause for cron', 'Fortissimo deploy',
        'Ticket in F sharp', 'Maestro of nothing', 'Hush, compiling', 'Orchestra of bugs', 'Tempo: never', 'Log solo', 'Rollback encore'],
      pat: ['Again, peasant', 'Good human', 'Standing ovation'],
      whack: ['Off key!', 'Ow, my baton', 'Out of tempo'],
    },
    strategist: {
      work: ['Checkmate, bug', 'Plan Z is ready', 'As foreseen', 'Move 47: coffee', 'Null gambit', 'Emotional castling', 'Expendable pawn',
        'All calculated, maybe', 'Tab conspiracy', 'Mate in 3 sprints', 'I have a Gantt', 'Zugzwang, colleagues', 'Sicilian variation', 'Diagram of the diagram'],
      pat: ['Calculated', 'A welcome move', 'Foreseen, thanks'],
      whack: ['Not foreseen', 'I resign', 'Check… on me'],
    },
    scout: {
      work: ['Found nothing!', 'Compass is null', 'I am lost', 'Trail 404', 'Grep in the woods', 'Bug footprints', 'Map upside down',
        'North? Maybe', 'I saw a file', 'Mushrooms in the repo', 'Camping here', 'Traces of TODO', 'Echo: echo echo', 'Foggy lens'],
      pat: ['Cuddle badge!', 'Woof?', 'Always ready'],
      whack: ['Ow! Reporting it', 'Bear! Bear!', 'Compass broken'],
    },
    artisan: {
      work: ['Hammer fixes it', 'Works crooked', 'Duct tape', 'Give it a whack', 'Spare bolt', 'Legacy is cast iron', 'Refactor by mallet',
        'Nail in prod', 'Weld and pray', 'Tolerance: dunno', 'Filing the bug down', 'Hand made', 'Stripped screw', 'Glue and commit'],
      pat: ['Hm. Thanks.', 'I do not melt', 'Ok, boss'],
      whack: ['Hey, my hammer', 'Dented', 'Out of warranty'],
    },
    sentinel: {
      work: ['None shall pass', 'Kill dash nine', 'I see dead processes', 'Zombie on port 80', 'I suspect you', 'Passphrase: no', 'Inner firewall',
        'Orphans up for adoption', 'Who goes there?', 'The log knows', 'Thread graveyard', 'Daemon under the bed', 'Trust is a bug', 'Buried in /tmp'],
      pat: ['Contact authorised', 'Threat: cuddles', 'Shield down'],
      whack: ['Intrusion!', 'Helmet tested', 'Logged. Forever.'],
    },
    herald: {
      work: ['Hear ye, hear ye!', 'Breaking: nothing', 'Special edition', 'Sound the logs', 'Announcing: soon', 'News: it compiles', 'People of the repo!',
        'I proclaim the merge', 'Trumpets, please', 'Scoop: a typo', 'Epic changelog', 'Source: trust me', 'Just in: yesterday', 'Headline incoming'],
      pat: ['The people love me!', 'Glad tidings', 'I bow'],
      whack: ['Censorship!', 'The press is wounded', 'Ow, front page'],
    },
    plain: {
      work: ['Eternal Monday', 'Got a meeting', 'As per my email', 'Synergy, I think', 'Coffee, then I exist', 'Ticket of the soul', 'Meeting about nothing',
        'Everyone in cc', 'Let us never align', 'I live in staging', 'Inner lunch break', 'Friday, deploy', 'Off and on again', 'Forwarding it'],
      pat: ['Finally, HR', 'Cuddle bonus', 'Goes on my CV'],
      whack: ['Filing a ticket', 'Workplace injury', 'Noted. Bitterly.'],
    },
  },
  de: {
    orchestrator: {
      work: ['Delegieren ist Kunst', 'Sinfonie in YAML', 'Alle im Takt', 'C-Dur, Merge', 'Ich dirigiere nur', 'Applaus für Cron', 'Fortissimo-Deploy',
        'Ticket in Fis', 'Maestro des Nichts', 'Ruhe, ich kompiliere', 'Orchester der Bugs', 'Tempo: nie', 'Log-Solo', 'Rollback-Zugabe'],
      pat: ['Nochmal, Pöbel', 'Braver Mensch', 'Stehende Ovation'],
      whack: ['Falscher Ton!', 'Au, mein Taktstock', 'Aus dem Takt'],
    },
    strategist: {
      work: ['Schach dem Bug', 'Plan Z steht', 'War vorgesehen', 'Zug 47: Kaffee', 'Null-Gambit', 'Emotionale Rochade', 'Opferbauer',
        'Alles berechnet, evtl.', 'Tab-Verschwörung', 'Matt in 3 Sprints', 'Ich habe ein Gantt', 'Zugzwang, Kollegen', 'Sizilianisch', 'Diagramm vom Diagramm'],
      pat: ['Berechnet', 'Willkommener Zug', 'Vorgesehen, danke'],
      whack: ['Nicht vorgesehen', 'Ich gebe auf', 'Schach… mir'],
    },
    scout: {
      work: ['Nichts gefunden!', 'Kompass ist null', 'Hab mich verirrt', 'Pfad 404', 'Grep im Wald', 'Bug-Spuren', 'Karte verkehrt herum',
        'Norden? Vielleicht', 'Ich sah eine Datei', 'Pilze im Repo', 'Ich zelte hier', 'Spuren von TODO', 'Echo: Echo Echo', 'Linse beschlagen'],
      pat: ['Kuschelabzeichen!', 'Wuff?', 'Allzeit bereit'],
      whack: ['Au! Ich melde das', 'Bär! Bär!', 'Kompass kaputt'],
    },
    artisan: {
      work: ['Hammer regelt', 'Läuft schief', 'Panzertape', 'Einmal draufhauen', 'Schraube übrig', 'Legacy ist Gusseisen', 'Refactoring per Fäustel',
        'Nagel in Prod', 'Schweißen und beten', 'Toleranz: keine Ahnung', 'Bug abfeilen', 'Handarbeit', 'Schraube rund', 'Kleber und Commit'],
      pat: ['Hm. Danke.', 'Ich schmelze nicht', 'Ok, Chef'],
      whack: ['He, mein Hammer', 'Verbeult', 'Garantie abgelaufen'],
    },
    sentinel: {
      work: ['Keiner kommt durch', 'Kill minus neun', 'Ich sehe tote Prozesse', 'Zombie auf Port 80', 'Ich verdächtige dich', 'Losung: nein', 'Innere Firewall',
        'Waisen zu vergeben', 'Wer da?', 'Das Log weiß es', 'Thread-Friedhof', 'Daemon unterm Bett', 'Vertrauen ist ein Bug', 'Begraben in /tmp'],
      pat: ['Kontakt genehmigt', 'Bedrohung: Kuscheln', 'Schild gesenkt'],
      whack: ['Eindringling!', 'Helm geprüft', 'Geloggt. Für immer.'],
    },
    herald: {
      work: ['Hört, hört!', 'Eilmeldung: nichts', 'Sonderausgabe', 'Lasst die Logs tönen', 'Ich kündige etwas an', 'Meldung: kompiliert', 'Volk des Repos!',
        'Ich verkünde den Merge', 'Fanfaren, bitte', 'Scoop: ein Tippfehler', 'Episches Changelog', 'Quelle: glaub mir', 'Soeben: gestern', 'Schlagzeile kommt'],
      pat: ['Das Volk liebt mich!', 'Frohe Kunde', 'Verbeugung'],
      whack: ['Zensur!', 'Presse verletzt', 'Au, Titelseite'],
    },
    plain: {
      work: ['Ewiger Montag', 'Hab ein Meeting', 'Wie per Mail', 'Synergie, glaub ich', 'Kaffee, dann Dasein', 'Ticket der Seele', 'Meeting über nichts',
        'Alle in cc', 'Nie abstimmen', 'Ich wohne in Staging', 'Innere Mittagspause', 'Freitag, Deploy', 'Aus und wieder an', 'Leite ich weiter'],
      pat: ['Endlich, HR', 'Kuschelbonus', 'Kommt in den CV'],
      whack: ['Ich mache ein Ticket', 'Arbeitsunfall', 'Notiert. Verbittert.'],
    },
  },
};

export const isQuipRole = (v: unknown): v is QuipRole => typeof v === 'string' && (QUIP_ROLES as readonly string[]).includes(v);

/** Every line a role can say at a moment, in a language. */
export const quips = (role: QuipRole, kind: QuipKind, lang: Lang): readonly string[] => QUIPS[lang][role][kind];

/** One line, picked by `rnd` (0 ≤ rnd() < 1); never `avoid` (the one it said last) when there is another. */
export function pickQuip(role: QuipRole, kind: QuipKind, lang: Lang, rnd: () => number = Math.random, avoid?: string): string {
  const all = quips(role, kind, lang), pool = all.length > 1 ? all.filter(q => q !== avoid) : all;
  return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))]!;
}
