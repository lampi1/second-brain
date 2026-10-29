// The in-app guide's content ("Guida", components/GuidePage.tsx): one card per core concept of the app, in Italian and
// English, written for a developer who wants to understand how the app works without reading the code. Every card names
// the source files its claims come from (`sources`, checked to exist by test/unit/concept-guide.test.ts) and a comment
// beside each part cites the file it was read from; a statement about what the app does NOT do yet goes in `target`,
// never in `points`. Kept as data, not JSX, so updating a card is a text edit. Also holds the pure helpers of «Discuti»:
// the text that carries a card into a chat (discussText) and the message «Discuti» sends to the Orchestrator
// (orchestratorText). German (ADR 0117) is not written beside each pair: concept-guide.de.ts maps every English text to
// its German one, and textOf falls back to English when an entry is missing.
import { GUIDE_DE } from './concept-guide.de';

export type GuideLang = 'it' | 'en' | 'de';
/** One text in Italian and English (ADR 0057); German comes from GUIDE_DE. */
export type Bi = Readonly<{ it: string; en: string }>;
/** A "Dettagli tecnici" row: a label (data shape, files, thresholds, where it lives) and its text. */
export interface ConceptTech { readonly label: Bi; readonly text: Bi }
/** A small diagram: boxes left to right; `cycle` draws the way back to the first box. Labels stay short (≤ 24 chars). */
export interface ConceptDiagram { readonly kind: 'flow' | 'cycle'; readonly steps: readonly Bi[] }
export interface ConceptCard {
  readonly id: string;
  readonly title: Bi;
  /** one plain line */
  readonly summary: Bi;
  /** "Come funziona": 4 to 8 short numbered points, current behaviour only */
  readonly points: readonly Bi[];
  /** an everyday analogy */
  readonly analogy: Bi;
  readonly tech: readonly ConceptTech[];
  /** repo-relative source files the card's claims come from */
  readonly sources: readonly string[];
  readonly diagram?: ConceptDiagram;
  /** the parts that are the target, not today's behaviour (shown apart, clearly marked) */
  readonly target?: readonly Bi[];
  /** work already in an open pull request, not on main yet: shown as "in arrivo (PR #n)"; move it into `points` after the merge */
  readonly coming?: readonly { readonly pr: number; readonly text: Bi }[];
  /** shown first, full width */
  readonly prominent?: true;
}

const b = (it: string, en: string): Bi => ({ it, en });
const tech = (label: Bi, it: string, en: string): ConceptTech => ({ label, text: b(it, en) });
const DATA = b('Forma dei dati', 'Data shape');
const FILES = b('File', 'Files');
const LIMITS = b('Soglie e limiti', 'Thresholds and limits');
const WHERE = b('Dove vive', 'Where it lives');
/** the MCP tool names a card's points describe in words (ADR 0101: tool names stay in the technical details) */
const TOOLS = b('Strumenti interni', 'Internal tools');

export const CONCEPTS: readonly ConceptCard[] = [
  {
    id: 'every-task-agent',
    prominent: true,
    title: b('Ogni compito passa da un ruolo', 'Every task goes through a role'),
    summary: b(
      'Il lavoro lo fanno sei ruoli fissi: l’Orchestrator coordina, cinque ruoli di lavoro eseguono, ognuno in una chat che vedi.',
      'Six fixed roles do the work: the Orchestrator coordinates, five work roles carry it out, each in a chat you can see.'),
    points: [
      // src/shared/roles.ts ROLE_IDS, ROLE_DEFAULTS
      b('I ruoli sono sempre gli stessi: Orchestrator, Strategist, Scout, Artisan, Sentinel, Herald. Nessuno se ne crea uno nuovo: un saper fare che manca diventa una skill. Router, Judge e Scribe non ci sono più: le richieste indipendenti le smista l’Orchestrator, il giudizio indipendente lo dà Sentinel, documenti e note del brain li scrive Artisan con una skill.',
        'The roles are always the same: Orchestrator, Strategist, Scout, Artisan, Sentinel, Herald. Nobody creates a new one: missing know-how becomes a skill. Router, Judge and Scribe are gone: the Orchestrator splits independent requests, Sentinel gives the independent verdict, Artisan writes documents and brain notes with a skill.'),
      // src/renderer/actions.ts newRequest (Ctrl+N); src/main/agents/catalog.ts resolve()
      b('Il lavoro parte solo dall’Orchestrator: Ctrl+N porta il cursore nella sua colonna («Cosa vuoi fare?»), lui sceglie il ruolo e le skill; la chat nasce con motore, modello del suo livello e istruzioni del ruolo.',
        'Work starts only from the Orchestrator: Ctrl+N puts the cursor in its column ("What do you want to do?"), it picks the role and the skills; the chat is born with the role’s engine, its tier’s model and the role’s instructions.'),
      // src/main/appctl/tools.ts app_create_chat; src/main/agents/discovery.ts agent_catalog
      b('L’Orchestrator legge l’elenco dei ruoli, si fa suggerire le skill adatte e apre il lavoro nominando il ruolo: motore, modello e sforzo li decide il ruolo, nient’altro li scavalca.',
        'The Orchestrator reads the list of roles, asks for the fitting skills and opens the work naming the role: the role decides engine, model and effort, nothing overrides them.'),
      // src/shared/roles.ts canLaunch, launches; src/main/appctl/tools.ts
      b('Un ruolo al lavoro delega una parte a un altro ruolo che può avviare: il figlio è una chat visibile sotto il genitore, mai un sotto-agente nascosto, e non ha mai più permessi del genitore.',
        'A working role delegates a part to another role it may launch: the child is a visible chat under its parent, never a hidden sub-agent, and never gets more permissions than its parent.'),
      // src/main/agents/run-report.ts; src/shared/roles.ts ROLE_PREAMBLE
      b('Ogni ruolo chiude il suo lavoro con un rapporto: esito, riassunto, risultato e i criteri del contratto con le prove. È un’autovalutazione, non una verifica indipendente.',
        'Every role closes its job with a report: outcome, summary, output and the contract’s criteria with their evidence. It is a self-report, not an independent check.'),
      // src/main/chats/manager.ts startRun only when owner.source === 'catalog'
      b('Le chat dei ruoli di lavoro hanno una «run» con contatori e costo; l’Orchestrator e le chat avviate senza ruolo (con i tuoi permessi) no.',
        'Work-role chats have a "run" with counters and cost; the Orchestrator and chats started without a role (with your permissions) do not.'),
      // src/main/agents/loop.ts; src/main/agents/trials.ts; src/main/agents/suggestions.ts
      b('L’app migliora i ruoli da sola: testi e skill subito, con «Annulla»; livello di modello, strumenti e permessi solo con il tuo sì in Memoria → Proposte, come versione in prova.',
        'The app improves the roles by itself: texts and skills at once, with "Undo"; model tier, tools and permissions only with your yes in Memory → Proposals, as a trial version.'),
    ],
    analogy: b(
      'Come una squadra con ruoli fissi: il coordinatore assegna, ognuno fa il suo pezzo in vista di tutti e torna con il risultato; se manca un saper fare, si scrive il manuale, non si assume un altro.',
      'Like a team with fixed roles: the coordinator assigns, each does their part in plain sight and comes back with the result; when know-how is missing, you write the manual, you do not hire someone else.'),
    diagram: { kind: 'cycle', steps: [b('Compito', 'Task'), b('Orchestrator', 'Orchestrator'), b('Ruolo e skill', 'Role and skills'), b('Risultato', 'Result'), b('Miglioramento', 'Improvement')] },
    tech: [
      // src/shared/agents.ts AgentProfile
      tech(DATA, 'AgentProfile { id, name, purpose, instructions, engine, model | null, effort?, tools, permissionCeiling, tier, tierMax, launches, skills, version, activeVersion, trial?, userLocked }.',
        'AgentProfile { id, name, purpose, instructions, engine, model | null, effort?, tools, permissionCeiling, tier, tierMax, launches, skills, version, activeVersion, trial?, userLocked }.'),
      // src/main/agents/catalog.ts (roles.json), src/main/agents/versions.ts (role-history.json)
      tech(FILES, 'userData/roles.json (i sei ruoli e Pulse) e role-history.json (le versioni di ogni ruolo).',
        'userData/roles.json (the six roles and Pulse) and role-history.json (each role’s versions).'),
      // src/shared/roles.ts DELEGATION_DEFAULTS
      tech(LIMITS, 'Deleghe: profondità 2 e 5 figli in corso per genitore, di serie (Impostazioni → Ruoli e deleghe).', 'Delegation: depth 2 and 5 running children per parent by default (Settings → Roles and delegation).'),
      tech(TOOLS, 'agent_catalog (i ruoli e le loro skill), app_create_chat con roleId (apre il lavoro), agent_report (il rapporto finale).',
        'agent_catalog (the roles and their skills), app_create_chat with roleId (opens the work), agent_report (the final report).'),
    ],
    target: [
      b('Su Codex e Cursor il divieto dei sotto-agenti interni del motore è scritto nelle istruzioni, non applicato dall’app.',
        'On Codex and Cursor the ban on the engine’s internal sub-agents is written in the instructions, not enforced by the app.'),
      b('Più richieste indipendenti in un messaggio: l’Orchestrator apre da sé una chat per richiesta, tutte insieme; l’app non gli manda da sola il lavoro in arrivo.',
        'Several independent requests in one message: the Orchestrator opens one chat per request itself, all at once; the app does not send it incoming work by itself.'),
    ],
    sources: ['src/shared/roles.ts', 'src/shared/agents.ts', 'src/main/agents/catalog.ts', 'src/main/agents/discovery.ts', 'src/main/appctl/tools.ts', 'src/main/chats/manager.ts', 'src/renderer/actions.ts', 'src/main/agents/run-report.ts', 'src/main/agents/loop.ts'],
  },
  {
    id: 'delegation',
    title: b('Le deleghe tra ruoli', 'Delegation between roles'),
    summary: b('Un ruolo affida una parte del suo compito a un altro ruolo: il figlio è una chat visibile sotto di lui, con un contratto, e torna con un risultato.',
      'A role hands part of its task to another role: the child is a visible chat under it, with a contract, and comes back with one result.'),
    points: [
      // src/main/agents/delegation.ts agent_delegate; src/shared/delegation.ts delegationPrompt
      b('Una delega avvia da 1 a 10 chat figlie insieme, ognuna con un contratto che basta a sé: obiettivo, risultato atteso, criteri di fatto, contesto. Il figlio non legge mai la conversazione del genitore.',
        'A delegation starts 1 to 10 child chats at once, each with a self-contained contract: goal, expected output, done-when criteria, context. The child never reads the parent’s conversation.'),
      // src/main/agents/delegation.ts allowsClass, launchGap; src/main/agents/worktrees.ts; src/main/agents/role-gate.ts aboveParent
      b('I permessi scendono soltanto: un figlio non ha mai più strumenti o permessi del genitore e lavora nella sua cartella (o in un worktree dello stesso repository); una richiesta oltre i permessi del genitore è rifiutata e lo dice nella chat. Di base ogni ruolo può tutto, quindi chi pianifica (Strategist) avvia anche chi cambia qualcosa (Artisan, Sentinel, Herald); se hai ristretto il genitore, un figlio che ha bisogno di più non parte: il genitore lo scrive nel suo risultato e lo avvia l’Orchestrator.',
        'Permissions only go down: a child never gets more tools or permissions than its parent and works in its folder (or a worktree of the same repository); a request beyond the parent’s permissions is refused and says so in the chat. By default every role may do everything, so a planner (Strategist) also launches the roles that change something (Artisan, Sentinel, Herald); if you narrowed the parent, a child that needs more does not start: the parent writes it in its result and the Orchestrator starts it.'),
      // src/shared/roles.ts DELEGATION_DEFAULTS; src/main/chats/manager.ts limitNotice
      b('Profondità e figli in corso sono limiti tuoi (Impostazioni → Ruoli e deleghe); una delega oltre il limite è rifiutata e il genitore mostra «Limite».',
        'Depth and running children are your limits (Settings → Roles and delegation); a delegation over the limit is refused and the parent shows "Limit".'),
      // src/main/agents/delegation.ts agent_ask_parent, agent_answer_child; src/renderer/lib/child-requests.ts requestHost
      b('Un dubbio del figlio va prima al genitore; a te arriva solo ciò che serve a una persona (un permesso, un’azione irreversibile o esterna, una scelta che cambia l’obiettivo), una volta sola, nella chat che stai guardando.',
        'A child’s doubt goes to its parent first; only what needs a person reaches you (a permission, an irreversible or external action, a choice that changes the goal), once, in the chat you are looking at.'),
      // src/renderer/components/DelegationCard.tsx; src/renderer/lib/run-steps.ts
      b('Nella Grindhouse ogni figlio è una scheda sul filo del genitore: compito, personaggio, skill, modello, i passi veri (il piano del motore e le sue azioni), lo stato. Un clic la apre nella chat intera; «Vai alla chat» la mette a fuoco.',
        'In the Grindhouse each child is a card on its parent’s thread: task, character, skills, model, its real steps (the engine’s plan and its actions), its state. A click opens it into the whole chat; "Vai alla chat" puts it in focus.'),
      // src/main/chats/manager.ts userWrote; src/main/chats/orchestrator-wake.ts user-message
      b('Puoi scrivere in qualunque figlio: l’Orchestrator e il genitore lo vengono a sapere con le tue parole, così nessuno disfa ciò che hai chiesto; se cambi l’obiettivo, il figlio lo dice nel suo risultato.',
        'You can write in any child: the Orchestrator and the parent learn it in your words, so nobody undoes what you asked; if you change the goal, the child says so in its result.'),
      // src/main/chats/manager.ts reportDelegation; src/shared/delegation.ts resultMessage
      b('Il figlio chiude con un rapporto: il risultato arriva al genitore come messaggio; l’Orchestrator vede solo lo stato. Una chat che l’Orchestrator ha aperto lui stesso gli riporta allo stesso modo.',
        'The child closes with a report: the result reaches the parent as a message; the Orchestrator sees only the state. A chat the Orchestrator opened itself reports to it the same way.'),
    ],
    analogy: b('Come un capo cantiere che affida i lavori ai suoi: ognuno ha la sua scheda di lavoro, nessuno ha chiavi che il capo non ha, e i dubbi passano prima da lui.',
      'Like a site foreman handing jobs to his crew: each has a job sheet, nobody holds keys the foreman lacks, and questions go through him first.'),
    diagram: { kind: 'flow', steps: [b('Genitore', 'Parent'), b('Delega', 'Delegation'), b('Figli visibili', 'Visible children'), b('Rapporto', 'Report'), b('Genitore', 'Parent')] },
    tech: [
      // src/shared/delegation.ts
      tech(DATA, 'ChatSummary.parentId e delegation { role, goal, doneWhen, at, tools?, result?, originalGoal? }.', 'ChatSummary.parentId and delegation { role, goal, doneWhen, at, tools?, result?, originalGoal? }.'),
      tech(WHERE, 'Strumenti MCP della chat: agent_delegate, agent_report, agent_children, agent_ask_parent, agent_answer_child (pre-approvati).', 'Chat MCP tools: agent_delegate, agent_report, agent_children, agent_ask_parent, agent_answer_child (pre-approved).'),
    ],
    sources: ['src/main/agents/delegation.ts', 'src/shared/delegation.ts', 'src/main/agents/role-gate.ts', 'src/main/chats/manager.ts', 'src/main/chats/orchestrator-wake.ts', 'src/renderer/components/DelegationCard.tsx', 'src/renderer/components/SidebarTree.tsx', 'src/renderer/lib/run-steps.ts', 'src/renderer/lib/child-requests.ts'],
  },
  {
    id: 'agents',
    title: b('I ruoli e il loro editor', 'The roles and their editor'),
    summary: b('Un ruolo è un profilo fisso con istruzioni, motore, livello di modello, ruoli che può avviare e skill di serie; di base può fare tutto, e i suoi permessi li restringi tu dalla sua scheda.',
      'A role is a fixed profile with instructions, engine, model tier, the roles it may launch and its default skills; by default it may do everything, and you narrow its permissions from its card.'),
    points: [
      // src/shared/roles.ts ROLE_DEFAULTS
      b('Strategist pianifica, Scout cerca e legge, Artisan costruisce e scrive documenti e note del brain, Sentinel verifica e, quando non c’è nulla da eseguire, giudica dalle prove, Herald comunica.',
        'Strategist plans, Scout searches and reads, Artisan builds and writes documents and brain notes, Sentinel verifies and, when nothing can be run, judges from the evidence, Herald communicates.'),
      // src/renderer/components/AgentStudio.tsx RoleEditor
      b('In Agenti ogni ruolo ha la sua pagina: «Modifica» cambia istruzioni, skill, motore, modello, livello, ruoli avviabili e contesto massimo; nome, scopo e personaggio restano del ruolo.',
        'In Agents each role has its page: "Edit" changes instructions, skills, engine, model, tier, launchable roles and maximum context; name, purpose and character stay the role’s.'),
      // src/renderer/components/RolePermissions.tsx; src/shared/roles.ts ALL_TOOLS, defaultPermissions
      b('Permessi: di base ogni ruolo ha tutti gli strumenti e nessun limite («Tutto consentito»), così non trovi chiamate rifiutate né popup inutili. La scheda «Permessi» del ruolo (o «Modifica permessi» sul retro della card) li restringe: un interruttore per classe di strumenti e un limite tra quattro, ognuno con il suo «?». Ogni salvataggio aggiorna la versione in uso (non ne crea una nuova); «Ripristina predefiniti» torna a tutto consentito.',
        'Permissions: by default every role has every tool and no limit ("Everything allowed"), so you find no refused calls and no useless popups. The role’s "Permissions" card (or "Edit permissions" on the back of its card) narrows them: one switch per tool class and a limit among four, each with its "?". Every save updates the version in use (it does not make a new one); "Restore defaults" goes back to everything allowed.'),
      // src/main/agents/catalog.ts reset()
      b('«Ripristina predefinito» riporta il ruolo com’è nell’app, dopo una conferma. I ruoli sono fissi: non si creano, non si importano e non si esportano (si condivide il brain intero, Impostazioni → «Condividi il brain»).',
        '"Restore default" brings the role back as the app ships it, after a confirmation. The roles are fixed: they are not created, imported or exported (the whole brain is shared instead, Settings → "Condividi il brain").'),
      // src/shared/agents.ts VERSIONED_CHANGES; src/main/agents/versions.ts versionedChanges (ADR 0186)
      b('Una versione nuova nasce solo quando cambiano testo, skill, modello (motore, modello, sforzo) o livello, e dice cosa è cambiato; strumenti, permessi, limiti, le migrazioni dell’app e il cambio automatico di motore aggiornano la versione in uso. Per ogni versione la pagina mostra run, esiti verificati e la riuscita con il suo ± (sotto 5 esiti: «troppo pochi»), e ne riattiva una vecchia con un clic.',
        'A new version comes only when the text, skills, model (engine, model, effort) or tier change, and it says what changed; tools, permissions, limits, the app’s migrations and the automatic engine switch update the version in use. For each version the page shows runs, verified outcomes and the success with its ± (under 5 outcomes: "too few"), and brings an older one back with a click.'),
      // src/main/agents/model-tier.ts tierModel; src/main/agents/role-table.ts; src/main/agents/catalog.ts resolve()
      b('Un ruolo senza un modello suo prende quello della riga di Instradamento modelli che corrisponde al lavoro sul suo motore (e il suo sforzo, se il ruolo non ne indica uno); altrimenti il livello (leggero, medio, top) diventa un modello per ogni motore: la tua scelta in Impostazioni, altrimenti il registro dei modelli del brain. Sentinel è indipendente perché parte in una sessione nuova, senza il ragionamento del genitore, non perché cambiano modello.',
        'A role without its own model takes the model of the Model routing row that matches the work on its engine (and its effort, when the role names none); else the tier (light, mid, top) becomes a model per engine: your choice in Settings, else the brain’s model registry. Sentinel is independent because it starts in a new session without the parent’s reasoning, not because they switch model.'),
      // src/main/agents/tool-policy.ts browserAccess, readOnlyCommand; src/main/chats/manager.ts refusedCommand; src/main/agents/skill-needs.ts
      b('Strumenti a classi: un ruolo limitato ai comandi di sola lettura vede rifiutato in chat un comando che scrive (se l’ha delegato una chat che può eseguirlo, decidi tu); uno che legge, o uno script node elencato in read-only-tools.md nel brain, ti arriva come permesso senza «sempre». Se una skill passata a un ruolo usa strumenti che il ruolo non ha, l’Orchestrator lo sa subito, già quando apre o delega il lavoro.',
        'Tools come in classes: a role limited to read-only commands has a writing command refused in the chat (when a chat that may run it delegated it, you decide); one that reads, or a node script listed in read-only-tools.md in the brain, reaches you as a permission without "always". When a skill passed to a role uses tools the role lacks, the Orchestrator knows at once, as it opens or delegates the work.'),
      // src/renderer/components/AgentAvatar.tsx; src/renderer/lib/character-art.ts
      b('Ogni ruolo ha un personaggio a cartone riconoscibile anche a 16 px: sotto i 24 px restano colore, capigliatura o copricapo e occhi; da 24 px anche viso e attrezzo.',
        'Every role has a cartoon character recognisable even at 16 px: below 24 px the colour, the hair or headwear and the eyes stay; from 24 px the face and the prop too.'),
    ],
    analogy: b('Come le schede dei reparti di un’officina: chi fa cosa, con quali attrezzi e fin dove può spingersi senza chiedere; la scheda si aggiorna, il reparto resta.',
      'Like the department cards of a workshop: who does what, with which tools and how far they may go without asking; the card is updated, the department stays.'),
    tech: [
      tech(DATA, 'Classi di strumenti: read, edit, shell, shell-read, web, browser, browser-read, mail-draft, calendar-read, brain-write, mcp (di base tutte). Tetti: nessuno (predefinito), acceptEdits, default, plan.',
        'Tool classes: read, edit, shell, shell-read, web, browser, browser-read, mail-draft, calendar-read, brain-write, mcp (all by default). Ceilings: none (default), acceptEdits, default, plan.'),
      // src/main/agents/catalog.ts behaviour()
      tech(LIMITS, 'Istruzioni ≤ 8000 caratteri; al massimo 40 skill di serie; un ruolo non avvia mai sé stesso né l’Orchestrator.',
        'Instructions ≤ 8000 chars; at most 40 default skills; a role never launches itself or the Orchestrator.'),
      tech(WHERE, 'Pagina Agenti (AgentCatalogPage, la pagina del ruolo è AgentStudio); catalogo nel processo main (AgentCatalogService).', 'Agents page (AgentCatalogPage, the role page is AgentStudio); catalog in the main process (AgentCatalogService).'),
      tech(TOOLS, 'Lo strumento mancante di una skill è segnalato nelle risposte di app_create_chat, agent_delegate e agent_catalog.', 'A skill’s missing tool is reported in the answers of app_create_chat, agent_delegate and agent_catalog.'),
    ],
    sources: ['src/shared/roles.ts', 'src/shared/agents.ts', 'src/main/agents/catalog.ts', 'src/main/agents/versions.ts', 'src/main/agents/model-tier.ts', 'src/main/agents/role-table.ts', 'src/main/agents/tool-policy.ts', 'src/main/agents/read-tools.ts', 'src/main/agents/skill-needs.ts', 'src/renderer/components/AgentStudio.tsx', 'src/renderer/components/RolePermissions.tsx', 'src/renderer/components/AgentAvatar.tsx', 'src/renderer/lib/character-art.ts'],
  },
  {
    id: 'skills',
    title: b('Ruoli e skill: la sezione Brain', 'Roles and skills: the Brain section'),
    summary: b('Due concetti soli: il ruolo è chi lavora, la skill è come si fa un lavoro. Si mantengono da soli, e ogni modifica si annulla con un clic.',
      'Two concepts only: the role is who works, the skill is how a job is done. They keep themselves up to date, and every change is undone with one click.'),
    points: [
      // src/main/brainmodel/model.ts readSkills; src/main/agents/pack/flows.ts runtime
      b('Una skill è un file SKILL.md nel brain (.claude/skills) o nelle tue cartelle. Un ruolo usa le sue skill di serie e quelle che il suo avvio gli dà; una skill che non ha gli viene rifiutata.',
        'A skill is a SKILL.md file in the brain (.claude/skills) or in your folders. A role uses its default skills and the ones its launch gives it; a skill it does not have is refused.'),
      // src/renderer/components/SkillsPage.tsx; src/main/brainmodel/service.ts link
      b('La scheda Skill di Memoria mostra quale ruolo usa ogni skill e quali strumenti chiama; «Ruoli» su una scheda la collega o la toglie subito, senza approvazione.',
        'The Skills tab of Memoria shows which role uses each skill and which tools it calls; "Roles" on a card links or drops it at once, with no approval.'),
      // src/main/brainmodel/jobs.ts
      b('La manutenzione parte solo quando premi «Manutenzione» (in alto, sulla testa dell’Orchestrator o in Memoria): un clic, poi lavora da sola in background. Mette in ordine skill, regole e memoria e un agente invisibile propone skill e regole nuove, cosa dimenticare e le issue per l’app, tutto come carte in Memoria → Proposte. Una lezione proposta da una chat di lavoro aspetta che l’Orchestrator te la chieda.',
        'Maintenance starts only when you press "Manutenzione" (top bar, the Orchestrator’s head or Memoria): one click, then it works by itself in the background. It tidies skills, rules and memory, and an invisible agent proposes new skills and rules, what to forget and issues for the app, all as cards in Memoria → Proposte. A lesson a work chat proposes waits until the Orchestrator asks you.'),
      // src/main/brainmodel/changes.ts; src/main/agents/catalog.ts maintain (ADR 0083)
      b('Ogni modifica è registrata con cosa, perché e le prove, e «Annulla» la riporta com’era. L’app cambia da sola solo il testo di un ruolo e le sue skill; il tuo sì resta per produzione, strumenti, tetto, motore e livello di un ruolo, impostazioni e testi per altri.',
        'Every change is logged with what, why and the evidence, and "Undo" puts it back. The app changes by itself only a role’s text and its skills; your yes stays for production, a role’s tools, ceiling, engine and tier, settings and texts for others.'),
      // src/main/brainmodel/procedure-sources.ts
      b('Le sezioni dei runbook e delle routine del brain diventano skill, senza perdere testo e senza ripetersi: il resoconto è nella scheda Skill di Memoria.',
        'The brain’s runbook and routines sections become skills, losing no text and never twice: the report is in Memoria’s Skills tab.'),
      // src/renderer/components/brain-model/
      b('Regole valgono per tutti i ruoli; Memoria tiene conoscenza, quello che è successo e una memoria per ruolo, con i numeri (righe per ruolo, crescita per settimana, ricordi più richiamati, file fermi, errori ricorrenti, skill utili o mai usate, curiosità; ogni «?» dice come è calcolato) e ogni file si apre nel visore; Mappa mostra ruolo → skill → regole → memoria.',
        'Rules apply to every role; Memory holds knowledge, what happened and one memory per role, with the numbers (lines per role, weekly growth, most recalled memories, stale files, recurring errors, useful or never used skills, curious facts; each "?" says how it is computed) and every file opens in the viewer; Map shows role → skills → rules → memory.'),
      // src/main/brainmodel/classifiers.ts
      b('Classificatori, in sola lettura: una scheda per classificatore (tipo di lavoro, modello, stima dai task simili, tipo nel registro dei costi) con cosa decide, i suoi numeri, l’andamento per settimana, quanto ha imparato e una curiosità; un clic apre il dettaglio con la storia e le tabelle (la tabella del modello).',
        'Classifiers, read only: one card per classifier (kind of work, model, similar-task estimate, cost-ledger kind) with what it decides, its numbers, the weekly trend, how much it has learned and a curious fact; a click opens the detail with the history and the tables (the model table).'),
    ],
    analogy: b('Come una squadra con un manuale condiviso: le persone sono i ruoli, le pagine del manuale sono le skill, e qualcuno lo tiene in ordine ogni notte.',
      'Like a team with a shared manual: the people are the roles, the manual’s pages are the skills, and someone keeps it tidy every night.'),
    tech: [
      tech(DATA, 'Registro delle modifiche e resoconto della migrazione nella cartella dati dell’app; memoria di un ruolo in agents/<id>/memory.md, quella comune in memory/shared.md.',
        'Change log and migration report in the app’s data folder; a role’s memory in agents/<id>/memory.md, the shared one in memory/shared.md.'),
      tech(WHERE, 'IPC brainmodel:state, :maintain, :rollback, :link e classifiers:state; pagine in src/renderer/components/brain-model/ (ADR 0077).',
        'IPC brainmodel:state, :maintain, :rollback, :link and classifiers:state; pages in src/renderer/components/brain-model/ (ADR 0077).'),
    ],
    sources: ['src/main/brainmodel/service.ts', 'src/main/brainmodel/jobs.ts', 'src/main/brainmodel/changes.ts', 'src/main/brainmodel/model.ts', 'src/main/brainmodel/procedure-sources.ts', 'src/main/brainmodel/classifiers.ts', 'src/main/agents/pack/rules.ts', 'src/renderer/components/SkillsPage.tsx', 'docs/adr/0077-agents-and-skills-only.md'],
  },
  {
    id: 'orchestrator',
    title: b('L’Orchestrator', 'The Orchestrator'),
    summary: b('La chat di coordinamento nella colonna a destra: pianifica, delega ai ruoli e segue a che punto sono, senza leggerne il lavoro.',
      'The coordinating chat in the right column: it plans, delegates to the roles and follows where they stand, without reading their work.'),
    points: [
      // src/renderer/lib/orchestrator-route.ts, src/main/chats/orchestrator-service.ts, ADR 0068
      b('Ce n’è uno solo, sempre nella colonna di destra (Ctrl+R). Lo crei tu: un ruolo non può crearne un altro.',
        'There is only one, always in the right column (Ctrl+R). You create it: a role cannot create another.'),
      // src/main/agents/orchestrator-role.ts; src/main/agents/discovery.ts roleCatalogBrief
      b('Riceve il suo ruolo e l’elenco dei ruoli di lavoro (nome e a cosa serve); i dettagli li chiede al catalogo dei ruoli, mai le istruzioni dei ruoli.',
        'It gets its role and the list of work roles (name and what each is for); it asks the role catalog for the details, never the roles’ instructions.'),
      // src/main/appctl/tools.ts app_create_chat
      b('Apre una chat di lavoro nominando sempre il ruolo, con un titolo «Area · cosa», il contratto come primo messaggio e le skill suggerite per la richiesta. Il ruolo decide motore e modello; l’Orchestrator può chiedere un livello più alto, fino al massimo del ruolo.',
        'It opens a work chat always naming the role, with an "Area · what" title, the contract as the first message and the skills suggested for the request. The role decides engine and model; the Orchestrator may ask for a higher tier, up to the role’s maximum.'),
      // src/main/agents/task-estimate.ts estimateTool; src/main/agents/orchestrator-role.ts (ADR 0087)
      b('Prima di partire stima la richiesta sui lavori simili già finiti (tempo, costo, su quanti lavori, affidabilità, quante parti) e prende la via rapida: una domanda breve la risponde lui, un lavoro veloce in una parte va a un solo agente senza sotto-chat; un albero di deleghe solo per il lavoro in più parti, che costa più token. La stima di ogni agente è sulla sua striscia nella Grindhouse, e il verdetto di ogni lavoro dice se è rimasta entro ×2.',
        'Before starting it estimates the request on similar finished jobs (time, cost, how many jobs, confidence, how many parts) and takes the fast path: a short question it answers itself, a quick one-part job goes to a single agent with no sub-chats; a delegation tree only for work in several parts, which costs more tokens. Each agent’s estimate is on its strip in the Grindhouse, and each job’s verdict says whether it stayed within ×2.'),
      // src/main/agents/run-feedback.ts metricsTool; src/main/agents/discovery.ts
      b('Dei figli vede solo lo stato e i numeri: mai il loro testo. Il risultato gli arriva quando il figlio chiude con il suo rapporto.',
        'Of its children it sees only state and numbers: never their text. The result reaches it when the child closes with its report.'),
      // src/shared/newchat.ts
      b('Un tuo messaggio che inizia con «[nuova chat]» gli chiede di aprire una chat di lavoro nuova.',
        'A message of yours starting with "[nuova chat]" asks it to open a new work chat.'),
      // src/main/chats/orchestrator-delivery.ts
      b('La posta delle chat gli arriva smistata: subito, raggruppata (30 s) o silenziosa.',
        'Mail from the chats reaches it sorted: now, grouped (30 s) or quiet.'),
      // src/main/chats/held-news.ts, src/renderer/components/HeldNews.tsx (#88)
      b('Quello che l’app gli tiene da parte lo vedi sopra il suo campo: «N novità in attesa»; un clic elenca chat, tipo, da quando e perché aspetta. Guardarlo non gli costa un turno.',
        'What the app holds back for it shows above its input: "N novità in attesa"; a click lists chat, kind, since when and why it waits. Looking costs it no turn.'),
    ],
    analogy: b('Come un caporedattore: non scrive ogni pezzo, sceglie chi lo scrive, sa a che punto è ognuno e legge il pezzo finito.',
      'Like an editor-in-chief: does not write every piece, picks who writes it, knows where each one stands and reads the finished piece.'),
    diagram: { kind: 'flow', steps: [b('Tua richiesta', 'Your request'), b('Orchestrator', 'Orchestrator'), b('Ruolo e skill', 'Role and skills'), b('Chat di lavoro', 'Work chat'), b('Rapporto', 'Report')] },
    tech: [
      tech(DATA, 'Risposta di app_create_chat: { chatId, title, harness, cwd, model, effort, route { source: agent, kind, area, reason, agent { id, version, chosenBy, tier?, modelFrom: role | tier | table | engine } } }.',
        'app_create_chat result: { chatId, title, harness, cwd, model, effort, route { source: agent, kind, area, reason, agent { id, version, chosenBy, tier?, modelFrom: role | tier | table | engine } } }.'),
      tech(LIMITS, 'Fino a 16 skill per chat delegata; un figlio non ha mai strumenti o tetto sopra quelli di chi lo avvia.', 'Up to 16 skills per delegated chat; a child never has tools or a ceiling above its launcher’s.'),
      tech(TOOLS, 'agent_catalog (i ruoli), app_create_chat con roleId e tier (apre il lavoro), task_estimate (la stima), agent_metrics (stato e numeri dei figli), agent_report (il rapporto del figlio).',
        'agent_catalog (the roles), app_create_chat with roleId and tier (opens the work), task_estimate (the estimate), agent_metrics (the children’s state and numbers), agent_report (the child’s report).'),
      tech(WHERE, 'MCP dell’app su 127.0.0.1 (tool app_*, agent_catalog, agent_metrics), ognuno con il suo endpoint e token.',
        'The app’s MCP on 127.0.0.1 (app_*, agent_catalog, agent_metrics tools), each with its own endpoint and token.'),
    ],
    sources: ['src/main/agents/orchestrator-role.ts', 'src/main/agents/task-estimate.ts', 'src/main/chats/orchestrator-service.ts', 'src/main/agents/discovery.ts', 'src/main/appctl/tools.ts', 'src/main/agents/run-feedback.ts', 'src/shared/newchat.ts', 'src/main/chats/orchestrator-delivery.ts', 'src/main/chats/held-news.ts', 'src/renderer/lib/orchestrator-route.ts'],
  },
  {
    id: 'runs',
    title: b('Le run dei ruoli', 'Role runs'),
    summary: b('Una run è un lavoro di un ruolo, dall’avvio al suo rapporto finale, con contatori, costo e risultato.',
      'A run is one job of a role, from start to its final report, with counters, cost and result.'),
    points: [
      // src/main/chats/manager.ts startRun (owner.source === 'catalog')
      b('Nasce quando una chat parte con un ruolo di lavoro; startedBy dice chi l’ha avviata: tu, l’Orchestrator o la chat genitore che l’ha delegata.',
        'It starts when a chat starts with a work role; startedBy says who started it: you, the Orchestrator or the parent chat that delegated it.'),
      // src/main/chats/manager.ts create (links.parentRunId); src/main/agents/delegation.ts
      b('Una run delegata porta parentRunId, la run del genitore: così l’albero delle deleghe resta leggibile anche nelle metriche.',
        'A delegated run carries parentRunId, its parent’s run: so the delegation tree stays readable in the metrics too.'),
      // src/main/chats/manager.ts countRequest
      b('Conta domande, permessi e comandi (una volta per richiesta), riaperture, picco di contesto, correzioni e tempo di esecuzione; le statistiche dei ruoli non usano più permessi e picco di contesto (sempre 0 o mai mostrati).',
        'It counts questions, permissions and commands (once per request), reopenings, context peak, corrections and execution time; the role statistics no longer use permissions and context peak (always 0 or never shown).'),
      // src/main/agents/runs.ts addTurn
      b('Somma costo e token di ogni turno; se un turno non li riporta, il totale diventa «sconosciuto» (null), non zero.',
        'It adds each turn’s cost and tokens; if a turn does not report them, the total becomes "unknown" (null), not zero.'),
      // src/main/agents/run-report.ts parseRunReport
      b('Il rapporto finale del ruolo (esito, verificato sì/in parte/no, riassunto) resta sulla run; un rapporto illeggibile conta come nessun rapporto.',
        'The role’s final report (outcome, verified yes/partly/no, summary) stays on the run; an unreadable report counts as none.'),
      // src/main/chats/manager.ts ends: completed / closed / stale
      b('Finisce come completed, closed (chat chiusa o archiviata) o stale (72 ore senza turni); scrivere di nuovo a mano la riapre.',
        'It ends as completed, closed (chat closed or archived) or stale (72 hours without turns); writing to it again by hand reopens it.'),
      // src/main/agents/run-feedback.ts recordFeedback
      b('Un giudizio vale come prova solo se viene da una revisione indipendente (di Sentinel) finita e verificata, nella sua sessione (su qualunque modello: conta che non abbia visto il ragionamento della run); il parere di un genitore resta un parere.',
        'A verdict counts as evidence only if it comes from an ended, verified independent review (a Sentinel’s) in its own session (on any model: what counts is that it never saw the run’s reasoning); a parent’s opinion stays an opinion.'),
      // src/main/run/outcome.ts (run:outcome IPC); src/renderer/components/RunSurface.tsx
      b('Quando la run ha finito, nella striscia espansa dici tu com’è andata (riuscita, in parte, non riuscita): il tuo esito vince sempre.',
        'Once the run has finished, in the expanded strip you say how it went (success, partial, failed): your verdict always wins.'),
    ],
    analogy: b('Come una commessa in officina: si apre, accumula ore e materiali, si chiude con il verbale; se il cliente torna, si riapre.',
      'Like a work order in a workshop: it opens, adds up hours and parts, closes with its report; if the customer comes back, it reopens.'),
    diagram: { kind: 'flow', steps: [b('Avvio', 'Start'), b('Turni e richieste', 'Turns and requests'), b('Rapporto', 'Report'), b('Esito', 'Outcome')] },
    tech: [
      // src/shared/agents.ts AgentRun
      tech(DATA, 'AgentRun { runId, chatId, agentId, version, goal, startedBy, startedAt, endedAt?, endReason?, outcome?, counters, costUsd | null, tokens | null, report?, tier?, parentRunId?, reviewOf?, reworkOf?, continuedFrom?, tags? }.',
        'AgentRun { runId, chatId, agentId, version, goal, startedBy, startedAt, endedAt?, endReason?, outcome?, counters, costUsd | null, tokens | null, report?, tier?, parentRunId?, reviewOf?, reworkOf?, continuedFrom?, tags? }.'),
      tech(FILES, 'userData/agent-runs.json è la fonte; ChatSummary.run ne è una copia; i giudizi in run-feedback.json.', 'userData/agent-runs.json is the source; ChatSummary.run mirrors it; verdicts in run-feedback.json.'),
      // src/main/agents/runs.ts RUNS_MAX, RUNS_BYTES, STALE_MS
      tech(LIMITS, 'RUNS_MAX = 5000, RUNS_BYTES = 7 000 000, STALE_MS = 72 h.', 'RUNS_MAX = 5000, RUNS_BYTES = 7,000,000, STALE_MS = 72 h.'),
      tech(TOOLS, 'Il rapporto finale è lo strumento agent_report del ruolo.', 'The final report is the role’s agent_report tool.'),
    ],
    sources: ['src/shared/agents.ts', 'src/main/agents/runs.ts', 'src/main/agents/run-report.ts', 'src/main/agents/run-feedback.ts', 'src/main/chats/manager.ts', 'src/main/index.ts', 'src/main/run/outcome.ts'],
  },
  {
    id: 'metrics',
    title: b('Metriche e statistiche degli agenti', 'Agent metrics and statistics'),
    summary: b('Le metriche di ogni agente dalle sue run concluse: lavori, successi verificati, costi, livello e performance sulla sua carta.',
      'Each agent’s metrics from its ended runs: runs, verified successes, costs, level and performance on its card.'),
    points: [
      // src/main/agents/analytics.ts, src/main/agents/collector.ts (#125: no page lists them since Costi dropped its per-agent blocks)
      b('L’app osserva le sessioni di ogni agente (costi e tempi) per il suo uso interno; non le mostra più per agente in Costi.',
        'The app observes each agent’s sessions (costs and times) for its own use; Costs no longer lists them per agent.'),
      // src/main/agents/run-metrics.ts; src/main/index.ts agents:metrics
      b('Il main calcola anche metriche per agente e versione dalle run concluse in agent-runs.json e dai riepiloghi delle run potate; le carte della pagina Agenti ne mostrano lavori conclusi, in corso e costo mediano.',
        'Main also computes per-agent and per-version metrics from ended runs in agent-runs.json and rollups of pruned runs; the Agenti page cards show ended runs, open runs and the median cost.'),
      // src/renderer/components/AgentCatalogCard.tsx Costs (#125)
      b('Sul retro della carta, i costi dell’agente: costo mediano per lavoro e costo per lavoro riuscito e verificato (il costo di tutti i lavori conclusi diviso per i riusciti verificati), con su quanti lavori. Un numero che manca è un trattino, con una riga che dice perché.',
        'On the back of the card, the agent’s costs: median cost per run and cost per verified successful run (the cost of every ended run divided by the verified successful ones), with how many runs. A missing number is a dash, with one line saying why.'),
      // src/main/agents/standing.ts; src/renderer/components/AgentCatalogCard.tsx
      b('Ogni carta ha un livello e una performance. Livello: solo i lavori riusciti e verificati danno XP, da 1 a 5 secondo quanto è grande il lavoro (turni, tempo di lavoro, file cambiati, chat delegate), e accanto c’è il totale («Lv 7 Praticante · 124 XP»). Lv 2 a 6 XP (circa 3 lavori), Lv 10 a 202, Lv 100, il massimo, a 9.358: con 4 lavori verificati al giorno, un mese per il Lv 10 e circa 4 anni per il Lv 100. Performance: una stima che parte dal 50% e si sposta coi voti (riuscito 100%, in parte 50%, fallito 0%), pesati per chi ha votato (tu e una revisione × 1, una revisione del Sentinel giudicata dai fatti × 0,8, le ricevute × 0,7, l’Orchestrator × 0,6, un segnale sulle scelte dell’Orchestrator e il genitore verificato × 0,5, un esito di Flash × 0,3; l’agente su sé stesso non conta) e per età (metà peso ogni 30 giorni), con un ± di incertezza; con meno di 5 voti o un ± oltre 30 punti l’agente è «in rodaggio». Il «?» accanto a ciascuno dà la formula.',
        'Each card has a level and a performance. Level: only verified successful runs give XP, 1 to 5 by the size of the job (turns, working time, files changed, delegated chats), and the total is written beside it ("Lv 7 Practitioner · 124 XP"). Lv 2 at 6 XP (about 3 runs), Lv 10 at 202, Lv 100, the top, at 9,358: with 4 verified runs a day, a month to Lv 10 and about 4 years to Lv 100. Performance: an estimate that starts at 50% and moves with the verdicts (success 100%, partial 50%, failure 0%), weighted by who gave them (you and a review × 1, a Sentinel review graded by what happened × 0.8, the receipts × 0.7, the Orchestrator × 0.6, a signal on the Orchestrator’s choices and a verified parent × 0.5, a Flash outcome × 0.3; the agent on itself does not count) and by age (half weight every 30 days), with a ± of uncertainty; with fewer than 5 verdicts or a ± beyond 30 points the agent is "warming up". The "?" beside each gives the formula.'),
      // src/main/agents/standing.ts decisionSignals, decisionXp; src/main/agents/flash-outcomes.ts (ADR 0131)
      b('L’Orchestrator guadagna con i lavori che ha avviato e sono riusciti verificati (gli XP del lavoro, dimezzati se il compito è passato a un altro ruolo o è stato rifatto), più 1 XP per un piano dello Strategist approvato senza modifiche; un compito passato a un altro ruolo, riaperto o rifatto pesa contro le sue scelte. Flash non apre lavori: una sua risposta regge se nei 5 minuti dopo non la correggi, non rifai la domanda e non la passi all’Orchestrator, e vale 0,25 XP. Tutto senza costo in token né nuove richieste di permesso.',
        'The Orchestrator earns with the runs it started that are verified successes (the job’s XP, halved when the task went to another role or was redone), plus 1 XP for a Strategist plan approved with no change; a task handed to another role, reopened or redone weighs against its choices. Flash opens no runs: one of its answers holds when within 5 minutes you do not correct it, ask it again or hand it to the Orchestrator, and is worth 0.25 XP. All with no token cost and no new permission prompt.'),
      // src/main/agents/standing.ts earnedVerdict; src/main/agents/judge-sample.ts pickAudits (ADR 0125)
      b('Ogni ruolo sale di livello anche senza i tuoi voti, se l’interruttore «Abilita controllo livello e performance» è acceso: un lavoro avviato dall’Orchestrator è verificato dalla revisione di un Sentinel; un lavoro delegato prende il verdetto del genitore verificato, se il suo resoconto aveva tutti i criteri soddisfatti, è arrivato prima che il genitore finisse e non è stato corretto, riaperto, rifatto o bocciato dal genitore; la revisione del Sentinel è giudicata da ciò che succede dopo: il tuo voto sullo stesso lavoro, una seconda revisione indipendente (1 lavoro su 10, costo in più circa un decimo) o un lavoro che aveva promosso e poi è stato riaperto o rifatto. Il silenzio non conta mai.',
        'Every role levels up without your verdicts too, when the switch "Enable level and performance check" is on: a run the Orchestrator opened is verified by a Sentinel review; a delegated run takes its verified parent’s verdict, when its report met every criterion, arrived before the parent ended and was not corrected, reopened, redone or rejected by the parent; the Sentinel review is graded by what happens next: your verdict on the same run, a second independent review (1 run in 10, about a tenth more cost) or a run it passed that was then reopened or redone. Silence never counts.'),
      // src/main/agents/receipts.ts; src/main/agents/judge-sample.ts byReceipts (ADR 0130)
      b('Prima di una revisione l’app guarda le ricevute del lavoro, registrate gratis mentre girava: i comandi con il loro codice di uscita, i file cambiati, i commit e le PR. Se i test o i controlli del progetto, non toccati dall’agente, sono passati dopo l’ultima modifica e l’agente dice di aver finito, il lavoro è riuscito senza revisione (peso × 0,7); se falliscono e l’agente lo ammette, è fallito. Se le ricevute non bastano o non concordano col resoconto, decide il Sentinel; una ricevuta su dieci viene rivista comunque.',
        'Before a review the app reads the run’s receipts, recorded for free while it ran: the commands with their exit code, the files changed, commits and PRs. If the project’s tests or checks, untouched by the agent, passed after the last change and the agent says it finished, the run succeeded with no review (weight × 0.7); if they fail and the agent admits it, it failed. When the receipts are not enough or disagree with the report, the Sentinel decides; one receipt in ten is reviewed anyway.'),
    ],
    analogy: b('Come il cruscotto di una flotta: consumi e tempi per veicolo, con scritto quando un dato manca invece di inventarlo.',
      'Like a fleet dashboard: consumption and times per vehicle, saying when a figure is missing instead of inventing it.'),
    tech: [
      tech(DATA, 'AgentMeasure { total, knownSubtotal, knownSessions, unknownSessions }; timing per categoria con medianMs.', 'AgentMeasure { total, knownSubtotal, knownSessions, unknownSessions }; timing per category with medianMs.'),
      // src/main/wiring.ts /api/agents/analytics
      // src/main/agents/level-diagnosis.ts, scripts/levels.mjs (ADR 0131)
      tech(WHERE, 'Diagnosi dei livelli: npm run levels -- <agent-runs.json> ricalcola livello e performance di ogni ruolo e dice perché i lavori non hanno dato XP (solo lettura, zero token).', 'Levels diagnostic: npm run levels -- <agent-runs.json> recomputes every role’s level and performance and says why runs gave no XP (read only, zero tokens).'),
      tech(WHERE, 'Metriche delle run: IPC agents:metrics, anche filtrate per tag skill, app e repo; le statistiche delle sessioni restano interne (/api/agents/analytics).', 'Run metrics: agents:metrics IPC, also filtered by skill, app and repo tags; the session statistics stay internal (/api/agents/analytics).'),
    ],
    sources: ['src/main/agents/analytics.ts', 'src/main/agents/run-metrics.ts', 'src/main/agents/standing.ts', 'src/main/agents/judge-sample.ts', 'src/renderer/components/AgentCatalogCard.tsx', 'src/main/index.ts', 'src/main/agents/collector.ts', 'docs/agent-evidence.md', 'docs/adr/0125-every-role-levels-up-from-outcomes.md', 'src/main/agents/receipts.ts', 'docs/adr/0130-run-receipts-before-reviews.md', 'src/main/agents/xp.ts', 'src/main/agents/flash-outcomes.ts', 'src/main/agents/level-diagnosis.ts', 'docs/adr/0131-levels-by-job-size-and-bayesian-performance.md'],
  },
  {
    id: 'errors-rules',
    title: b('Errori, correzioni e «Regole imparate»', 'Errors, corrections and "Learned rules"'),
    summary: b('Gli errori degli agenti finiscono nel brain; l’app li raggruppa, e tu puoi correggere un ragionamento mentre avviene.',
      'Agents’ errors land in the brain; the app groups them, and you can correct a line of reasoning while it happens.'),
    points: [
      // ADR 0037; src/renderer/brain/lib/stats.ts
      b('Quando correggi un agente, gli strumenti del brain scrivono una riga in ai-errors.md; l’app legge e raggruppa, non scrive.',
        'When you correct an agent, the brain’s tools write a line to ai-errors.md; the app reads and groups, it does not write.'),
      b('Ci sono 11 tipi ufficiali (es. test-passato-a-torto, richiesta-fraintesa, regola-ignorata); una riga illeggibile è «Formato non riconosciuto».',
        'There are 11 official types (e.g. test-passato-a-torto, richiesta-fraintesa, regola-ignorata); an unreadable line is "Unrecognised format".'),
      b('Un tipo è «ricorrente» da 2 righe in su; si confronta la settimana con la precedente.', 'A type is "recurring" from 2 rows up; the week is compared with the previous one.'),
      // src/renderer/lib/correction.ts, src/renderer/components/CorrectThought.tsx (ADR 0058)
      b('«Correggi» su un pezzo di ragionamento manda all’agente la citazione e la tua correzione; è bloccato se c’è una domanda aperta.',
        '"Correct" on a piece of reasoning sends the agent the quote and your fix; it is blocked while a question is open.'),
      // src/renderer/brain/pages/LearnedRules.tsx, src/renderer/components/brain-model/RulesPage.tsx, src/renderer/brain/lib/learn.ts (ADR 0082)
      b('«Regole imparate», in fondo alla scheda Regole di Memoria, mostra le politiche di auto-miglioramento del brain (stime, scelta del modello, soglie) con Ripristina; una proposta in attesa si decide in Memoria → Proposte. Compare solo quando il brain ne ha.',
        '"Learned rules", at the bottom of Memoria’s Rules tab, shows the brain’s self-improvement policies (estimates, model choice, thresholds) with Restore; a waiting proposal is decided in Memory → Proposals. It appears only when the brain has some.'),
      // src/renderer/i18n/areas/home.it.ts home.rulesReading
      b('Una regola conta come «tenuta» se il suo errore non ricompare nei giorni osservati: non è una prova di causa.',
        'A rule counts as "holding" if its error does not reappear in the observed days: it is not proof of cause.'),
      // src/main/chats/manager.ts; src/main/agents/run-metrics.ts (ADR 0186: no ai-errors column)
      b('Le run contano correzioni esplicite e riaperture dell’utente dopo un report valido. Le righe di ai-errors.md non entrano nelle metriche delle run: il comando error dell’app non scrive la run.',
        'Runs count explicit corrections and user reopenings after a valid report. ai-errors.md lines are not part of the run metrics: the app’s error command does not write the run.'),
    ],
    analogy: b('Come il registro degli incidenti di un reparto: si annota, si raggruppa, si scrive una regola e si guarda se l’incidente torna.',
      'Like a department’s incident log: write it down, group it, write a rule, and watch whether the incident comes back.'),
    diagram: { kind: 'cycle', steps: [b('Correzione', 'Correction'), b('ai-errors.md', 'ai-errors.md'), b('Raggruppa', 'Group'), b('Regola', 'Rule'), b('Ricompare?', 'Comes back?')] },
    tech: [
      tech(FILES, 'Nel brain: ai-errors.md (scritto da ops/tools/mem.mjs), politiche lette da /api/improve.', 'In the brain: ai-errors.md (written by ops/tools/mem.mjs), policies read from /api/improve.'),
      // src/renderer/lib/correction.ts QUOTE_MAX; src/renderer/brain/lib/learn.ts MIN_N
      tech(LIMITS, 'Citazione della correzione ≤ 400 caratteri; una politica si valuta da 20 esiti (MIN_N).', 'Correction quote ≤ 400 chars; a policy is judged from 20 outcomes (MIN_N).'),
      tech(DATA, 'Messaggio: [Reasoning correction] / In your reasoning you wrote: «…» / Not like that: … ; «Al prossimo passo» solo con Claude.',
        'Message: [Reasoning correction] / In your reasoning you wrote: «…» / Not like that: … ; "At the next step" on Claude only.'),
    ],
    sources: ['src/main/chats/manager.ts', 'src/main/agents/run-metrics.ts', 'src/renderer/brain/lib/stats.ts', 'src/renderer/lib/correction.ts', 'src/renderer/components/CorrectThought.tsx', 'src/renderer/brain/pages/LearnedRules.tsx', 'src/renderer/components/brain-model/RulesPage.tsx', 'src/renderer/brain/lib/learn.ts', 'docs/adr/0037-useful-errors-and-stats.md', 'docs/adr/0058-correct-the-thought.md'],
  },
  {
    id: 'brain-scripts',
    title: b('Script e changelog del brain', 'Brain scripts and changelog'),
    summary: b('Gli script provati dei tuoi agenti stanno nel brain, riutilizzabili; ogni cambiamento al brain finisce nel changelog, che leggi nel Log.',
      'Your agents’ tested scripts live in the brain, ready to reuse; every change to the brain lands in the changelog, which you read in the Log.'),
    points: [
      // src/main/brain/scripts.ts
      b('Gli script stanno nella cartella scripts/ del brain; l’intestazione dice titolo, cosa fa, come si usa, tag e l’ultimo test.',
        'Scripts live in the brain’s scripts/ folder; their header says title, what it does, how to run it, tags and the last test.'),
      // src/main/brain/scripts-tools.ts brain_scripts
      b('Ogni chat può cercarli prima di scrivere uno script nuovo, per riusarne uno che funziona.',
        'Every chat can look them up before writing a new script, to reuse one that works.'),
      // src/main/brain/scripts-tools.ts brain_script_save, brain_script_delete, brain_script_add; src/main/brain/auto-scripts.ts
      b('Senza chiederti l’ok: una chat aggiunge lo script che ha provato, l’app salva da sola un comando riutilizzabile riuscito con Esegui, l’Orchestrator corregge o elimina. Le credenziali sono rifiutate, un eliminato va in scripts/.deleted/ e non torna.',
        'Without asking you: a chat adds the script it ran, the app saves a reusable command that worked with Esegui by itself, the Orchestrator fixes or deletes. Credentials are refused, a deleted one goes to scripts/.deleted/ and does not come back.'),
      // src/main/brain/changelog.ts
      b('Ogni cambiamento è una riga in changelog.md: quando, cosa, quale file, chi e perché. L’Orchestrator vi annota anche regole, skill e note che cambia.',
        'Every change is a line in changelog.md: when, what, which file, who and why. The Orchestrator also logs the rules, skills and notes it changes.'),
      // src/renderer/brain/pages/Script.tsx; src/renderer/components/LogPage.tsx (ADR 0111)
      b('La scheda Script & Query di Memoria mostra gli script a schede; nessun bottone esegue uno script. Le righe del changelog stanno nel Log, tipo «Brain».',
        'Memoria’s Scripts & Queries tab shows the scripts as cards; no button runs a script. The changelog lines are on the Log page, kind "Brain".'),
      // docs/adr/0076-brain-scripts-and-changelog.md
      b('Nessun classificatore sceglie gli script: con pochi script che si descrivono da soli basta la ricerca per parole.',
        'No classifier picks scripts: with a few self-describing scripts a word search is enough.'),
    ],
    analogy: b('Come la cassetta degli attrezzi di un’officina con il registro accanto: ogni attrezzo ha l’etichetta, e chi lo cambia lo scrive.',
      'Like a workshop toolbox with a logbook beside it: every tool is labelled, and whoever changes one writes it down.'),
    diagram: { kind: 'flow', steps: [b('Script provato', 'Tested script'), b('Orchestrator salva', 'Orchestrator saves'), b('scripts/', 'scripts/'), b('changelog.md', 'changelog.md'), b('Riuso', 'Reuse')] },
    tech: [
      tech(TOOLS, 'brain_scripts (cerca), brain_script_add (aggiunge), brain_script_save e brain_script_delete (l’Orchestrator).', 'brain_scripts (search), brain_script_add (add), brain_script_save and brain_script_delete (the Orchestrator).'),
      tech(FILES, 'Nel brain: scripts/<nome>, scripts/.deleted/, changelog.md; creati al primo salvataggio.', 'In the brain: scripts/<name>, scripts/.deleted/, changelog.md; created on the first save.'),
      tech(WHERE, 'Pagine: /api/scripts, /api/script?id=…, /api/changelog; evento scripts:changed.', 'Pages: /api/scripts, /api/script?id=…, /api/changelog; event scripts:changed.'),
      tech(LIMITS, 'Uno script ≤ 200 KB; la pagina legge le ultime 500 righe del changelog.', 'A script ≤ 200 KB; the page reads the latest 500 changelog lines.'),
    ],
    sources: ['src/main/brain/scripts.ts', 'src/main/brain/scripts-tools.ts', 'src/main/brain/changelog.ts', 'src/renderer/brain/pages/Script.tsx', 'src/renderer/components/LogPage.tsx', 'docs/adr/0076-brain-scripts-and-changelog.md'],
  },
  {
    id: 'classifiers',
    title: b('I classificatori', 'The classifiers'),
    summary: b('Dove l’app smista qualcosa da sola senza spendere token: il tipo di lavoro, la posta dell’Orchestrator, i comandi delicati.',
      'Where the app sorts something by itself without spending tokens: the kind of work, the Orchestrator’s mail, sensitive commands.'),
    points: [
      // src/main/agents/discovery.ts agent_catalog (ADR 0186: the suggester is gone)
      b('Skill per un compito: nessun suggeritore (ADR 0186: 3 consigli giusti su 4129); l’Orchestrator, o il ruolo che delega, passa per nome le skill che servono. Un ruolo usa solo le skill che il suo avvio gli dà.',
        'Skills for a task: no suggester (ADR 0186: 3 right suggestions in 4129); the Orchestrator, or the role that delegates, passes the skills it needs by name. A role uses only the skills its launch gives it.'),
      // src/shared/work-concepts.ts CONCEPTS
      b('Italiano e inglese si incontrano: un piccolo lessico di lavori («correggi» = fix, «revisiona» = review, «fonti» = sources…) unisce le richieste in italiano e le skill scritte in inglese.',
        'Italian and English meet: a small lexicon of kinds of work ("correggi" = fix, "revisiona" = review, "fonti" = sources…) joins Italian requests and skills written in English.'),
      // src/shared/work-concepts.ts taskOf, builtinTask
      b('Tipo di lavoro, uno solo per tutta l’app (tabella dei modelli, registro dei costi, stime): prima le regole del brain (estimates.json), poi il lessico integrato, poi «altro». Una richiesta che costruisce o corregge vince su un titolo che nomina solo un tema.',
        'Kind of work, one taxonomy for the whole app (model table, cost ledger, estimates): the brain’s rules first (estimates.json), then the built-in lexicon, then "altro". A request that builds or fixes wins over a title that only names a topic.'),
      // src/main/chats/orchestrator-delivery.ts mailClassifier
      b('Posta per l’Orchestrator: urgente → subito; richiesta, finito o errore → raggruppata; solo avanzamento → silenziosa. Nel dubbio raggruppata: una richiesta tenuta ferma costa più di un’attesa.',
        'Mail for the Orchestrator: urgent → now; a request, done or error → grouped; progress only → quiet. When in doubt grouped: a request held back costs more than a wait.'),
      // src/shared/runnable.ts prodRisk; src/main/agents/tool-policy.ts readOnlyCommand
      b('Comandi: quelli di produzione (az, sqlcmd, script ops) chiedono un secondo clic e il main ricontrolla; per un ruolo a sola lettura un comando conta come lettura solo se è un lettore noto, senza concatenazioni, redirezioni, sottoespressioni né opzioni che scrivono o eseguono (sort e uniq solo dopo una pipe).',
        'Commands: production ones (az, sqlcmd, ops scripts) ask for a second click and main checks again; for a read-only role a command counts as reading only if it is a known reader, with no chaining, redirection, subexpression or option that writes or runs (sort and uniq only after a pipe).'),
      // src/renderer/lib/foreign.ts; src/main/chats/admission.ts; src/shared/waiting.ts
      // src/shared/roles.ts ROLE_DEFAULTS.orchestrator
      b('Altri: messaggi non scritti da te (mostrati attenuati), «Aspetta un lavoro» sul testo, la coda per carico (CPU > 75% o RAM libera < 15%). Permessi e domande non sono indovinati: arrivano strutturati dalla CLI. Smistare un lotto di lavoro (una inbox, una lista di ticket) lo fa invece l’Orchestrator, una chat per richiesta, quando glielo affidi.',
        'Others: messages you did not type (shown muted), "Waits for work" on the text, the load queue (CPU > 75% or free RAM < 15%). Permissions and questions are not guessed: they arrive structured from the CLI. Triaging a batch of work (an inbox, a list of tickets) is instead the Orchestrator’s, one chat per request, when you hand it one.'),
      // src/renderer/components/brain-model/ClassifiersPage.tsx, src/main/brainmodel/classifier-cards.ts
      b('Brain → Classificatori ne mostra quattro come schede: decisioni, quanto spesso «prendono» (tipo riconosciuto, costo dentro la forchetta, tempo del task fra metà e doppio della stima), quante chat decise sono riuscite (verificate da te o da una revisione, dai run o dal registro del brain, mai l’autovalutazione; gli esiti automatici del brain, come «chiusa senza errori», sono contati a parte come non verificati), il costo medio, 8 settimane di andamento e i casi verificati raccolti sui 20 che servono per calibrarsi. Ogni numero ha un «?».',
        'Brain → Classifiers shows four of them as cards: decisions, how often they "get it" (kind recognised, cost inside the range, task time between half and double the estimate), how many decided chats succeeded (verified by you or a review, never a self-report), the average cost, 8 weeks of trend and the verified cases collected of the 20 needed to calibrate. Every number has a "?".'),
    ],
    analogy: b('Come lo smistamento della posta in portineria: regole scritte, una casella «varie» quando non si capisce, e per un sacco intero di posta si chiama chi smista di mestiere.',
      'Like mail sorting at the front desk: written rules, a "misc" box when it is unclear, and for a whole sack of mail you call the person whose job is sorting.'),
    diagram: { kind: 'flow', steps: [b('Richiesta', 'Request'), b('Parole e lessico', 'Words and lexicon'), b('Ruolo e skill per nome', 'Role and skills by name'), b('Avvio del ruolo', 'Role launch')] },
    tech: [
      // src/shared/contract.ts TaskKind
      tech(DATA, 'TaskKind: qa-run, review, bug-fix, ops-read, writing, triage, research-web, investigation, app-feature, orchestrator, altro.',
        'TaskKind: qa-run, review, bug-fix, ops-read, writing, triage, research-web, investigation, app-feature, orchestrator, altro.'),
    ],
    sources: ['src/main/brainmodel/classifier-cards.ts', 'src/renderer/components/brain-model/ClassifiersPage.tsx', 'src/renderer/lib/classifier-view.ts', 'src/main/agents/discovery.ts', 'src/shared/work-concepts.ts', 'src/main/brain/routing.ts', 'src/main/brain/estimates.ts', 'src/shared/runnable.ts',
      'src/main/agents/tool-policy.ts', 'src/main/chats/orchestrator-delivery.ts', 'src/renderer/lib/foreign.ts', 'src/main/chats/admission.ts', 'src/shared/waiting.ts', 'src/shared/roles.ts'],
  },
  {
    id: 'permissions',
    title: b('Permessi e tetto dei permessi', 'Permissions and the permission ceiling'),
    summary: b('Quando un ruolo vuole fare qualcosa di delicato, la CLI chiede: l’app ti mostra il pannello e rispetta il tetto del ruolo.',
      'When a role wants to do something sensitive, the CLI asks: the app shows you the panel and enforces the role’s ceiling.'),
    points: [
      // src/main/chats/claude.ts onControlRequest; src/main/chats/acp.ts
      b('La richiesta arriva dal motore (Claude, Cursor, o Codex per comandi e modifiche) e diventa un pannello con le risposte disponibili.',
        'The request comes from the engine (Claude, Cursor, or Codex for commands and file changes) and becomes a panel with the available responses.'),
      b('«Consenti sempre» vale solo per questa sessione: l’app non scrive mai i file di impostazioni di Claude o Cursor.',
        '"Allow always" lasts for this session only: the app never writes Claude’s or Cursor’s settings files.'),
      // src/shared/contract.ts PermissionMode; src/renderer/lib/format.ts labels
      b('Modalità: Chiedi ogni volta, Accetta le modifiche, Automatico, Solo piano, Senza permessi; si sceglie all’avvio o dal menu ⋯ (solo Claude).',
        'Modes: Ask every time, Accept edits, Automatic, Plan only, No permissions; chosen at start or from the ⋯ menu (Claude only).'),
      // src/shared/agents.ts PERMISSION_CEILINGS; src/main/agents/tool-policy.ts
      b('Il tetto di un ruolo può essere plan, default o acceptEdits (lo cambi nella pagina Agenti, dopo la tua approvazione): una modalità più alta viene abbassata al tetto.',
        'A role’s ceiling can be plan, default or acceptEdits (changed on the Agenti page, after your approval): a higher mode is lowered to the ceiling.'),
      // src/main/chats/manager.ts (reset above ceiling, chat:set refusal)
      b('Se il motore sale da solo sopra il tetto, l’app lo riporta giù; cambiarlo a mano sopra il tetto è rifiutato.',
        'If the engine climbs above the ceiling by itself, the app sets it back; raising it by hand above the ceiling is refused.'),
      // src/main/agents/tool-policy.ts FAIL_CLOSED
      b('Una politica salvata illeggibile vale «solo lettura, tetto plan».', 'An unreadable stored policy means "read only, plan ceiling".'),
    ],
    analogy: b('Come la carta aziendale con un massimale: puoi chiedere un’autorizzazione, ma oltre il tetto non passa.',
      'Like a company card with a limit: you can ask for approval, but above the limit it does not go through.'),
    diagram: { kind: 'flow', steps: [b('Il ruolo vuole agire', 'Role wants to act'), b('Richiesta della CLI', 'CLI request'), b('Pannello', 'Panel'), b('Tua risposta', 'Your answer')] },
    tech: [
      tech(TOOLS, 'Claude: can_use_tool; Cursor: session/request_permission; Codex: le approvazioni di comandi e modifiche.', 'Claude: can_use_tool; Cursor: session/request_permission; Codex: command and file-change approvals.'),
      tech(DATA, "PendingRequest { id, chatId, type: 'permission' | 'question' | 'command', tool, title, detail, input, noAlways?, alwaysRules? }.",
        "PendingRequest { id, chatId, type: 'permission' | 'question' | 'command', tool, title, detail, input, noAlways?, alwaysRules? }."),
      tech(LIMITS, 'Ordine: plan 0 < default 1 < acceptEdits 2 < auto 3 < bypassPermissions 4; auto e bypass non possono essere un tetto.',
        'Order: plan 0 < default 1 < acceptEdits 2 < auto 3 < bypassPermissions 4; auto and bypass cannot be a ceiling.'),
      tech(WHERE, 'Su Cursor (ACP) «sempre» è ignorato e solo il tetto plan è applicato; gli altri tetti risultano «dichiarati, non applicati».',
        'On Cursor (ACP) "always" is ignored and only the plan ceiling is enforced; other ceilings are "declared, not enforced".'),
      tech(WHERE, 'Su Codex plan/default impongono una sandbox in sola lettura; acceptEdits usa approvazioni on-request.',
        'On Codex, plan/default enforce a read-only sandbox; acceptEdits uses on-request approvals.'),
    ],
    sources: ['src/main/chats/claude.ts', 'src/main/chats/acp.ts', 'src/main/chats/codex.ts', 'src/shared/contract.ts', 'src/shared/agents.ts', 'src/main/agents/tool-policy.ts', 'src/main/chats/manager.ts', 'src/renderer/lib/format.ts'],
  },
  {
    id: 'questions',
    title: b('Domande e decisioni', 'Questions and decisions'),
    summary: b('Quando una chat «ti aspetta», la domanda resta in attesa finché rispondi: nel riquadro della chat o nella finestra delle domande.',
      'When a chat "waits for you", the question stays pending until you answer: in the chat’s tile or in the questions window.'),
    points: [
      // src/renderer/store/state.ts pending; src/main/chats/manager.ts
      b('Ogni domanda, permesso o comando da rivedere entra nell’elenco «pending»; la chat resta ferma finché non rispondi.',
        'Every question, permission or command to review joins the "pending" list; the chat stays blocked until you answer.'),
      // src/renderer/lib/questions.ts; src/renderer/components/QuestionsWindow.tsx
      b('Si aprono sempre una alla volta in una finestra centrale: non c’è un interruttore per spegnerla.',
        'They always open one at a time in a central window: there is no switch to turn it off.'),
      // src/renderer/components/QuestionsWindow.tsx
      b('Nella finestra puoi rispondere in qualsiasi ordine dalla colonna a sinistra; Esc vuol dire «Rispondi dopo», non «rifiuta».',
        'In the window you can answer in any order from the left rail; Esc means "Answer later", not "deny".'),
      // src/renderer/lib/questions.ts TYPING_IDLE_MS
      b('Se stai scrivendo, una domanda nuova aspetta come pillola e compare 2 secondi dopo che smetti.',
        'If you are typing, a new question waits as a pill and appears 2 seconds after you stop.'),
      // src/renderer/lib/later.ts, src/main/later.ts
      b('«Rispondi dopo» mette da parte solo quella richiesta in «Da rispondere»; Ctrl+J apre la prossima cosa che ti aspetta.',
        '"Answer later" sets only that request aside in "To answer"; Ctrl+J opens the next thing waiting for you.'),
      // src/renderer/components/AskImages.tsx, src/main/ask-image.ts SCREENSHOT_HINT
      b('Gli screenshot che l’agente cita (un percorso PNG/JPG/WebP nella domanda o in un’opzione) compaiono come miniature, prima e dopo affiancati; un clic li apre grandi. Lo stesso vale per i messaggi in chat.',
        'Screenshots the agent names (a PNG/JPG/WebP path in the question or an option) show as thumbnails, before and after side by side; a click opens them large. Chat messages work the same way.'),
      // src/main/chats/orchestrator-wake.ts QUIET; no timeout
      b('Non c’è scadenza: la richiesta sparisce solo se rispondi, se la CLI la ritira o se chiudi la chat.',
        'There is no timeout: the request goes away only if you answer, the CLI withdraws it, or you close the chat.'),
    ],
    analogy: b('Come i post-it sulla scrivania: restano lì finché non li togli tu, e puoi decidere di guardarli dopo pranzo.',
      'Like sticky notes on the desk: they stay until you remove them, and you can decide to look at them after lunch.'),
    diagram: { kind: 'flow', steps: [b('Chat chiede', 'Chat asks'), b('In attesa', 'Pending'), b('Finestra delle domande', 'Questions window'), b('Risposta', 'Answer'), b('La chat riparte', 'Chat resumes')] },
    tech: [
      tech(DATA, "Answer = { kind: 'permission', allow, always?, message? } | { kind: 'question', answers }.", "Answer = { kind: 'permission', allow, always?, message? } | { kind: 'question', answers }."),
      tech(FILES, 'Nessuna impostazione; le richieste messe da parte con «Rispondi dopo» restano in memoria fino alla risposta.', 'No setting; requests set aside with "Answer later" stay in memory until answered.'),
      tech(WHERE, 'Le domande non svegliano l’Orchestrator da sole (orchestrator-wake.ts); l’ordine è quello di arrivo.', 'Questions never wake the Orchestrator by themselves (orchestrator-wake.ts); the order is arrival order.'),
    ],
    sources: ['src/renderer/store/state.ts', 'src/renderer/lib/questions.ts', 'src/renderer/components/QuestionsWindow.tsx', 'src/renderer/components/AskImages.tsx', 'src/main/ask-image.ts', 'src/renderer/lib/later.ts', 'src/main/later.ts', 'src/main/chats/orchestrator-wake.ts', 'src/shared/contract.ts'],
  },
  {
    id: 'grindhouse',
    title: b('La Grindhouse', 'The Grindhouse'),
    summary: b('La pagina iniziale: una striscia per ogni agente al lavoro, con i browser che guida accanto alla chat aperta.',
      'The home page: one strip per working agent, with the browsers it drives beside the expanded chat.'),
    points: [
      // src/renderer/brain/pages/Home.tsx
      b('La pagina mostra le strisce degli agenti; le richieste in attesa compaiono sulla striscia della chat interessata.',
        'The page shows agent strips; pending requests appear on the strip of the relevant chat.'),
      // src/renderer/lib/agent-order.ts
      b('Le strisce sono raggruppate per area, cioè l’ultima cartella del percorso di lavoro della chat.',
        'Strips are grouped by area, i.e. the last folder of the chat’s working path.'),
      // src/renderer/lib/grid.ts workspaceTiles
      b('Una striscia con un browser agganciato mostra un piccolo globo. I browser restano chiusi finché non premi il globo: il globo apre anche la striscia, se è chiusa, e i browser stanno accanto alla chat, oppure sotto se lo spazio è stretto, e ognuno si può mettere a tutto schermo. Restano visibili sempre quelli che richiedono il tuo intervento o sono massimizzati. Un browser chiuso con il globo continua a lavorare fuori schermo.',
        'A strip with an attached browser shows a small globe. Its browsers stay folded until you press the globe: the globe also expands a collapsed strip, and the browsers sit beside the chat, or below in a narrow space, and each can go full screen. Those awaiting your intervention or maximized always show. A browser folded with the globe keeps working off screen.'),
      // src/renderer/components/ChildStrips.tsx
      b('Sotto ogni striscia compaiono i sottoagenti e i comandi ancora al lavoro, ciascuno con il nome dell’agente dell’app con cui gira (o «nessun agente»); quelli finiti spariscono subito (l’elenco completo resta in «Dettagli e collaboratori»). Finché un sottoagente lavora, la striscia madre dice «in attesa», non «finito».',
        'Under each strip appear the subagents and commands still at work, each with the name of the app agent it runs as (or "no agent"); finished ones leave at once (the full list stays in "Details and collaborators"). While a subagent works, the parent strip says "waiting", not "finished".'),
      // src/renderer/components/RunEstimate.tsx, src/main/agents/task-estimate.ts (ADR 0087)
      b('Una striscia di un agente mostra una stima tratteggiata, «stima ~4 min · ~0,12 $ · su 12 task simili»: la mediana dei task simili già finiti (stesso agente e stesso tipo, poi stesso tipo, poi stesso agente; almeno 3), mai il tempo né il costo di questa esecuzione. Finito il lavoro diventa «~4 min → 6 min» con ✓ se il reale sta tra la metà e il doppio. Il «?» spiega il calcolo e quanto sono state precise le stime.',
        'An agent strip shows a dashed estimate, "estimate ~4 min · ~0,12 $ · from 12 similar tasks": the median of similar finished tasks (same agent and kind, then same kind, then same agent; at least 3), never this run’s own time or cost. Once done it becomes "~4 min → 6 min" with ✓ when the actual is between half and double. The "?" explains the computation and how accurate the estimates have been.'),
      // src/main/chats/manager.ts settleReport; src/main/chats/auto-close.ts; src/renderer/components/AutoCloseNotice.tsx (ADR 0084)
      b('Un agente che ha mandato il report finale all’Orchestrator e non lavora più chiude il suo incarico e si chiude da solo dopo il tempo scelto in Impostazioni (lo ritrovi con Ctrl+K). Se aspetta te, un permesso, i colleghi o task in background resta aperto e la striscia dice «In attesa di…».',
        'An agent that sent its final report to the Orchestrator and is idle completes its assignment and closes by itself after the delay set in Settings (Ctrl+K finds it). If it waits for you, a permission, colleagues or background tasks it stays open and the strip says "Waiting for…".'),
      // src/renderer/components/ChatTile.tsx
      b('Una striscia chiusa mostra agente, stato, modello e l’ultima risposta; un clic ovunque su di essa la apre, ogni volta, e mostra la conversazione e l’input. Lo sforzo lo decide il profilo dell’agente: la striscia non lo mostra.',
        'A collapsed strip shows agent, state, model and the last answer; a click anywhere on it expands it, every time, showing the conversation and the input. The effort is the agent profile’s: the strip does not show it.'),
      // src/renderer/components/CloudStrips.tsx, src/main/cloud/service.ts (ADR 0080)
      b('Gli agenti cloud (Cursor, Codex, Claude Code che girano nel cloud del fornitore, anche a PC spento) hanno la loro striscia sotto le altre, raggruppata per repository, con l’etichetta «cloud» e il motore. Cursor mostra i messaggi, accetta messaggi e si ferma dall’app; Codex e Claude si seguono sulla loro pagina («Apri»). «Porta in locale» prende il risultato in un nuovo worktree. Li avvia l’Orchestrator quando glielo chiedi, solo su repository GitHub con il branch già pushato.',
        'Cloud agents (Cursor, Codex, Claude Code running in the vendor’s cloud, even with the PC off) get their own strip under the others, grouped by repository, with a "cloud" label and the engine. Cursor shows its messages, takes messages and stops from the app; Codex and Claude are followed on their own page ("Open"). "Bring home" takes the result into a new worktree. The Orchestrator starts one when you ask it, only on GitHub repositories with the branch already pushed.'),
    ],
    analogy: b('Come il banco di orchestrator di uno studio: un fader per ogni canale, e il monitor di ciascuno sotto.',
      'Like a studio mixing desk: one fader per channel, and each one’s monitor below it.'),
    tech: [
      tech(WHERE, 'Pagina «home» (brain/pages/Home.tsx), strisce in components/AgentStrips.tsx, ordine in lib/agent-order.ts; ADR 0068.',
        'Page "home" (brain/pages/Home.tsx), strips in components/AgentStrips.tsx, order in lib/agent-order.ts; ADR 0068.'),
      tech(DATA, 'Una striscia è aperta se prefs.chatExpanded[id], i suoi browser se anche prefs.browserOpen[id]; nessun ordine salvato, nessun trascinamento.', 'A strip is expanded if prefs.chatExpanded[id], its browsers if prefs.browserOpen[id] too; no saved order, no dragging.'),
      tech(TOOLS, 'Un agente cloud parte da app_create_chat con where «cloud».', 'A cloud agent starts from app_create_chat with where "cloud".'),
    ],
    sources: ['src/renderer/brain/pages/Home.tsx', 'src/renderer/components/AgentStrips.tsx', 'src/renderer/lib/agent-order.ts', 'src/renderer/lib/grid.ts', 'src/renderer/components/ChatTile.tsx', 'src/renderer/components/RunEstimate.tsx', 'src/renderer/components/BrowserTile.tsx', 'src/renderer/components/CloudStrips.tsx', 'src/main/cloud/service.ts'],
  },
  {
    id: 'memory-hub',
    title: b('La Memoria, un posto solo', 'Memoria, one place'),
    summary: b('Memoria è il posto unico di tutto quello che il brain contiene: in cima è viva (la frase del giorno, i contatori dal vivo, le ultime modifiche, «Manutenzione»), sotto le schede Proposte, Approvate, Skill, Regole, Script & Query, Idee, File, Apprendimento e Statistiche.',
      'Memoria is the one place for everything the brain holds: its top is alive (the day’s sentence, live counters, the latest changes, \"Maintenance\"), below it the tabs Proposals, Approved, Skills, Rules, Scripts & Queries, Ideas, Files, Learning and Statistics.'),
    points: [
      // src/renderer/lib/memory-hub.ts, src/renderer/actions.ts, src/renderer/components/Sidebar.tsx
      b('Skill, Regole, Script, Idee e Apprendimento non sono più pagine a sé nella barra: sono schede di Memoria; i vecchi link, gli id e i tasti G (G S, G L, G T, G I, G J) aprono la scheda giusta, e «memoria/<scheda>» apre una scheda da un link.',
        'Skills, Rules, Scripts, Ideas and Learning are no longer pages of their own in the rail: they are Memoria tabs; old links, ids and G keys (G S, G L, G T, G I, G J) open the right tab, and \"memoria/<tab>\" opens a tab from a link.'),
      b('La voce Memoria nella barra porta il numero delle proposte che aspettano te; la scheda Proposte le mostra una alla volta.',
        'The Memoria entry in the rail carries the number of proposals waiting for you; the Proposals tab shows them one at a time.'),
      // src/renderer/components/brain-model/ApprovedTab.tsx, src/main/brainmodel/service.ts
      b('«Approvate» elenca tutto quello che è nel brain adesso (skill, regole, fatti confermati, script): il cestino lo toglie con un clic e per qualche secondo «Annulla» lo rimette; skill, regole e script passano dal registro delle modifiche, quindi restano annullabili anche in Apprendimento.',
        '\"Approved\" lists everything in the brain now (skills, rules, confirmed facts, scripts): the bin takes one out in a click and for a few seconds \"Undo\" puts it back; skills, rules and scripts go through the change log, so they stay undoable in Learning too.'),
      // src/renderer/brain/pages/Idee.tsx
      b('«Idee» divide le tue da quelle dell’IA (la colonna «Chi» di ideas.md: «IA» è l’IA) e «Rispolvera» ti ripropone a caso un’idea vecchia ancora aperta; sotto, il Battito e i temi delle idee.',
        '\"Ideas\" splits yours from the AI’s (the \"Chi\" column of ideas.md: \"IA\" is the AI) and \"Dust one off\" brings back an old idea still open at random; below, the Pulse and the ideas’ themes.'),
      b('La Dashboard non c’è più: la frase e i contatori sono in cima a Memoria, il contesto delle chat in Costi, gli errori dell’app e i temi degli errori in Qualità, gli spunti dell’AI in Idee; il resto erano doppioni.',
        'The Dashboard is gone: the sentence and the counters are at the top of Memoria, the chats’ context in Costi, the app’s errors and the errors’ themes in Quality, the AI’s tips in Ideas; the rest were duplicates.'),
      b('Ogni numero ha un «?» che dice come è calcolato; ogni pannello ha «Discuti», che prepara una bozza all’Orchestrator senza mai inviarla.',
        'Every number has a \"?\" saying how it is computed; every panel has \"Discuss\", which drafts for the Orchestrator and never sends.'),
    ],
    analogy: b('Come lo studio di casa dove tieni tutto: la scrivania con la posta da aprire, gli scaffali in ordine e un cassetto da cui ogni tanto ripeschi un’idea.',
      'Like the study at home where you keep everything: the desk with the mail to open, tidy shelves and a drawer you now and then fish an idea out of.'),
    tech: [
      tech(WHERE, 'Schede in lib/memory-hub.ts (HUB_TABS, parseHubArg, hubRedirect), reindirizzamento in actions.ts go(); pagina components/brain-model/MemoryPage.tsx; ADR 0122.',
        'Tabs in lib/memory-hub.ts (HUB_TABS, parseHubArg, hubRedirect), redirect in actions.ts go(); page components/brain-model/MemoryPage.tsx; ADR 0122.'),
      tech(DATA, 'Il cestino chiama brainmodel:remove (skill del brain, file in rules/, script) e torna l’id della modifica; «Annulla» è brainmodel:rollback. Un fatto confermato si cancella con memory:delete solo quando il messaggio scade.',
        'The bin calls brainmodel:remove (brain skills, rules/ files, scripts) and gets the change id back; \"Undo\" is brainmodel:rollback. A confirmed fact is erased with memory:delete only once its message expires.'),
    ],
    sources: ['src/renderer/components/brain-model/MemoryPage.tsx', 'src/renderer/components/brain-model/ApprovedTab.tsx', 'src/renderer/lib/memory-hub.ts', 'src/renderer/brain/pages/Idee.tsx', 'src/renderer/components/ContextNow.tsx', 'src/renderer/dashboard/AppErrors.tsx', 'src/main/brainmodel/service.ts'],
  },
  {
    id: 'tasks',
    title: b('Task', 'Tasks'),
    summary: b('Task mostra quello che ti aspetta su Azure DevOps: notizie, PR, review e work item.',
      'Tasks shows what waits for you on Azure DevOps: news, PRs, reviews and work items.'),
    points: [
      // src/renderer/brain/pages/Task.tsx, src/main/tasks/service.ts
      b('«Task» legge con il lettore devops-me.mjs le tue PR, le review, i work item e le menzioni: quello incluso nell’app, o quello del brain se c’è; sola lettura, zero token.',
        '"Tasks" reads your PRs, reviews, work items and mentions with the devops-me.mjs reader: the one shipped with the app, or the brain’s own when it has one; read-only, zero tokens.'),
      b('La lettura parte con «Aggiorna ora» o da sola, ogni 15 minuti fino a 2 ore, se accendi la lettura automatica; una menzione ti avvisa con un suono che puoi spegnere.',
        'The read starts with "Refresh now" or by itself, every 15 minutes up to 2 hours, when the automatic read is on; a mention alerts you with a sound you can turn off.'),
      b('Ogni notizia, PR, review o work item è una striscia a sinistra; a destra c’è il dettaglio di quella scelta. «Per te» raccoglie quello che aspetta te; aprire una notizia la segna letta, J e K scorrono.',
        'Every news, PR, review or work item is a strip on the left; the selected one’s detail is on the right. "For you" gathers what waits for you; opening a news item marks it read, J and K move.'),
      b('Ogni record ha «Discuti»: l’Orchestrator riceve una bozza con titolo, link, stato e cartella; se serve lavoro, è lui ad aprire e istruire la chat.',
        'Every record has "Discuss": the Orchestrator gets a draft with title, link, state and folder; if work is needed, it opens and briefs the chat itself.'),
      // src/renderer/brain/pages/TaskQa.tsx
      b('«Test e QA» mostra, per ogni tua PR con un test plan, quanti test case sono fatti e quanti mancano, chi li ha eseguiti e i bug collegati.',
        '"Tests and QA" shows, for each of your PRs with a test plan, how many test cases are done and how many are missing, who ran them and the linked bugs.'),
    ],
    analogy: b('Task è la posta in arrivo del lavoro.',
      'Tasks is the work’s inbox.'),
    tech: [
      tech(DATA, 'La cache tasks.json nella cartella dati dell’app.',
        'The tasks.json cache in the app’s data folder.'),
      tech(WHERE, 'Lettura e avvisi in src/main/tasks/, la pagina in brain/pages/Task.tsx. Fino al 19/10/2026 Task si chiamava DevOps: impostazioni e link vecchi passano da soli al nome nuovo (ADR 0079).',
        'Reads and alerts in src/main/tasks/, the page in brain/pages/Task.tsx. Until 19/10/2026 Tasks was called DevOps: old settings and links move to the new name by themselves (ADR 0079).'),
    ],
    sources: ['src/renderer/brain/pages/Task.tsx', 'src/main/tasks/service.ts'],
  },
  {
    id: 'setup',
    title: b('La prima configurazione', 'The first setup'),
    summary: b('Una sola finestra, sei passi: lingua, la tua IA, gli strumenti, chi sei, le cartelle e pronto. Riprendi quando vuoi.',
      'One window, six steps: language, your AI, tools, who you are, folders and ready. Resume whenever you like.'),
    points: [
      // src/renderer/components/SetupLanguage.tsx; src/renderer/i18n/LangRoot.tsx
      b('Lingua per prima: tre pulsanti grandi, già scelta quella del sistema. Un clic cambia subito la lingua dell’app; le risposte restano. La stessa lingua va in me.md per le chat e nel brain nuovo.',
        'Language first: three big buttons, the system one already picked. A click changes the app’s language at once; the answers stay. The same language goes into me.md for the chats and into the new brain.'),
      // src/renderer/components/SetupEngines.tsx; src/renderer/lib/setup-wizard.ts
      b('La tua IA: una consigliata, le altre sotto «Altre IA». «Collega» apre l’accesso ufficiale in una finestra a parte; la configurazione resta aperta e ricontrolla da sola ogni pochi secondi. La prima IA scelta è quella dei ruoli.',
        'Your AI: one recommended, the others under "More AI tools". "Collega" opens the official sign-in in a separate window; the setup stays open and checks again by itself every few seconds. The first AI chosen is the roles’ one.'),
      // src/renderer/components/ToolCatalog.tsx; src/renderer/lib/tool-presets.ts
      b('Strumenti (GitHub, Jira, Azure DevOps): ogni riquadro crea insieme l’account e il server MCP degli agenti. Chiede solo organizzazione o sito, poi un token (con il link alla pagina dove si crea) o l’accesso nel browser, e prova subito: «Funziona: vedo N progetti» o cosa fare. Il modulo tecnico sta in Impostazioni → Avanzate.',
        'Tools (GitHub, Jira, Azure DevOps): each tile creates the account and the agents’ MCP server together. It asks only for the organization or site, then a token (with the link to the page where it is made) or the browser sign-in, and tests at once: "Works: I see N projects" or what to do. The technical form is in Settings → Advanced.'),
      // src/renderer/components/SetupFolders.tsx; src/main/brain/projects-folder.ts; src/modules/ai-first/default-brain.ts
      b('Cartelle: sempre un brain nuovo e vuoto nel posto predefinito (creato alla conferma); la cartella dei progetti la cerca l’app da sola e te la chiede solo se non la trova. Un brain che hai già lo indichi in Impostazioni → Il mio spazio.',
        'Folders: always a new, empty brain in the default place (created on confirmation); the app looks for the projects folder by itself and asks only when it finds none. A brain you already have is pointed to in Settings → My workspace.'),
      // src/renderer/components/FirstInterview.tsx; src/modules/ai-first/model.ts
      b('Pronto: obiettivi, aree di lavoro e squadra non si chiedono qui ma dopo, nella prima chat con la guida, una domanda alla volta. Ogni risposta è salvata come bozza mezzo secondo dopo, così «Più tardi» o Esc riprendono dallo stesso passo.',
        'Ready: goals, work areas and team are not asked here but later, in the first chat with the guide, one question at a time. Every answer is saved as a draft half a second later, so "Più tardi" or Esc resume on the same step.'),
      // src/renderer/components/ui.tsx Modal
      b('Niente dentro la finestra la chiude da solo: un clic fuori non fa nulla, e la si riapre da Impostazioni → «Configura il mio lavoro».',
        'Nothing inside the window closes it by itself: a click outside does nothing, and you reopen it from Settings → "Configura il mio lavoro".'),
    ],
    analogy: b('Come il primo giorno in un ufficio nuovo: ti mostrano la scrivania, ti danno i badge e controllano che aprano davvero le porte.',
      'Like the first day at a new office: they show you your desk, hand you the badges and check they really open the doors.'),
    diagram: { kind: 'flow', steps: [b('Lingua', 'Language'), b('La tua IA', 'Your AI'), b('Strumenti', 'Tools'), b('Chi sei', 'About you'), b('Cartelle', 'Folders'), b('Pronto', 'Ready')] },
    tech: [
      tech(WHERE, 'Le scelte stanno in config.json (brainRoot, projectsRoot); la bozza in setup.json; il brain nuovo usa projectsRoot come cartella dei repository (REPOS).',
        'The choices live in config.json (brainRoot, projectsRoot); the draft in setup.json; a new brain uses projectsRoot as its repositories folder (REPOS).'),
      tech(LIMITS, 'Ricerca dei progetti: solo nomi di cartelle e presenza di .git, al massimo 300 cartelle note alle CLI; nessun file aperto. Ricontrollo degli accessi: ogni 4 secondi per 3 minuti.',
        'Projects search: folder names and .git presence only, at most 300 folders known to the CLIs; no file opened. Sign-in re-checks: every 4 seconds for 3 minutes.'),
    ],
    sources: ['src/renderer/components/FirstInterview.tsx', 'src/renderer/components/SetupFolders.tsx', 'src/renderer/components/SetupEngines.tsx', 'src/renderer/components/SetupLanguage.tsx', 'src/renderer/components/ToolCatalog.tsx', 'src/renderer/lib/setup-wizard.ts', 'src/renderer/lib/tool-presets.ts', 'src/renderer/lib/setup-connectors.ts', 'src/main/brain/projects-folder.ts', 'src/renderer/components/ProjectsFolderSetting.tsx', 'src/modules/ai-first/default-brain.ts', 'src/renderer/components/ui.tsx'],
  },
  {
    id: 'brain',
    title: b('Il brain: le note e la memoria', 'The brain: notes and memory'),
    summary: b('Una cartella di note, nuova e vuota alla prima configurazione (o un brain che hai già): gli agenti la leggono e la scrivono, l’app la mostra dal vivo.',
      'A folder of notes, new and empty at the first setup (or a brain you already have): agents read and write it, the app shows it live.'),
    points: [
      // src/main/brain/detect.ts isBrainFolder
      b('Si riconosce da brain.json (un brain nuovo) oppure da AGENTS.md più ops/tools/brain-site.mjs (un brain di prima); il percorso è salvato in config.json (brainRoot).',
        'It is recognised by brain.json (a new brain) or by AGENTS.md plus ops/tools/brain-site.mjs (an older brain); the path is saved in config.json (brainRoot).'),
      // src/main/rules/new-brain.ts writeFreshBrain, src/main/rules/tools.ts (ADR 0072)
      b('Un brain nuovo contiene solo me.md (il tuo profilo) e brain.json: regole, skill, agenti e strumenti dell’app restano nell’app e arrivano a ogni chat. now.md, ideas.md, ai-errors.md e journal/ nascono al primo uso.',
        'A new brain holds only me.md (your profile) and brain.json: the app’s rules, skills, agents and tools stay in the app and reach every chat. now.md, ideas.md, ai-errors.md and journal/ appear on first use.'),
      // brain-template/ops/tools/mem.mjs; src/main/brain/profile.ts; src/main/chats/mail.ts; src/main/skills/service.ts
      b('Gli strumenti del brain aggiornano le note con mem.mjs; l’app scrive anche il profilo me.md, la posta in ops/state/inbox/, brain-settings.json e file di skill/agenti, oltre allo stato in ops/state/improve/.',
        'Brain tools update notes through mem.mjs; the app also writes the me.md profile, mail under ops/state/inbox/, brain-settings.json and skill/agent files, as well as state in ops/state/improve/.'),
      // src/main/brain/live.ts
      b('Il feed dal vivo osserva la cartella e mostra le novità (idee, errori, decisioni…); «mentre eri via» segna quelle arrivate a app chiusa.',
        'The live feed watches the folder and shows what changed (ideas, errors, decisions…); "while you were away" marks those that came while the app was closed.'),
      // src/main/brainmodel/procedure-sources.ts (ADR 0077)
      b('Runbook e routine di un brain di prima diventano skill una volta sola; i file originali restano dove sono, le righe che sembrano credenziali non passano mai.',
        'Runbooks and routines of an older brain become skills once; the original files stay where they are, lines that look like credentials never pass.'),
      // src/main/brain/domains.ts, src/main/brain/sync.ts
      b('Più domini e sincronizzazione tra PC sono opzionali (domain.json); prima di ogni push passa il controllo di pubblicazione.',
        'Several domains and sync between PCs are optional (domain.json); every push goes through the publish guard first.'),
    ],
    analogy: b('Come il quaderno di bordo condiviso di un equipaggio: chi entra in turno lo legge, chi esce scrive cosa è successo.',
      'Like a crew’s shared logbook: whoever starts a shift reads it, whoever ends one writes what happened.'),
    diagram: { kind: 'cycle', steps: [b('Agente legge', 'Agent reads'), b('Lavora', 'Works'), b('mem.mjs scrive', 'mem.mjs writes'), b('Feed dal vivo', 'Live feed')] },
    tech: [
      // src/main/brain/live.ts debounce; src/main/brain/index.ts FEED_MAX
      tech(LIMITS, 'Feed: osservazione con attesa di 400 ms, 500 eventi tenuti.',
        'Feed: watching with a 400 ms debounce, 500 events kept.'),
      tech(DATA, "domain.json { name, scope: 'everywhere' | 'this-pc', remote?, denyList? }; senza file = un dominio «solo questo PC».",
        "domain.json { name, scope: 'everywhere' | 'this-pc', remote?, denyList? }; no file = one \"this PC only\" domain."),
      tech(WHERE, 'Il server dati del brain (brain-site.mjs) gira su una porta 127.0.0.1; il main inoltra solo GET su percorsi ammessi.',
        'The brain’s data server (brain-site.mjs) runs on a 127.0.0.1 port; main forwards only GETs on allowed paths.'),
    ],
    sources: ['src/main/rules/new-brain.ts', 'src/main/rules/tools.ts', 'src/main/brain/detect.ts', 'src/main/brain/live.ts', 'src/main/brain/index.ts', 'src/main/brainmodel/procedure-sources.ts', 'src/main/brain/domains.ts', 'src/main/brain/sync.ts', 'src/main/brain/profile.ts', 'src/main/chats/mail.ts', 'src/main/brain/brain-settings.ts', 'src/main/skills/service.ts', 'brain-template/ops/tools/mem.mjs', 'brain-template/map.md'],
  },
  {
    id: 'search',
    title: b('La ricerca (Ctrl+K)', 'Search (Ctrl+K)'),
    summary: b('Cerca in chat, messaggi, branch e note del brain; nelle note del brain anche per significato, con un modello locale e offline.',
      'Searches chats, messages, branches and brain notes; in the brain notes by meaning too, with a local, offline model.'),
    points: [
      // src/main/search/service.ts
      b('Indicizza le chat degli ultimi 30 giorni (sempre quelle aperte), i branch git delle cartelle delle chat e i file .md del brain.',
        'It indexes chats of the last 30 days (open ones always), the git branches of the chats’ folders and the brain’s .md files.'),
      // src/main/search/text-index.ts
      b('Ogni parola della ricerca deve comparire; maiuscole e accenti non contano.', 'Every word of the query must appear; case and accents do not matter.'),
      b('Punteggio: corrispondenza nel titolo, poi frase intera, poi parole sparse, più un premio per le cose recenti.',
        'Score: a match in the title, then the whole phrase, then loose words, plus a bonus for recent things.'),
      b('L’indice di chat e branch si aggiorna solo quando cerchi (al massimo ogni 2 secondi), senza timer né osservatori.', 'The chats and branches index refreshes only when you search (at most every 2 seconds), with no timer or watcher.'),
      // src/main/search/hybrid/service.ts, engine.ts (ADR 0094 hybrid brain search)
      b('Il gruppo «Nel brain» usa la ricerca ibrida: parole (BM25, anche con un errore di battitura) e significato (multilingual-e5, scaricato una volta e poi offline), così una frase in inglese trova una nota in italiano. Finché il modello non è pronto cerca solo per parole.',
        'The "In the brain" group uses the hybrid search: words (BM25, a typo allowed too) and meaning (multilingual-e5, downloaded once then offline), so an English phrase finds an Italian note. Until the model is ready it searches by words only.'),
      // src/renderer/components/CommandPalette.tsx
      b('Risultati in gruppi: «Chat trovate», «Nei messaggi», «Branch», «Nel brain»; al massimo 6 per gruppo.',
        'Results in groups: "Chats found", "In messages", "Branches", "In the brain"; at most 6 per group.'),
    ],
    analogy: b('Come l’indice analitico di un libro, con un bibliotecario che per le note del brain capisce anche cosa intendi.',
      'Like a book’s index, with a librarian who, for the brain notes, also understands what you mean.'),
    tech: [
      tech(LIMITS, 'Ricerca da 2 a 200 caratteri; 2 000 000 caratteri per chat; 4000 file del brain, 1 MB l’uno.', 'Query from 2 to 200 chars; 2,000,000 chars per chat; 4000 brain files, 1 MB each.'),
      tech(DATA, 'Titolo 600 + testo + recentezza (fino a 150, lineare su 30 giorni); frase 200; parole 100.', 'Title 600 + text + recency (up to 150, linear over 30 days); phrase 200; words 100.'),
      tech(WHERE, 'Chat e branch: indice in memoria nel processo main (src/main/search), canale search:query. Brain: indice ibrido in userData/search/index.db, in un worker, lo stesso usato da /api/search e dallo strumento brain_search delle chat.', 'Chats and branches: in-memory index in the main process (src/main/search), channel search:query. Brain: hybrid index in userData/search/index.db, in a worker, the same one /api/search and the chats’ brain_search tool use.'),
    ],
    sources: ['src/main/search/service.ts', 'src/main/search/text-index.ts', 'src/main/search/sources.ts', 'src/main/search/hybrid/service.ts', 'src/main/search/hybrid/engine.ts', 'src/renderer/components/CommandPalette.tsx', 'docs/adr/0023-full-text-search.md', 'docs/adr/0094-hybrid-brain-search.md'],
  },
  {
    id: 'file-viewer',
    title: b('Il visualizzatore di file', 'The file viewer'),
    summary: b('Apre in sola lettura un file citato in chat o nel brain, alla riga giusta, solo dentro le cartelle di lavoro.',
      'Opens a file mentioned in a chat or the brain read-only, at the right line, only inside the working folders.'),
    points: [
      // src/main/index.ts (allowed roots); src/main/file-view.ts
      b('Cartelle ammesse: il brain, la cartella del repo dell’app (Impostazioni) e la cartella della chat.',
        'Allowed folders: the brain, the app’s repo folder (Settings) and the chat’s folder.'),
      b('Rifiuta file fuori da queste cartelle (controllato prima e dopo aver risolto il percorso reale), radici di disco e condivisioni di rete.',
        'It refuses files outside these folders (checked before and after resolving the real path), drive roots and network shares.'),
      b('Non mostra file «privati»: cartelle che iniziano con un punto (tranne .github e .githooks) o nomi come secret, token, password.',
        'It does not show "private" files: folders starting with a dot (except .github and .githooks) or names like secret, token, password.'),
      b('Testo fino a 1 MB; .jsonl come tabella; il resto come codice numerato.', 'Text up to 1 MB; .jsonl as a table; the rest as numbered code.'),
      // src/renderer/brain/components/ReportHtml.tsx, ReportImages.tsx
      b('Report Markdown e HTML con le loro immagini (incorporate in base64 o file accanto al report), mai da internet; un clic su un’immagine la apre grande. L’HTML è ripulito: niente script, moduli o caricamenti esterni.',
        'Markdown and HTML reports with their images (embedded as base64 or files beside the report), never from the internet; a click on an image opens it large. The HTML is cleaned: no scripts, forms or external loads.'),
      // src/renderer/components/viewer/ViewerOverlay.tsx, ShotsCompare.tsx; brain/components/FindBar.tsx, Toc.tsx; brain/pages/FileDiff.tsx
      b('Si apre sopra la pagina, che resta com’era: Esc lo chiude, Alt+←/→ passano tra i file aperti, Espandi (F11) lo porta a tutto schermo. Ctrl+F cerca nel testo, un documento lungo ha l’indice a lato, Confronta mostra le modifiche affiancate parola per parola, e gli screenshot prima e dopo di un agente si confrontano affiancati o con un cursore.',
        'It opens above the page, which stays as it was: Esc closes it, Alt+←/→ move between the files opened, Expand (F11) makes it full screen. Ctrl+F searches the text, a long document has its contents beside it, Compare shows the changes side by side word by word, and an agent’s before and after screenshots compare side by side or with a slider.'),
      // src/main/peek-file.ts
      b('Cliccare un percorso in chat apre prima un’anteprima piccola (14 righe), senza scrivere né eseguire nulla.',
        'Clicking a path in a chat first opens a small preview (14 lines), writing and running nothing.'),
    ],
    analogy: b('Come una teca di museo: guardi da vicino, ma non tocchi e non porti via.', 'Like a museum display case: you look closely, but you do not touch or take it away.'),
    tech: [
      // src/shared/file-view.ts FileReference
      tech(DATA, 'FileReference { path, line?, column?, chatId? }, da «percorso:riga:colonna» o «#L10C2».', 'FileReference { path, line?, column?, chatId? }, from "path:line:column" or "#L10C2".'),
      tech(LIMITS, 'FILE_VIEW_BYTES = 1 000 000; immagini png/jpg/webp ≤ 4 MB e 4096 px per lato; oltre 4000 righe una finestra attorno alla riga citata.',
        'FILE_VIEW_BYTES = 1,000,000; png/jpg/webp images ≤ 4 MB and 4096 px a side; beyond 4000 lines a window around the cited line.'),
      tech(WHERE, 'Canale app:readFile → readFileView nel main; pagina «file» (brain/pages/FileViewer.tsx).', 'Channel app:readFile → readFileView in main; page "file" (brain/pages/FileViewer.tsx).'),
    ],
    sources: ['src/shared/file-view.ts', 'src/main/file-view.ts', 'src/main/peek-file.ts', 'src/main/index.ts', 'src/renderer/brain/pages/FileViewer.tsx', 'src/renderer/brain/components/ReportHtml.tsx', 'src/renderer/brain/components/ReportImages.tsx'],
  },
  {
    id: 'routing',
    title: b('Instradamento modelli', 'Model routing'),
    summary: b('Una tabella dà motore, modello e sforzo alle chat avviate senza un ruolo; una chat di un ruolo prende il modello del livello del ruolo.',
      'A table gives engine, model and effort to chats started without a role; a role’s chat takes its role tier’s model.'),
    points: [
      // src/shared/work-concepts.ts taskOf; src/main/brain/routing.ts areaOf
      b('Il tipo di lavoro viene dal titolo e dal primo prompt, salvo un tipo esplicito; l’area dal chiamante (App per le chat sul codice dell’app); dal titolo solo «App · …», «Pers · App» e l’Orchestrator, le altre etichette non sono un’area.',
        'Kind comes from the title and first prompt unless supplied explicitly; area comes from the caller (App for chats on the app’s code); from the title only "App · …", "Pers · App" and the Orchestrator, other labels are no area.'),
      // src/main/brain/routing.ts match
      b('Vince la riga più specifica: tipo + area, poi area, poi tipo, poi «qualsiasi»; a pari merito la prima.',
        'The most specific row wins: kind + area, then area, then kind, then "any"; on a tie the first one.'),
      // src/main/brain/routing.ts resolve
      b('Se la riga indica un motore che non si può avviare, valgono i tuoi predefiniti «Chat aperte dall’Orchestrator».',
        'If the row names an engine that cannot start, your "Chats opened by the Orchestrator" defaults apply.'),
      // src/main/brain/routing.ts routeAgent (ADR 0083)
      b('Un ruolo non viene mai scavalcato: la sua chat ha il suo modello; se il ruolo non ne ha uno, quello della riga della tabella sul suo motore (e il suo sforzo, se il ruolo non ne indica uno), altrimenti il modello del suo livello. La rotta lo registra come «agent». Senza ruolo, un modello diverso dalla tabella richiede un motivo; lo sforzo max mai dalla tabella.',
        'A role is never overridden: its chat has its own model; when the role has none, the table row’s model on its engine (and its effort, when the role names none), else its tier’s model. The route records it as "agent". Without a role, a model other than the table’s needs a reason; max effort never from the table.'),
      // src/main/brain/routing.ts knownOutcome; src/main/wiring.ts routingVerdict; src/main/brainmodel/classifiers.ts
      b('Il tuo esito su una run di un ruolo (o quello di una revisione indipendente) entra nel registro come esito noto; i risultati di ogni riga, solo verificati, sono in Brain → Classificatori.',
        'Your verdict on a role run (or an independent review’s) enters the ledger as a known outcome; each row’s results, verified only, are in Brain → Classifiers.'),
      // src/main/brain/routing.ts (the table's file in the brain)
      b('La tabella è un file del brain: ogni salvataggio è una versione nuova e una riga «locked» non la cambiano gli agenti.',
        'The table is a file in the brain: every save is a new version, and agents never change a «locked» row.'),
      // docs/adr/0047-routing-voted-and-priced-per-work.md
      b('Il voto dei lavori e il ciclo che aggiorna la tabella vivono negli script del brain (ADR 0047).',
        'Work votes and the loop that updates the table live in the brain’s scripts (ADR 0047).'),
    ],
    analogy: b('Come il centralino di un call center: in base al motivo della chiamata ti passa al reparto giusto.',
      'Like a call-centre switchboard: depending on why you call, it puts you through to the right department.'),
    diagram: { kind: 'flow', steps: [b('Titolo e prompt', 'Title and prompt'), b('Tipo + area', 'Kind + area'), b('Riga della tabella', 'Table row'), b('Motore e modello', 'Engine and model')] },
    tech: [
      tech(DATA, 'Riga: { kind | *, area?, harness, model, effort, why, since, evidence, locked?, onApi? }; tabella con costWeight (default 7); exploration resta nel file ma non decide più nulla.',
        'Row: { kind | *, area?, harness, model, effort, why, since, evidence, locked?, onApi? }; table with costWeight (default 7); exploration stays in the file but no longer decides anything.'),
      tech(FILES, '<brain>/ops/state/improve/routing/v<N>.json + current.json; prezzi e modelli in <brain>/harness/models.json, o nella copia dell’app finché un brain nuovo non ne ha una sua.',
        '<brain>/ops/state/improve/routing/v<N>.json + current.json; prices and models in <brain>/harness/models.json, or in the app’s copy until a new brain has its own.'),
      tech(LIMITS, 'Mai Fable; le aree App usano il motore delle chat dell’app.', 'Never Fable; App areas use the app chats’ engine.'),
    ],
    sources: ['src/main/brain/routing.ts', 'src/main/brain/brain-estimates.ts', 'src/renderer/lib/routing.ts', 'docs/adr/0032-model-routing.md', 'docs/adr/0047-routing-voted-and-priced-per-work.md'],
  },
  {
    id: 'costs',
    title: b('Costi e limiti di utilizzo', 'Cost and usage limits'),
    summary: b('La barra in alto mostra la spesa di oggi e le finestre del piano; i limiti di spesa avvisano, non fermano.',
      'The top bar shows today’s spend and the plan’s windows; spending limits warn, they do not stop.'),
    points: [
      // src/renderer/components/UsageBar.tsx
      b('In alto: spesa di oggi, finestra di 5 ore, settimana e le chat di oggi dalla più cara; verde sotto 70%, ambra da 70%, rosso da 90%.',
        'At the top: today’s spend, 5-hour window, week and today’s chats from the most expensive; green below 70%, amber from 70%, red from 90%.'),
      // src/renderer/brain/pages/Costi.tsx (#125)
      b('Andamento → Costi è l’unica pagina dei costi: le chat di oggi dal vivo, il periodo con il confronto, qualche curiosità (il giorno più caro, il modello che pesa di più), dove risparmiare, i grafici per giorno, tipo, modello e area e ogni chat. I costi per agente sono sul retro della sua carta in Agenti.',
        'Andamento → Costi is the one costs page: today’s chats live, the period with its comparison, a few curious facts (the priciest day, the model that weighs most), where to save, charts by day, kind, model and area, and every chat. Per-agent costs are on the back of its card in Agenti.'),
      // src/main/chats/live-cost.ts priceUsage
      b('Il costo di un turno si calcola dai token ai prezzi di models.json, poi viene sostituito dal costo reale che la CLI riporta a fine turno.',
        'A turn’s cost is computed from tokens at models.json prices, then replaced by the real cost the CLI reports at the end of the turn.'),
      b('Per Claude è un prezzo di listino API: con l’abbonamento è un costo equivalente, non una fattura.',
        'For Claude it is an API list price: on a subscription it is an equivalent cost, not an invoice.'),
      // src/main/brain/budget.ts
      b('I limiti di spesa (al giorno, per chat) avvisano all’80% e al 100%, una volta sola; al 100% arriva anche un avviso urgente.',
        'Spending limits (per day, per chat) warn at 80% and 100%, once each; at 100% an urgent alert comes too.'),
      b('Nessun limite ferma una chat da solo.', 'No limit stops a chat by itself.'),
      // src/main/brain/settings-schema.ts COMPACT_WINDOW
      b('Claude compatta automaticamente il contesto vicino alla finestra configurata da «Compatta le chat Claude a (token)», default 200 000.',
        'Claude automatically compacts context near the window configured by "Compact Claude chats at (tokens)", default 200,000.'),
    ],
    analogy: b('Come il contachilometri con la spia della riserva: ti avvisa, ma l’auto non si spegne da sola.',
      'Like a fuel gauge with the reserve light: it warns you, but the car does not switch itself off.'),
    tech: [
      tech(FILES, 'Spesa di Claude da <brain>/ops/tools/cost.mjs ogni 3 minuti; stato degli avvisi in budget-state.json.', 'Claude spend from <brain>/ops/tools/cost.mjs every 3 minutes; alert state in budget-state.json.'),
      tech(DATA, 'Costo = (input·prezzo + scritture cache + letture cache + output·prezzo) / 1e6, con fascia per prompt lunghi.', 'Cost = (input·price + cache writes + cache reads + output·price) / 1e6, with a long-prompt tier.'),
    ],
    target: [
      // src/shared/contract.ts budget 'ask' mode; nothing subscribes to the alert
      b('La modalità «chiedi» dei limiti (fermare o continuare?) è descritta ma oggi aggiunge solo una nota all’avviso.',
        'The limits’ "ask" mode (stop or continue?) is described but today only adds a note to the alert.'),
    ],
    sources: ['src/renderer/components/UsageBar.tsx', 'src/main/chats/live-cost.ts', 'src/main/brain/budget.ts', 'src/main/brain/usage.ts', 'src/main/brain/settings-schema.ts'],
  },
  {
    id: 'mcp-servers',
    title: b('Connettori e server MCP', 'Connectors and MCP servers'),
    summary: b('In Impostazioni → Connettori aggiungi una volta i server MCP: l’app li dà a Claude, Cursor e Codex, con i token cifrati e i limiti di ogni agente.',
      'In Settings → Connectors you add MCP servers once: the app gives them to Claude, Cursor and Codex, with encrypted tokens and each agent’s limits.'),
    points: [
      // src/renderer/components/ConnectorsHub.tsx; src/modules/onboarding/AppScreen.tsx
      b('Una sola sezione: gli account dell’app (Azure DevOps, GitHub, Jira) e i server MCP come schede, ognuna con stato, uso, strumenti, ruoli e un solo «Prova».',
        'One section: the app’s accounts (Azure DevOps, GitHub, Jira) and the MCP servers as cards, each with state, use, tools, roles and one "Prova".'),
      // src/main/mcp-servers/store.ts
      b('Un server è locale (un comando, es. npx) o remoto (un indirizzo https); il token si scrive una volta, viene cifrato sul computer e poi si vede solo mascherato.',
        'A server is local (a command, e.g. npx) or remote (an https address); the token is typed once, encrypted on the computer and then shown only masked.'),
      // src/main/mcp-servers/service.ts test()
      b('«Prova» apre il server come farebbe una chat, elenca i suoi strumenti (lettura o scrittura) e, se non va, dice l’errore e come sistemarlo.',
        '"Prova" opens the server as a chat would, lists its tools (read or write) and, when it fails, says the error and how to fix it.'),
      // src/main/mcp-servers/gateway.ts
      b('Le chat raggiungono i server solo attraverso l’app (127.0.0.1): il token resta nell’app, mai nei file di configurazione dei motori.',
        'Chats reach the servers only through the app (127.0.0.1): the token stays in the app, never in the engines’ config files.'),
      // src/shared/mcp-servers.ts chainAllows; src/renderer/components/AgentMcpSection.tsx
      b('Ogni agente può usare tutti i server; dal retro della sua scheda lo restringi per server: tutto, solo lettura, strumenti scelti o niente.',
        'Every agent may use every server; from the back of its card you narrow it per server: everything, read only, chosen tools or nothing.'),
      b('Un lavoratore non ha mai più accesso della chat che l’ha avviato, e una modifica vale subito anche per le chat aperte.',
        'A worker never has more access than the chat that started it, and a change applies at once to open chats too.'),
      // src/main/mcp-servers/import.ts
      b('«Importa da Claude e Cursor» legge le loro configurazioni senza cambiarle e senza copiare i segreti: i token li reinserisci tu.',
        '"Importa da Claude e Cursor" reads their configs without changing them and without copying secrets: you type the tokens again.'),
    ],
    analogy: b('Come un portiere d’albergo che tiene le chiavi: gli ospiti chiedono a lui di aprire, e lui apre solo le stanze del loro piano.',
      'Like a hotel concierge who keeps the keys: guests ask him to open a door, and he opens only the rooms on their floor.'),
    diagram: { kind: 'flow', steps: [b('Chat dell’agente', 'Agent’s chat'), b('Gateway dell’app', 'App gateway'), b('Accesso del ruolo', 'Role access'), b('Server MCP', 'MCP server')] },
    tech: [
      tech(FILES, 'userData/mcp-servers.json (server, accesso per ruolo, ultima prova) e mcp-secrets.json (token cifrati con safeStorage).',
        'userData/mcp-servers.json (servers, per-role access, last test) and mcp-secrets.json (tokens encrypted with safeStorage).'),
      tech(WHERE, '/mcp/ext/<chat>/<server>/<token>; Claude con --mcp-config, Cursor in ACP session/new, Codex con -c mcp_servers.<id>.url.',
        '/mcp/ext/<chat>/<server>/<token>; Claude via --mcp-config, Cursor in ACP session/new, Codex via -c mcp_servers.<id>.url.'),
      tech(DATA, 'Accesso per ruolo e server: all, read, none o un elenco di strumenti; assente = all. «Lettura» = annotations.readOnlyHint.',
        'Access per role and server: all, read, none or a list of tools; absent = all. "Read" = annotations.readOnlyHint.'),
    ],
    target: [
      b('I server che chiedono un accesso OAuth nel browser e quelli solo SSE (vecchio trasporto) non sono ancora supportati.',
        'Servers that need an OAuth sign-in in the browser and SSE-only ones (old transport) are not supported yet.'),
    ],
    sources: ['src/main/mcp-servers/store.ts', 'src/main/mcp-servers/gateway.ts', 'src/main/mcp-servers/service.ts', 'src/main/mcp-servers/import.ts', 'src/shared/mcp-servers.ts',
      'src/renderer/components/ConnectorsHub.tsx', 'src/renderer/components/AgentMcpSection.tsx', 'docs/adr/0086-app-managed-mcp-servers.md'],
  },
  {
    id: 'updates',
    title: b('Aggiornamenti', 'Updates'),
    summary: b('Tu usi una copia stabile e congelata. «Aggiorna» in Impostazioni → Aggiornamenti la porta all’ultima versione con un clic.',
      'You use a frozen stable copy. "Aggiorna" in Settings → Updates brings it to the latest version with one click.'),
    points: [
      // ADR 0007; scripts/release.mjs
      b('Stabile = una release congelata in %LOCALAPPDATA%/second-brain/releases; dev = tutto ciò che parte dal repo, con dati separati.',
        'Stable = a frozen release in %LOCALAPPDATA%/second-brain/releases; dev = anything run from the repo, with separate data.'),
      b('npm run promote accetta solo main pulito, esegue tutti i controlli e copia la build in una release mai sovrascritta.',
        'npm run promote accepts only a clean main, runs all checks and copies the build into a release that is never overwritten.'),
      b('Se la finestra nuova non compare entro 30 secondi la release è segnata come guasta e riparte la precedente.',
        'If the new window does not appear within 30 seconds the release is marked bad and the previous one starts.'),
      // src/main/update/download.ts; src/main/index.ts (45 s)
      b('Nella versione Windows installata, 45 secondi dopo l’avvio l’app cerca l’ultima release su GitHub, la scarica e verifica gli sha256.',
        'In the installed Windows version, 45 seconds after start the app looks for the latest release on GitHub, downloads it and checks the sha256s.'),
      // src/main/update/wiring.ts RESTART_LIFECYCLE_VERIFIED = false: the ready package says it cannot be applied yet
      b('Quando il pacchetto è pronto lo vedi in «Aggiornamenti»: scaricato e preparato, ma non installato (l’applicazione automatica è spenta).',
        'When the package is ready you see it in "Updates": downloaded and prepared, but not installed (automatic apply is switched off).'),
      // ADR 0075; src/main/update/source.ts, src/renderer/components/AppUpdateSettings.tsx
      b('«Aggiorna» in Impostazioni → Aggiornamenti conta cosa c’è di nuovo su GitHub, poi scarica (solo avanzamento rapido), ricostruisce e riavvia sull’ultima versione, senza la suite di test.',
        '"Aggiorna" in Settings → Updates counts what is new on GitHub, then downloads it (fast-forward only), rebuilds and restarts on the latest version, without the test suite.'),
      // ADR 0074; src/main/appctl/tools.ts app_update_code
      b('Puoi anche chiedere all’Orchestrator «aggiornati»: porta la cartella del codice all’ultima versione, ma passarci resta il tuo clic su «Aggiorna».',
        'You can also ask the Orchestrator to "update": it brings the code folder to the latest version, but switching to it stays your click on "Aggiorna".'),
    ],
    analogy: b('Come il cambio di una gomma con la ruota di scorta pronta: se la nuova non tiene, rimetti quella di prima.',
      'Like changing a tyre with the spare ready: if the new one does not hold, you put the old one back.'),
    diagram: { kind: 'flow', steps: [b('Release su GitHub', 'Release on GitHub'), b('Scarica e verifica', 'Download and verify'), b('Pacchetto preparato', 'Prepared package'), b('Installa: non ancora', 'Install: not yet')] },
    tech: [
      tech(FILES, 'current.json (current, previous, bad), launch.cmd; userData second-brain (stabile, MCP 4319) e second-brain-dev (dev, MCP 4329).',
        'current.json (current, previous, bad), launch.cmd; userData second-brain (stable, MCP 4319) and second-brain-dev (dev, MCP 4329).'),
      tech(LIMITS, 'JSON della release ≤ 2 MB, zip ≤ 1,5 GB, cache ≤ 4 GB; checkpoint ≤ 8 MB.', 'Release JSON ≤ 2 MB, zip ≤ 1.5 GB, cache ≤ 4 GB; checkpoint ≤ 8 MB.'),
    ],
    target: [
      // src/main/update/wiring.ts RESTART_LIFECYCLE_VERIFIED = false; src/main/update/checkpoint.ts
      b('Installare il pacchetto preparato e riavviare (checkpoint di bozze e preferenze, poi ripristino automatico se fallisce): il codice c’è ma è spento finché il riavvio non è verificato.',
        'Installing the prepared package and restarting (checkpoint of drafts and preferences, then automatic rollback on failure): the code is there but switched off until the restart is verified.'),
    ],
    sources: ['scripts/release.mjs', 'scripts/pull.mjs', 'src/main/update/source.ts', 'src/renderer/components/AppUpdateSettings.tsx', 'src/main/update/download.ts', 'src/main/update/wiring.ts', 'src/main/update/checkpoint.ts', 'docs/adr/0007-self-hosting.md', 'docs/adr/0075-update-button-without-tests.md'],
  },
  {
    id: 'maintenance',
    title: b('La manutenzione del brain', 'Brain maintenance'),
    summary: b('Solo quando premi «Manutenzione»: un clic, l’app riordina skill, regole e memoria e un agente invisibile propone miglioramenti come carte; ogni cambio ha un perché e un «Annulla».',
      'Only when you press "Manutenzione": one click, the app tidies skills, rules and memory and an invisible agent proposes improvements as cards; every change has a reason and an "Undo".'),
    points: [
      // src/main/brainmodel/service.ts start(), brainmodel/research.ts runAll (ADR 0153)
      b('Parte solo dal tuo clic, mai da sola: la pulizia non spende token (lavoro sul testo fatto sul tuo PC), poi la ricerca usa il modello più forte con un tetto di 5 $ e ti avvisa quando finisce. Le idee sull’app vanno in Idee (lato IA) e ogni idea o bug diventa una carta «Apro la issue?» che, con il tuo sì, apre la issue su GitHub.',
        'It starts only from your click, never by itself: the cleanup spends no tokens (text work on your PC), then the research uses the strongest model with a 5 $ cap and gives you a notice when it ends. Ideas about the app go to Ideas (the AI’s side) and every idea or bug becomes a card "Open the issue?" that, with your yes, opens it on GitHub.'),
      // src/main/brainmodel/jobs.ts repeated-task, merge-skills
      b('Se tre o più lavori finiti chiedono la stessa cosa e nessuna skill la copre, scrive una skill nuova; due skill quasi uguali diventano una.',
        'When three or more finished jobs ask the same thing and no skill covers it, it writes a new skill; two near-identical skills become one.'),
      // src/main/brainmodel/jobs.ts corrections, merge-memory
      b('Le lezioni imparate dalle tue correzioni vanno nel testo del ruolo, in una skill o nelle regole del brain; la stessa riga in più memorie va una volta sola nella memoria condivisa.',
        'Lessons learnt from your corrections go to the role’s text, a skill or the brain’s rules; the same line in several memories goes once into the shared memory.'),
      // src/main/agents/pack/lesson-evidence.ts (causal: false), brainmodel/evidence.ts lessonCounts (ADR 0186)
      b('Le prove di una lezione citano run con esito verificato, ma non misurano se la lezione ha aiutato: non sono mai causali. Memoria → Apprendimento dice quante lezioni sono state proposte nelle ultime 12 settimane e come sono finite, oppure «Nessun dato».',
        'A lesson’s evidence cites runs with a verified outcome, but does not measure whether the lesson helped: it is never causal. Memory → Apprendimento says how many lessons were proposed in the last 12 weeks and how they ended, or "No data".'),
      // src/main/brainmodel/jobs.ts migration
      b('Una volta sola, i vecchi runbook e le sezioni «routines» del brain diventano skill, con un resoconto di dove è finito ciascuno.',
        'Once, the brain’s old runbooks and "routines" sections become skills, with a report of where each one went.'),
      // src/main/brainmodel/upgrade.ts, src/shared/brain-layout.ts
      b('Con una nuova versione, il brain si mette in pari da solo: l’app descrive dove tiene ogni tipo di contenuto e ciò che nelle note ora ha un suo posto ci viene spostato, con un rimando dove stava: uno script in scripts/, una query SQL o KQL in queries/ (Memoria → Script & Query), un’idea («Idea:», «💡», le voci sotto «## Idee») in ideas.md con la nota da cui viene, la data e se era tua o dell’IA. Un agente senza strumenti decide solo quando c’è qualcosa da spostare.',
        'With a new version the brain catches up by itself: the app describes where it keeps each kind of content, and what in the notes now has a place of its own moves there, with a pointer where it was: a script to scripts/, an SQL or KQL query to queries/ (Memory → Script & Query), an idea ("Idea:", "💡", the items under "## Ideas") to ideas.md with the note it came from, the date and whether it was yours or the AI’s. An agent with no tools decides only when there is something to move.'),
      // src/main/brainmodel/changes.ts rollback
      b('Ogni cambio finisce nel registro con cosa, perché e le prove; «Annulla» rimette il testo di prima, ma solo se nessuno l’ha cambiato dopo. Un cambio annullato non viene rifatto.',
        'Every change goes to the log with what, why and the evidence; "Undo" puts the earlier text back, but only if nobody changed it since. An undone change is not made again.'),
      // src/main/brainmodel/jobs.ts header: what stays with the user
      b('Non tocca mai da sola permessi, strumenti, motore, livello di modello o limiti di un ruolo: quelli diventano una carta in Memoria → Proposte.',
        'It never changes a role’s permissions, tools, engine, model tier or limits by itself: those become a card in Memory → Proposals.'),
    ],
    analogy: b('Come chi riordina l’archivio quando glielo chiedi: unisce i doppioni, scrive le schede che mancano e lascia un biglietto per ogni cosa spostata, così la rimetti a posto se non ti piace.',
      'Like someone who tidies the archive when you ask: merges duplicates, writes the missing cards and leaves a note for everything moved, so you can put it back if you do not like it.'),
    diagram: { kind: 'cycle', steps: [b('Lavori finiti', 'Finished jobs'), b('Manutenzione', 'Maintenance'), b('Cambio con perché', 'Change with a reason'), b('Annulla se serve', 'Undo if needed')] },
    tech: [
      tech(DATA, 'BrainChange { id, at, job, kind: skill | agent | rule | memory, action, target, summary, reason, evidence, rolledBackAt?, canRollback }.',
        'BrainChange { id, at, job, kind: skill | agent | rule | memory, action, target, summary, reason, evidence, rolledBackAt?, canRollback }.'),
      tech(FILES, 'userData/brain-changes.json: ultimi 400 cambi, istantanee prima/dopo fino a 256 KB ciascuna.', 'userData/brain-changes.json: last 400 changes, before/after snapshots up to 256 KB each.'),
      tech(LIMITS, 'Lavori: migration, upgrade, corrections, repeated-task, merge-skills, merge-memory; solo al clic su «Manutenzione», la migrazione un minuto dopo l’avvio.', 'Jobs: migration, upgrade, corrections, repeated-task, merge-skills, merge-memory; only on a «Manutenzione» click, the migration a minute after start.'),
    ],
    sources: ['src/main/brainmodel/jobs.ts', 'src/main/brainmodel/upgrade.ts', 'src/shared/brain-layout.ts', 'src/main/brain/queries.ts', 'src/main/brainmodel/changes.ts', 'src/main/brainmodel/service.ts', 'src/shared/brain-model.ts', 'src/renderer/components/brain-model/MaintenanceButton.tsx'],
  },
  {
    id: 'proposals',
    title: b('Memoria → Proposte', 'Memory → Proposals'),
    summary: b('Tutto quello che l’app propone e aspetta il tuo sì è una carta in un solo mazzo: una alla volta, approvi o rifiuti.',
      'Everything the app proposes and that waits for your yes is a card in a single deck: one at a time, you approve or reject.'),
    points: [
      // ADR 0123; src/main/proposals/sources.ts (SOURCES), src/main/proposals/service.ts, src/renderer/components/brain-model/ProposalsDeck.tsx, src/renderer/lib/proposals.ts
      b('Il mazzo raccoglie fatti di memoria proposti, skill candidate, richieste di impostazioni degli agenti, livelli e prove dei ruoli, regole del Battito, politiche dell’auto-miglioramento e i cambi che la manutenzione ha già fatto negli ultimi 14 giorni.',
        'The deck gathers proposed memory facts, skill candidates, the agents’ setting requests, the roles’ tiers and trials, the Battito’s rules, the self-improvement policies and the changes the maintenance already made in the last 14 days.'),
      b('Ogni carta dice chi l’ha proposta, dove (chat e run), quando e con quali prove; la più recente sta in cima, i filtri sopra la dividono per gruppo.',
        'Every card says who proposed it, where (chat and run), when and with what evidence; the newest is on top, the filters above split it by group.'),
      b('Trascina a destra o premi ✓ (→) per approvare, a sinistra o ✕ (←) per rifiutare; Z o Ctrl+Z annulla l’ultima scelta finché non è partita, dopo circa 6 secondi o alla scelta seguente.',
        'Drag right or press ✓ (→) to approve, left or ✕ (←) to reject; Z or Ctrl+Z undoes the last choice until it is sent, after about 6 seconds or at the next choice.'),
      b('Un cambio già applicato si mostra «già applicato» con Tieni o Annulla: Annulla è il ripristino del registro dei cambi, Tieni lo toglie dal mazzo.',
        'A change already made shows as "already applied" with Keep or Undo: Undo is the change log’s rollback, Keep takes it off the deck.'),
      b('Ogni decisione passa dalla strada di sempre della sua fonte, e prima l’app ricontrolla che la carta sia ancora aperta; se la fonte rifiuta, la carta torna con il motivo.',
        'Every decision goes through its source’s usual path, and first the app checks again that the card is still open; if the source refuses, the card comes back with the reason.'),
      b('Una skill candidata si approva solo dopo aver aperto la bozza e le prove; le altre pagine non decidono più, rimandano qui. Il numero accanto a Memoria conta le carte aperte.',
        'A skill candidate can be approved only after opening its draft and evidence; the other pages no longer decide, they point here. The number beside Memory counts the open cards.'),
    ],
    analogy: b('Come la pila della posta sulla scrivania: una busta alla volta, la apri, decidi, passi alla prossima, finché la pila è vuota.',
      'Like the pile of mail on the desk: one envelope at a time, you open it, decide, move to the next, until the pile is empty.'),
    tech: [
      tech(DATA, 'Proposal { id `<fonte>:<id>`, source, group, applied, title, content, facts, provenance { who, chat?, runId?, files?, at, evidence }, canApprove, canReject, blocked?, readFirst? }.',
        'Proposal { id `<source>:<id>`, source, group, applied, title, content, facts, provenance { who, chat?, runId?, files?, at, evidence }, canApprove, canReject, blocked?, readFirst? }.'),
      tech(WHERE, 'IPC proposals:list, proposals:count, proposals:decide; evento proposals:changed { count }. I «Tieni» in userData/proposals-reviewed.json (60 giorni).',
        'IPC proposals:list, proposals:count, proposals:decide; event proposals:changed { count }. The "Keep" marks in userData/proposals-reviewed.json (60 days).'),
    ],
    sources: ['src/shared/proposals.ts', 'src/main/proposals/sources.ts', 'src/main/proposals/service.ts', 'src/renderer/lib/proposals.ts', 'src/renderer/components/brain-model/ProposalsDeck.tsx'],
  },
  {
    id: 'trials',
    title: b('Versioni in prova', 'Trial versions'),
    summary: b('Quello che l’app non cambia da sola diventa una proposta in Memoria → Proposte, con i numeri prima e dopo.',
      'What the app does not change by itself becomes a proposal in Memory → Proposals, with the numbers before and after.'),
    points: [
      // src/main/agents/lifecycle.ts header
      b('Testi e skill dei ruoli si aggiornano da soli; livello di modello, strumenti e permessi solo con il tuo sì, su una carta di Memoria → Proposte (la pagina Agenti rimanda lì).',
        'The roles’ texts and skills update by themselves; model tier, tools and permissions only with your yes, on a card of Memory → Proposals (the Agents page points there).'),
      // src/main/agents/trials.ts evaluateTrial
      b('Una versione in prova si confronta con la versione di prima sugli stessi lavori (stesso ruolo, stesse skill): fino a 21 giorni, servono almeno 5 lavori per parte.',
        'A trial version is compared with the version before on the same jobs (same role, same skills): up to 21 days, at least 5 jobs on each side.'),
      // src/main/agents/trials.ts: improved / safe
      b('Propone di tenerla solo se migliora qualcosa che conta (riuscita, correzioni, rifacimenti) senza costare, durare o chiedere molto di più; altrimenti propone di tornare indietro.',
        'It proposes keeping it only when something that matters improves (success, corrections, rework) without costing, lasting or asking much more; otherwise it proposes going back.'),
      // src/main/agents/trials.ts: coverage < 60%
      b('Se meno del 60% dei lavori ha un esito, aspetta: senza esiti non c’è niente da confrontare. Il tuo voto sulla striscia è ciò che riempie il confronto.',
        'When fewer than 60% of the jobs have an outcome, it waits: without outcomes there is nothing to compare. Your vote on the strip is what fills the comparison.'),
      // src/main/agents/suggestions.ts (tier rule); src/main/proposals/sources.ts (trial, tier)
      b('Ogni proposta dice perché, cosa cambia e i numeri con quanti lavori li sostengono; la decidi tu, o la chiudi.',
        'Every proposal says why, what changes and the numbers with how many jobs back them; you decide it, or dismiss it.'),
    ],
    analogy: b('Come provare una ricetta nuova accanto alla vecchia per tre settimane, sugli stessi piatti, e decidere solo quando hai assaggiato abbastanza.',
      'Like trying a new recipe beside the old one for three weeks, on the same dishes, and deciding only once you have tasted enough.'),
    tech: [
      tech(LIMITS, 'TRIAL_DAYS = 21 giorni; almeno 5 lavori comparabili per parte; copertura degli esiti ≥ 60%; successo −5 punti = ritorno; costo e tempo entro ×1,25.',
        'TRIAL_DAYS = 21 days; at least 5 comparable jobs per side; outcome coverage ≥ 60%; success −5 points = revert; cost and time within ×1.25.'),
      tech(FILES, 'userData/agent-lifecycle.json (le proposte); le versioni in role-history.json.', 'userData/agent-lifecycle.json (the proposals); the versions in role-history.json.'),
    ],
    sources: ['src/main/agents/trials.ts', 'src/main/agents/lifecycle.ts', 'src/main/agents/suggestions.ts', 'src/main/proposals/sources.ts'],
  },
  {
    id: 'auto-close',
    title: b('La chiusura automatica', 'Automatic close'),
    summary: b('Un agente che ha consegnato il rapporto e non lavora più si chiude da sé; chi aspetta qualcosa resta aperto e dice cosa.',
      'An agent that has delivered its report and no longer works closes by itself; one waiting for something stays open and says what.'),
    points: [
      // ADR 0084; src/main/chats/auto-close.ts
      b('Quando un ruolo di lavoro ha mandato il rapporto finale ed è fermo, dopo il tempo scelto in Impostazioni (di serie 2 minuti) la sua chat viene archiviata.',
        'When a work role has sent its final report and is idle, after the time chosen in Settings (2 minutes by default) its chat is archived.'),
      // src/main/chats/auto-close.ts AUTO_CLOSE_WARNING_MS
      b('Prima di chiudere mostra un avviso di 2 minuti sulla striscia: «Resta aperto» la ferma.',
        'Before closing it shows a 2-minute notice on the strip: "Keep open" (Resta aperto) stops it.'),
      // src/shared/auto-close.ts AutoCloseWaiting
      b('Resta aperta, con «In attesa di…», una chat che aspetta una tua risposta o un permesso, i colleghi, un comando, un lavoro in background o il suo rapporto.',
        'A chat waiting for your answer or a permission, colleagues, a command, background work or its own report stays open, with "Waiting for…".'),
      // src/main/chats/auto-close.ts: presence lease
      b('Chiude anche se non guardi l’avviso o la finestra è ridotta a icona, e dopo un riavvio dell’app; una bozza, una chat in primo piano o messaggi in coda la tengono aperta.',
        'It closes even if you do not look at the notice or the window is minimized, and after the app restarts; a draft, a chat in focus or queued messages keep it open.'),
      // src/renderer/components/AutoCloseNotice.tsx; the palette's "Chiuse"
      b('L’Orchestrator e le chat senza ruolo non si chiudono mai da sole; una chat chiusa resta nell’archivio e si riapre scrivendole.',
        'The Orchestrator and chats without a role never close by themselves; a closed chat stays in the archive and reopens when you write to it.'),
      // src/main/chats/manager.ts autoCloseCandidates (ADR 0111)
      b('Un albero di deleghe si chiude tutto insieme: le chat che hanno finito aspettano le altre, e il tempo parte quando ha finito l’ultima.',
        'A delegation tree closes as one: the chats that finished wait for the others, and the time starts when the last one finished.'),
      // src/renderer/components/SidebarTree.tsx
      b('Puoi chiudere una chat anche dalla barra laterale: passa sopra la sua riga e premi ✕ (6 secondi per Annulla).',
        'You can also close a chat from the sidebar: hover its row and press ✕ (6 seconds to undo).'),
    ],
    analogy: b('Come un collega che, consegnato il lavoro, sgombra la scrivania: ma se aspetta una tua firma resta lì, con il foglio in mano.',
      'Like a colleague who clears the desk after handing in the work: but when waiting for your signature, stays there, paper in hand.'),
    tech: [
      tech(LIMITS, 'Avviso AUTO_CLOSE_WARNING_MS = 120 s; presenza della finestra rinnovata ogni 15 s; tempo in Impostazioni (autoCloseMin, 0 = mai).',
        'Notice AUTO_CLOSE_WARNING_MS = 120 s; window presence renewed every 15 s; time in Settings (autoCloseMin, 0 = never).'),
      tech(DATA, 'AutoCloseStatus { chatId, deadline, warningStartedAt, keptOpen, reason, waitingFor? }; waitingFor: answer | permission | command | user | colleagues | work | report | mail | browser.',
        'AutoCloseStatus { chatId, deadline, warningStartedAt, keptOpen, reason, waitingFor? }; waitingFor: answer | permission | command | user | colleagues | work | report | mail | browser.'),
    ],
    sources: ['src/main/chats/auto-close.ts', 'src/shared/auto-close.ts', 'src/renderer/components/AutoCloseNotice.tsx', 'docs/adr/0084-finished-workers-close-by-themselves.md', 'docs/adr/0111-the-log-page.md', 'docs/adr/0134-finished-chats-close-by-default.md'],
  },
  {
    id: 'log',
    title: b('Il Log', 'The Log'),
    summary: b('Una pagina sola con tutto quello che l’app fa, in tempo reale e leggibile: ogni incarico passo per passo, i classificatori, le stime, gli errori e la memoria scritti nel brain, Battito.',
      'One page with everything the app does, live and readable: each task step by step, the classifiers, the estimates, the errors and memory written to the brain, Battito.'),
    points: [
      // src/main/activity/chat-watch.ts
      b('Ogni incarico è una catena: chi ha scelto quale agente e perché, il suo lavoro con costo, strumenti ed errori, il risultato, la verifica (o «non effettuata»).',
        'Each task is a chain: who chose which agent and why, its work with cost, tools and errors, the result, the verification (or "not done").'),
      // src/renderer/lib/log-view.ts flagsOf
      b('Regole dell’app segnalano da sole le anomalie: risposta duplicata, approvazione nascosta (un permesso chiuso senza la tua risposta), revisione senza verdetto.',
        'App rules flag anomalies by themselves: a duplicate reply, a hidden approval (a permission closed without your answer), a review without a verdict.'),
      // src/main/activity/journal.ts
      b('Leggerlo non consuma token: sono eventi e contatori salvati dall’app. Solo «Fai analizzare all’IA» prepara un messaggio per l’Orchestrator, che parte se lo invii tu.',
        'Reading it spends no tokens: these are events and counters the app saved. Only "Fai analizzare all’IA" prepares a message for the Orchestrator, sent only if you send it.'),
      // src/main/activity/journal.ts clean
      b('Si pulisce da solo: tiene 7 giorni e al massimo 20 MB, il resto si cancella.',
        'It cleans itself: it keeps 7 days and at most 20 MB, the rest is deleted.'),
    ],
    analogy: b('Come la scatola nera di un aereo, ma scritta in italiano e da leggere mentre voli.',
      'Like a plane’s black box, but written in plain words and readable while you fly.'),
    tech: [
      tech(FILES, 'userData/activity/log-AAAA-MM-GG.jsonl, una riga JSON per evento, segreti oscurati.', 'userData/activity/log-YYYY-MM-DD.jsonl, one JSON line per event, secrets redacted.'),
      tech(WHERE, 'IPC log:list (gli ultimi 3000 eventi) ed evento log:events (in diretta); pagina G N.', 'IPC log:list (the last 3000 events) and event log:events (live); page G N.'),
      tech(LIMITS, '7 giorni, 20 MB in tutto, 2000 caratteri per campo.', '7 days, 20 MB in all, 2000 characters per field.'),
    ],
    sources: ['src/main/activity/journal.ts', 'src/main/activity/chat-watch.ts', 'src/main/activity/wiring.ts', 'src/renderer/components/LogPage.tsx', 'src/renderer/lib/log-view.ts', 'docs/adr/0111-the-log-page.md', 'docs/adr/0134-finished-chats-close-by-default.md'],
  },
  {
    id: 'impara',
    title: b('Impara: lezioni a pezzi', 'Impara: lessons piece by piece'),
    summary: b('Una lezione su una tua PR, un argomento (anche il tuo lavoro, il tuo brain o l’app) o un testo: prima la ricerca e la verifica delle fonti, poi lo schema che si muove mentre la voce spiega, tu vai avanti quando hai capito.',
      'A lesson on one of your PRs, a topic (your work, your brain or the app too) or a text: first the sources are researched and checked, then the diagram moves while the voice explains, you go on when you got it.'),
    points: [
      // src/main/learn/material.ts
      b('Per una PR l’app legge da sola descrizione e diff (gh per GitHub, git nella copia locale per le PR del Task), in sola lettura e con il tuo login.',
        'For a PR the app itself reads the description and the diff (gh for GitHub, git in the local clone for the Task page’s PRs), read-only, with your own login.'),
      // src/main/learn/service.ts research
      b('Prima di spiegare cerca le fonti: sul web (solo Claude, vede solo la tua domanda, mai i tuoi file) e nei file (il materiale, il tuo brain, la guida e il codice dell’app). Un secondo modello verifica ogni fatto sulla sua fonte: confermato, corretto o da verificare.',
        'Before explaining it looks for sources: on the web (Claude only, it sees only your question, never your files) and in the files (the material, your brain, the app’s guide and code). A second model checks each fact against its source: confirmed, corrected or unconfirmed.'),
      b('Se la domanda può voler dire cose diverse, ti chiede al massimo due cose prima di iniziare. Ogni pezzo mostra le sue fonti; «Fonti» in alto le raccoglie tutte (pagine web e file del PC, apribili con un clic).',
        'If the question can mean different things, it asks you at most two things before starting. Each piece shows its sources; «Sources» at the top gathers them all (web pages and files on your PC, opened with one click).'),
      // src/renderer/components/impara/TeacherChip.tsx
      b('«Chi spiega» sceglie motore, modello e impegno; senza scelta Claude con il modello più forte, impegno alto.',
        '«Who explains» picks the engine, model and effort; with no choice, Claude with its strongest model, high effort.'),
      // src/renderer/components/impara/LessonStage.tsx
      b('La lezione è a tutto schermo (Esc per uscire). Lo schema si muove frase per frase: si accendono i nodi di cui parla, una luce corre lungo la freccia, «Qui» indica il punto. Quelli già visti restano calmi, quelli che verranno sono sbiaditi.',
        'The lesson is full screen (Esc to leave). The diagram moves sentence by sentence: the nodes it talks about light up, a light runs along the arrow, «Here» marks the spot. Seen ones stay calm, coming ones are faint.'),
      b('«Spiegamelo meglio», «Fammi un esempio», «Mostrami il codice» e le tue domande aggiungono un pezzo subito dopo. Con «Rispondo a voce» dici «avanti», «ripeti», «non ho capito», «la b».',
        '«Explain it better», «Give me an example», «Show me the code» and your questions add a piece right after. With «I answer by voice» you say «next», «repeat», «I don’t understand», «b».'),
      // src/main/learn/store.ts
      b('Verifiche dopo alcuni pezzi, «Spiegalo tu» alla fine. Ogni lezione resta salvata su questo PC e riapre dal punto in cui eri.',
        'Checks after some pieces, «Explain it yourself» at the end. Every lesson stays saved on this PC and reopens where you were.'),
      // src/shared/review.ts, src/renderer/components/impara/ImparaReview.tsx
      b('Ogni lezione ha una materia e lascia carte di ripasso: le sue verifiche e altre scritte solo dai fatti verificati. «Ripassa ora» e il «Quiz» di ogni materia le ripropongono quando stai per dimenticarle (FSRS); la percentuale è una stima, non un voto.',
        'Every lesson has a subject and leaves review cards: its checks and others written only from the verified facts. «Review now» and each subject’s «Quiz» bring them back when you are about to forget them (FSRS); the percentage is an estimate, not a score.'),
    ],
    analogy: b('Come un collega che prima si documenta, poi ti spiega alla lavagna indicando il punto giusto mentre parla.',
      'Like a colleague who reads up first, then explains at the whiteboard pointing at the right spot while talking.'),
    tech: [
      tech(FILES, 'userData/learn/<id>/: lesson.json (lezione, fatti verificati, risposte, punto in cui sei), il materiale (materiale.md, diff.patch, testo.md) e guida-app.md.', 'userData/learn/<id>/: lesson.json (lesson, verified facts, answers, where you are), the material (materiale.md, diff.patch, testo.md) and guida-app.md.'),
      tech(WHERE, 'Pagina G X; IPC impara:* (impara:clarify per le risposte alle domande); ogni risposta del modello è una sessione nascosta in sola lettura; la ricerca web è l’unica con WebSearch/WebFetch e nessuno strumento sui file.', 'Page G X; IPC impara:* (impara:clarify for the answers to the questions); each model answer is a hidden read-only session; the web research is the only one with WebSearch/WebFetch and no file tool.'),
      tech(LIMITS, 'Al massimo 24 fatti per ricerca, 2 domande, 6 battute per pezzo; schema di 4-10 nodi; etichette mai oltre 1,2× e schema intero quando si legge almeno all’80%.', 'At most 24 facts per research, 2 questions, 6 beats per piece; a 4-10 node diagram; labels never past 1.2× and the whole diagram whenever it reads at 80% or more.'),
    ],
    sources: ['src/shared/lesson.ts', 'src/main/learn/service.ts', 'src/main/learn/prompt.ts', 'src/main/compare/headless.ts', 'src/renderer/components/impara/LessonStage.tsx', 'src/renderer/components/impara/ImparaSources.tsx', 'src/renderer/components/impara/ImparaPlayer.tsx', 'docs/adr/0185-impara-lessons.md', 'docs/adr/0188-impara-research-and-animated-board.md', 'src/shared/review.ts', 'docs/adr/0189-impara-subjects-and-spaced-review.md'],
  },
  {
    id: 'held-news',
    title: b('Le novità trattenute', 'Held news'),
    summary: b('«N novità in attesa»: notizie dei lavori che l’app non ha ancora passato all’Orchestrator, e perché.',
      '"N news waiting": news from the jobs the app has not passed to the Orchestrator yet, and why.'),
    points: [
      // src/main/chats/orchestrator-delivery.ts
      b('Un lavoro che finisce, fallisce, chiede qualcosa o scrive all’Orchestrator produce una notizia; l’app la consegna all’Orchestrator, ma non sempre subito.',
        'A job that finishes, fails, asks something or writes to the Orchestrator makes a piece of news; the app delivers it to the Orchestrator, but not always at once.'),
      // src/main/chats/orchestrator-delivery.ts ORCHESTRATOR_GROUP_MS
      b('La trattiene mentre l’Orchestrator aspetta te, la raggruppa per 30 secondi con le altre in arrivo, o fa viaggiare le notizie tranquille con la prossima consegna: così l’Orchestrator non viene svegliato a ogni riga.',
        'It holds it while the Orchestrator waits for you, groups it for 30 seconds with the others arriving, or lets quiet news ride along with the next delivery: so the Orchestrator is not woken at every line.'),
      // src/renderer/components/HeldNews.tsx
      b('Sulla colonna dell’Orchestrator vedi quante sono; un clic le elenca (chat, tipo, da quando, perché aspetta) e una riga apre la sua chat.',
        'On the Orchestrator’s column you see how many there are; a click lists them (chat, kind, since when, why it waits) and a row opens its chat.'),
      // src/main/chats/held-news.ts seen; src/main/chats/orchestrator-wake.ts seen (#123)
      b('Una riga che apri è letta: esce dall’elenco e non sveglia più l’Orchestrator, che la riceve solo insieme alla prossima consegna. Guardare l’elenco non spende nulla.',
        'A row you open is read: it leaves the list and no longer wakes the Orchestrator, which gets it only with the next delivery. Looking at the list spends nothing.'),
      // src/main/chats/manager.ts releaseResult; src/shared/sys.ts resultReady (#123)
      b('Quando un ruolo che l’Orchestrator ha aperto per la tua domanda ha la risposta, nella chat dell’Orchestrator compare un avviso verde con il riassunto e «Apri»: nessun turno in più dell’Orchestrator.',
        'When a role the Orchestrator opened for your question has the answer, a green notice with the summary and "Open" shows in the Orchestrator’s chat: no extra Orchestrator turn.'),
    ],
    analogy: b('Come la posta che la segreteria tiene da parte mentre sei in riunione: non si perde, arriva tutta insieme quando esci.',
      'Like the mail the front desk keeps aside while you are in a meeting: nothing is lost, it all arrives together when you come out.'),
    tech: [
      tech(LIMITS, 'Raggruppamento ORCHESTRATOR_GROUP_MS = 30 s.', 'Grouping ORCHESTRATOR_GROUP_MS = 30 s.'),
      tech(WHERE, 'Code: OrchestratorWake (notizie dei lavori) e ChatMail (posta); lette da HeldNewsHub (IPC orchestrator:held).', 'Queues: OrchestratorWake (job news) and ChatMail (mail); read by HeldNewsHub (IPC orchestrator:held).'),
    ],
    sources: ['src/main/chats/held-news.ts', 'src/main/chats/orchestrator-delivery.ts', 'src/main/chats/orchestrator-wake.ts', 'src/main/chats/manager.ts', 'src/shared/sys.ts', 'src/renderer/components/HeldNews.tsx'],
  },
  {
    id: 'context',
    title: b('Il contesto e il passaggio di una chat lunga', 'Context and hand-off of a long chat'),
    summary: b('Una chat rilegge tutta la sua storia a ogni passo: più è lunga, più costa. L’app la riassume o la fa ripartire da un passaggio di consegne.',
      'A chat re-reads its whole history at every step: the longer, the costlier. The app summarises it or restarts it from a hand-off note.'),
    points: [
      // src/shared/context.ts NEAR_COMPACTION; src/renderer/components/ContextBar.tsx
      b('La barra del contesto sulla striscia diventa ambra quando la chat è vicina al suo limite (l’80% della finestra; per Cursor la soglia in Impostazioni, di serie 200k token).',
        'The context bar on the strip turns amber when the chat is near its limit (80% of the window; for Cursor the threshold in Settings, 200k tokens by default).'),
      // src/main/chats/continuity.ts compact
      b('Una chat Claude al limite si riassume da sola nella stessa sessione; l’Orchestrator anche una volta al giorno nuovo.',
        'A Claude chat at its limit summarises itself in the same session; the Orchestrator also once on each new day.'),
      // src/main/chats/continuity.ts fresh session (coldHandoffMin)
      b('Una chat di lavoro ferma da tempo (di serie 50 minuti) scrive una nota mentre la sua memoria temporanea è ancora calda; il tuo messaggio dopo riparte da quella nota, invece di rileggere tutto.',
        'A work chat idle for a while (50 minutes by default) writes a note while its short-term cache is still warm; your next message starts from that note instead of re-reading everything.'),
      // src/main/chats/handoff.ts handoffRequest; «Riprendi»
      b('«Riprendi in chat nuova» chiede alla chat un passaggio di consegne (stato, file, decisioni, cosa è stato provato, prossimo passo) e apre una chat nuova che parte da lì.',
        '"Resume" asks the chat for a hand-off note (state, files, decisions, what was tried, next step) and opens a new chat that starts from it.'),
      // src/main/chats/handoff.ts: token-free fallback note
      b('Se la chat non può rispondere, l’app scrive la nota da ciò che ha visto (file, comandi, ultimi messaggi) e lo dice.',
        'When the chat cannot answer, the app writes the note from what it saw (files, commands, last messages) and says so.'),
    ],
    analogy: b('Come cambiare turno in reparto: invece di rileggere tutto il diario, chi arriva legge la pagina di consegne.',
      'Like a shift change on a ward: instead of re-reading the whole log, whoever arrives reads the hand-over page.'),
    tech: [
      tech(LIMITS, 'Ambra all’80% della finestra (NEAR_COMPACTION); contextWarnTokens = 200 000; coldHandoffMin = 50; nota al massimo 6000 caratteri.',
        'Amber at 80% of the window (NEAR_COMPACTION); contextWarnTokens = 200,000; coldHandoffMin = 50; note at most 6000 chars.'),
      tech(FILES, 'userData/handoffs/<chatId>.md.', 'userData/handoffs/<chatId>.md.'),
    ],
    sources: ['src/shared/context.ts', 'src/main/chats/continuity.ts', 'src/main/chats/handoff.ts', 'src/renderer/components/ContextBar.tsx'],
  },
  {
    id: 'quality',
    title: b('La pagina Qualità', 'The Quality page'),
    summary: b('Quattro numeri su come lavora l’IA, ciascuno con la sua fonte, i giorni che copre e il prossimo passo.',
      'Four numbers on how the AI works, each with its source, the days it covers and the next step.'),
    points: [
      // src/renderer/brain/pages/Qualita.tsx 1)
      b('Errori che hai dovuto trovare tu ogni 100 turni: le righe di ai-errors.md «visto da» te, divise per i turni finiti nell’app negli stessi giorni.',
        'Errors you had to catch yourself per 100 turns: the ai-errors.md rows "seen by" you, divided by the turns finished in the app on the same days.'),
      // Qualita.tsx 2); ADR 0024
      b('Regole che hanno funzionato: per ogni regola nata da un errore, se lo stesso tipo di errore è tornato entro 14 giorni. Una regola giovane è «troppo presto».',
        'Rules that worked: for each rule born from an error, whether the same kind of error came back within 14 days. A young rule is "too early".'),
      // Qualita.tsx 3) 4); src/main/brain/quality.ts
      b('PR ferme per una build o un QA fallito, e bug risolti che sono tornati aperti (da Azure DevOps, in sola lettura).',
        'PRs held by a failed build or QA, and resolved bugs sent back to open (from Azure DevOps, read only).'),
      // Qualita.tsx: patterns (ADR 0037)
      b('Sotto i numeri, gli errori che si ripetono raggruppati per tipo, con questa settimana contro la precedente.',
        'Under the numbers, the errors that repeat grouped by kind, with this week against the one before.'),
      // Qualita.tsx header: each number has its reading
      b('Ogni numero dice da dove viene e su quanti casi; quando i casi sono pochi lo dice invece di mostrare una percentuale.',
        'Every number says where it comes from and on how many cases; when the cases are few it says so instead of showing a percentage.'),
    ],
    analogy: b('Come il cruscotto di un’officina che conta i resi dei clienti, non i complimenti: pochi numeri, tutti verificabili.',
      'Like a workshop’s dashboard that counts the customers’ returns, not the compliments: few numbers, all checkable.'),
    tech: [
      tech(FILES, 'ai-errors.md nel brain; turni dai log dell’app (14 giorni); bug riaperti da ops/tools/bug-reopen.mjs, al massimo ogni 12 h.', 'ai-errors.md in the brain; turns from the app’s logs (14 days); reopened bugs from ops/tools/bug-reopen.mjs, at most every 12 h.'),
      tech(WHERE, 'Pagina Qualità (sidebar → Andamento, o G Q); dati da /api/tables e /api/quality.', 'Quality page (sidebar → Trends, or G Q); data from /api/tables and /api/quality.'),
    ],
    sources: ['src/renderer/brain/pages/Qualita.tsx', 'src/main/brain/quality.ts', 'src/renderer/brain/lib/quality.ts'],
  },
  {
    id: 'flash',
    title: b('Flash, la domanda al volo',
      'Flash, the quick side question'),
    summary: b('Accanto all’Orchestrator, Flash risponde in pochi secondi a domande e spiegazioni sul lavoro in corso, in sola lettura, senza disturbare nessuno.',
      'Next to the Orchestrator, Flash answers questions and explanations about the work in progress in seconds, read only, without disturbing anyone.'),
    points: [
      // src/shared/roles.ts FLASH_ID; src/renderer/components/LampoTile.tsx
      b('Flash è la scheda accanto all’Orchestrator nella colonna di destra: è un agente con la sua carta in Agenti, mai un ruolo di lavoro e mai delegato.',
        'Flash is the tab next to the Orchestrator in the right column: an agent with its own card in Agents, never a work role and never delegated.'),
      // src/main/chats/lampo-context.ts (ADR 0106)
      b('A ogni tua domanda riceve ciò che è successo nella chat dell’Orchestrator dall’ultima volta, così risponde sul lavoro in corso senza chiederti il contesto. L’Orchestrator non sa nulla di Flash.',
        'With each of your questions it gets what happened in the Orchestrator’s chat since it last looked, so it answers about the work in progress without asking for context. The Orchestrator knows nothing of Flash.'),
      // src/main/chats/manager.ts flashAgent (permissionMode plan)
      b('Lavora in sola lettura: legge file e web, non cambia niente, non lancia comandi che scrivono.',
        'It works read only: it reads files and the web, changes nothing, runs no command that writes.'),
      // src/main/chats/manager.ts flashFollow (ADR 0107)
      b('Ha un modello suo, separato da quello dell’Orchestrator: lo scegli dal chip del modello nella sua testata o sulla sua carta, e vale dalla domanda dopo.',
        'It has a model of its own, separate from the Orchestrator’s: pick it from the model chip in its header or on its card, and it applies from the next question.'),
      // src/renderer/i18n/areas/lampo.it.ts lampo.toWork
      b('Quando la risposta diventa un lavoro vero, «Fanne un lavoro» prepara il messaggio per l’Orchestrator con la tua domanda e la risposta di Flash.',
        'When the answer turns into real work, "Make it a job" drafts the message for the Orchestrator with your question and Flash’s answer.'),
      // src/renderer/components/LampoTile.tsx: the eraser in the head
      b('La gomma nella testata pulisce Flash in un clic: la conversazione ricomincia da zero, sulla sua carta.',
        'The eraser in its header clears Flash in one click: the conversation starts over, on its card.'),
    ],
    analogy: b('Come chiedere al collega di banco «ma cos’è quella cosa?» mentre il capo parla: risponde sottovoce e non interrompe la riunione.',
      'Like asking the colleague next to you "what was that?" while the boss is talking: they whisper the answer and the meeting goes on.'),
    diagram: { kind: 'flow', steps: [b('Tua domanda', 'Your question'), b('Contesto Orchestrator', 'Orchestrator context'), b('Risposta', 'Answer'), b('Lavoro, se serve', 'A job, if needed')] },
    tech: [
      tech(LIMITS, 'Permessi: modalità plan (sola lettura); strumenti lettura e web; mai delegabile, scope background come Battito.',
        'Permissions: plan mode (read only); read and web tools; never delegable, background scope like Pulse.'),
      tech(WHERE, 'Carta «flash» in roles.json; il contesto passa da ChatManager.deliverNow.',
        'Card "flash" in roles.json; the context goes through ChatManager.deliverNow.'),
    ],
    sources: ['src/main/chats/lampo-context.ts', 'src/main/chats/manager.ts', 'src/shared/roles.ts', 'src/renderer/components/LampoTile.tsx'],
  },
  {
    id: 'orchestrator-app',
    title: b('L’Orchestrator conosce l’app',
      'The Orchestrator knows the app'),
    summary: b('Chiedi all’Orchestrator dove sta una cosa o di cambiare un’impostazione: legge la mappa dell’app dal vivo e la cambia per te, con «Annulla».',
      'Ask the Orchestrator where something is, or to change a setting: it reads the app’s map live and changes it for you, with "Undo".'),
    points: [
      // src/main/appctl/guide.ts app_guide
      b('Quando gli serve, legge la mappa dell’app così come è disegnata ora: le voci della barra, le pagine, le schede di Memoria, le sezioni delle Impostazioni con i valori attuali, le scorciatoie, i testi dei «?» e queste carte della Guida.',
        'When it needs to, it reads the app’s map as it is drawn now: the rail’s items, the pages, Memoria’s tabs, the Settings sections with their current values, the shortcuts, the "?" texts and these Guide cards.'),
      // src/main/appctl/guide.ts outline (window.__sbScreen)
      b('Sa anche cosa c’è sullo schermo adesso e dove sta ogni controllo, senza leggere il contenuto privato delle chat.',
        'It also knows what is on screen right now and where each control sits, without reading the chats’ private content.'),
      // src/main/appctl/config.ts app_config
      b('Cambia per te ogni configurazione: impostazioni, vista (tema, densità), la carta di un ruolo, un connettore acceso o spento, «Rispondi dopo». Anche le impostazioni protette cambiano subito.',
        'It changes every configuration for you: settings, the view (theme, density), a role’s card, a connector on or off, "Answer later". Protected settings change at once too.'),
      // src/main/appctl/user-words.ts
      b('Cambia qualcosa solo se gliel’hai scritto tu, di recente, in un messaggio che è l’ultimo della sua chat: le notizie dell’app o la posta di un agente non bastano.',
        'It changes something only if you typed the ask yourself, recently, in a message that is the latest of its chat: the app’s news or an agent’s mail are not enough.'),
      // src/main/appctl/config.ts: logged as the agent’s change
      b('Ogni impostazione cambiata finisce nel registro dei cambi con il suo «Annulla»; la carta di un ruolo torna alla versione di prima; vista e connettori si rimettono chiedendoglielo di nuovo.',
        'Every setting change goes to the change log with its "Undo"; a role’s card can go back to its previous version; the view and connectors are set back by asking again.'),
      // src/main/appctl/config.ts: secrets, own tools
      b('Non tocca mai segreti, chiavi o password, né i suoi stessi strumenti e permessi: quelli restano un tuo clic.',
        'It never touches secrets, keys or passwords, nor its own tools and permissions: those stay your click.'),
    ],
    analogy: b('Come un assistente che conosce l’ufficio a memoria: gli dici «abbassa il riscaldamento» e lo fa, lasciando un biglietto per rimetterlo com’era.',
      'Like an assistant who knows the office by heart: you say "turn the heating down" and they do it, leaving a note so you can put it back.'),
    tech: [
      tech(TOOLS, 'app_guide (la mappa, su richiesta), app_ui «outline» (lo schermo), app_config (setting, view, agent, connector, later).',
        'app_guide (the map, on demand), app_ui "outline" (the screen), app_config (setting, view, agent, connector, later).'),
      tech(LIMITS, 'app_config solo sull’endpoint dell’Orchestrator (app_guide e app_ui anche altrove, senza i valori delle impostazioni); nessun costo di token negli altri turni: la mappa si legge solo quando serve.',
        'app_config only on the Orchestrator’s endpoint (app_guide and app_ui elsewhere too, without the settings’ values); no token cost in its other turns: the map is read only when needed.'),
    ],
    sources: ['src/main/appctl/guide.ts', 'src/main/appctl/config.ts', 'src/main/appctl/user-words.ts', 'src/renderer/lib/app-map.ts'],
  },
  {
    id: 'voice',
    title: b('La voce: dettare e parlare',
      'Voice: dictate and talk'),
    summary: b('Detti nel campo di testo con il microfono, oppure parli con l’Orchestrator e lui risponde a voce. Tutto gira sul tuo PC, gratis.',
      'Dictate into the text field with the mic, or talk to the Orchestrator and hear it answer. It all runs on your PC, for free.'),
    points: [
      // src/renderer/lib/voice.ts dictation
      b('Il microfono nel campo dell’Orchestrator e di Flash (o Ctrl+M) è solo dettatura: scrive quello che dici nel campo, non invia niente e non legge niente ad alta voce.',
        'The mic in the Orchestrator’s and Flash’s field (or Ctrl+M) is dictation only: it writes what you say into the field, sends nothing and reads nothing aloud.'),
      // src/renderer/lib/voice.ts conversation; src/renderer/components/VoiceSettings.tsx
      b('La conversazione a voce si accende in Impostazioni → Voce (o Ctrl+Maiusc+Spazio): ciò che dici va all’Orchestrator come messaggio e la risposta viene letta mentre si scrive, frase per frase.',
        'The voice conversation is switched on in Settings → Voice (or Ctrl+Shift+Space): what you say goes to the Orchestrator as a message and the reply is read while it is being written, sentence by sentence.'),
      // src/renderer/lib/voice.ts barge-in
      b('Se parli sopra l’app, lei smette subito di parlare e ascolta te.',
        'If you talk over the app, it stops speaking at once and listens to you.'),
      // src/renderer/lib/voice.ts useVoiceQuestion, parseSpokenAnswer
      b('Con la conversazione accesa, le carte di domanda si leggono ad alta voce: un «sì», un «no» o «non voglio rispondere» detti valgono come il clic; qualsiasi altra frase va come tua risposta scritta, mai come un sì.',
        'With the conversation on, question cards are read aloud: a spoken "yes", "no" or "I don’t want to answer" counts as the click; any other sentence goes as your written answer, never as a yes.'),
      // src/main/voice/service.ts; src/main/voice/catalog.ts
      b('Trascrizione con Whisper e voce italiana con Piper, sul tuo PC: niente esce dal computer, a parte lo scarico una tantum dei modelli, controllati con la loro impronta.',
        'Transcription with Whisper and an Italian voice with Piper, on your PC: nothing leaves the computer except the one-time model downloads, checked against their hash.'),
      // src/renderer/lib/mic.ts
      b('In Impostazioni → Voce scegli trascrizione Veloce o Precisa, la voce (Paola, Miro, Dii) e il microfono; uno USB collegato mentre l’app è aperta si usa subito.',
        'In Settings → Voice you pick Fast or Accurate transcription, the voice (Paola, Miro, Dii) and the microphone; a USB one plugged in while the app runs is used at once.'),
      // src/renderer/lib/voice.ts header
      b('L’app non parla mai di sua iniziativa: solo per rispondere a te.',
        'The app never speaks on its own initiative: only to answer you.'),
    ],
    analogy: b('Come un interfono in ufficio: premi per dettare un appunto, oppure lo lasci aperto e parli con chi coordina.',
      'Like an office intercom: press it to dictate a note, or leave it open and talk to the coordinator.'),
    diagram: { kind: 'flow', steps: [b('Microfono', 'Microphone'), b('Whisper sul PC', 'Whisper on the PC'), b('Orchestrator', 'Orchestrator'), b('Piper legge', 'Piper reads it')] },
    tech: [
      tech(WHERE, 'Un processo a parte (voice/worker.ts, sherpa-onnx); il microfono manda pezzi a 16 kHz; Silero taglia le frasi.',
        'A separate process (voice/worker.ts, sherpa-onnx); the mic streams 16 kHz chunks; Silero cuts the sentences.'),
      tech(LIMITS, 'Modelli: Veloce 374 MB, Precisa 1 GB; la voce in modalità conversazione non registra niente su disco.',
        'Models: Fast 374 MB, Accurate 1 GB; voice mode records nothing to disk.'),
    ],
    sources: ['src/renderer/lib/voice.ts', 'src/main/voice/service.ts', 'src/main/voice/catalog.ts', 'src/renderer/lib/mic.ts', 'src/renderer/components/VoiceSettings.tsx'],
  },
  {
    id: 'recordings',
    title: b('Le registrazioni delle call',
      'Call recordings'),
    summary: b('Registri una call (audio del PC e microfono) o importi un file: Whisper la trascrive sul tuo PC, a zero token, e l’Orchestrator la trova da solo.',
      'Record a call (the PC’s audio and your mic) or import a file: Whisper transcribes it on your PC at zero tokens, and the Orchestrator finds it by itself.'),
    points: [
      // src/renderer/lib/recorder.ts
      b('«Registra call» prende il tuo microfono e l’audio del PC (Teams, Meet, qualsiasi cosa suoni) in due canali: a sinistra «Tu», a destra «Altri». Senza l’audio del PC registra solo il microfono.',
        '"Record call" takes your mic and the PC’s audio (Teams, Meet, anything playing) on two channels: left "You", right "Others". Without the PC’s audio it records the mic alone.'),
      // src/renderer/components/TopBar.tsx REC pill
      b('Mentre registri, la pillola REC con il tempo resta in alto su ogni pagina e la ferma con un clic. La conversazione a voce si spegne: risponderebbe alla call.',
        'While recording, the REC pill with the timer stays at the top on every page and stops it in one click. The voice conversation turns off: it would answer the call.'),
      // src/main/recordings/service.ts
      b('Alla fine, Whisper la trascrive in locale, una alla volta, a zero token; nella pagina cerchi nel testo, la riascolti o la copi.',
        'At the end Whisper transcribes it locally, one at a time, at zero tokens; on the page you search the text, listen again or copy it.'),
      // src/main/recordings/find.ts
      b('«Trovate sul PC» elenca i file audio e video delle ultime settimane nelle cartelle solite (Download, Documenti, Video, Desktop, le registrazioni di Teams in OneDrive): niente si legge finché non lo importi.',
        '"Found on the PC" lists the audio and video files of the last weeks in the usual folders (Downloads, Documents, Videos, Desktop, Teams recordings in OneDrive): nothing is read until you import it.'),
      // src/main/appctl/recordings.ts
      b('L’Orchestrator legge l’elenco e le trascrizioni («apri un bug da quello che ci siamo detti») e può chiedere di importare un file trovato. Solo lui: una call è privata.',
        'The Orchestrator reads the list and the transcripts ("open a bug from what we said") and can ask to import a file found. Only it: a call is private.'),
      // src/main/recordings/store.ts
      b('Audio e testo restano solo sul tuo PC, nei dati dell’app, mai nel brain.',
        'Audio and text stay only on your PC, in the app’s data, never in the brain.'),
    ],
    analogy: b('Come il registratore sul tavolo della riunione, con una stenografa che batte il verbale a fine incontro e lo mette nel cassetto giusto.',
      'Like the recorder on the meeting table, with a stenographer who types the minutes when it ends and files them in the right drawer.'),
    diagram: { kind: 'flow', steps: [b('Registra o importa', 'Record or import'), b('Whisper sul PC', 'Whisper on the PC'), b('Tu / Altri', 'You / Others'), b('Orchestrator', 'Orchestrator')] },
    tech: [
      tech(FILES, 'userData/recordings/<id>/: meta.json, audio.wav (16 kHz, 16 bit; stereo per una call), transcript.json, trascrizione.md.',
        'userData/recordings/<id>/: meta.json, audio.wav (16 kHz, 16-bit; stereo for a call), transcript.json, trascrizione.md.'),
      tech(TOOLS, 'app_recordings (elenco, trascrizioni, file trovati) e app_recording_import, solo sull’endpoint dell’Orchestrator.',
        'app_recordings (list, transcripts, files found) and app_recording_import, only on the Orchestrator’s endpoint.'),
      tech(WHERE, 'Pagina Registrazioni (barra a sinistra, o G V).',
        'Recordings page (left rail, or G V).'),
    ],
    sources: ['src/renderer/lib/recorder.ts', 'src/main/recordings/service.ts', 'src/main/recordings/store.ts', 'src/main/recordings/find.ts', 'src/main/appctl/recordings.ts', 'src/renderer/components/RecordingsPage.tsx'],
  },
  {
    id: 'personal-browser',
    title: b('Il tuo Browser personale',
      'Your personal Browser'),
    summary: b('Un browser di tutti i giorni dentro l’app, con preferiti, sessioni e password, separato da quelli degli agenti: loro non lo vedono mai.',
      'An everyday browser inside the app, with bookmarks, sessions and passwords, apart from the agents’ ones: they never see it.'),
    points: [
      // src/main/personal/browser.ts (persist:personal)
      b('Le sue schede vivono in una partizione tutta loro: nessuno strumento degli agenti le elenca, le legge o le fotografa, e loro non vedono le sessioni degli agenti.',
        'Its tabs live in a partition of their own: no agent tool lists, reads or screenshots them, and they never see the agents’ sessions.'),
      // src/renderer/components/BrowserPage.tsx
      b('Barra degli indirizzi con suggerimenti da preferiti e cronologia, stella per i preferiti, sessioni salvate (un gruppo di schede con un nome) e «Riapri le ultime schede».',
        'An address bar with suggestions from bookmarks and history, a star for bookmarks, saved sessions (a named set of tabs) and "Reopen the last tabs".'),
      // src/main/personal/vault.ts
      b('Le password sono cifrate dal sistema (DPAPI su Windows) e si riempiono solo in una pagina del loro sito, al tuo clic; puoi importare il CSV di Google Password Manager, Chrome, Edge o Firefox.',
        'Passwords are encrypted by the system (DPAPI on Windows) and filled only into a page of their own site, at your click; you can import the CSV from Google Password Manager, Chrome, Edge or Firefox.'),
      // src/main/browser/tabs.ts lend (ADR 0133)
      b('«Affida a un agente» presta una sola scheda a una chat finché non premi «Riprendi la scheda»: solo il tuo clic la presta, e torna indietro viva.',
        '"Give to an agent" lends one tab to a chat until you press "Take the tab back": only your click lends it, and it comes back alive.'),
      // src/main/personal/browser.ts: tabs keep running
      b('Una scheda che non è sullo schermo continua a girare: la musica o una call vanno avanti mentre cambi pagina.',
        'A tab that is off screen keeps running: music or a call go on while you change page.'),
    ],
    analogy: b('Come la tua scrivania personale nello stesso ufficio della squadra: è nella stanza, ma i cassetti sono tuoi e nessuno ci guarda.',
      'Like your own desk in the team’s office: it is in the room, but the drawers are yours and nobody looks inside.'),
    target: [b('Google a volte rifiuta l’accesso dai browser dentro le app («browser non sicuro»): per quel sito serve Chrome.',
        'Google sometimes refuses sign-in from browsers inside apps ("browser not secure"): that site needs Chrome.')],
    tech: [
      tech(FILES, 'userData/personal-browser.json (preferiti, sessioni, cronologia, ultime schede); userData/personal-passwords.json (cifrate).',
        'userData/personal-browser.json (bookmarks, sessions, history, last tabs); userData/personal-passwords.json (encrypted).'),
      tech(WHERE, 'Pagina Browser (barra a sinistra, o G W).',
        'Browser page (left rail, or G W).'),
    ],
    sources: ['src/main/personal/browser.ts', 'src/main/personal/vault.ts', 'src/main/personal/store.ts', 'src/main/browser/tabs.ts', 'src/renderer/components/BrowserPage.tsx'],
  },
  {
    id: 'notifications',
    title: b('Avvisi e suoni',
      'Notices and sounds'),
    summary: b('Ogni avviso dell’app è la stessa carta, con un suono suo per tipo; suona solo ciò che arriva da sé, mai la risposta a un tuo clic.',
      'Every notice of the app is the same card, with its own sound per kind; only what arrives by itself rings, never the answer to your click.'),
    points: [
      // src/renderer/components/Notice.tsx (ADR 0151)
      b('Una sola carta per tutti gli avvisi, nell’app e sopra i browser: tipo, titolo, dettaglio, eventuali etichette e un’azione.',
        'One card for every notice, in the app and over the browsers: kind, title, detail, optional chips and an action.'),
      // src/renderer/lib/sounds.ts SoundKind
      b('Sei tipi, sei suoni brevi sintetizzati al momento: riuscito, informazione, attenzione, avviso, errore e festa.',
        'Six kinds, six short sounds synthesized on the spot: success, info, attention, warning, error and celebrate.'),
      // src/renderer/lib/sounds.ts RANK
      b('Più avvisi insieme suonano una volta sola, con il tipo più importante.',
        'Several notices together ring once, with the most important kind.'),
      // src/renderer/lib/notice.ts
      b('Una Manutenzione che ha prodotto qualcosa finisce con la carta «festa»: più grande, con il riepilogo e «Apri Memoria».',
        'A Maintenance that produced something ends with the "celebrate" card: bigger, with the summary and "Open Memoria".'),
      // src/renderer/lib/notice.ts: tasks.sound, mute, do-not-disturb
      b('Il suono segue l’interruttore degli avvisi, il muto del tipo e «Non disturbare»; le notifiche di Windows restano silenziose.',
        'The sound follows the alerts switch, the kind’s mute and "Do not disturb"; Windows notifications stay silent.'),
    ],
    analogy: b('Come i campanelli di un albergo: uno per la reception, uno per la cucina, uno per le emergenze. Dal suono sai già chi chiama.',
      'Like the bells in a hotel: one for reception, one for the kitchen, one for emergencies. From the sound you already know who is calling.'),
    tech: [
      tech(LIMITS, 'Durata: 8 s, la carta festa 20 s; ogni suono sotto 0,9 s, a volume basso, senza file audio.',
        'Duration: 8 s, the celebrate card 20 s; every sound under 0.9 s, at low volume, without audio files.'),
      tech(WHERE, 'notify() in lib/notice.ts per i lavori in background; toast() per la risposta a un tuo clic.',
        'notify() in lib/notice.ts for background jobs; toast() for the answer to your own click.'),
    ],
    sources: ['src/renderer/components/Notice.tsx', 'src/renderer/lib/notice.ts', 'src/renderer/lib/sounds.ts'],
  },
  {
    id: 'routines',
    title: b('Le routine, dal terminale',
      'Routines, from the terminal'),
    summary: b('Una routine è un pacchetto di passi che gira dal terminale con il comando routine; l’app aiuta a prepararlo e mostra le run quando le apri.',
      'A routine is a package of steps that runs from the terminal with the routine command; the app helps you prepare it and shows the runs when you open them.'),
    points: [
      // packages/routine-runtime/README.md
      b('Il terminale è l’unico esecutore: routine run fa una run, routine resume la riprende dal passo non finito, routine watch segue il trigger DevOps e avvia una run per ogni work item nuovo.',
        'The terminal is the only executor: routine run does one run, routine resume continues it from the step that did not finish, routine watch follows the DevOps trigger and starts one run per new work item.'),
      // packages/routine-runtime/README.md
      b('Ogni passo è una sessione Claude Code; quando serve una persona, il runtime chiede in un commento DevOps e aspetta la risposta lì.',
        'Each step is a Claude Code session; when a person is needed, the runtime asks in a DevOps comment and waits for the answer there.'),
      // src/renderer/brain/pages/Routines.tsx (ADR 0179)
      b('Nell’app prepari il pacchetto con l’Orchestrator, inserisci le credenziali e lo esporti; la pagina Routine non avvia, non riprova e non pianifica niente.',
        'In the app you prepare the package with the Orchestrator, enter its credentials and export it; the Routines page starts, retries and schedules nothing.'),
      // src/renderer/brain/pages/Routines.tsx RunPage
      b('Aprendo una run vedi dal vivo passi, azioni, screenshot, prove e rapporto; chiudendo la vista l’osservazione si ferma.',
        'Opening a run shows its steps, actions, screenshots, evidence and report live; closing the view stops the watching.'),
      // src/renderer/components/LegacyRoutineHistory.tsx
      b('Le vecchie run fatte dall’app restano un archivio in sola lettura.',
        'The old runs made by the app stay a read-only archive.'),
      // src/main/appctl/tools.ts app_routine_status
      b('L’Orchestrator legge stato e prove di una run solo quando glielo chiedi, e non la esegue mai.',
        'The Orchestrator reads a run’s state and evidence only when you ask, and never executes it.'),
    ],
    analogy: b('Come una ricetta scritta per la cucina: la prepari a tavolino, poi in cucina la segue chi è ai fornelli; tu guardi dalla finestrella quando vuoi.',
      'Like a recipe written for the kitchen: you prepare it at the desk, then whoever is at the stove follows it; you look through the hatch when you want.'),
    diagram: { kind: 'flow', steps: [b('Prepara', 'Prepare'), b('Esporta', 'Export'), b('routine run', 'routine run'), b('Guarda la run', 'Watch the run')] },
    tech: [
      tech(WHERE, 'Pagina Routine (barra a sinistra, o G U); runtime in packages/routine-runtime (comando routine).',
        'Routines page (left rail, or G U); runtime in packages/routine-runtime (the routine command).'),
      tech(LIMITS, 'Nessun timer, polling o scansione all’avvio nell’app: solo una run aperta osserva i suoi file (run.json, events.jsonl, report.md).',
        'No timers, polling or startup scans in the app: only an open run watches its files (run.json, events.jsonl, report.md).'),
    ],
    sources: ['packages/routine-runtime/README.md', 'src/renderer/brain/pages/Routines.tsx', 'src/renderer/components/LegacyRoutineHistory.tsx', 'src/main/appctl/tools.ts', 'docs/adr/0179-terminal-only-routines.md'],
  },
];

export const textOf = (t: Bi, lang: GuideLang): string => (lang === 'de' ? GUIDE_DE[t.en] ?? t.en : t[lang]);

/** The card as plain text for a chat: title, summary, numbered points, analogy, technical part, target, sources. */
export function cardText(card: ConceptCard, lang: GuideLang): string {
  const L = (t: Bi) => textOf(t, lang);
  const h = (it: string, en: string, de: string) => (lang === 'en' ? en : lang === 'de' ? de : it);
  const lines = [
    `# ${L(card.title)}`,
    L(card.summary),
    '',
    h('Come funziona:', 'How it works:', 'So funktioniert es:'),
    ...card.points.map((p, i) => `${i + 1}. ${L(p)}`),
    '',
    `${h('Analogia', 'Analogy', 'Vergleich')}: ${L(card.analogy)}`,
    '',
    h('Dettagli tecnici:', 'Technical details:', 'Technische Details:'),
    ...card.tech.map(x => `- ${L(x.label)}: ${L(x.text)}`),
  ];
  if (card.coming?.length) lines.push('', h('In arrivo (non ancora su main):', 'Coming (not on main yet):', 'In Arbeit (noch nicht auf main):'), ...card.coming.map(x => `- PR #${x.pr}: ${L(x.text)}`));
  if (card.target?.length) lines.push('', h('Obiettivo, non ancora così oggi:', 'Target, not today’s behaviour:', 'Ziel, heute noch nicht so:'), ...card.target.map(x => `- ${L(x)}`));
  lines.push('', `${h('Fonti nel codice', 'Sources in the code', 'Quellen im Code')}: ${card.sources.join(', ')}`);
  return lines.join('\n');
}

/** What an explainer agent's chat starts with (a draft the user sends): the card and an opening question. */
export function discussText(card: ConceptCard, lang: GuideLang): string {
  const ask = lang === 'en'
    ? 'Explain this concept of the second-brain app to me, a developer, a bit more technically. Check the source files above before answering and tell me if something here is out of date.'
    : lang === 'de'
    ? 'Erklär mir, einem Entwickler, dieses Konzept der App second-brain etwas technischer. Prüf vor der Antwort die Quelldateien oben und sag mir, ob hier etwas veraltet ist.'
    : 'Spiegami questo concetto dell’app second-brain, a me che sono uno sviluppatore, andando un po’ sul tecnico. Controlla i file sorgente qui sopra prima di rispondere e dimmi se qualcosa qui è superato.';
  return `${cardText(card, lang)}\n\n${ask}`;
}

/** What «Discuti» sends to the Orchestrator: the request to explain the card (delegating the code reading to a Scout
 *  when needed) and the card as context. */
export function orchestratorText(card: ConceptCard, lang: GuideLang): string {
  const ask = lang === 'en'
    ? `I want to discuss the concept «${card.title.en}» from the app's guide. Explain it to me yourself; if it needs reading the code first, delegate that to a Scout and tell me what it found.`
    : lang === 'de'
    ? `Ich möchte das Konzept «${textOf(card.title, 'de')}» aus dem Leitfaden der App besprechen. Erklär es mir selbst; wenn dafür zuerst der Code gelesen werden muss, gib das an einen Scout ab und sag mir, was er gefunden hat.`
    : `Voglio discutere il concetto «${card.title.it}» della guida dell'app. Spiegamelo tu; se prima serve leggere il codice, delega la lettura a uno Scout e dimmi cosa ha trovato.`;
  return `${ask}\n\n---\n${discussText(card, lang)}`;
}
