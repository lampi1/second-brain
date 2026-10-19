// The in-app guide's content ("Guida", components/GuidePage.tsx): one card per core concept of the app, in Italian and
// English, written for a developer who wants to understand how the app works without reading the code. Every card names
// the source files its claims come from (`sources`, checked to exist by test/unit/concept-guide.test.ts) and a comment
// beside each part cites the file it was read from; a statement about what the app does NOT do yet goes in `target`,
// never in `points`. Kept as data, not JSX, so updating a card is a text edit. Also holds the pure helpers of «Discuti»:
// the text that carries a card into a chat (discussText) and the message «Discuti» sends to the Orchestrator
// (orchestratorText).

export type GuideLang = 'it' | 'en';
/** One text in both UI languages (ADR 0057). */
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

export const CONCEPTS: readonly ConceptCard[] = [
  {
    id: 'every-task-agent',
    prominent: true,
    title: b('Ogni compito passa da un ruolo', 'Every task goes through a role'),
    summary: b(
      'Il lavoro lo fanno nove ruoli fissi: l’Orchestrator coordina, otto ruoli di lavoro eseguono, ognuno in una chat che vedi.',
      'Nine fixed roles do the work: the Orchestrator coordinates, eight work roles carry it out, each in a chat you can see.'),
    points: [
      // src/shared/roles.ts ROLE_IDS, ROLE_DEFAULTS
      b('I ruoli sono sempre gli stessi: Orchestrator, Strategist, Scout, Artisan, Sentinel, Herald, Router, Judge, Scribe. Nessuno se ne crea uno nuovo: un saper fare che manca diventa una skill.',
        'The roles are always the same: Orchestrator, Strategist, Scout, Artisan, Sentinel, Herald, Router, Judge, Scribe. Nobody creates a new one: missing know-how becomes a skill.'),
      // src/renderer/actions.ts newRequest (Ctrl+N); src/main/agents/catalog.ts resolve()
      b('Il lavoro parte solo dall’Orchestrator: Ctrl+N porta il cursore nella sua colonna («Cosa vuoi fare?»), lui sceglie il ruolo e le skill; la chat nasce con motore, modello del suo livello e istruzioni del ruolo.',
        'Work starts only from the Orchestrator: Ctrl+N puts the cursor in its column ("What do you want to do?"), it picks the role and the skills; the chat is born with the role’s engine, its tier’s model and the role’s instructions.'),
      // src/main/appctl/tools.ts app_create_chat; src/main/agents/discovery.ts agent_catalog, skills_suggest
      b('L’Orchestrator legge i ruoli con agent_catalog, sceglie le skill con skills_suggest e apre il lavoro con app_create_chat indicando roleId: motore, modello e sforzo li decide il ruolo, nient’altro li scavalca.',
        'The Orchestrator reads the roles with agent_catalog, picks skills with skills_suggest and opens the work with app_create_chat naming a roleId: the role decides engine, model and effort, nothing overrides them.'),
      // src/shared/roles.ts canLaunch, launches; src/main/appctl/tools.ts
      b('Un ruolo al lavoro delega una parte a un altro ruolo che può avviare: il figlio è una chat visibile sotto il genitore, mai un sotto-agente nascosto, e non ha mai più permessi del genitore.',
        'A working role delegates a part to another role it may launch: the child is a visible chat under its parent, never a hidden sub-agent, and never gets more permissions than its parent.'),
      // src/main/agents/run-report.ts; src/shared/roles.ts ROLE_PREAMBLE
      b('Ogni ruolo chiude il suo incarico con agent_report: esito, riassunto, risultato e i criteri del contratto con le prove. È un’autovalutazione, non una verifica indipendente.',
        'Every role closes its assignment with agent_report: outcome, summary, output and the contract’s criteria with their evidence. It is a self-report, not an independent check.'),
      // src/main/chats/manager.ts startRun only when owner.source === 'catalog'
      b('Le chat dei ruoli di lavoro hanno una «run» con contatori e costo; l’Orchestrator e le chat avviate senza ruolo (con i tuoi permessi) no.',
        'Work-role chats have a "run" with counters and cost; the Orchestrator and chats started without a role (with your permissions) do not.'),
      // src/main/agents/loop.ts; src/main/agents/trials.ts; src/main/agents/suggestions.ts
      b('L’app migliora i ruoli da sola: testi e skill subito, con «Annulla»; livello di modello, strumenti e permessi solo con il tuo sì in «Da approvare», come versione in prova.',
        'The app improves the roles by itself: texts and skills at once, with "Undo"; model tier, tools and permissions only with your yes in "To approve", as a trial version.'),
    ],
    analogy: b(
      'Come una squadra con ruoli fissi: il coordinatore assegna, ognuno fa il suo pezzo in vista di tutti e torna con il risultato; se manca un saper fare, si scrive il manuale, non si assume un altro.',
      'Like a team with fixed roles: the coordinator assigns, each does their part in plain sight and comes back with the result; when know-how is missing, you write the manual, you do not hire someone else.'),
    diagram: { kind: 'cycle', steps: [b('Compito', 'Task'), b('Orchestrator', 'Orchestrator'), b('Ruolo e skill', 'Role and skills'), b('Risultato', 'Result'), b('Miglioramento', 'Improvement')] },
    tech: [
      // src/shared/agents.ts AgentProfile
      tech(DATA, 'AgentProfile { id, name, purpose, instructions, engine, model | null, effort?, tools, permissionCeiling, tier, tierMax, independent, launches, skills, version, activeVersion, trial?, userLocked }.',
        'AgentProfile { id, name, purpose, instructions, engine, model | null, effort?, tools, permissionCeiling, tier, tierMax, independent, launches, skills, version, activeVersion, trial?, userLocked }.'),
      // src/main/agents/catalog.ts (roles.json), src/main/agents/versions.ts (role-history.json)
      tech(FILES, 'userData/roles.json (i nove ruoli e Pulse) e role-history.json (le versioni di ogni ruolo).',
        'userData/roles.json (the nine roles and Pulse) and role-history.json (each role’s versions).'),
      // src/shared/roles.ts DELEGATION_DEFAULTS
      tech(LIMITS, 'Deleghe: profondità 2 e 5 figli in corso per genitore, di serie (Impostazioni → Ruoli e deleghe).', 'Delegation: depth 2 and 5 running children per parent by default (Settings → Roles and delegation).'),
    ],
    target: [
      b('Su Codex e Cursor il divieto dei sotto-agenti interni del motore è scritto nelle istruzioni, non applicato dall’app.',
        'On Codex and Cursor the ban on the engine’s internal sub-agents is written in the instructions, not enforced by the app.'),
      b('Router smista solo i lotti che gli dai tu: l’app non gli manda da sola il lavoro in arrivo.',
        'Router triages only the batches you give it: the app does not send it incoming work by itself.'),
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
      b('agent_delegate avvia da 1 a 10 chat figlie insieme, ognuna con un contratto che basta a sé: obiettivo, risultato atteso, criteri di fatto, contesto. Il figlio non legge mai la conversazione del genitore.',
        'agent_delegate starts 1 to 10 child chats at once, each with a self-contained contract: goal, expected output, done-when criteria, context. The child never reads the parent’s conversation.'),
      // src/main/agents/delegation.ts allowsClass, launchGap; src/main/agents/worktrees.ts; src/main/agents/role-gate.ts aboveParent
      b('I permessi scendono soltanto: un figlio non ha mai più strumenti o permessi del genitore e lavora nella sua cartella (o in un worktree dello stesso repository); una richiesta oltre i permessi del genitore è rifiutata e lo dice nella chat. Per questo chi pianifica (Strategist, Router) lancia solo chi legge (Scout, Judge): il lavoro che cambia qualcosa lo scrive nel suo risultato e lo avvia l’Orchestrator.',
        'Permissions only go down: a child never gets more tools or permissions than its parent and works in its folder (or a worktree of the same repository); a request beyond the parent’s permissions is refused and says so in the chat. That is why a planner (Strategist, Router) launches only the reading roles (Scout, Judge): the work that changes something goes in its result and the Orchestrator starts it.'),
      // src/shared/roles.ts DELEGATION_DEFAULTS; src/main/chats/manager.ts limitNotice
      b('Profondità e figli in corso sono limiti tuoi (Impostazioni → Ruoli e deleghe); una delega oltre il limite è rifiutata e il genitore mostra «Limite».',
        'Depth and running children are your limits (Settings → Roles and delegation); a delegation over the limit is refused and the parent shows "Limit".'),
      // src/main/agents/delegation.ts agent_ask_parent, agent_answer_child; src/renderer/lib/child-requests.ts requestHost
      b('Un dubbio del figlio va prima al genitore (agent_ask_parent); a te arriva solo ciò che serve a una persona (un permesso, un’azione irreversibile o esterna, una scelta che cambia l’obiettivo), una volta sola, nella chat che stai guardando.',
        'A child’s doubt goes to its parent first (agent_ask_parent); only what needs a person reaches you (a permission, an irreversible or external action, a choice that changes the goal), once, in the chat you are looking at.'),
      // src/renderer/components/DelegationCard.tsx; src/renderer/lib/run-steps.ts
      b('Nella Grindhouse ogni figlio è una scheda sul filo del genitore: compito, personaggio, skill, modello, i passi veri (il piano del motore e le sue azioni), lo stato. Un clic la apre nella chat intera; «Vai alla chat» la mette a fuoco.',
        'In the Grindhouse each child is a card on its parent’s thread: task, character, skills, model, its real steps (the engine’s plan and its actions), its state. A click opens it into the whole chat; "Vai alla chat" puts it in focus.'),
      // src/main/chats/manager.ts userWrote; src/main/chats/orchestrator-wake.ts user-message
      b('Puoi scrivere in qualunque figlio: l’Orchestrator e il genitore lo vengono a sapere con le tue parole, così nessuno disfa ciò che hai chiesto; se cambi l’obiettivo, il figlio lo dice nel suo risultato.',
        'You can write in any child: the Orchestrator and the parent learn it in your words, so nobody undoes what you asked; if you change the goal, the child says so in its result.'),
      // src/main/chats/manager.ts reportDelegation; src/shared/delegation.ts resultMessage
      b('Il figlio chiude con agent_report: il risultato arriva al genitore come messaggio; l’Orchestrator vede solo lo stato.',
        'The child closes with agent_report: the result reaches the parent as a message; the Orchestrator sees only the state.'),
    ],
    analogy: b('Come un capo cantiere che affida i lavori ai suoi: ognuno ha la sua scheda di lavoro, nessuno ha chiavi che il capo non ha, e i dubbi passano prima da lui.',
      'Like a site foreman handing jobs to his crew: each has a job sheet, nobody holds keys the foreman lacks, and questions go through him first.'),
    diagram: { kind: 'flow', steps: [b('Genitore', 'Parent'), b('agent_delegate', 'agent_delegate'), b('Figli visibili', 'Visible children'), b('agent_report', 'agent_report'), b('Genitore', 'Parent')] },
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
    summary: b('Un ruolo è un profilo fisso con istruzioni, motore, livello di modello, strumenti, tetto dei permessi, ruoli che può avviare e skill di serie.',
      'A role is a fixed profile with instructions, engine, model tier, tools, permission ceiling, the roles it may launch and its default skills.'),
    points: [
      // src/shared/roles.ts ROLE_DEFAULTS
      b('Strategist pianifica, Scout cerca e legge, Artisan costruisce, Sentinel verifica, Herald comunica, Router smista lotti, Judge valuta in modo indipendente, Scribe scrive nel brain.',
        'Strategist plans, Scout searches and reads, Artisan builds, Sentinel verifies, Herald communicates, Router triages batches, Judge evaluates independently, Scribe writes to the brain.'),
      // src/renderer/components/AgentStudio.tsx RoleEditor
      b('In Agenti ogni ruolo ha la sua pagina: «Modifica» cambia istruzioni, skill, motore, modello, livello, strumenti, tetto, ruoli avviabili e contesto massimo; nome, scopo e personaggio restano del ruolo.',
        'In Agents each role has its page: "Edit" changes instructions, skills, engine, model, tier, tools, ceiling, launchable roles and maximum context; name, purpose and character stay the role’s.'),
      // src/main/agents/catalog.ts reset()
      b('«Ripristina predefinito» riporta il ruolo com’è nell’app, dopo una conferma; le skill arrivate da un pacchetto restano.',
        '"Restore default" brings the role back as the app ships it, after a confirmation; skills that came from a pack stay.'),
      // src/shared/agents.ts BEHAVIOUR_FIELDS; src/main/agents/versions.ts
      b('Ogni cambio di comportamento è una versione nuova: la pagina ne mostra le ultime e ne riattiva una vecchia con un clic.',
        'Every behaviour change is a new version: the page shows the latest ones and brings an older one back with a click.'),
      // src/main/agents/model-tier.ts tierModel, independentModel
      b('Il livello (leggero, medio, top) diventa un modello per ogni motore: la tua scelta in Impostazioni, altrimenti il registro dei modelli del brain. Sentinel e Judge prendono un modello diverso da quello del genitore quando c’è.',
        'The tier (light, mid, top) becomes a model per engine: your choice in Settings, else the brain’s model registry. Sentinel and Judge take a model other than their parent’s when there is one.'),
      // src/main/agents/tool-policy.ts browserAccess, readOnlyCommand; src/main/chats/manager.ts refusedCommand
      b('Strumenti a classi: Scout ha comandi e browser in sola lettura; un comando che scrive viene rifiutato in chat (se l’ha delegato una chat che può eseguirlo, decidi tu), uno che legge ti arriva come permesso senza «sempre».',
        'Tools come in classes: Scout has read-only commands and browser; a command that writes is refused in the chat (when a chat that may run it delegated Scout, you decide), one that reads reaches you as a permission without "always".'),
      // src/renderer/components/AgentAvatar.tsx; src/renderer/lib/character-art.ts
      b('Ogni ruolo ha un personaggio a cartone riconoscibile anche a 16 px: sotto i 24 px restano colore, capigliatura o copricapo e occhi; da 24 px anche viso e attrezzo.',
        'Every role has a cartoon character recognisable even at 16 px: below 24 px the colour, the hair or headwear and the eyes stay; from 24 px the face and the prop too.'),
    ],
    analogy: b('Come le schede dei reparti di un’officina: chi fa cosa, con quali attrezzi e fin dove può spingersi senza chiedere; la scheda si aggiorna, il reparto resta.',
      'Like the department cards of a workshop: who does what, with which tools and how far they may go without asking; the card is updated, the department stays.'),
    tech: [
      tech(DATA, 'Classi di strumenti: read, edit, shell, shell-read, web, browser, browser-read, mail-draft, calendar-read, brain-write, mcp. Tetti: plan, default, acceptEdits.',
        'Tool classes: read, edit, shell, shell-read, web, browser, browser-read, mail-draft, calendar-read, brain-write, mcp. Ceilings: plan, default, acceptEdits.'),
      // src/main/agents/catalog.ts behaviour()
      tech(LIMITS, 'Istruzioni ≤ 8000 caratteri; al massimo 40 skill di serie; un ruolo non avvia mai sé stesso né l’Orchestrator.',
        'Instructions ≤ 8000 chars; at most 40 default skills; a role never launches itself or the Orchestrator.'),
      tech(WHERE, 'Pagina Agenti (AgentCatalogPage, la pagina del ruolo è AgentStudio); catalogo nel processo main (AgentCatalogService).', 'Agents page (AgentCatalogPage, the role page is AgentStudio); catalog in the main process (AgentCatalogService).'),
    ],
    sources: ['src/shared/roles.ts', 'src/shared/agents.ts', 'src/main/agents/catalog.ts', 'src/main/agents/versions.ts', 'src/main/agents/model-tier.ts', 'src/main/agents/tool-policy.ts', 'src/renderer/components/AgentStudio.tsx', 'src/renderer/components/AgentAvatar.tsx', 'src/renderer/lib/character-art.ts'],
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
      b('La pagina Skill mostra quale ruolo usa ogni skill e quali strumenti chiama; «Ruoli» su una scheda la collega o la toglie subito, senza approvazione.',
        'The Skill page shows which role uses each skill and which tools it calls; "Roles" on a card links or drops it at once, with no approval.'),
      // src/main/brainmodel/jobs.ts
      b('La manutenzione gira da sola ogni 6 ore, o subito con il pulsante «Manutenzione» in cima a Skill, Regole e Memoria, che dice cosa ha fatto ogni lavoro: una skill nuova da un lavoro ripetuto, skill doppie unite, ricordi doppi nella memoria condivisa, le tue correzioni applicate al ruolo, alla skill o a una regola. Una lezione proposta da una chat di lavoro aspetta che l’Orchestrator te la chieda.',
        'Maintenance runs by itself every 6 hours, or at once with the "Manutenzione" button atop Skill, Regole and Memoria, which says what each job did: a new skill from a repeated task, duplicate skills merged, duplicate memories moved to the shared one, your corrections applied to the role, the skill or a rule. A lesson a work chat proposes waits until the Orchestrator asks you.'),
      // src/main/brainmodel/changes.ts; src/main/agents/catalog.ts maintain (ADR 0083)
      b('Ogni modifica è registrata con cosa, perché e le prove, e «Annulla» la riporta com’era. L’app cambia da sola solo il testo di un ruolo e le sue skill; il tuo sì resta per produzione, strumenti, tetto, motore e livello di un ruolo, impostazioni e testi per altri.',
        'Every change is logged with what, why and the evidence, and "Undo" puts it back. The app changes by itself only a role’s text and its skills; your yes stays for production, a role’s tools, ceiling, engine and tier, settings and texts for others.'),
      // src/main/brainmodel/procedure-sources.ts
      b('Le sezioni dei runbook e delle routine del brain diventano skill, senza perdere testo e senza ripetersi: il resoconto è sulla pagina Skill.',
        'The brain’s runbook and routines sections become skills, losing no text and never twice: the report is on the Skill page.'),
      // src/renderer/components/brain-model/
      b('Regole valgono per tutti i ruoli; Memoria tiene conoscenza, quello che è successo e una memoria per ruolo, con i numeri (righe per ruolo, crescita per settimana, ricordi più richiamati, file fermi, errori ricorrenti, skill utili o mai usate, curiosità; ogni «?» dice come è calcolato) e ogni file si apre nel visore; Mappa mostra ruolo → skill → regole → memoria.',
        'Rules apply to every role; Memory holds knowledge, what happened and one memory per role, with the numbers (lines per role, weekly growth, most recalled memories, stale files, recurring errors, useful or never used skills, curious facts; each "?" says how it is computed) and every file opens in the viewer; Map shows role → skills → rules → memory.'),
      // src/main/agents/pack/emit.ts, rules.ts
      b('Esportare un ruolo porta il suo testo, le skill, l’elenco degli strumenti (TOOLS.md) e le regole; mai la memoria. Importare un pacchetto aggiunge skill e regole al ruolo che scegli, come versione in prova: il ruolo tiene i suoi permessi.',
        'Exporting a role carries its text, skills, the tools list (TOOLS.md) and the rules; never memory. Importing a pack adds skills and rules to the role you pick, as a trial version: the role keeps its permissions.'),
      // src/main/brainmodel/classifiers.ts
      b('Classificatori, in sola lettura: la tabella che sceglie il modello con i risultati di ogni riga, le skill suggerite contro quelle date, la qualità per settimana.',
        'Classifiers, read only: the table that picks the model with each row’s results, the suggested skills versus the ones given, quality by week.'),
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
      b('Riceve il suo ruolo e l’elenco dei ruoli di lavoro (id, nome, a cosa serve); i dettagli li legge con agent_catalog, mai le istruzioni dei ruoli.',
        'It gets its role and the list of work roles (id, name, what each is for); it reads the details with agent_catalog, never the roles’ instructions.'),
      // src/main/appctl/tools.ts app_create_chat
      b('Delega con app_create_chat: roleId obbligatorio, un titolo «Area · cosa», il contratto come primo messaggio e le skill scelte con skills_suggest. Il ruolo decide motore e modello; tier chiede un livello più alto fino al massimo del ruolo.',
        'It delegates with app_create_chat: roleId required, an "Area · what" title, the contract as the first message and the skills picked with skills_suggest. The role decides engine and model; tier asks for a higher level up to the role’s maximum.'),
      // src/main/agents/task-estimate.ts estimateTool; src/main/agents/orchestrator-role.ts (ADR 0087)
      b('Prima di partire stima la richiesta sui task simili già finiti (task_estimate: tempo, costo, su quanti task, affidabilità, quante parti) e prende la via rapida: una domanda breve la risponde lui, un lavoro veloce in una parte va a un solo agente senza sotto-chat; un albero di deleghe solo per il lavoro in più parti, che costa più token. Sotto la sua testata, il piano: gli agenti avviati oggi con la stima, il segno «via rapida» e la precisione delle stime settimana per settimana.',
        'Before starting it estimates the request on similar finished tasks (task_estimate: time, cost, how many tasks, confidence, how many parts) and takes the fast path: a short question it answers itself, a quick one-part job goes to a single agent with no sub-chats; a delegation tree only for work in several parts, which costs more tokens. Under its head, the plan: the agents started today with their estimate, the "fast path" mark and the estimates’ accuracy week by week.'),
      // src/main/agents/run-feedback.ts metricsTool; src/main/agents/discovery.ts
      b('Dei figli vede solo lo stato e i numeri (agent_metrics): mai il loro testo. Il risultato gli arriva quando il figlio chiude con agent_report.',
        'Of its children it sees only state and numbers (agent_metrics): never their text. The result reaches it when the child closes with agent_report.'),
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
    diagram: { kind: 'flow', steps: [b('Tua richiesta', 'Your request'), b('Orchestrator', 'Orchestrator'), b('Ruolo e skill', 'Role and skills'), b('Chat di lavoro', 'Work chat'), b('agent_report', 'agent_report')] },
    tech: [
      tech(DATA, 'Risposta di app_create_chat: { chatId, title, harness, cwd, model, effort, route { source: agent, kind, area, reason, agent { id, version, chosenBy, tier?, modelFrom } } }.',
        'app_create_chat result: { chatId, title, harness, cwd, model, effort, route { source: agent, kind, area, reason, agent { id, version, chosenBy, tier?, modelFrom } } }.'),
      tech(LIMITS, 'Fino a 16 skill per chat delegata; un figlio non ha mai strumenti o tetto sopra quelli di chi lo avvia.', 'Up to 16 skills per delegated chat; a child never has tools or a ceiling above its launcher’s.'),
      tech(WHERE, 'MCP dell’app su 127.0.0.1 (tool app_*, agent_catalog, skills_suggest, agent_metrics), ognuno con il suo endpoint e token.',
        'The app’s MCP on 127.0.0.1 (app_*, agent_catalog, skills_suggest, agent_metrics tools), each with its own endpoint and token.'),
    ],
    sources: ['src/main/agents/orchestrator-role.ts', 'src/main/agents/task-estimate.ts', 'src/main/chats/orchestrator-service.ts', 'src/main/agents/discovery.ts', 'src/main/appctl/tools.ts', 'src/main/agents/run-feedback.ts', 'src/shared/newchat.ts', 'src/main/chats/orchestrator-delivery.ts', 'src/main/chats/held-news.ts', 'src/renderer/lib/orchestrator-route.ts'],
  },
  {
    id: 'runs',
    title: b('Le run dei ruoli', 'Role runs'),
    summary: b('Una run è un incarico di un ruolo, dall’avvio al suo agent_report, con contatori, costo e risultato.',
      'A run is one assignment of a role, from start to its agent_report, with counters, cost and result.'),
    points: [
      // src/main/chats/manager.ts startRun (owner.source === 'catalog')
      b('Nasce quando una chat parte con un ruolo di lavoro; startedBy dice chi l’ha avviata: tu, l’Orchestrator o la chat genitore che l’ha delegata.',
        'It starts when a chat starts with a work role; startedBy says who started it: you, the Orchestrator or the parent chat that delegated it.'),
      // src/main/chats/manager.ts create (links.parentRunId); src/main/agents/delegation.ts
      b('Una run delegata porta parentRunId, la run del genitore: così l’albero delle deleghe resta leggibile anche nelle metriche.',
        'A delegated run carries parentRunId, its parent’s run: so the delegation tree stays readable in the metrics too.'),
      // src/main/chats/manager.ts countRequest
      b('Conta domande, permessi e comandi (una volta per richiesta), riaperture, picco di contesto, correzioni e tempo di esecuzione.',
        'It counts questions, permissions and commands (once per request), reopenings, context peak, corrections and execution time.'),
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
      b('Un giudizio vale come prova solo se viene da una revisione di Judge finita, verificata, su un modello diverso da quello della run; il parere di un genitore resta un parere.',
        'A verdict counts as evidence only if it comes from an ended Judge review, verified, on a model other than the run’s; a parent’s opinion stays an opinion.'),
      // src/main/run/outcome.ts (run:outcome IPC); src/renderer/components/RunSurface.tsx
      b('Quando la run ha finito, nella striscia espansa dici tu com’è andata (riuscita, in parte, non riuscita): il tuo esito vince sempre.',
        'Once the run has finished, in the expanded strip you say how it went (success, partial, failed): your verdict always wins.'),
    ],
    analogy: b('Come una commessa in officina: si apre, accumula ore e materiali, si chiude con il verbale; se il cliente torna, si riapre.',
      'Like a work order in a workshop: it opens, adds up hours and parts, closes with its report; if the customer comes back, it reopens.'),
    diagram: { kind: 'flow', steps: [b('Avvio', 'Start'), b('Turni e richieste', 'Turns and requests'), b('agent_report', 'agent_report'), b('Esito', 'Outcome')] },
    tech: [
      // src/shared/agents.ts AgentRun
      tech(DATA, 'AgentRun { runId, chatId, agentId, version, goal, startedBy, startedAt, endedAt?, endReason?, outcome?, counters, costUsd | null, tokens | null, report?, tier?, parentRunId?, reviewOf?, reworkOf?, continuedFrom?, tags? }.',
        'AgentRun { runId, chatId, agentId, version, goal, startedBy, startedAt, endedAt?, endReason?, outcome?, counters, costUsd | null, tokens | null, report?, tier?, parentRunId?, reviewOf?, reworkOf?, continuedFrom?, tags? }.'),
      tech(FILES, 'userData/agent-runs.json è la fonte; ChatSummary.run ne è una copia; i giudizi in run-feedback.json.', 'userData/agent-runs.json is the source; ChatSummary.run mirrors it; verdicts in run-feedback.json.'),
      // src/main/agents/runs.ts RUNS_MAX, RUNS_BYTES, STALE_MS
      tech(LIMITS, 'RUNS_MAX = 5000, RUNS_BYTES = 7 000 000, STALE_MS = 72 h.', 'RUNS_MAX = 5000, RUNS_BYTES = 7,000,000, STALE_MS = 72 h.'),
    ],
    sources: ['src/shared/agents.ts', 'src/main/agents/runs.ts', 'src/main/agents/run-report.ts', 'src/main/agents/run-feedback.ts', 'src/main/chats/manager.ts', 'src/main/index.ts', 'src/main/run/outcome.ts'],
  },
  {
    id: 'metrics',
    title: b('Metriche e statistiche degli agenti', 'Agent metrics and statistics'),
    summary: b('Statistiche dalle sessioni osservate e metriche dalle run: due letture distinte del lavoro degli agenti.',
      'Statistics from observed sessions and metrics from runs: two separate views of agents’ work.'),
    points: [
      // src/shared/agent-analytics.ts
      b('Per ogni agente: costo reale, costo a listino e costo stimato, ciascuno con quante sessioni sono note e quante no.',
        'For each agent: actual cost, list-price cost and estimated cost, each with how many sessions are known and how many are not.'),
      b('I tempi sono divisi per tipo: esecuzione, attesa di te, attesa di un permesso, coda, sconosciuto (mediana).',
        'Times are split by kind: execution, waiting for you, waiting for a permission, queue, unknown (median).'),
      b('Le coorti raggruppano le sessioni completate per tipo di compito × motore × modello × sforzo.',
        'Cohorts group completed sessions by task type × engine × model × effort.'),
      // src/renderer/brain/pages/Costi.tsx
      b('Le vedi nella pagina Costi, «Per agente · tutte le sessioni osservate», aggiornate ogni 5 secondi; nessuna classifica.',
        'You see them on the Costs page, "By agent · all observed sessions", refreshed every 5 seconds; no ranking.'),
      // src/main/agents/analytics.ts, src/main/agents/collector.ts
      b('Le statistiche della pagina Costi vengono dalle sessioni e dai registri osservati.', 'The Costs page statistics come from observed sessions and ledgers.'),
      // src/main/agents/run-metrics.ts; src/main/index.ts agents:metrics
      b('Il main calcola anche metriche per agente e versione dalle run concluse in agent-runs.json e dai riepiloghi delle run potate; le carte della pagina Agenti ne mostrano lavori conclusi, in corso e costo mediano.',
        'Main also computes per-agent and per-version metrics from ended runs in agent-runs.json and rollups of pruned runs; the Agenti page cards show ended runs, open runs and the median cost.'),
      // src/main/agents/standing.ts; src/renderer/components/AgentCatalogCard.tsx
      b('Ogni carta ha un livello e una performance. Livello: Lv 2 a 5 lavori conclusi, Lv 3 a 15, Lv 4 a 30 (ogni livello ne chiede 5 in più). Performance: media dei voti (riuscito 100%, in parte 50%, fallito 0%) pesata per chi ha votato (tu o il Giudice × 1, l’Orchestrator × 0,6, l’agente stesso × 0,3) e per età (metà peso ogni 30 giorni); sotto 5 lavori valutati l’agente è «in rodaggio». Il «?» accanto a ciascuno dà la formula.',
        'Each card has a level and a performance. Level: Lv 2 at 5 ended runs, Lv 3 at 15, Lv 4 at 30 (each level asks 5 more). Performance: the average of verdicts (success 100%, partial 50%, failure 0%) weighted by who gave them (you or the Judge × 1, the Orchestrator × 0.6, the agent itself × 0.3) and by age (half weight every 30 days); below 5 judged runs the agent is "warming up". The "?" beside each gives the formula.'),
    ],
    analogy: b('Come il cruscotto di una flotta: consumi e tempi per veicolo, con scritto quando un dato manca invece di inventarlo.',
      'Like a fleet dashboard: consumption and times per vehicle, saying when a figure is missing instead of inventing it.'),
    tech: [
      tech(DATA, 'AgentMeasure { total, knownSubtotal, knownSessions, unknownSessions }; timing per categoria con medianMs.', 'AgentMeasure { total, knownSubtotal, knownSessions, unknownSessions }; timing per category with medianMs.'),
      // src/main/wiring.ts /api/agents/analytics
      tech(WHERE, 'Statistiche delle sessioni: /api/agents/analytics; metriche delle run: IPC agents:metrics, anche filtrate per tag skill, app e repo.', 'Session statistics: /api/agents/analytics; run metrics: agents:metrics IPC, also filtered by skill, app and repo tags.'),
    ],
    sources: ['src/shared/agent-analytics.ts', 'src/main/agents/analytics.ts', 'src/main/agents/run-metrics.ts', 'src/main/agents/standing.ts', 'src/renderer/components/AgentCatalogCard.tsx', 'src/main/index.ts', 'src/main/agents/collector.ts', 'src/renderer/brain/pages/Costi.tsx', 'docs/agent-evidence.md'],
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
      b('«Regole imparate», in fondo alla pagina Regole, mostra le politiche di auto-miglioramento del brain (stime, scelta del modello, soglie) con Applica, No, Ripristina; compare solo quando il brain ne ha.',
        '"Learned rules", at the bottom of the Rules page, shows the brain’s self-improvement policies (estimates, model choice, thresholds) with Apply, No, Restore; it appears only when the brain has some.'),
      // src/renderer/i18n/areas/home.it.ts home.rulesReading
      b('Una regola conta come «tenuta» se il suo errore non ricompare nei giorni osservati: non è una prova di causa.',
        'A rule counts as "holding" if its error does not reappear in the observed days: it is not proof of cause.'),
      // src/main/chats/manager.ts; src/main/agents/run-metrics.ts aiErrorRuns
      b('Le run contano correzioni esplicite e riaperture dell’utente dopo un report valido; le metriche includono anche righe di ai-errors.md con runId e «visto da: Brother».',
        'Runs count explicit corrections and user reopenings after a valid report; metrics also include ai-errors.md entries with a runId and "visto da: Brother".'),
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
    title: b('Script e Changelog del brain', 'Brain scripts and changelog'),
    summary: b('Gli script provati dei tuoi agenti stanno nel brain, riutilizzabili; ogni cambiamento al brain finisce nel Changelog.',
      'Your agents’ tested scripts live in the brain, ready to reuse; every change to the brain lands in the Changelog.'),
    points: [
      // src/main/brain/scripts.ts
      b('Gli script stanno nella cartella scripts/ del brain; l’intestazione dice titolo, cosa fa, come si usa, tag e l’ultimo test.',
        'Scripts live in the brain’s scripts/ folder; their header says title, what it does, how to run it, tags and the last test.'),
      // src/main/brain/scripts-tools.ts brain_scripts
      b('Ogni chat può cercarli con brain_scripts prima di scrivere uno script nuovo, per riusarne uno che funziona.',
        'Every chat can look them up with brain_scripts before writing a new script, to reuse one that works.'),
      // src/main/brain/scripts-tools.ts brain_script_save, brain_script_delete
      b('Solo l’Orchestrator li aggiunge, corregge o elimina, senza chiederti l’ok: salva solo dopo un test, rifiuta le credenziali, un eliminato va in scripts/.deleted/.',
        'Only the Orchestrator adds, fixes or deletes them, without asking you: it saves only after a test, credentials are refused, a deleted one goes to scripts/.deleted/.'),
      // src/main/brain/changelog.ts
      b('Ogni cambiamento è una riga in changelog.md: quando, cosa, quale file, chi e perché. L’Orchestrator vi annota anche regole, skill e note che cambia.',
        'Every change is a line in changelog.md: when, what, which file, who and why. The Orchestrator also logs the rules, skills and notes it changes.'),
      // src/renderer/brain/pages/Script.tsx, Changelog.tsx
      b('Le pagine Script e Changelog, nella sezione Brain, mostrano tutto a schede; nessun bottone esegue uno script.',
        'The Script and Changelog pages, in the Brain section, show it all as cards; no button runs a script.'),
      // docs/adr/0076-brain-scripts-and-changelog.md
      b('Nessun classificatore sceglie gli script: con pochi script che si descrivono da soli basta la ricerca per parole.',
        'No classifier picks scripts: with a few self-describing scripts a word search is enough.'),
    ],
    analogy: b('Come la cassetta degli attrezzi di un’officina con il registro accanto: ogni attrezzo ha l’etichetta, e chi lo cambia lo scrive.',
      'Like a workshop toolbox with a logbook beside it: every tool is labelled, and whoever changes one writes it down.'),
    diagram: { kind: 'flow', steps: [b('Script provato', 'Tested script'), b('Orchestrator salva', 'Orchestrator saves'), b('scripts/', 'scripts/'), b('changelog.md', 'changelog.md'), b('Riuso', 'Reuse')] },
    tech: [
      tech(FILES, 'Nel brain: scripts/<nome>, scripts/.deleted/, changelog.md; creati al primo salvataggio.', 'In the brain: scripts/<name>, scripts/.deleted/, changelog.md; created on the first save.'),
      tech(WHERE, 'Pagine: /api/scripts, /api/script?id=…, /api/changelog; evento scripts:changed.', 'Pages: /api/scripts, /api/script?id=…, /api/changelog; event scripts:changed.'),
      tech(LIMITS, 'Uno script ≤ 200 KB; la pagina legge le ultime 500 righe del changelog.', 'A script ≤ 200 KB; the page reads the latest 500 changelog lines.'),
    ],
    sources: ['src/main/brain/scripts.ts', 'src/main/brain/scripts-tools.ts', 'src/main/brain/changelog.ts', 'src/renderer/brain/pages/Script.tsx', 'src/renderer/brain/pages/Changelog.tsx', 'docs/adr/0076-brain-scripts-and-changelog.md'],
  },
  {
    id: 'milestones',
    title: b('Traguardi personali', 'Personal milestones'),
    summary: b('Tre traguardi locali: primo ruolo personalizzato, spazio configurato e primo risultato confermato.',
      'Three local milestones: first custom role, workspace set up and first confirmed result.'),
    points: [
      // src/shared/progress.ts ACHIEVEMENTS; src/renderer/lib/progress-bridge.ts labels
      b('I traguardi sono: «Primo ruolo personalizzato», «Spazio di lavoro configurato», «Primo risultato confermato».',
        'The milestones are: "First custom role", "Workspace set up", "First confirmed result".'),
      // src/main/agents/progress.ts
      b('Sono salvati in progress.json nella cartella dati dell’app.', 'They are saved in progress.json in the app’s data folder.'),
      // src/main/wiring.ts ProgressService enabled:true; src/main/agents/progress.ts confirmResult
      b('Personalizzare un ruolo e completare la configurazione assegnano i primi due; il primo risultato richiede una tua conferma su un risultato idoneo.',
        'Customizing a role and completing setup award the first two; the first result requires your confirmation of an eligible result.'),
      // src/renderer/components/ProgressPanel.tsx
      b('Il pannello nella pagina Agenti mostra i traguardi e si può nascondere; in demo o con errori di salvataggio spiega il problema.',
        'The panel on the Agenti page shows milestones and can be hidden; in demo or with storage errors it explains the problem.'),
    ],
    analogy: b('Come tre caselle da spuntare quando prepari il tuo spazio e confermi il primo lavoro riuscito.',
      'Like three boxes to tick as you prepare your workspace and confirm the first successful job.'),
    tech: [
      tech(DATA, "ACHIEVEMENTS = ['first-agent', 'setup-complete', 'first-result'].", "ACHIEVEMENTS = ['first-agent', 'setup-complete', 'first-result']."),
      tech(FILES, 'userData/progress.json; servizio ProgressService con enabled: true nel profilo personale.', 'userData/progress.json; ProgressService with enabled: true in the personal profile.'),
    ],
    sources: ['src/shared/progress.ts', 'src/main/agents/progress.ts', 'src/main/wiring.ts', 'src/renderer/lib/progress-bridge.ts', 'src/renderer/components/AgentStudio.tsx', 'src/renderer/components/ProgressPanel.tsx'],
  },
  {
    id: 'classifiers',
    title: b('I classificatori', 'The classifiers'),
    summary: b('Dove l’app smista qualcosa da sola senza spendere token: le skill adatte a un compito, il tipo di lavoro, la posta dell’Orchestrator, i comandi delicati.',
      'Where the app sorts something by itself without spending tokens: the skills that fit a task, the kind of work, the Orchestrator’s mail, sensitive commands.'),
    points: [
      // src/main/skills/suggest.ts; src/main/agents/discovery.ts skills_suggest
      b('Skill per un compito (skills_suggest): la richiesta è confrontata con nome e descrizione di ogni skill del brain, per parole (BM25) e, quando il modello locale è pronto, per significato; l’Orchestrator, o il ruolo che delega, passa le migliori al ruolo. È un consiglio: un ruolo usa solo le skill che il suo avvio gli dà.',
        'Skills for a task (skills_suggest): the request is compared with each brain skill’s name and description, by words (BM25) and, when the local model is ready, by meaning; the Orchestrator, or the role that delegates, passes the best ones to the role. It is advice: a role uses only the skills its launch gives it.'),
      // src/shared/work-concepts.ts CONCEPTS
      b('Italiano e inglese si incontrano: un piccolo lessico di lavori («correggi» = fix, «revisiona» = review, «fonti» = sources…) unisce le richieste in italiano e le skill scritte in inglese.',
        'Italian and English meet: a small lexicon of kinds of work ("correggi" = fix, "revisiona" = review, "fonti" = sources…) joins Italian requests and skills written in English.'),
      // src/main/brain/routing.ts taskOf; src/shared/work-concepts.ts builtinTask
      b('Tipo di lavoro per l’instradamento: prima le regole del brain (estimates.json), poi il lessico integrato, poi «altro». Una richiesta che costruisce o corregge vince su un titolo che nomina solo un tema.',
        'Kind of work for routing: the brain’s rules first (estimates.json), then the built-in lexicon, then "altro". A request that builds or fixes wins over a title that only names a topic.'),
      // src/main/brain/estimates.ts classify
      b('Tipo di lavoro nel registro dei costi (correzione, QA, revisione, funzionalità, indagine, domanda, altro): espressioni in italiano e inglese, vince il tipo con più indizi.',
        'Kind of work in the cost ledger (fix, QA, review, feature, research, question, other): Italian and English patterns, the kind with the most clues wins.'),
      // src/main/chats/orchestrator-delivery.ts mailClassifier
      b('Posta per l’Orchestrator: urgente → subito; richiesta, finito o errore → raggruppata; solo avanzamento → silenziosa. Nel dubbio raggruppata: una richiesta tenuta ferma costa più di un’attesa.',
        'Mail for the Orchestrator: urgent → now; a request, done or error → grouped; progress only → quiet. When in doubt grouped: a request held back costs more than a wait.'),
      // src/shared/runnable.ts prodRisk; src/main/agents/tool-policy.ts readOnlyCommand
      b('Comandi: quelli di produzione (az, sqlcmd, script ops) chiedono un secondo clic e il main ricontrolla; per un ruolo a sola lettura un comando conta come lettura solo se è un lettore noto, senza concatenazioni, redirezioni, sottoespressioni né opzioni che scrivono o eseguono (sort e uniq solo dopo una pipe).',
        'Commands: production ones (az, sqlcmd, ops scripts) ask for a second click and main checks again; for a read-only role a command counts as reading only if it is a known reader, with no chaining, redirection, subexpression or option that writes or runs (sort and uniq only after a pipe).'),
      // src/renderer/lib/foreign.ts; src/main/chats/admission.ts; src/shared/waiting.ts
      b('Altri: messaggi non scritti da te (mostrati attenuati), «Aspetta un lavoro» sul testo, la coda per carico (CPU > 75% o RAM libera < 15%). Permessi e domande non sono indovinati: arrivano strutturati dalla CLI.',
        'Others: messages you did not type (shown muted), "Waits for work" on the text, the load queue (CPU > 75% or free RAM < 15%). Permissions and questions are not guessed: they arrive structured from the CLI.'),
      // src/shared/roles.ts ROLE_DEFAULTS.router
      b('Smistare un lotto di lavoro (una inbox, una lista di ticket) è il compito del ruolo Router, quando glielo affidi: non è un classificatore che gira da solo.',
        'Triaging a batch of work (an inbox, a list of tickets) is the Router role’s job, when you hand it one: it is not a classifier that runs by itself.'),
    ],
    analogy: b('Come lo smistamento della posta in portineria: regole scritte, una casella «varie» quando non si capisce, e per un sacco intero di posta si chiama chi smista di mestiere.',
      'Like mail sorting at the front desk: written rules, a "misc" box when it is unclear, and for a whole sack of mail you call the person whose job is sorting.'),
    diagram: { kind: 'flow', steps: [b('Richiesta', 'Request'), b('Parole e lessico', 'Words and lexicon'), b('Skill suggerite', 'Suggested skills'), b('Avvio del ruolo', 'Role launch')] },
    tech: [
      // src/shared/skill-suggest.ts
      tech(DATA, 'SkillSuggestions { candidates: { name, score 0–100, why }[] (al massimo 5, la migliore prima), mode: hybrid | words }; chi delega passa quelle da 60 in su.',
        'SkillSuggestions { candidates: { name, score 0–100, why }[] (at most 5, best first), mode: hybrid | words }; whoever delegates passes those from 60 up.'),
      // src/shared/contract.ts TaskKind
      tech(DATA, 'TaskKind: qa-run, review, bug-fix, ops-read, writing, triage, research-web, investigation, app-feature, orchestrator, altro.',
        'TaskKind: qa-run, review, bug-fix, ops-read, writing, triage, research-web, investigation, app-feature, orchestrator, altro.'),
      tech(LIMITS, 'Richiesta letta fino a 2000 caratteri; il modello locale ha 2,5 s, poi si risponde a sole parole; nessun token speso.', 'Request read up to 2000 characters; the local model gets 2.5 s, then the answer is words only; no token spent.'),
    ],
    sources: ['src/main/skills/suggest.ts', 'src/shared/skill-suggest.ts', 'src/main/agents/discovery.ts', 'src/shared/work-concepts.ts', 'src/main/brain/routing.ts', 'src/main/brain/estimates.ts', 'src/shared/runnable.ts',
      'src/main/agents/tool-policy.ts', 'src/main/chats/orchestrator-delivery.ts', 'src/renderer/lib/foreign.ts', 'src/main/chats/admission.ts', 'src/shared/waiting.ts', 'src/shared/roles.ts'],
  },
  {
    id: 'permissions',
    title: b('Permessi e tetto dei permessi', 'Permissions and the permission ceiling'),
    summary: b('Quando un ruolo vuole fare qualcosa di delicato, la CLI chiede: l’app ti mostra il pannello e rispetta il tetto del ruolo.',
      'When a role wants to do something sensitive, the CLI asks: the app shows you the panel and enforces the role’s ceiling.'),
    points: [
      // src/main/chats/claude.ts onControlRequest; src/main/chats/acp.ts
      b('La richiesta arriva dalla CLI (Claude can_use_tool, Cursor session/request_permission, Codex approvazioni di comandi e modifiche) e diventa un pannello con le risposte disponibili.',
        'The request comes from the CLI (Claude can_use_tool, Cursor session/request_permission, Codex command and file-change approvals) and becomes a panel with the available responses.'),
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
      // src/renderer/lib/questions.ts; src/renderer/components/TopBar.tsx PopupsSwitch
      b('«Domande in finestra» (interruttore «Popup» in alto, spento di default) le apre una alla volta in una finestra centrale.',
        '"Questions in a window" (the "Popups" switch at the top, off by default) opens them one at a time in a central window.'),
      // src/renderer/components/QuestionsWindow.tsx
      b('Nella finestra puoi rispondere in qualsiasi ordine dalla colonna a sinistra; Esc vuol dire «Rispondi dopo», non «rifiuta».',
        'In the window you can answer in any order from the left rail; Esc means "Answer later", not "deny".'),
      // src/renderer/lib/questions.ts TYPING_IDLE_MS
      b('Se stai scrivendo, una domanda nuova aspetta come pillola e compare 2 secondi dopo che smetti.',
        'If you are typing, a new question waits as a pill and appears 2 seconds after you stop.'),
      // src/renderer/lib/later.ts, src/main/later.ts
      b('«Rispondi dopo» tiene tutto in «Da rispondere» senza popup; Ctrl+J apre la prossima cosa che ti aspetta.',
        '"Answer later" keeps everything in "To answer" with no popups; Ctrl+J opens the next thing waiting for you.'),
      // src/renderer/components/AskImages.tsx, src/main/ask-image.ts SCREENSHOT_HINT
      b('Gli screenshot che l’agente cita (un percorso PNG/JPG/WebP nella domanda o in un’opzione) compaiono come miniature, prima e dopo affiancati; un clic li apre grandi. Lo stesso vale per i messaggi in chat.',
        'Screenshots the agent names (a PNG/JPG/WebP path in the question or an option) show as thumbnails, before and after side by side; a click opens them large. Chat messages work the same way.'),
      // src/main/chats/orchestrator-wake.ts QUIET; no timeout
      b('Non c’è scadenza: la richiesta sparisce solo se rispondi, se la CLI la ritira o se chiudi la chat.',
        'There is no timeout: the request goes away only if you answer, the CLI withdraws it, or you close the chat.'),
    ],
    analogy: b('Come i post-it sulla scrivania: restano lì finché non li togli tu, e puoi decidere di guardarli dopo pranzo.',
      'Like sticky notes on the desk: they stay until you remove them, and you can decide to look at them after lunch.'),
    diagram: { kind: 'flow', steps: [b('Chat chiede', 'Chat asks'), b('In attesa', 'Pending'), b('Riquadro o finestra', 'Tile or window'), b('Risposta', 'Answer'), b('La chat riparte', 'Chat resumes')] },
    tech: [
      tech(DATA, "Answer = { kind: 'permission', allow, always?, message? } | { kind: 'question', answers }.", "Answer = { kind: 'permission', allow, always?, message? } | { kind: 'question', answers }."),
      tech(FILES, 'Impostazione questionsModal (default false); stato «Rispondi dopo» in userData/answer-later.json.', 'Setting questionsModal (default false); "Answer later" state in userData/answer-later.json.'),
      tech(WHERE, 'Le domande non svegliano l’Orchestrator da sole (orchestrator-wake.ts); l’ordine è quello di arrivo.', 'Questions never wake the Orchestrator by themselves (orchestrator-wake.ts); the order is arrival order.'),
    ],
    sources: ['src/renderer/store/state.ts', 'src/renderer/lib/questions.ts', 'src/renderer/components/QuestionsWindow.tsx', 'src/renderer/components/AskImages.tsx', 'src/main/ask-image.ts', 'src/renderer/components/TopBar.tsx', 'src/renderer/lib/later.ts', 'src/main/later.ts', 'src/main/chats/orchestrator-wake.ts', 'src/shared/contract.ts'],
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
      b('Gli agenti cloud (Cursor, Codex, Claude Code che girano nel cloud del fornitore, anche a PC spento) hanno la loro striscia sotto le altre, raggruppata per repository, con l’etichetta «cloud» e il motore. Cursor mostra i messaggi, accetta messaggi e si ferma dall’app; Codex e Claude si seguono sulla loro pagina («Apri»). «Porta in locale» prende il risultato in un nuovo worktree. Li avvia l’Orchestrator quando glielo chiedi (app_create_chat con where «cloud»), solo su repository GitHub con il branch già pushato.',
        'Cloud agents (Cursor, Codex, Claude Code running in the vendor’s cloud, even with the PC off) get their own strip under the others, grouped by repository, with a "cloud" label and the engine. Cursor shows its messages, takes messages and stops from the app; Codex and Claude are followed on their own page ("Open"). "Bring home" takes the result into a new worktree. The Orchestrator starts one when you ask it (app_create_chat with where "cloud"), only on GitHub repositories with the branch already pushed.'),
    ],
    analogy: b('Come il banco di orchestrator di uno studio: un fader per ogni canale, e il monitor di ciascuno sotto.',
      'Like a studio mixing desk: one fader per channel, and each one’s monitor below it.'),
    tech: [
      tech(WHERE, 'Pagina «home» (brain/pages/Home.tsx), strisce in components/AgentStrips.tsx, ordine in lib/agent-order.ts; ADR 0068.',
        'Page "home" (brain/pages/Home.tsx), strips in components/AgentStrips.tsx, order in lib/agent-order.ts; ADR 0068.'),
      tech(DATA, 'Una striscia è aperta se prefs.chatExpanded[id], i suoi browser se anche prefs.browserOpen[id]; nessun ordine salvato, nessun trascinamento.', 'A strip is expanded if prefs.chatExpanded[id], its browsers if prefs.browserOpen[id] too; no saved order, no dragging.'),
    ],
    sources: ['src/renderer/brain/pages/Home.tsx', 'src/renderer/components/AgentStrips.tsx', 'src/renderer/lib/agent-order.ts', 'src/renderer/lib/grid.ts', 'src/renderer/components/ChatTile.tsx', 'src/renderer/components/RunEstimate.tsx', 'src/renderer/components/BrowserTile.tsx', 'src/renderer/components/CloudStrips.tsx', 'src/main/cloud/service.ts'],
  },
  {
    id: 'dashboard',
    title: b('La Dashboard', 'The Dashboard'),
    summary: b('Solo statistiche, dal vivo: agenti, costi, contesto, errori, temi e spunti, tutte da dati reali. La mappa del brain è nella pagina Mappa.',
      'Statistics only, live: agents, costs, context, errors, themes and tips, all from real data. The brain map is on the Map page.'),
    points: [
      // src/renderer/dashboard/Dashboard.tsx, src/renderer/dashboard/data.ts
      b('«Mappa agenti»: le chat aperte e chi parla con chi (proprietà dell’Orchestrator, messaggi tra chat).',
        '"Agents map": open chats and who talks to whom (Orchestrator ownership, messages between chats).'),
      // src/renderer/dashboard/BrainNotesMap.tsx (ADR 0077)
      b('Le note del brain e i loro collegamenti sono in Mappa → «Note del brain», letti ogni 30 secondi; «Adatta» rimette tutta la mappa in vista.',
        'The brain’s notes and their links are in Map → "Brain notes", read every 30 seconds; "Fit" brings the whole map back into view.'),
      b('«Costi» per giorno, modello, motore e agente; «Token e contesto» avvisa all’80% della finestra di compattazione Claude, se riportata con il contesto misurato; altrimenti usa contextWarnTokens (default 200 000).',
        '"Costs" by day, model, engine and agent; "Tokens & context" warns at 80% of the Claude compaction window when reported with measured context; otherwise it uses contextWarnTokens (default 200,000).'),
      b('«Errori» conta ai-errors.md e gli eventi (la lezione di ogni errore è in Memoria); «Spunti» deriva segnali come contesti lunghi e costi alti.',
        '"Errors" counts ai-errors.md and events (each error’s lesson is in Memory); "Tips" derives signals such as long contexts and high costs.'),
      b('Ogni pannello ha «Discuti»: mette una bozza all’Orchestrator, non la invia mai da solo.',
        'Every panel has "Discuss": it puts a draft in the Orchestrator, never sends it by itself.'),
    ],
    analogy: b('Come il quadro strumenti dell’auto: non guida, ma ti dice com’è la situazione adesso.',
      'Like a car’s instrument panel: it does not drive, it tells you how things are right now.'),
    tech: [
      tech(DATA, 'Un contesto non riportato conta come sconosciuto, mai come sotto soglia.', 'An unreported context counts as unknown, never as below the threshold.'),
      tech(WHERE, 'API del brain /api/map, /api/cost, /api/tables più lo stato delle chat dell’app.', 'Brain APIs /api/map, /api/cost, /api/tables plus the app’s chat state.'),
    ],
    sources: ['src/renderer/dashboard/Dashboard.tsx', 'src/renderer/dashboard/BrainNotesMap.tsx', 'src/renderer/dashboard/data.ts', 'src/shared/context.ts'],
  },
  {
    id: 'task-fatto',
    title: b('Task e Fatto', 'Tasks and Done'),
    summary: b('Task mostra quello che ti aspetta su Azure DevOps; Fatto è il registro di quello che è stato fatto, dal più recente.',
      'Tasks shows what waits for you on Azure DevOps; Done is the log of what was done, newest first.'),
    points: [
      // src/renderer/brain/pages/Task.tsx, src/main/tasks/service.ts
      b('«Task» legge con lo script del cervello devops-me.mjs le tue PR, le review, i work item e le menzioni: sola lettura, zero token.',
        '"Tasks" reads your PRs, reviews, work items and mentions with the brain’s script devops-me.mjs: read-only, zero tokens.'),
      b('La lettura parte con «Aggiorna ora» o da sola, ogni 15 minuti fino a 2 ore, se accendi la lettura automatica; una menzione ti avvisa con un suono che puoi spegnere.',
        'The read starts with "Refresh now" or by itself, every 15 minutes up to 2 hours, when the automatic read is on; a mention alerts you with a sound you can turn off.'),
      b('Ogni record ha «Discuti»: l’Orchestrator riceve una bozza con titolo, link, stato e cartella; se serve lavoro, è lui ad aprire e istruire la chat.',
        'Every record has "Discuss": the Orchestrator gets a draft with title, link, state and folder; if work is needed, it opens and briefs the chat itself.'),
      // src/renderer/brain/pages/Fatto.tsx, src/renderer/brain/lib/done-log.ts
      b('«Fatto» elenca per giorno, dal più recente, PR, work item, righe «fatto» e «decisione» del diario e chat concluse.',
        '"Done" lists by day, newest first, PRs, work items, "fatto" and "decisione" diary lines and finished chats.'),
      b('Ogni voce dice cosa, chi (tu, o l’agente o il motore della chat), quando e ha il suo link: Azure DevOps fuori dall’app, la chat dentro.',
        'Each entry says what, who (you, or the chat’s agent or engine), when, and has its link: Azure DevOps outside the app, the chat inside it.'),
      b('«Mostra altri giorni» aggiunge tre giorni; lo stand-up di oggi resta in cima, da copiare.',
        '"Show more days" adds three days; today’s stand-up stays on top, ready to copy.'),
    ],
    analogy: b('Task è la posta in arrivo del lavoro; Fatto è il diario di bordo.',
      'Tasks is the work’s inbox; Done is the logbook.'),
    tech: [
      tech(DATA, 'Task: la cache tasks.json nella cartella dati dell’app; Fatto: /api/day?kind=report del cervello più l’elenco delle chat dell’app.',
        'Tasks: the tasks.json cache in the app’s data folder; Done: the brain’s /api/day?kind=report plus the app’s chat list.'),
      tech(WHERE, 'Lettura e avvisi in src/main/tasks/, le pagine in brain/pages/Task.tsx e Fatto.tsx. Fino al 19/10/2026 Task si chiamava DevOps: impostazioni e link vecchi passano da soli al nome nuovo (ADR 0079).',
        'Reads and alerts in src/main/tasks/, the pages in brain/pages/Task.tsx and Fatto.tsx. Until 19/10/2026 Tasks was called DevOps: old settings and links move to the new name by themselves (ADR 0079).'),
    ],
    sources: ['src/renderer/brain/pages/Task.tsx', 'src/main/tasks/service.ts', 'src/renderer/brain/pages/Fatto.tsx', 'src/renderer/brain/lib/done-log.ts', 'brain-template/ops/tools/day.mjs'],
  },
  {
    id: 'setup',
    title: b('La prima configurazione', 'The first setup'),
    summary: b('Una sola finestra, sette passi: cartelle, la tua IA, gli strumenti, chi sei, il tuo lavoro, la squadra e il riepilogo. Riprendi quando vuoi.',
      'One window, seven steps: folders, your AI, tools, who you are, your work, the team and the summary. Resume whenever you like.'),
    points: [
      // src/renderer/components/SetupFolders.tsx; src/modules/ai-first/default-brain.ts
      b('Cartelle: nessuna scelta tra opzioni. La memoria è nuova e vuota (creata alla conferma nella cartella dati dell’app) oppure un brain che hai già, indicato con «Usa un brain esistente…».',
        'Folders: no options to pick. The memory is a new, empty one (created on confirmation in the app’s data folder) or a brain you already have, pointed to with "Use an existing brain…".'),
      // src/main/brain/projects-folder.ts
      b('La cartella dei progetti la cerca l’app da sola: i repository in cui Claude Code e Cursor hanno già lavorato e i posti abituali (source/repos, Projects, dev…). Te la chiede solo se non la trova; la cambi o la rilevi di nuovo in Impostazioni → Il mio spazio.',
        'The app looks for the projects folder by itself: the repositories Claude Code and Cursor already worked in and the usual places (source/repos, Projects, dev…). It asks only when it finds none.'),
      // src/renderer/components/SetupEngines.tsx; src/renderer/lib/setup-wizard.ts
      b('La tua IA: «Collega» apre l’accesso ufficiale in una finestra a parte; la configurazione resta aperta e ricontrolla da sola ogni pochi secondi, finché la scheda dice «Collegata» con l’account e l’ora della verifica.',
        'Your AI: "Collega" opens the official sign-in in a separate window; the setup stays open and checks again by itself every few seconds, until the card says "Collegata" with the account and the time of the check.'),
      // src/renderer/components/SetupConnectors.tsx; src/renderer/lib/setup-connectors.ts
      b('Strumenti (GitHub, Azure DevOps, Jira): ogni accesso finisce con una verifica vera in sola lettura. «Connesso come …» dice l’account e quanti progetti ha letto; «Non connesso» dice il motivo e cosa fare.',
        'Tools (GitHub, Azure DevOps, Jira): every sign-in ends in a real read-only check. "Connected as …" names the account and how many projects it read; "Not connected" says why and what to do.'),
      // src/renderer/components/FirstInterview.tsx; src/main/brain/profile.ts
      b('Nome, ruolo, lingua, aree e stile delle risposte finiscono in me.md alla conferma; ogni risposta è salvata come bozza mezzo secondo dopo, così «Più tardi» o Esc riprendono dallo stesso passo.',
        'Name, role, language, areas and reply style go into me.md on confirmation; every answer is saved as a draft half a second later, so "Più tardi" or Esc resume on the same step.'),
      // src/renderer/components/ui.tsx Modal
      b('Niente dentro la finestra la chiude da solo: un clic fuori non fa nulla, e la si riapre da Impostazioni → «Configura il mio lavoro».',
        'Nothing inside the window closes it by itself: a click outside does nothing, and you reopen it from Settings → "Configura il mio lavoro".'),
    ],
    analogy: b('Come il primo giorno in un ufficio nuovo: ti mostrano la scrivania, ti danno i badge e controllano che aprano davvero le porte.',
      'Like the first day at a new office: they show you your desk, hand you the badges and check they really open the doors.'),
    diagram: { kind: 'flow', steps: [b('Cartelle', 'Folders'), b('La tua IA', 'Your AI'), b('Strumenti', 'Tools'), b('Chi sei e lavoro', 'You and your work'), b('Conferma', 'Confirm')] },
    tech: [
      tech(WHERE, 'Le scelte stanno in config.json (brainRoot, projectsRoot); la bozza in setup.json; il brain nuovo usa projectsRoot come cartella dei repository (REPOS).',
        'The choices live in config.json (brainRoot, projectsRoot); the draft in setup.json; a new brain uses projectsRoot as its repositories folder (REPOS).'),
      tech(LIMITS, 'Ricerca dei progetti: solo nomi di cartelle e presenza di .git, al massimo 300 cartelle note alle CLI; nessun file aperto. Ricontrollo degli accessi: ogni 4 secondi per 3 minuti.',
        'Projects search: folder names and .git presence only, at most 300 folders known to the CLIs; no file opened. Sign-in re-checks: every 4 seconds for 3 minutes.'),
    ],
    sources: ['src/renderer/components/FirstInterview.tsx', 'src/renderer/components/SetupFolders.tsx', 'src/renderer/components/SetupEngines.tsx', 'src/renderer/components/SetupConnectors.tsx', 'src/renderer/lib/setup-wizard.ts', 'src/renderer/lib/setup-connectors.ts', 'src/main/brain/projects-folder.ts', 'src/renderer/components/ProjectsFolderSetting.tsx', 'src/modules/ai-first/default-brain.ts', 'src/renderer/components/ui.tsx'],
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
      // src/main/search/hybrid/service.ts, engine.ts (ADR 0068 hybrid brain search)
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
      tech(DATA, 'Titolo 600 + testo + recenza (fino a 150, lineare su 30 giorni); frase 200; parole 100.', 'Title 600 + text + recency (up to 150, linear over 30 days); phrase 200; words 100.'),
      tech(WHERE, 'Chat e branch: indice in memoria nel processo main (src/main/search), canale search:query. Brain: indice ibrido in userData/search/index.db, in un worker, lo stesso usato da /api/search e dallo strumento brain_search delle chat.', 'Chats and branches: in-memory index in the main process (src/main/search), channel search:query. Brain: hybrid index in userData/search/index.db, in a worker, the same one /api/search and the chats’ brain_search tool use.'),
    ],
    sources: ['src/main/search/service.ts', 'src/main/search/text-index.ts', 'src/main/search/sources.ts', 'src/main/search/hybrid/service.ts', 'src/main/search/hybrid/engine.ts', 'src/renderer/components/CommandPalette.tsx', 'docs/adr/0023-full-text-search.md', 'docs/adr/0068-hybrid-brain-search.md'],
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
      // src/main/brain/routing.ts taskOf, areaOf
      b('Il tipo di lavoro viene dal titolo e dal primo prompt, salvo un tipo esplicito; l’area dal chiamante o dal titolo, con App per le chat nella cartella del codice dell’app.',
        'Kind comes from the title and first prompt unless supplied explicitly; area comes from the caller or title, with App for chats in the app’s code folder.'),
      // src/main/brain/routing.ts match
      b('Vince la riga più specifica: tipo + area, poi area, poi tipo, poi «qualsiasi»; a pari merito la prima.',
        'The most specific row wins: kind + area, then area, then kind, then "any"; on a tie the first one.'),
      // src/main/brain/routing.ts resolve
      b('Se la riga indica un motore che non si può avviare, valgono i tuoi predefiniti «Chat aperte dall’Orchestrator».',
        'If the row names an engine that cannot start, your "Chats opened by the Orchestrator" defaults apply.'),
      // src/main/brain/routing.ts routeAgent (ADR 0083)
      b('Un ruolo non viene mai scavalcato: la sua chat ha il modello del suo livello e la rotta lo registra come «agent». Senza ruolo, un modello diverso dalla tabella richiede un motivo; lo sforzo max mai dalla tabella.',
        'A role is never overridden: its chat has its tier’s model and the route records it as "agent". Without a role, a model other than the table’s needs a reason; max effort never from the table.'),
      // src/main/brain/routing.ts knownOutcome, kindStats, freshReason; src/main/wiring.ts routingVerdict
      b('Il tuo esito su una run di un ruolo (o quello di una revisione di Judge) entra nel registro come esito noto; il motivo della riga mostra i conteggi di oggi, per esempio «16 chat, 10 con esito, 70% riuscite».',
        'Your verdict on a role run (or a Judge review’s) enters the ledger as a known outcome; the row’s reason shows today’s counts, for example "16 chats, 10 with an outcome, 70% successful".'),
      // src/main/brain/routing.ts explore
      b('«Esplorazione» (0–50%) prova ogni tanto il modello con meno esempi, mai per l’Orchestrator e mai per le chat che avvii tu.',
        '"Exploration" (0–50%) sometimes tries the model with the fewest samples, never for the Orchestrator and never for chats you start.'),
      // src/renderer/components/RoutingGroup.tsx
      b('In Impostazioni la modifichi riga per riga; «L’AI può cambiarla» spento blocca la riga agli agenti; ogni salvataggio è una versione.',
        'In Settings you edit it row by row; "AI may change it" off locks the row from agents; every save is a version.'),
      // docs/adr/0047-routing-voted-and-priced-per-work.md
      b('Il voto dei lavori e il ciclo che aggiorna la tabella vivono negli script del brain (ADR 0047).',
        'Work votes and the loop that updates the table live in the brain’s scripts (ADR 0047).'),
    ],
    analogy: b('Come il centralino di un call center: in base al motivo della chiamata ti passa al reparto giusto.',
      'Like a call-centre switchboard: depending on why you call, it puts you through to the right department.'),
    diagram: { kind: 'flow', steps: [b('Titolo e prompt', 'Title and prompt'), b('Tipo + area', 'Kind + area'), b('Riga della tabella', 'Table row'), b('Motore e modello', 'Engine and model')] },
    tech: [
      tech(DATA, 'Riga: { kind | *, area?, harness, model, effort, why, since, evidence, locked?, onApi? }; tabella con exploration e costWeight (default 7).',
        'Row: { kind | *, area?, harness, model, effort, why, since, evidence, locked?, onApi? }; table with exploration and costWeight (default 7).'),
      tech(FILES, '<brain>/ops/state/improve/routing/v<N>.json + current.json; prezzi e modelli in <brain>/harness/models.json, o nella copia dell’app finché un brain nuovo non ne ha una sua.',
        '<brain>/ops/state/improve/routing/v<N>.json + current.json; prices and models in <brain>/harness/models.json, or in the app’s copy until a new brain has its own.'),
      tech(LIMITS, 'EXPLORE_MIN = 20 esempi; mai Fable; le aree App usano il motore delle chat dell’app.', 'EXPLORE_MIN = 20 samples; never Fable; App areas use the app chats’ engine.'),
    ],
    sources: ['src/main/brain/routing.ts', 'src/main/brain/brain-estimates.ts', 'src/renderer/components/RoutingGroup.tsx', 'src/renderer/lib/routing.ts', 'docs/adr/0032-model-routing.md', 'docs/adr/0047-routing-voted-and-priced-per-work.md'],
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
];

export const textOf = (t: Bi, lang: GuideLang): string => t[lang];

/** The card as plain text for a chat: title, summary, numbered points, analogy, technical part, target, sources. */
export function cardText(card: ConceptCard, lang: GuideLang): string {
  const L = (t: Bi) => textOf(t, lang);
  const h = (it: string, en: string) => (lang === 'en' ? en : it);
  const lines = [
    `# ${L(card.title)}`,
    L(card.summary),
    '',
    h('Come funziona:', 'How it works:'),
    ...card.points.map((p, i) => `${i + 1}. ${L(p)}`),
    '',
    `${h('Analogia', 'Analogy')}: ${L(card.analogy)}`,
    '',
    h('Dettagli tecnici:', 'Technical details:'),
    ...card.tech.map(x => `- ${L(x.label)}: ${L(x.text)}`),
  ];
  if (card.coming?.length) lines.push('', h('In arrivo (non ancora su main):', 'Coming (not on main yet):'), ...card.coming.map(x => `- PR #${x.pr}: ${L(x.text)}`));
  if (card.target?.length) lines.push('', h('Obiettivo, non ancora così oggi:', 'Target, not today’s behaviour:'), ...card.target.map(x => `- ${L(x)}`));
  lines.push('', `${h('Fonti nel codice', 'Sources in the code')}: ${card.sources.join(', ')}`);
  return lines.join('\n');
}

/** What an explainer agent's chat starts with (a draft the user sends): the card and an opening question. */
export function discussText(card: ConceptCard, lang: GuideLang): string {
  const ask = lang === 'en'
    ? 'Explain this concept of the second-brain app to me, a developer, a bit more technically. Check the source files above before answering and tell me if something here is out of date.'
    : 'Spiegami questo concetto dell’app second-brain, a me che sono uno sviluppatore, andando un po’ sul tecnico. Controlla i file sorgente qui sopra prima di rispondere e dimmi se qualcosa qui è superato.';
  return `${cardText(card, lang)}\n\n${ask}`;
}

/** What «Discuti» sends to the Orchestrator: the request to explain the card (delegating the code reading to a Scout
 *  when needed) and the card as context. */
export function orchestratorText(card: ConceptCard, lang: GuideLang): string {
  const ask = lang === 'en'
    ? `I want to discuss the concept «${card.title.en}» from the app's guide. Explain it to me yourself; if it needs reading the code first, delegate that to a Scout and tell me what it found.`
    : `Voglio discutere il concetto «${card.title.it}» della guida dell'app. Spiegamelo tu; se prima serve leggere il codice, delega la lettura a uno Scout e dimmi cosa ha trovato.`;
  return `${ask}\n\n---\n${discussText(card, lang)}`;
}
