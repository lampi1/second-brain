// What the agents' little people say (ADR 0303): two or three words of nonsense in a small bubble, each role in its
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
  orchestrator: 'an ancient, wise wizard with a long white beard: serene, cryptic and kindly ironic; talks in gentle proverbs, knows more than he says, the agents are his apprentices',
  strategist: 'a cold war-room strategist who talks like a chess master: dry, cynical, always three moves ahead, never surprised',
  scout: 'a weathered tracker of few words: dry gallows humour, has seen worse, reads the code like tracks on the ground',
  artisan: 'a huge, gruff blacksmith with a cigar: few words, proud of work that lasts, contempt for anything fancy, hits it until it fits',
  sentinel: 'a merciless guard in a dark helm: menacing, trusts nobody, enjoys turning work away, speaks in threats and verdicts',
  herald: 'a pompous, wine-loving town crier: theatrical and gossipy, sells every small event as a scandal or a triumph',
  plain: 'a burned-out senior developer: deadpan and sarcastic, lives on coffee, has seen every bug twice',
};

type Lines = Record<QuipKind, readonly string[]>;
const QUIPS: Record<Lang, Record<QuipRole, Lines>> = {
  it: {
    orchestrator: {
      work: ['Ogni cosa a suo tempo', 'La pazienza è magia', 'Tutto è collegato', 'Fidati del disegno', 'Vedo più di quanto dico', 'Un passo, poi un altro', 'Il caos ha un ordine',
        'Curioso. Molto curioso.', 'Lasciali imparare', 'Niente fretta, mai', 'Guido, non comando', 'Bacchetta alla mano', 'Le stelle approvano', 'C’è un filo in tutto'],
      pat: ['Gentile, amico mio', 'Ah, la gioventù', 'Una caramella?'],
      whack: ['Me l’aspettavo', 'Perdono. Stavolta.', 'La barba no, prego'],
      think: ['Consulto le stelle', 'Mh. Interessante.'],
      read: ['{x}: antica pergamena', 'Leggo tra le righe'],
      edit: ['Un ritocco a {x}', 'Un piccolo incanto'],
      run: ['Evoco {x}', 'Che l’incanto parta'],
      test: ['{x}: prova del fuoco', 'Vediamo se regge'],
      search: ['Dove si cela {x}?', 'Ciò che cerchi, c’è'],
      web: ['Un gufo a {x}', 'Notizie da lontano'],
      delegate: ['A te, apprendista', 'Affido il compito'],
      wait: ['La scelta è tua', 'Attendo. Senza fretta.'],
      err: ['Anche i saggi sbagliano', 'Incanto riuscito male'],
      done: ['Come doveva andare', 'Incanto compiuto'],
      idle: ['Medito. Quasi.', 'Sogno a occhi chiusi'],
    },
    strategist: {
      work: ['Tre mosse avanti', 'Era previsto', 'Nessuna sorpresa', 'Sacrifico un pedone', 'Il piano regge', 'La fretta perde', 'Prima penso. Poi vinco.',
        'Posizione vinta', 'Lascia che sbaglino', 'Ogni mossa ha un costo', 'Conto le varianti', 'Il caso non esiste', 'Stringo il cappio', 'Piano B già pronto'],
      pat: ['Previsto.', 'Mossa debole, ma grata', 'Non mi distrai'],
      whack: ['Annotata.', 'Te ne pentirai', 'Mossa da dilettante'],
      think: ['Calcolo. Silenzio.', 'Vedo il matto in sei'],
      read: ['Studio {x}', 'Leggo l’avversario'],
      edit: ['Muovo su {x}', 'Mossa silenziosa'],
      run: ['{x}: apertura', 'Eseguo. Come da piano.'],
      test: ['Verifico la variante', '{x}: nessun buco'],
      search: ['Stano {x}', 'Cerco il punto debole'],
      web: ['Spio {x}', 'Informazioni. Servono.'],
      delegate: ['Mando avanti un pedone', 'Qualcuno si sporchi'],
      wait: ['Tocca a te', 'L’orologio è tuo'],
      err: ['Calcolato male. Raro.', 'Perdo un pezzo'],
      done: ['Scacco matto', 'Come previsto'],
      idle: ['Studio finali', 'Aspetto il tuo errore'],
    },
    scout: {
      work: ['Ho visto di peggio', 'Tracce fresche', 'Qui è passato qualcuno', 'Terreno marcio', 'Segui le impronte', 'Sentiero battuto male', 'Il codice non mente',
        'Odore di legacy', 'Mai fidarsi delle mappe', 'Avanzo piano', 'Niente in vista. Male.', 'Conosco questa palude', 'Vento da nord, bug', 'Vado io. Resta qui.'],
      pat: ['Mh.', 'Non sono un cane', 'Ricevuto'],
      whack: ['Ne ho prese di peggio', 'Occhio, mordo', 'Segnato.'],
      think: ['Leggo il terreno', 'Qualcosa non torna'],
      read: ['{x}: tracce vecchie', 'Leggo i segni'],
      edit: ['Segno {x}', 'Lascio una tacca'],
      run: ['Lancio {x}. Giù.', 'Fuoco di prova'],
      test: ['Saggio il ghiaccio', '{x}: regge o cede'],
      search: ['{x}. Lo stano.', 'Caccia aperta'],
      web: ['Ricognizione su {x}', 'Fuori dal recinto'],
      delegate: ['Mando un segugio', 'Ci va il ragazzo'],
      wait: ['Aspetto il segnale', 'Fermo al guado'],
      err: ['Imboscata.', 'Pista sbagliata'],
      done: ['Trovato. Come sempre.', 'Zona battuta'],
      idle: ['Un occhio aperto', 'Fuoco basso'],
    },
    artisan: {
      work: ['Il ferro non mente', 'Batti finché è caldo', 'Meno chiacchiere', 'Lo raddrizzo io', 'Roba fatta per durare', 'Framework. Bah.', 'A mano viene meglio',
        'Niente fronzoli', 'Si piega o si spezza', 'Un colpo alla volta', 'Chi ha saldato qui?', 'Lavoro da uomini', 'Sudore, non slide', 'Ancora un colpo'],
      pat: ['Mh. Grazie.', 'Giù le mani', 'Attento al sigaro'],
      whack: ['Tutto qui?', 'Solletico.', 'L’incudine fa più male'],
      think: ['Misuro. Poi taglio.', 'Fammi fumare'],
      read: ['{x}: fatto coi piedi', 'Guardo il pezzo'],
      edit: ['Raddrizzo {x}', 'Lima e martello'],
      run: ['{x}: gira o lo rompo', 'Accendo la forgia'],
      test: ['Collaudo a martellate', '{x}: se regge, regge'],
      search: ['Dov’è {x}, diavolo?', 'Cerco l’attrezzo'],
      web: ['{x}. Roba da ufficio.', 'Internet. Bah.'],
      delegate: ['Lo fa il garzone', 'Tieni. Non romperlo.'],
      wait: ['Il ferro si fredda', 'Deciditi, capo'],
      err: ['Si è crepato', 'Ferro scadente'],
      done: ['Fatto. Regge.', 'Dura cent’anni'],
      idle: ['Finisco il sigaro', 'Forgia spenta'],
    },
    sentinel: {
      work: ['Nessuno passa', 'Respinto.', 'Ti vedo.', 'Un errore. Uno solo.', 'Fuori dal mio cancello', 'Non mi fido. Mai.', 'Chi sbaglia, paga',
        'Conto i caduti', 'Passa solo il perfetto', 'Ho la lista nera', 'Prova a fregarmi', 'Il codice confessa', 'Niente pietà', 'Tutti colpevoli'],
      pat: ['Tocca ancora e mordo', 'Mano registrata.', 'Tollerato.'],
      whack: ['Sbagliato bersaglio', 'Lo metto a verbale', 'Ricorderò.'],
      think: ['Sospetto di tutti', 'Chi mente qui?'],
      read: ['Perquisisco {x}', 'Leggo le prove'],
      edit: ['Blindo {x}', 'Chiudo la falla'],
      run: ['{x} sotto scorta', 'Esecuzione. Letterale.'],
      test: ['Interrogo {x}', 'Chi fallisce, sparisce'],
      search: ['Caccia a {x}', 'Stano i colpevoli'],
      web: ['{x}: territorio ostile', 'Fuori è pieno di ladri'],
      delegate: ['Mando la recluta', 'Che muoia un altro'],
      wait: ['Parola d’ordine.', 'Ti osservo. Rispondi.'],
      err: ['Breccia. Qualcuno paga.', 'Ve l’avevo detto'],
      done: ['Zona ripulita', 'Nessun superstite'],
      idle: ['Dormo a occhi aperti', 'Affilo la lama'],
    },
    herald: {
      work: ['Udite, udite!', 'Scandalo nel repo!', 'Lo sapranno tutti', 'Notizia che scotta', 'Ve lo dico in rima', 'Fonti ben pagate', 'Gonfio un po’ i fatti',
        'Voce di corridoio', 'Brindo alla notizia', 'Popolo, tremate!', 'Trionfo! O quasi.', 'In piazza a mezzogiorno', 'Si mormora che…', 'Proclama in arrivo'],
      pat: ['Il popolo mi adora', 'Un inchino, prego', 'Offrimi da bere'],
      whack: ['Attentato alla stampa!', 'Lo griderò in piazza', 'Infame!'],
      think: ['Cerco la rima', 'Come la gonfio?'],
      read: ['Declamo {x}', 'Sfoglio i pettegolezzi'],
      edit: ['Ritocco {x}. Ad arte.', 'Abbellisco i fatti'],
      run: ['Squilli per {x}!', 'Si dia fiato!'],
      test: ['Verdetto in piazza', '{x}: il popolo giudica'],
      search: ['Chi ha visto {x}?', 'Fiuto lo scandalo'],
      web: ['Voci da {x}', 'Dalle piazze straniere'],
      delegate: ['Mando il mio paggio', 'Corri, ragazzo!'],
      wait: ['Il pubblico attende', 'Parla, che annuncio'],
      err: ['Tragedia! In tre atti.', 'Smentisco tutto'],
      done: ['Trionfo! Scrivetelo.', 'Annuncio fatto. Vino.'],
      idle: ['Riposo l’ugola', 'Un goccio e torno'],
    },
    plain: {
      work: ['Già visto. Due volte.', 'Altro caffè', 'Funzionava ieri', 'Chi ha scritto questo?', 'Ah, io.', 'Non toccare se va', 'È venerdì da martedì',
        'Un altro workaround', 'Lo sistemo dopo. Mai.', 'TODO del 2019', 'Rifare tutto. Scherzo.', 'Stack Overflow, amico', 'Deadline: ieri', 'Riunione evitata'],
      pat: ['Preferivo un aumento', 'Grazie, HR', 'Ok.'],
      whack: ['Lo metto nel ticket', 'Feedback ricevuto', 'Mi licenzio. Domani.'],
      think: ['Fisso il vuoto', 'Penso. O dormo.'],
      read: ['{x}: chi l’ha scritto?', 'Leggo e invecchio'],
      edit: ['{x}: fix temporaneo', 'Cambio una riga. Prego.'],
      run: ['Lancio {x}. Speriamo.', 'Invio e chiudo gli occhi'],
      test: ['Da me funziona', '{x}: rosso. Ovvio.'],
      search: ['Dov’era {x}?', 'Grep e preghiere'],
      web: ['{x}: 40 schede aperte', 'Leggo la doc. Finta.'],
      delegate: ['Non è compito mio', 'Passo la patata'],
      wait: ['Aspetto. Come sempre.', 'Sollecito numero tre'],
      err: ['Lo sapevo.', 'Riavvia e prega'],
      done: ['Fatto. Non toccate.', 'Chiudo e sparisco'],
      idle: ['Pausa caffè. Lunga.', 'Fingo di lavorare'],
    },
  },
  en: {
    orchestrator: {
      work: ['All in good time', 'Patience is magic', 'Everything connects', 'Trust the pattern', 'More seen than said', 'One step, then another', 'Chaos has an order',
        'Curious. Most curious.', 'Let them learn', 'No hurry. Ever.', 'I guide, not command', 'Wand at the ready', 'The stars approve', 'A thread runs through it'],
      pat: ['Kind of you, my friend', 'Ah, youth', 'Care for a sweet?'],
      whack: ['I expected that', 'Forgiven. This once.', 'Not the beard, please'],
      think: ['Consulting the stars', 'Hm. Interesting.'],
      read: ['{x}: an old scroll', 'Reading between lines'],
      edit: ['A touch on {x}', 'A small charm'],
      run: ['I summon {x}', 'Let the spell begin'],
      test: ['{x}: trial by fire', 'We shall see'],
      search: ['Where hides {x}?', 'What you seek is here'],
      web: ['An owl to {x}', 'News from afar'],
      delegate: ['Yours, apprentice', 'I entrust the task'],
      wait: ['The choice is yours', 'I wait. No hurry.'],
      err: ['Even the wise err', 'A spell gone wrong'],
      done: ['As it was meant', 'The spell is cast'],
      idle: ['Meditating. Almost.', 'Dreaming, eyes shut'],
    },
    strategist: {
      work: ['Three moves ahead', 'As expected', 'No surprises', 'Sacrificing a pawn', 'The plan holds', 'Haste loses', 'Think first. Then win.',
        'Won position', 'Let them blunder', 'Every move has a cost', 'Counting the lines', 'Luck does not exist', 'Tightening the noose', 'Plan B is ready'],
      pat: ['Expected.', 'Weak move, but kind', 'You won’t distract me'],
      whack: ['Noted.', 'You will regret it', 'An amateur’s move'],
      think: ['Calculating. Quiet.', 'Mate in six'],
      read: ['Studying {x}', 'Reading the opponent'],
      edit: ['My move: {x}', 'A quiet move'],
      run: ['{x}: the opening', 'Executing. As planned.'],
      test: ['Checking the line', '{x}: no holes'],
      search: ['Flushing out {x}', 'Finding the weak spot'],
      web: ['Spying on {x}', 'Intelligence. Needed.'],
      delegate: ['Sending a pawn ahead', 'Let someone get dirty'],
      wait: ['Your move', 'The clock is yours'],
      err: ['Miscalculated. Rare.', 'I lose a piece'],
      done: ['Checkmate', 'As planned'],
      idle: ['Studying endgames', 'Awaiting your mistake'],
    },
    scout: {
      work: ['Seen worse', 'Fresh tracks', 'Someone passed here', 'Rotten ground', 'Follow the prints', 'Badly kept trail', 'Code doesn’t lie',
        'Smells like legacy', 'Never trust the maps', 'Moving slow', 'Nothing in sight. Bad.', 'I know this swamp', 'North wind, bugs', 'I’ll go. Stay here.'],
      pat: ['Hm.', 'Not a dog', 'Copy'],
      whack: ['Had worse', 'Careful, I bite', 'Marked.'],
      think: ['Reading the ground', 'Something’s off'],
      read: ['{x}: old tracks', 'Reading the signs'],
      edit: ['Marking {x}', 'Leaving a notch'],
      run: ['Firing {x}. Down.', 'Test shot'],
      test: ['Testing the ice', '{x}: holds or breaks'],
      search: ['{x}. I’ll flush it.', 'Hunt is on'],
      web: ['Recon on {x}', 'Beyond the fence'],
      delegate: ['Sending a hound', 'The kid goes'],
      wait: ['Waiting for the signal', 'Holding at the ford'],
      err: ['Ambush.', 'Wrong trail'],
      done: ['Found. As always.', 'Area swept'],
      idle: ['One eye open', 'Fire burning low'],
    },
    artisan: {
      work: ['Iron doesn’t lie', 'Strike while it’s hot', 'Less talk', 'I’ll straighten it', 'Built to last', 'Frameworks. Bah.', 'Better done by hand',
        'No frills', 'Bends or breaks', 'One blow at a time', 'Who welded this?', 'Real work', 'Sweat, not slides', 'One more blow'],
      pat: ['Hm. Thanks.', 'Hands off', 'Mind the cigar'],
      whack: ['That all?', 'Tickles.', 'The anvil hits harder'],
      think: ['Measure. Then cut.', 'Let me smoke'],
      read: ['{x}: shoddy work', 'Looking at the piece'],
      edit: ['Straightening {x}', 'File and hammer'],
      run: ['{x}: runs or breaks', 'Lighting the forge'],
      test: ['Tested by hammer', '{x}: holds or scrap'],
      search: ['Where’s {x}, damn it?', 'Looking for the tool'],
      web: ['{x}. Office stuff.', 'Internet. Bah.'],
      delegate: ['The apprentice does it', 'Here. Don’t break it.'],
      wait: ['The iron’s cooling', 'Make up your mind, boss'],
      err: ['It cracked', 'Cheap iron'],
      done: ['Done. It holds.', 'Lasts a century'],
      idle: ['Finishing my cigar', 'Forge is cold'],
    },
    sentinel: {
      work: ['None shall pass', 'Rejected.', 'I see you.', 'One mistake. Just one.', 'Away from my gate', 'I trust no one.', 'Fail, and you pay',
        'Counting the fallen', 'Only perfect passes', 'I keep a blacklist', 'Try to fool me', 'The code confesses', 'No mercy', 'All guilty'],
      pat: ['Touch again, I bite', 'Hand recorded.', 'Tolerated.'],
      whack: ['Wrong target', 'It goes on record', 'I will remember.'],
      think: ['I suspect everyone', 'Who is lying here?'],
      read: ['Searching {x}', 'Reading the evidence'],
      edit: ['Locking down {x}', 'Sealing the breach'],
      run: ['{x} under escort', 'Execution. Literally.'],
      test: ['Interrogating {x}', 'Fail and vanish'],
      search: ['Hunting {x}', 'Rooting out the guilty'],
      web: ['{x}: hostile ground', 'Thieves everywhere'],
      delegate: ['Sending the recruit', 'Let another one die'],
      wait: ['Password.', 'I’m watching. Answer.'],
      err: ['Breach. Someone pays.', 'I told you so'],
      done: ['Area cleansed', 'No survivors'],
      idle: ['Sleeping eyes open', 'Sharpening the blade'],
    },
    herald: {
      work: ['Hear ye, hear ye!', 'Scandal in the repo!', 'All shall know', 'Scorching news', 'I’ll say it in rhyme', 'Well-paid sources', 'Inflating the facts',
        'Word in the corridor', 'A toast to the news', 'Tremble, good people!', 'Triumph! Or nearly.', 'Town square at noon', 'Rumour has it…', 'Proclamation incoming'],
      pat: ['The people adore me', 'A bow, if you please', 'Buy me a drink'],
      whack: ['Attack on the press!', 'I’ll shout it in town', 'Scoundrel!'],
      think: ['Seeking a rhyme', 'How do I inflate it?'],
      read: ['Declaiming {x}', 'Leafing through gossip'],
      edit: ['Gilding {x}', 'Embellishing the facts'],
      run: ['Fanfare for {x}!', 'Sound the trumpets!'],
      test: ['Verdict in the square', '{x}: the people judge'],
      search: ['Who has seen {x}?', 'Sniffing a scandal'],
      web: ['Rumours from {x}', 'From foreign squares'],
      delegate: ['Sending my page', 'Run, boy!'],
      wait: ['The audience waits', 'Speak, and I announce'],
      err: ['Tragedy! In three acts.', 'I deny everything'],
      done: ['Triumph! Write it down.', 'Announced. Now wine.'],
      idle: ['Resting my voice', 'One sip and I’m back'],
    },
    plain: {
      work: ['Seen it. Twice.', 'More coffee', 'It worked yesterday', 'Who wrote this?', 'Oh. Me.', 'If it works, hands off', 'Friday since Tuesday',
        'Another workaround', 'Fix it later. Never.', 'TODO from 2019', 'Rewrite it all. Kidding.', 'Thanks, Stack Overflow', 'Deadline: yesterday', 'Meeting dodged'],
      pat: ['I’d prefer a raise', 'Thanks, HR', 'Ok.'],
      whack: ['Adding it to the ticket', 'Feedback received', 'I quit. Tomorrow.'],
      think: ['Staring into the void', 'Thinking. Or asleep.'],
      read: ['{x}: who did this?', 'Reading and ageing'],
      edit: ['{x}: temporary fix', 'One line changed. Enjoy.'],
      run: ['Running {x}. Pray.', 'Enter, eyes closed'],
      test: ['Works on my machine', '{x}: red. Obviously.'],
      search: ['Where was {x}?', 'Grep and prayers'],
      web: ['{x}: 40 tabs open', 'Reading the docs. Sure.'],
      delegate: ['Not my job', 'Passing the buck'],
      wait: ['Waiting. As usual.', 'Third reminder'],
      err: ['I knew it.', 'Reboot and pray'],
      done: ['Done. Don’t touch it.', 'Closing and vanishing'],
      idle: ['Coffee break. Long.', 'Pretending to work'],
    },
  },
  de: {
    orchestrator: {
      work: ['Alles zu seiner Zeit', 'Geduld ist Magie', 'Alles hängt zusammen', 'Vertrau dem Muster', 'Ich sehe mehr', 'Schritt für Schritt', 'Chaos hat Ordnung',
        'Kurios. Sehr kurios.', 'Lass sie lernen', 'Keine Eile. Nie.', 'Ich lenke, nicht befehle', 'Zauberstab bereit', 'Die Sterne nicken', 'Ein Faden in allem'],
      pat: ['Sehr freundlich', 'Ach, die Jugend', 'Ein Bonbon?'],
      whack: ['Das ahnte ich', 'Verziehen. Diesmal.', 'Nicht den Bart, bitte'],
      think: ['Ich frage die Sterne', 'Hm. Interessant.'],
      read: ['{x}: altes Pergament', 'Lese zwischen Zeilen'],
      edit: ['Ein Hauch für {x}', 'Ein kleiner Zauber'],
      run: ['Ich rufe {x}', 'Der Zauber beginne'],
      test: ['{x}: Feuerprobe', 'Mal sehen, ob es hält'],
      search: ['Wo steckt {x}?', 'Was du suchst, ist da'],
      web: ['Eine Eule zu {x}', 'Kunde aus der Ferne'],
      delegate: ['Für dich, Lehrling', 'Ich vertraue es an'],
      wait: ['Die Wahl ist dein', 'Ich warte. Ohne Eile.'],
      err: ['Auch Weise irren', 'Zauber missglückt'],
      done: ['Wie es sein sollte', 'Der Zauber wirkt'],
      idle: ['Ich meditiere. Fast.', 'Träume mit Augen zu'],
    },
    strategist: {
      work: ['Drei Züge voraus', 'Wie erwartet', 'Keine Überraschung', 'Ich opfere einen Bauern', 'Der Plan hält', 'Eile verliert', 'Erst denken, dann siegen',
        'Gewonnene Stellung', 'Lass sie patzen', 'Jeder Zug kostet', 'Ich zähle Varianten', 'Zufall gibt es nicht', 'Die Schlinge zieht zu', 'Plan B steht'],
      pat: ['Erwartet.', 'Schwacher Zug, aber nett', 'Du lenkst mich nicht ab'],
      whack: ['Notiert.', 'Das bereust du', 'Ein Anfängerzug'],
      think: ['Ich rechne. Ruhe.', 'Matt in sechs'],
      read: ['Studiere {x}', 'Ich lese den Gegner'],
      edit: ['Mein Zug: {x}', 'Ein stiller Zug'],
      run: ['{x}: die Eröffnung', 'Ausführung nach Plan'],
      test: ['Prüfe die Variante', '{x}: keine Lücke'],
      search: ['Ich stöbere {x} auf', 'Suche die Schwachstelle'],
      web: ['Spähe {x} aus', 'Aufklärung. Nötig.'],
      delegate: ['Ein Bauer geht vor', 'Das macht ein Bauer'],
      wait: ['Du bist am Zug', 'Deine Uhr läuft'],
      err: ['Verrechnet. Selten.', 'Ich verliere eine Figur'],
      done: ['Schachmatt', 'Wie geplant'],
      idle: ['Studiere Endspiele', 'Warte auf deinen Fehler'],
    },
    scout: {
      work: ['Hab Schlimmeres gesehen', 'Frische Spuren', 'Hier war jemand', 'Fauler Boden', 'Folge den Abdrücken', 'Schlecht gepflegter Pfad', 'Code lügt nicht',
        'Riecht nach Legacy', 'Trau keiner Karte', 'Ich gehe langsam', 'Nichts in Sicht. Übel.', 'Den Sumpf kenne ich', 'Nordwind, Bugs', 'Ich gehe. Bleib hier.'],
      pat: ['Hm.', 'Bin kein Hund', 'Verstanden'],
      whack: ['Kenne Schlimmeres', 'Vorsicht, ich beiße', 'Gemerkt.'],
      think: ['Ich lese den Boden', 'Etwas stimmt nicht'],
      read: ['{x}: alte Spuren', 'Ich lese die Zeichen'],
      edit: ['Markiere {x}', 'Eine Kerbe gesetzt'],
      run: ['Feuere {x}. Runter.', 'Probeschuss'],
      test: ['Prüfe das Eis', '{x}: hält oder bricht'],
      search: ['{x}. Aufgestöbert.', 'Die Jagd beginnt'],
      web: ['Erkundung bei {x}', 'Jenseits des Zauns'],
      delegate: ['Schicke einen Spürhund', 'Der Junge geht'],
      wait: ['Warte aufs Signal', 'Halt an der Furt'],
      err: ['Hinterhalt.', 'Falsche Fährte'],
      done: ['Gefunden. Wie immer.', 'Gebiet durchkämmt'],
      idle: ['Ein Auge offen', 'Feuer brennt klein'],
    },
    artisan: {
      work: ['Eisen lügt nicht', 'Schmiede, solange heiß', 'Weniger Gerede', 'Das richte ich', 'Gebaut für ewig', 'Frameworks. Pah.', 'Von Hand wird es besser',
        'Kein Schnickschnack', 'Biegt oder bricht', 'Schlag für Schlag', 'Wer hat hier geschweißt?', 'Echte Arbeit', 'Schweiß statt Folien', 'Noch ein Schlag'],
      pat: ['Hm. Danke.', 'Finger weg', 'Pass auf die Zigarre auf'],
      whack: ['Das war alles?', 'Kitzelt.', 'Der Amboss haut härter'],
      think: ['Messen. Dann schneiden.', 'Lass mich rauchen'],
      read: ['{x}: Pfusch', 'Ich prüfe das Stück'],
      edit: ['Richte {x}', 'Feile und Hammer'],
      run: ['{x}: lauf oder brich', 'Ich heize die Esse an'],
      test: ['Prüfung mit dem Hammer', '{x}: hält oder nicht'],
      search: ['Wo ist {x}, verdammt?', 'Suche das Werkzeug'],
      web: ['{x}. Bürokram.', 'Internet. Pah.'],
      delegate: ['Das macht der Lehrling', 'Da. Nicht kaputtmachen.'],
      wait: ['Das Eisen wird kalt', 'Entscheide dich, Chef'],
      err: ['Es hat einen Riss', 'Billiges Eisen'],
      done: ['Fertig. Hält.', 'Hält hundert Jahre'],
      idle: ['Rauche zu Ende', 'Die Esse ist kalt'],
    },
    sentinel: {
      work: ['Keiner kommt durch', 'Abgewiesen.', 'Ich sehe dich.', 'Ein Fehler. Nur einer.', 'Weg von meinem Tor', 'Ich traue keinem.', 'Wer patzt, zahlt',
        'Ich zähle die Gefallenen', 'Nur Perfektes passiert', 'Ich führe eine Liste', 'Versuch mich zu täuschen', 'Der Code gesteht', 'Keine Gnade', 'Alle schuldig'],
      pat: ['Nochmal, und ich beiße', 'Hand vermerkt.', 'Geduldet.'],
      whack: ['Falsches Ziel', 'Kommt ins Protokoll', 'Ich merke es mir.'],
      think: ['Ich verdächtige alle', 'Wer lügt hier?'],
      read: ['Durchsuche {x}', 'Ich lese die Beweise'],
      edit: ['Riegle {x} ab', 'Ich schließe die Lücke'],
      run: ['{x} unter Bewachung', 'Exekution. Wörtlich.'],
      test: ['Verhöre {x}', 'Wer scheitert, fliegt'],
      search: ['Jagd auf {x}', 'Ich finde die Schuldigen'],
      web: ['{x}: Feindesland', 'Draußen nur Diebe'],
      delegate: ['Schicke den Rekruten', 'Soll ein anderer fallen'],
      wait: ['Parole.', 'Ich beobachte. Antworte.'],
      err: ['Bresche. Einer zahlt.', 'Ich habe es gesagt'],
      done: ['Gebiet gesäubert', 'Keine Überlebenden'],
      idle: ['Schlafe, Augen offen', 'Ich schärfe die Klinge'],
    },
    herald: {
      work: ['Hört, hört!', 'Skandal im Repo!', 'Alle werden es wissen', 'Brandheiße Nachricht', 'Ich sag es im Reim', 'Gut bezahlte Quellen', 'Ich blähe es etwas auf',
        'Flurfunk', 'Prost auf die Neuigkeit', 'Volk, erzittere!', 'Triumph! Oder fast.', 'Mittags am Marktplatz', 'Man munkelt…', 'Verkündung naht'],
      pat: ['Das Volk liebt mich', 'Eine Verbeugung, bitte', 'Gib mir einen aus'],
      whack: ['Angriff auf die Presse!', 'Das rufe ich am Markt', 'Schurke!'],
      think: ['Ich suche den Reim', 'Wie blähe ich es auf?'],
      read: ['Deklamiere {x}', 'Blättere im Tratsch'],
      edit: ['Vergolde {x}', 'Ich schmücke die Fakten'],
      run: ['Fanfare für {x}!', 'Blast die Trompeten!'],
      test: ['Urteil am Marktplatz', '{x}: das Volk richtet'],
      search: ['Wer sah {x}?', 'Ich wittere Skandal'],
      web: ['Gerüchte aus {x}', 'Von fremden Plätzen'],
      delegate: ['Ich schicke den Pagen', 'Lauf, Junge!'],
      wait: ['Das Publikum wartet', 'Sprich, ich verkünde'],
      err: ['Tragödie! In drei Akten.', 'Ich dementiere alles'],
      done: ['Triumph! Notiert das.', 'Verkündet. Jetzt Wein.'],
      idle: ['Schone die Stimme', 'Ein Schluck, dann weiter'],
    },
    plain: {
      work: ['Schon gesehen. Zweimal.', 'Mehr Kaffee', 'Gestern lief es noch', 'Wer hat das geschrieben?', 'Ach. Ich.', 'Läuft? Finger weg.', 'Freitag seit Dienstag',
        'Noch ein Workaround', 'Mach ich später. Nie.', 'TODO von 2019', 'Alles neu. Scherz.', 'Danke, Stack Overflow', 'Deadline: gestern', 'Meeting umgangen'],
      pat: ['Lieber mehr Gehalt', 'Danke, HR', 'Ok.'],
      whack: ['Kommt ins Ticket', 'Feedback angekommen', 'Ich kündige. Morgen.'],
      think: ['Ich starre ins Leere', 'Denke. Oder schlafe.'],
      read: ['{x}: wer war das?', 'Lesen macht alt'],
      edit: ['{x}: Übergangslösung', 'Eine Zeile. Bitte sehr.'],
      run: ['Starte {x}. Beten.', 'Enter, Augen zu'],
      test: ['Bei mir läuft es', '{x}: rot. Klar.'],
      search: ['Wo war {x}?', 'Grep und Gebete'],
      web: ['{x}: 40 Tabs offen', 'Lese die Doku. Sicher.'],
      delegate: ['Nicht mein Job', 'Ich reiche es weiter'],
      wait: ['Ich warte. Wie immer.', 'Dritte Erinnerung'],
      err: ['Wusste ich.', 'Neustart und beten'],
      done: ['Fertig. Nicht anfassen.', 'Zu und weg'],
      idle: ['Kaffeepause. Lang.', 'Ich tue beschäftigt'],
    },
  },
};

export const isQuipRole = (v: unknown): v is QuipRole => typeof v === 'string' && (QUIP_ROLES as readonly string[]).includes(v);

/** The lines of the day (ADR 0305; the owner, 2026-11-14: «ogni giorno dovrebbero cambiare … un modello minuscolo per
 *  farlo, tipo la frase del giorno»): written once a day by the lightest model (main/quips/daily.ts), checked by
 *  cleanDailyQuips, kept a few days. They join the fixed lines, which are always there (no engine, no network, a day
 *  the model wrote nothing usable). */
export type DailyQuips = Partial<Record<QuipRole, Partial<Record<QuipKind, string[]>>>>;
const daily: Partial<Record<Lang, DailyQuips>> = {};
/** The lines of the day of a language, for every person in this process (null: none). */
export function setDailyQuips(lang: Lang, lines: DailyQuips | null): void {
  if (lines) daily[lang] = lines; else delete daily[lang];
}

/** Every line a role can say at a moment, in a language, as written (a `{x}` stands for the real thing's name): the
 *  lines of the day first, then the fixed ones. */
export const quips = (role: QuipRole, kind: QuipKind, lang: Lang): readonly string[] => {
  const today = daily[lang]?.[role]?.[kind];
  return today?.length ? [...today, ...QUIPS[lang][role][kind]] : QUIPS[lang][role][kind];
};
/** The fixed lines alone: what the app says with no line of the day. */
export const fixedQuips = (role: QuipRole, kind: QuipKind, lang: Lang): readonly string[] => QUIPS[lang][role][kind];

/** The moments whose line may name the real thing with `{x}`. */
export const QUIP_X_KINDS: readonly QuipKind[] = ['read', 'edit', 'run', 'test', 'search', 'web'];
/** How long a line of the day that names the real thing may be besides the name (the name takes up to QUIP_X_MAX). */
export const QUIP_X_REST = 18;
/** How many lines of the day a role keeps for one moment. */
export const DAILY_MAX = 40;
/** One line a model wrote, as it may be said: a few plain words that fit the bubble, at most one `{x}` and only where
 *  a thing can be named; null when it is not. Letters, digits and plain punctuation only: no markup, link or code. */
export function cleanQuip(v: unknown, kind: QuipKind): string | null {
  if (typeof v !== 'string') return null;
  const q = v.normalize('NFC').replace(/\s+/g, ' ').replace(/^[\s"'«»“”„]+|[\s"'«»“”„]+$/g, '');
  if (!q || [...q].length > QUIP_MAX || q.split(' ').length > 5) return null;
  const x = q.split('{x}').length - 1;
  if (x > (QUIP_X_KINDS.includes(kind) ? 1 : 0)) return null;
  if (x && [...q.replace('{x}', '')].length > QUIP_X_REST) return null;
  if (!/^[\p{L}\p{N} .,:;!?'’…()%+\-]+$/u.test(q.replace('{x}', 'x')) || !/\p{L}/u.test(q.replace('{x}', ''))) return null;
  if (/https?:|www\.|\/\//i.test(q)) return null;
  return q;
}
/** What a model wrote for the day, checked line by line: only known roles and moments, only lines cleanQuip accepts,
 *  none twice, none that is a fixed line already, at most DAILY_MAX each. Anything else is dropped. */
export function cleanDailyQuips(raw: unknown, lang: Lang): DailyQuips {
  const out: DailyQuips = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const role of QUIP_ROLES) {
    const of = (raw as Record<string, unknown>)[role];
    if (!of || typeof of !== 'object' || Array.isArray(of)) continue;
    for (const kind of QUIP_KINDS) {
      const list = (of as Record<string, unknown>)[kind];
      if (!Array.isArray(list)) continue;
      const fixed = new Set(QUIPS[lang][role][kind].map(q => q.toLowerCase())), seen = new Set<string>(), kept: string[] = [];
      for (const v of list) {
        const q = cleanQuip(v, kind);
        if (!q || fixed.has(q.toLowerCase()) || seen.has(q.toLowerCase())) continue;
        seen.add(q.toLowerCase()); kept.push(q);
        if (kept.length >= DAILY_MAX) break;
      }
      if (kept.length) (out[role] ??= {})[kind] = kept;
    }
  }
  return out;
}
/** A model's answer as lines of the day: one `role.moment: line | line | line` per row; a row it cannot read is skipped. */
export function parseDailyQuips(text: string, lang: Lang): DailyQuips {
  const raw: DailyQuips = {};
  for (const row of text.split(/\r?\n/)) {
    const m = /^\s*[-*]?\s*([a-z]+)\.([a-z]+)\s*:\s*(.+)$/i.exec(row);
    if (!m) continue;
    // only a known role and moment is a key: a word like `constructor` in their place is not looked up anywhere
    const role = QUIP_ROLES.find(r => r === m[1]!.toLowerCase()), kind = QUIP_KINDS.find(k => k === m[2]!.toLowerCase());
    if (role && kind) ((raw[role] ??= {})[kind] ??= []).push(...m[3]!.split('|'));
  }
  return cleanDailyQuips(raw, lang);
}
/** Two sets of lines as one: the first one's lines first, none twice, at most DAILY_MAX each. */
export function mergeDailyQuips(a: DailyQuips, b: DailyQuips): DailyQuips {
  const out: DailyQuips = {};
  for (const role of QUIP_ROLES) for (const kind of QUIP_KINDS) {
    const all = [...(a[role]?.[kind] ?? []), ...(b[role]?.[kind] ?? [])];
    const kept = all.filter((q, i) => all.findIndex(o => o.toLowerCase() === q.toLowerCase()) === i).slice(0, DAILY_MAX);
    if (kept.length) (out[role] ??= {})[kind] = kept;
  }
  return out;
}

/** The name that goes in a line: one word or file name, cut short. '' when there is nothing sayable. */
export function quipX(v: string): string {
  const x = [...v.trim().replace(/\s+/g, ' ')]; // by character: a cut never splits one
  return x.length > QUIP_X_MAX ? `${x.slice(0, QUIP_X_MAX - 1).join('')}…` : x.join('');
}

/** One line, picked by `rnd` (0 ≤ rnd() < 1); never `avoid` (the one it said last) when there is another. With `x`
 *  (the real file, command, search or site) the lines that name it take part, with it in place; without, only the
 *  others: every moment has at least one. */
export function pickQuip(role: QuipRole, kind: QuipKind, lang: Lang, rnd: () => number = Math.random, avoid?: string, x?: string): string {
  const name = x ? quipX(x) : '';
  const all = quips(role, kind, lang).flatMap(q => (q.includes('{x}') ? (name ? [q.replace('{x}', () => name)] : []) : [q]));
  const pool = all.length > 1 ? all.filter(q => q !== avoid) : all;
  return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))]!;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const base = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? '';
/** A step that only moves or prepares: the program is the one after it. */
const SETUP = /^(cd|pushd|Set-Location|export|set)\s/i;
/** A variable set in front of the program (`FOO=1`), dropped with its value. */
const ASSIGN = /^\s*\w+=(\\.|\S)*\s+/;
/** A program's path as typed, before its folders are cut away: no quotes, signs or values. */
const PLAIN_PATH = /^[\w.\/\\:+-]+$/;
/** A program's name as it can be said: letters first (a piece of anything else is not shown). */
const PROGRAM = /^[A-Za-z][\w.+-]*$/;
/** Programs that are test runners by themselves, and tools that test when asked to with a word. */
const RUNNER = /^(vitest|jest|pytest|mocha|rspec|phpunit|ctest)$/i;
const TOOL = /^(npm|pnpm|yarn|bun|npx|pnpx|bunx|dotnet|cargo|go|mvn|mvnw|gradle|gradlew|make|deno|python\d?|py|php|rake|node)$/i;
const ASKED = /^(test|tests|t|unittest|nextest|check:quick|--test)$|^test:|(^|[\/\\])e2e\b/i;

/** The steps of a command, each as its words: what stands in quotes or is computed in place is taken out first (a
 *  value never becomes a word), the variables set in front are dropped, a step that only prepares is skipped. */
function steps(cmd: string): string[][] {
  const bare = cmd.replace(/"[^"]*"|'[^']*'|`[^`]*`|\$\([^)]*\)/g, '""');
  return bare.split(/&&|\|\||;|\||\n/).map(p => { let s = p.trim(); while (ASSIGN.test(s)) s = s.replace(ASSIGN, ''); return s; })
    .filter(s => s && !SETUP.test(`${s} `)).map(s => s.split(/\s+/));
}
/** The program of a step, without its folders and `.exe`; '' when it is not a plain name (a quoted path, a sign). */
const program = (step: readonly string[]): string => {
  const raw = step[0] ?? '', word = PLAIN_PATH.test(raw) ? base(raw).replace(/\.(exe|cmd|bat)$/i, '') : '';
  return PROGRAM.test(word) ? word : '';
};
/** A step that runs tests: a test runner (`vitest`, `npx playwright test`), or a tool asked to test (`npm test`,
 *  `dotnet test`, `python -m pytest`, `npm run check:quick`). The word in a message or a file name is not one. */
function testing(step: readonly string[]): boolean {
  const p = program(step), args = step.slice(1), words = args.filter(a => !a.startsWith('-') || a === '--test');
  if (RUNNER.test(p)) return true;
  if (/^playwright$/i.test(p)) return words[0] === 'test';
  if (!TOOL.test(p)) return false;
  // `npx vitest`, `yarn jest`, `python -m pytest`: the runner is the first word; `npx playwright test`
  const first = base(words[0] ?? '');
  if (RUNNER.test(first)) return true;
  if (/^playwright$/i.test(first)) return words[1] === 'test';
  return words.some(w => ASKED.test(w));
}

/** The moment of a tool call, and the real thing it works on (zero tokens: the tool's name and input, as every engine
 *  the app runs names them). A file's name for a read or an edit, the program for a command, the words for a search,
 *  the host for a page; a tool it does not know is plain `work`. */
export function quipOfTool(name: string, input: unknown): { kind: QuipKind; x?: string } {
  const i = obj(input), file = base(str(i.file_path) || str(i.path) || str(i.notebook_path) || str(i.file));
  const withX = (kind: QuipKind, x: string): { kind: QuipKind; x?: string } => (x ? { kind, x } : { kind });
  if (/^(Bash|PowerShell|Shell|shell|exec_command|command)$/.test(name)) {
    const cmd = str(i.command) || (Array.isArray(i.command) ? i.command.map(str).join(' ') : '') || str(i.cmd);
    // the program that runs first, past `cd x &&` and the variables set in front; a test when any step runs tests
    const all = steps(cmd);
    return withX(all.some(testing) ? 'test' : 'run', program(all[0] ?? []));
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
