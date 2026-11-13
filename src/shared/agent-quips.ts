// What the agents' little people say (ADR 0302): two or three words of nonsense in a small bubble, each role in its
// own character. The owner asked for it (2026-11-13: «frasi divertenti e stupide esilaranti quasi nosense, ogni agente
// un carattere … umorismo informatico, macabro, nosense, esilarante, cringe»). One set for the whole app: the
// Grindhouse bubbles (renderer AgentSprite.tsx) and the chess section read it from here. The lines follow what the
// agent is really doing, at zero tokens (the owner, the same evening: «il più collegati possibile a quello che stanno
// realmente facendo … a zero consumo di token»): a moment per state and per kind of tool (QuipKind, quipOfTool), and
// lines with `{x}` that name the real file, command, search or site. Fixed text in code, never model content; pure
// data and pure functions, no dependency. A new moment is a new QuipKind with its lists here, in each role's character.
import type { Lang } from './contract/settings';

/** Who speaks: the roles' people and `plain`, the person of an agent without a role (the ids of the sprites). */
export type QuipRole = 'orchestrator' | 'strategist' | 'scout' | 'artisan' | 'sentinel' | 'herald' | 'plain';
export const QUIP_ROLES: readonly QuipRole[] = ['orchestrator', 'strategist', 'scout', 'artisan', 'sentinel', 'herald', 'plain'];
/** When. `work`: at work, whatever it does (the lines without a moment of their own). `pat`, `whack`: the user
 *  clicked it (ADR 0297). The states: `think`, `wait` (for the user), `err`, `done`, `idle`. What its tool is doing:
 *  `read`, `edit`, `run` (a command), `test`, `search`, `web`, `delegate`. */
export type QuipKind = 'work' | 'pat' | 'whack' | 'think' | 'wait' | 'err' | 'done' | 'idle' | 'read' | 'edit' | 'run' | 'test' | 'search' | 'web' | 'delegate';
export const QUIP_KINDS: readonly QuipKind[] = ['work', 'pat', 'whack', 'think', 'wait', 'err', 'done', 'idle', 'read', 'edit', 'run', 'test', 'search', 'web', 'delegate'];
/** A bubble stays small: no line is longer than this as written (`{x}` counted as it stands)… */
export const QUIP_MAX = 24;
/** …and the real name put in place of `{x}` is cut to this many characters. */
export const QUIP_X_MAX = 12;

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
      think: ['Componevo, zitti', 'Penso in re minore'],
      read: ['{x}: che spartito', 'Leggo lo spartito'],
      edit: ['Ritocco {x}', 'Correggo la partitura'],
      run: ['{x}, attacca!', 'Via col comando'],
      test: ['Prova generale', 'Test: accordatevi'],
      search: ['Cerco {x} in platea', 'Chi ha stonato?'],
      web: ['{x} in tournée', 'Ascolto il web'],
      delegate: ['Suonalo tu', 'Delegato. Applausi.'],
      wait: ['Aspetto il pubblico', 'Maestro in attesa'],
      err: ['Stecca clamorosa', 'Colpa dei violini'],
      done: ['Applausi, grazie', 'Sipario. Inchino.'],
      idle: ['Pausa di 40 battute', 'Zzz… crescendo'],
    },
    strategist: {
      work: ['Scacco al bug', 'Piano Z pronto', 'Era previsto', 'Mossa 47: caffè', 'Gambetto di null', 'Arrocco emotivo', 'Pedone sacrificabile',
        'Tutto calcolato, forse', 'Complotto dei tab', 'Matto in 3 sprint', 'Ho un Gantt', 'Zugzwang, colleghi', 'Variante siciliana', 'Diagramma del diagramma'],
      pat: ['Calcolato', 'Mossa gradita', 'Previsto, grazie'],
      whack: ['Non era previsto', 'Abbandono', 'Scacco… a me'],
      think: ['Calcolo 12 mosse', 'Penso alla variante'],
      read: ['Studio {x}', 'Leggo la partita'],
      edit: ['Mossa su {x}', 'Sposto un pedone'],
      run: ['{x} in e4', 'Apertura: comando'],
      test: ['Test: mediogioco', 'Verifico la variante'],
      search: ['Cerco {x}. Previsto.', 'Trappola in vista'],
      web: ['Spio {x}', 'Ricognizione online'],
      delegate: ['Sacrifico un agente', 'Pedoni avanti'],
      wait: ['Tocca a te', 'L’orologio corre'],
      err: ['Svista. Capita.', 'Gambetto fallito'],
      done: ['Scacco matto', 'Partita chiusa'],
      idle: ['Sogno arrocchi', 'Zzz… patta'],
    },
    scout: {
      work: ['Trovato niente!', 'Bussola in null', 'Mi sono perso', 'Sentiero 404', 'Grep nel bosco', 'Orme di bug', 'Mappa al contrario',
        'Nord? Forse', 'Ho visto un file', 'Funghi nel repo', 'Mi accampo qui', 'Tracce di TODO', 'Eco: eco eco', 'Lente appannata'],
      pat: ['Distintivo coccole!', 'Bau?', 'Sempre pronto'],
      whack: ['Ahi! Segnalo', 'Orso! Orso!', 'Bussola rotta'],
      think: ['Dove sono?', 'Consulto il muschio'],
      read: ['{x}: orme fresche!', 'Leggo le tracce'],
      edit: ['Bandiera su {x}', 'Segno il sentiero'],
      run: ['{x}! Avventura!', 'Lancio il segnale'],
      test: ['Provo il ponte', 'Assaggio il fungo'],
      search: ['{x}, dove sei?', 'Cerco col fiuto'],
      web: ['Esploro {x}', 'Nel web selvaggio'],
      delegate: ['Mando un piccione', 'Chiamo rinforzi'],
      wait: ['Aspetto al bivio', 'Segnali di fumo?'],
      err: ['Sabbie mobili!', 'Mappa sbagliata'],
      done: ['Missione compiuta!', 'Distintivo preso'],
      idle: ['Pisolino in tenda', 'Zzz… marshmallow'],
    },
    artisan: {
      work: ['Martello risolve', 'Funziona storto', 'Nastro adesivo', 'Dagli un colpo', 'Bullone avanzato', 'Legacy è ghisa', 'Refactor a mazzate',
        'Chiodo in prod', 'Saldo e prego', 'Tolleranza: boh', 'Limo il bug', 'Fatto a mano', 'Vite spanata', 'Colla e commit'],
      pat: ['Mh. Grazie.', 'Non mi sciolgo', 'Ok, capo'],
      whack: ['Giù dal martello', 'Ammaccato', 'Fuori garanzia'],
      think: ['Misuro due volte', 'Mh. Ci penso.'],
      read: ['Guardo {x}. Storto.', 'Leggo il progetto'],
      edit: ['{x}: a mazzate', 'Limo e incollo'],
      run: ['{x}, gira!', 'Accendo il tornio'],
      test: ['Collaudo a martello', 'Se regge, regge'],
      search: ['Dov’è {x}?', 'Cerco la chiave del 10'],
      web: ['{x}? Roba moderna', 'Internet. Bah.'],
      delegate: ['Fallo tu, garzone', 'Passo il cacciavite'],
      wait: ['Aspetto. Sbuffo.', 'Capo, ci sei?'],
      err: ['Si è spaccato', 'Colpa del legno'],
      done: ['Fatto. Regge.', 'Pezzo finito'],
      idle: ['Pausa caffè', 'Zzz… trucioli'],
    },
    sentinel: {
      work: ['Nessuno passa', 'Kill meno nove', 'Vedo processi morti', 'Zombie sulla porta 80', 'Sospetto di te', 'Parola d’ordine: no', 'Firewall interiore',
        'Orfani da adottare', 'Chi va là?', 'Il log sa', 'Cimitero dei thread', 'Daemon sotto il letto', 'Fidarsi è un bug', 'Sepolto in /tmp'],
      pat: ['Contatto autorizzato', 'Minaccia: coccole', 'Abbasso lo scudo'],
      whack: ['Intrusione!', 'Elmo collaudato', 'A log. Per sempre.'],
      think: ['Fiuto un complotto', 'Penso al peggio'],
      read: ['Perquisisco {x}', 'Leggo i sospetti'],
      edit: ['{x} va blindato', 'Metto filo spinato'],
      run: ['{x} sotto scorta', 'Comando sorvegliato'],
      test: ['Test: interrogatorio', 'Chi fallisce, sparisce'],
      search: ['Caccia a {x}', 'Cerco cadaveri'],
      web: ['{x}: non mi fido', 'Fuori è pericoloso'],
      delegate: ['Mando una recluta', 'Pattuglia in uscita'],
      wait: ['Parola d’ordine?', 'Ti tengo d’occhio'],
      err: ['Breccia nel muro!', 'Abbiamo un morto'],
      done: ['Zona bonificata', 'Nessun superstite'],
      idle: ['Dormo con un occhio', 'Zzz… allarme'],
    },
    herald: {
      work: ['Udite, udite!', 'Ultim’ora: niente', 'Edizione straordinaria', 'Squillino i log', 'Annuncio un annuncio', 'Notizia: compila', 'Popolo del repo!',
        'Proclamo il merge', 'Trombe, prego', 'Scoop: un refuso', 'Changelog epico', 'Fonte: fidati', 'Appena giunta: ieri', 'Titolone in arrivo'],
      pat: ['Il popolo mi ama!', 'Lieta novella', 'Inchino'],
      whack: ['Censura!', 'Stampa ferita', 'Ahi, in prima pagina'],
      think: ['Cerco il titolo', 'Medito un proclama'],
      read: ['Leggo {x} al popolo', 'Sfoglio le cronache'],
      edit: ['Riscrivo {x}!', 'Correggo la bozza'],
      run: ['Annuncio: {x}!', 'Squilla il comando'],
      test: ['Test in diretta', 'Verdetto in arrivo'],
      search: ['Chi ha visto {x}?', 'Cerco lo scoop'],
      web: ['Notizie da {x}', 'Dal nostro inviato'],
      delegate: ['Mando un messo', 'Passo la tromba'],
      wait: ['Attendo l’intervista', 'Popolo, rispondi!'],
      err: ['Tragedia in prima!', 'Smentita ufficiale'],
      done: ['Stampate tutto!', 'Vittoria! Trombe!'],
      idle: ['Edicola chiusa', 'Zzz… rassegna stampa'],
    },
    plain: {
      work: ['Lunedì eterno', 'Ho una riunione', 'Come da mail', 'Sinergia, credo', 'Caffè, poi esisto', 'Ticket dell’anima', 'Riunione sul nulla',
        'Tutti in copia', 'Allineiamoci mai', 'Vivo in staging', 'Pausa pranzo interiore', 'Venerdì, deploy', 'Spengo e riaccendo', 'Lo giro a qualcuno'],
      pat: ['Finalmente, le HR', 'Bonus coccola', 'Lo metto nel CV'],
      whack: ['Apro un ticket', 'Infortunio sul lavoro', 'Me lo segno'],
      think: ['Penso al weekend', 'Brainstorming da solo'],
      read: ['Leggo {x}. Sigh.', 'Leggo le mail'],
      edit: ['{x} versione finale2', 'Salvo come finale_v3'],
      run: ['Lancio {x}, prego', 'Premo invio e spero'],
      test: ['Test. Incrocio le dita', 'Da me funziona'],
      search: ['Dov’era {x}?', 'Cerco su Drive'],
      web: ['{x} in 40 schede', 'Navigo in orario'],
      delegate: ['Lo inoltro', 'Non è compito mio'],
      wait: ['Resto in attesa', 'Sollecito gentile'],
      err: ['Non sono stato io', 'Riavvio tutto'],
      done: ['Chiudo il ticket', 'Fatto. Vado a casa.'],
      idle: ['Pausa sigaretta', 'Zzz… scrivania'],
    },
  },
  en: {
    orchestrator: {
      work: ['I delegate, ergo sum', 'Symphony in YAML', 'All on my beat', 'C major, merge', 'I conduct, you sweat', 'Applause for cron', 'Fortissimo deploy',
        'Ticket in F sharp', 'Maestro of nothing', 'Hush, compiling', 'Orchestra of bugs', 'Tempo: never', 'Log solo', 'Rollback encore'],
      pat: ['Again, peasant', 'Good human', 'Standing ovation'],
      whack: ['Off key!', 'Ow, my baton', 'Out of tempo'],
      think: ['Composing. Hush.', 'Thinking in D minor'],
      read: ['{x}: what a score', 'Reading the score'],
      edit: ['Retouching {x}', 'Fixing the score'],
      run: ['{x}, from the top!', 'Cue the command'],
      test: ['Dress rehearsal', 'Tests: tune up'],
      search: ['Seeking {x} in the pit', 'Who played flat?'],
      web: ['{x} on tour', 'Listening to the web'],
      delegate: ['You play it', 'Delegated. Applause.'],
      wait: ['Awaiting my audience', 'Maestro on hold'],
      err: ['A dreadful note', 'Blame the violins'],
      done: ['Thank you, thank you', 'Curtain. I bow.'],
      idle: ['A 40-bar rest', 'Zzz… crescendo'],
    },
    strategist: {
      work: ['Checkmate, bug', 'Plan Z is ready', 'As foreseen', 'Move 47: coffee', 'Null gambit', 'Emotional castling', 'Expendable pawn',
        'All calculated, maybe', 'Tab conspiracy', 'Mate in 3 sprints', 'I have a Gantt', 'Zugzwang, colleagues', 'Sicilian variation', 'Diagram of the diagram'],
      pat: ['Calculated', 'A welcome move', 'Foreseen, thanks'],
      whack: ['Not foreseen', 'I resign', 'Check… on me'],
      think: ['Calculating 12 moves', 'Pondering the line'],
      read: ['Studying {x}', 'Reading the game'],
      edit: ['My move: {x}', 'Pushing a pawn'],
      run: ['{x} to e4', 'Opening: command'],
      test: ['Tests: middlegame', 'Checking the line'],
      search: ['Hunting {x}. Foreseen.', 'I smell a trap'],
      web: ['Spying on {x}', 'Scouting online'],
      delegate: ['Sacrificing an agent', 'Pawns forward'],
      wait: ['Your move', 'The clock is ticking'],
      err: ['A blunder. Happens.', 'Gambit failed'],
      done: ['Checkmate', 'Game over. I won.'],
      idle: ['Dreaming of castling', 'Zzz… stalemate'],
    },
    scout: {
      work: ['Found nothing!', 'Compass is null', 'I am lost', 'Trail 404', 'Grep in the woods', 'Bug footprints', 'Map upside down',
        'North? Maybe', 'I saw a file', 'Mushrooms in the repo', 'Camping here', 'Traces of TODO', 'Echo: echo echo', 'Foggy lens'],
      pat: ['Cuddle badge!', 'Woof?', 'Always ready'],
      whack: ['Ow! Reporting it', 'Bear! Bear!', 'Compass broken'],
      think: ['Where am I?', 'Asking the moss'],
      read: ['{x}: fresh tracks!', 'Reading the tracks'],
      edit: ['Flag planted on {x}', 'Marking the trail'],
      run: ['{x}! Adventure!', 'Sending the signal'],
      test: ['Testing the bridge', 'Tasting the mushroom'],
      search: ['{x}, where are you?', 'Sniffing around'],
      web: ['Exploring {x}', 'Into the wild web'],
      delegate: ['Sending a pigeon', 'Calling for backup'],
      wait: ['Waiting at the fork', 'Smoke signals?'],
      err: ['Quicksand!', 'Wrong map'],
      done: ['Mission complete!', 'Badge earned'],
      idle: ['Nap in the tent', 'Zzz… marshmallows'],
    },
    artisan: {
      work: ['Hammer fixes it', 'Works crooked', 'Duct tape', 'Give it a whack', 'Spare bolt', 'Legacy is cast iron', 'Refactor by mallet',
        'Nail in prod', 'Weld and pray', 'Tolerance: dunno', 'Filing the bug down', 'Hand made', 'Stripped screw', 'Glue and commit'],
      pat: ['Hm. Thanks.', 'I do not melt', 'Ok, boss'],
      whack: ['Hey, my hammer', 'Dented', 'Out of warranty'],
      think: ['Measure twice', 'Hm. Thinking.'],
      read: ['Looking at {x}. Bent.', 'Reading the plans'],
      edit: ['{x}: by mallet', 'File it, glue it'],
      run: ['{x}, spin!', 'Starting the lathe'],
      test: ['Hammer test', 'If it holds, it holds'],
      search: ['Where is {x}?', 'Seeking the 10 mm'],
      web: ['{x}? Newfangled', 'Internet. Bah.'],
      delegate: ['You do it, kid', 'Passing the screwdriver'],
      wait: ['Waiting. Grumbling.', 'Boss, you there?'],
      err: ['It snapped', 'Blame the wood'],
      done: ['Done. It holds.', 'Piece finished'],
      idle: ['Coffee break', 'Zzz… sawdust'],
    },
    sentinel: {
      work: ['None shall pass', 'Kill dash nine', 'I see dead processes', 'Zombie on port 80', 'I suspect you', 'Passphrase: no', 'Inner firewall',
        'Orphans up for adoption', 'Who goes there?', 'The log knows', 'Thread graveyard', 'Daemon under the bed', 'Trust is a bug', 'Buried in /tmp'],
      pat: ['Contact authorised', 'Threat: cuddles', 'Shield down'],
      whack: ['Intrusion!', 'Helmet tested', 'Logged. Forever.'],
      think: ['I smell a plot', 'Assuming the worst'],
      read: ['Frisking {x}', 'Reading the suspects'],
      edit: ['{x} gets armoured', 'Adding barbed wire'],
      run: ['{x} under escort', 'Command, supervised'],
      test: ['Tests: interrogation', 'Fail and vanish'],
      search: ['Manhunt: {x}', 'Looking for bodies'],
      web: ['{x}: no trust', 'Outside is dangerous'],
      delegate: ['Sending a recruit', 'Patrol going out'],
      wait: ['Password?', 'I am watching you'],
      err: ['Breach in the wall!', 'We have a body'],
      done: ['Area secured', 'No survivors'],
      idle: ['One eye open', 'Zzz… alarm'],
    },
    herald: {
      work: ['Hear ye, hear ye!', 'Breaking: nothing', 'Special edition', 'Sound the logs', 'Announcing: soon', 'News: it compiles', 'People of the repo!',
        'I proclaim the merge', 'Trumpets, please', 'Scoop: a typo', 'Epic changelog', 'Source: trust me', 'Just in: yesterday', 'Headline incoming'],
      pat: ['The people love me!', 'Glad tidings', 'I bow'],
      whack: ['Censorship!', 'The press is wounded', 'Ow, front page'],
      think: ['Seeking a headline', 'Drafting a decree'],
      read: ['Reading {x} aloud', 'Leafing the chronicles'],
      edit: ['Rewriting {x}!', 'Fixing the draft'],
      run: ['Announcing: {x}!', 'The command resounds'],
      test: ['Tests, live!', 'Verdict incoming'],
      search: ['Who has seen {x}?', 'Chasing the scoop'],
      web: ['News from {x}', 'From our reporter'],
      delegate: ['Sending a messenger', 'Passing the trumpet'],
      wait: ['Awaiting the interview', 'People, answer!'],
      err: ['Tragedy, front page!', 'Official denial'],
      done: ['Print it all!', 'Victory! Trumpets!'],
      idle: ['Newsstand closed', 'Zzz… press review'],
    },
    plain: {
      work: ['Eternal Monday', 'Got a meeting', 'As per my email', 'Synergy, I think', 'Coffee, then I exist', 'Ticket of the soul', 'Meeting about nothing',
        'Everyone in cc', 'Let us never align', 'I live in staging', 'Inner lunch break', 'Friday, deploy', 'Off and on again', 'Forwarding it'],
      pat: ['Finally, HR', 'Cuddle bonus', 'Goes on my CV'],
      whack: ['Filing a ticket', 'Workplace injury', 'Noted. Bitterly.'],
      think: ['Thinking of Friday', 'Brainstorming alone'],
      read: ['Reading {x}. Sigh.', 'Reading emails'],
      edit: ['{x} final version 2', 'Saved as final_v3'],
      run: ['Launching {x}, please', 'Enter, and pray'],
      test: ['Tests. Fingers crossed', 'Works on my machine'],
      search: ['Where was {x}?', 'Searching the Drive'],
      web: ['{x} in 40 tabs', 'Browsing on the clock'],
      delegate: ['Passing it along', 'Not my job'],
      wait: ['Kindly waiting', 'A gentle reminder'],
      err: ['It was not me', 'Rebooting everything'],
      done: ['Closing the ticket', 'Done. Going home.'],
      idle: ['Smoke break', 'Zzz… desk'],
    },
  },
  de: {
    orchestrator: {
      work: ['Delegieren ist Kunst', 'Sinfonie in YAML', 'Alle im Takt', 'C-Dur, Merge', 'Ich dirigiere nur', 'Applaus für Cron', 'Fortissimo-Deploy',
        'Ticket in Fis', 'Maestro des Nichts', 'Ruhe, ich kompiliere', 'Orchester der Bugs', 'Tempo: nie', 'Log-Solo', 'Rollback-Zugabe'],
      pat: ['Nochmal, Pöbel', 'Braver Mensch', 'Stehende Ovation'],
      whack: ['Falscher Ton!', 'Au, mein Taktstock', 'Aus dem Takt'],
      think: ['Ich komponiere. Ruhe.', 'Denke in d-Moll'],
      read: ['{x}: welche Partitur', 'Lese die Partitur'],
      edit: ['Retusche an {x}', 'Korrigiere die Noten'],
      run: ['{x}, Einsatz!', 'Kommando, bitte'],
      test: ['Generalprobe', 'Tests: stimmt euch'],
      search: ['Suche {x} im Saal', 'Wer spielte falsch?'],
      web: ['{x} auf Tournee', 'Lausche dem Web'],
      delegate: ['Spiel du es', 'Delegiert. Applaus.'],
      wait: ['Warte aufs Publikum', 'Maestro wartet'],
      err: ['Grässlicher Ton', 'Die Geigen waren’s'],
      done: ['Danke, danke', 'Vorhang. Verbeugung.'],
      idle: ['40 Takte Pause', 'Zzz… crescendo'],
    },
    strategist: {
      work: ['Schach dem Bug', 'Plan Z steht', 'War vorgesehen', 'Zug 47: Kaffee', 'Null-Gambit', 'Emotionale Rochade', 'Opferbauer',
        'Alles berechnet, evtl.', 'Tab-Verschwörung', 'Matt in 3 Sprints', 'Ich habe ein Gantt', 'Zugzwang, Kollegen', 'Sizilianisch', 'Diagramm vom Diagramm'],
      pat: ['Berechnet', 'Willkommener Zug', 'Vorgesehen, danke'],
      whack: ['Nicht vorgesehen', 'Ich gebe auf', 'Schach… mir'],
      think: ['Rechne 12 Züge', 'Prüfe die Variante'],
      read: ['Studiere {x}', 'Lese die Partie'],
      edit: ['Mein Zug: {x}', 'Schiebe einen Bauern'],
      run: ['{x} nach e4', 'Eröffnung: Kommando'],
      test: ['Tests: Mittelspiel', 'Variante geprüft'],
      search: ['Jage {x}. Vorgesehen.', 'Ich rieche eine Falle'],
      web: ['Spioniere {x} aus', 'Aufklärung online'],
      delegate: ['Opfere einen Agenten', 'Bauern voran'],
      wait: ['Du bist am Zug', 'Die Uhr läuft'],
      err: ['Patzer. Passiert.', 'Gambit gescheitert'],
      done: ['Schachmatt', 'Partie gewonnen'],
      idle: ['Träume von Rochaden', 'Zzz… Remis'],
    },
    scout: {
      work: ['Nichts gefunden!', 'Kompass ist null', 'Hab mich verirrt', 'Pfad 404', 'Grep im Wald', 'Bug-Spuren', 'Karte verkehrt herum',
        'Norden? Vielleicht', 'Ich sah eine Datei', 'Pilze im Repo', 'Ich zelte hier', 'Spuren von TODO', 'Echo: Echo Echo', 'Linse beschlagen'],
      pat: ['Kuschelabzeichen!', 'Wuff?', 'Allzeit bereit'],
      whack: ['Au! Ich melde das', 'Bär! Bär!', 'Kompass kaputt'],
      think: ['Wo bin ich?', 'Frage das Moos'],
      read: ['{x}: frische Spuren!', 'Lese die Fährte'],
      edit: ['Fahne auf {x}', 'Markiere den Pfad'],
      run: ['{x}! Abenteuer!', 'Sende das Signal'],
      test: ['Teste die Brücke', 'Koste den Pilz'],
      search: ['{x}, wo bist du?', 'Schnüffle herum'],
      web: ['Erkunde {x}', 'Ins wilde Web'],
      delegate: ['Schicke eine Taube', 'Rufe Verstärkung'],
      wait: ['Warte an der Gabelung', 'Rauchzeichen?'],
      err: ['Treibsand!', 'Falsche Karte'],
      done: ['Mission erfüllt!', 'Abzeichen verdient'],
      idle: ['Nickerchen im Zelt', 'Zzz… Marshmallows'],
    },
    artisan: {
      work: ['Hammer regelt', 'Läuft schief', 'Panzertape', 'Einmal draufhauen', 'Schraube übrig', 'Legacy ist Gusseisen', 'Refactoring per Fäustel',
        'Nagel in Prod', 'Schweißen und beten', 'Toleranz: keine Ahnung', 'Bug abfeilen', 'Handarbeit', 'Schraube rund', 'Kleber und Commit'],
      pat: ['Hm. Danke.', 'Ich schmelze nicht', 'Ok, Chef'],
      whack: ['He, mein Hammer', 'Verbeult', 'Garantie abgelaufen'],
      think: ['Zweimal messen', 'Hm. Ich überlege.'],
      read: ['Schau auf {x}. Schief.', 'Lese den Plan'],
      edit: ['{x}: mit dem Fäustel', 'Feilen und kleben'],
      run: ['{x}, dreh dich!', 'Drehbank an'],
      test: ['Hammerprobe', 'Hält es, hält es'],
      search: ['Wo ist {x}?', 'Suche den Zehner'],
      web: ['{x}? Neumodisch', 'Internet. Pah.'],
      delegate: ['Mach du, Lehrling', 'Reiche den Dreher'],
      wait: ['Warte. Brumme.', 'Chef, bist du da?'],
      err: ['Ist gebrochen', 'Das Holz war’s'],
      done: ['Fertig. Hält.', 'Stück vollendet'],
      idle: ['Kaffeepause', 'Zzz… Späne'],
    },
    sentinel: {
      work: ['Keiner kommt durch', 'Kill minus neun', 'Ich sehe tote Prozesse', 'Zombie auf Port 80', 'Ich verdächtige dich', 'Losung: nein', 'Innere Firewall',
        'Waisen zu vergeben', 'Wer da?', 'Das Log weiß es', 'Thread-Friedhof', 'Daemon unterm Bett', 'Vertrauen ist ein Bug', 'Begraben in /tmp'],
      pat: ['Kontakt genehmigt', 'Bedrohung: Kuscheln', 'Schild gesenkt'],
      whack: ['Eindringling!', 'Helm geprüft', 'Geloggt. Für immer.'],
      think: ['Rieche ein Komplott', 'Denke ans Schlimmste'],
      read: ['Durchsuche {x}', 'Lese die Verdächtigen'],
      edit: ['{x} wird gepanzert', 'Lege Stacheldraht'],
      run: ['{x} unter Bewachung', 'Kommando, bewacht'],
      test: ['Tests: Verhör', 'Wer fällt, verschwindet'],
      search: ['Fahndung: {x}', 'Suche Leichen'],
      web: ['{x}: kein Vertrauen', 'Draußen ist Gefahr'],
      delegate: ['Schicke einen Rekruten', 'Patrouille rückt aus'],
      wait: ['Losungswort?', 'Ich beobachte dich'],
      err: ['Bresche in der Mauer!', 'Wir haben eine Leiche'],
      done: ['Zone gesichert', 'Keine Überlebenden'],
      idle: ['Ein Auge offen', 'Zzz… Alarm'],
    },
    herald: {
      work: ['Hört, hört!', 'Eilmeldung: nichts', 'Sonderausgabe', 'Lasst die Logs tönen', 'Ich kündige etwas an', 'Meldung: kompiliert', 'Volk des Repos!',
        'Ich verkünde den Merge', 'Fanfaren, bitte', 'Scoop: ein Tippfehler', 'Episches Changelog', 'Quelle: glaub mir', 'Soeben: gestern', 'Schlagzeile kommt'],
      pat: ['Das Volk liebt mich!', 'Frohe Kunde', 'Verbeugung'],
      whack: ['Zensur!', 'Presse verletzt', 'Au, Titelseite'],
      think: ['Suche die Schlagzeile', 'Entwerfe ein Edikt'],
      read: ['Lese {x} laut vor', 'Blättere in Chroniken'],
      edit: ['Schreibe {x} neu!', 'Korrigiere den Entwurf'],
      run: ['Verkünde: {x}!', 'Das Kommando erschallt'],
      test: ['Tests, live!', 'Urteil folgt'],
      search: ['Wer sah {x}?', 'Jage den Scoop'],
      web: ['Neues von {x}', 'Von unserem Reporter'],
      delegate: ['Schicke einen Boten', 'Reiche die Fanfare'],
      wait: ['Warte aufs Interview', 'Volk, antworte!'],
      err: ['Tragödie, Titelseite!', 'Offizielles Dementi'],
      done: ['Druckt alles!', 'Sieg! Fanfaren!'],
      idle: ['Kiosk geschlossen', 'Zzz… Presseschau'],
    },
    plain: {
      work: ['Ewiger Montag', 'Hab ein Meeting', 'Wie per Mail', 'Synergie, glaub ich', 'Kaffee, dann Dasein', 'Ticket der Seele', 'Meeting über nichts',
        'Alle in cc', 'Nie abstimmen', 'Ich wohne in Staging', 'Innere Mittagspause', 'Freitag, Deploy', 'Aus und wieder an', 'Leite ich weiter'],
      pat: ['Endlich, HR', 'Kuschelbonus', 'Kommt in den CV'],
      whack: ['Ich mache ein Ticket', 'Arbeitsunfall', 'Notiert. Verbittert.'],
      think: ['Denke an Freitag', 'Brainstorming allein'],
      read: ['Lese {x}. Seufz.', 'Lese Mails'],
      edit: ['{x} final Version 2', 'Gespeichert: final_v3'],
      run: ['Starte {x}, bitte', 'Enter und beten'],
      test: ['Tests. Daumen drücken', 'Bei mir läuft’s'],
      search: ['Wo war {x}?', 'Suche im Laufwerk'],
      web: ['{x} in 40 Tabs', 'Surfe in Arbeitszeit'],
      delegate: ['Gebe ich ab', 'Nicht mein Job'],
      wait: ['Warte höflich', 'Freundliche Erinnerung'],
      err: ['Ich war’s nicht', 'Starte alles neu'],
      done: ['Ticket geschlossen', 'Fertig. Feierabend.'],
      idle: ['Raucherpause', 'Zzz… Schreibtisch'],
    },
  },
};

export const isQuipRole = (v: unknown): v is QuipRole => typeof v === 'string' && (QUIP_ROLES as readonly string[]).includes(v);

/** Every line a role can say at a moment, in a language, as written (a `{x}` stands for the real thing's name). */
export const quips = (role: QuipRole, kind: QuipKind, lang: Lang): readonly string[] => QUIPS[lang][role][kind];

/** The name that goes in a line: one word or file name, cut short. '' when there is nothing sayable. */
export function quipX(v: string): string {
  const x = v.trim().replace(/\s+/g, ' ');
  return x.length > QUIP_X_MAX ? `${x.slice(0, QUIP_X_MAX - 1)}…` : x;
}

/** One line, picked by `rnd` (0 ≤ rnd() < 1); never `avoid` (the one it said last) when there is another. With `x`
 *  (the real file, command, search or site) the lines that name it take part, with it in place; without, only the
 *  others: every moment has at least one. */
export function pickQuip(role: QuipRole, kind: QuipKind, lang: Lang, rnd: () => number = Math.random, avoid?: string, x?: string): string {
  const name = x ? quipX(x) : '';
  const all = quips(role, kind, lang).flatMap(q => (q.includes('{x}') ? (name ? [q.replace('{x}', name)] : []) : [q]));
  const pool = all.length > 1 ? all.filter(q => q !== avoid) : all;
  return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))]!;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const base = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? '';
const TESTS = /\b(test|tests|vitest|jest|pytest|playwright|mocha|rspec|phpunit|xunit|nunit|check:quick)\b/i;

/** The moment of a tool call, and the real thing it works on (zero tokens: the tool's name and input, as every engine
 *  the app runs names them). A file's name for a read or an edit, the program for a command, the words for a search,
 *  the host for a page; a tool it does not know is plain `work`. */
export function quipOfTool(name: string, input: unknown): { kind: QuipKind; x?: string } {
  const i = obj(input), file = base(str(i.file_path) || str(i.path) || str(i.notebook_path) || str(i.file));
  const withX = (kind: QuipKind, x: string): { kind: QuipKind; x?: string } => (x ? { kind, x } : { kind });
  if (/^(Bash|PowerShell|Shell|shell|exec_command|command)$/.test(name)) {
    const cmd = str(i.command) || (Array.isArray(i.command) ? i.command.map(str).join(' ') : '') || str(i.cmd);
    // the program that runs: past `cd x &&` and variables set in front
    const word = base((cmd.split(/&&|;|\|/).map(p => p.trim()).find(p => p && !/^cd\b/.test(p)) ?? '').split(/\s+/).find(w => w && !/^\w+=/.test(w)) ?? '');
    return withX(TESTS.test(cmd) ? 'test' : 'run', word);
  }
  if (/^(Read|LS|List|NotebookRead)$/.test(name)) return withX('read', file);
  if (/^(Edit|MultiEdit|Write|NotebookEdit|Delete|Move|apply_patch)$/.test(name)) return withX('edit', file);
  if (/^(Grep|Glob|Search)$/.test(name)) return withX('search', str(i.pattern) || str(i.query));
  if (/^(WebFetch|Fetch|WebSearch)$/.test(name) || /browser/i.test(name)) {
    let host = '';
    try { host = str(i.url) ? new URL(str(i.url)).hostname.replace(/^www\./, '') : ''; } catch { host = ''; }
    return withX('web', host);
  }
  if (/^(Task|Agent)$/.test(name) || /^mcp__.+__agent_(start|message|delegate)/.test(name)) return { kind: 'delegate' };
  return { kind: 'work' };
}
