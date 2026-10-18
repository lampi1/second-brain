// The in-app guide's content ("Guida", components/GuidePage.tsx): one card per core concept of the app, in Italian and
// English, written for a developer who wants to understand how the app works without reading the code. Every card names
// the source files its claims come from (`sources`, checked to exist by test/unit/concept-guide.test.ts) and a comment
// beside each part cites the file it was read from; a statement about what the app does NOT do yet goes in `target`,
// never in `points`. Kept as data, not JSX, so updating a card is a text edit. Also holds the pure helpers of «Discutine»:
// the text that carries a card into a chat (discussText) and the instruction for the Orchestrator when no explainer agent
// exists (regiaText); lib/concept-discuss.ts decides where it goes.

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
    title: b('Ogni compito passa da un agente', 'Every task goes through an agent'),
    summary: b(
      'Qui il lavoro passa da un agente: scegli uno specialista oppure la chat viene assegnata a Generale.',
      'Here work goes through an agent: choose a specialist or the chat is assigned to Generale.'),
    points: [
      // src/renderer/components/AgentStartDialog.tsx (createChat with agentId); src/main/agents/catalog.ts resolve()
      b('Tu (o l’Orchestrator) avvii un agente del catalogo: la chat nasce con il suo motore, modello e istruzioni.',
        'You (or the Orchestrator) start a catalog agent: the chat is born with its engine, model and instructions.'),
      // src/main/appctl/tools.ts app_create_chat; src/main/agents/discovery.ts agent_catalog
      b('L’Orchestrator legge il catalogo con agent_catalog e apre il lavoro con app_create_chat, passando l’agentId scelto.',
        'The Orchestrator reads the catalog with agent_catalog and opens the work with app_create_chat, passing the chosen agentId.'),
      // src/main/agents/catalog.ts resolve(): Generale preserves the caller's engine/model/effort
      b('Senza un agente indicato, le chat di lavoro vanno a Generale: mantengono motore, modello e sforzo scelti da te o dall’instradamento.',
        'Without a named agent, work chats go to Generale: they keep the engine, model and effort chosen by you or routing.'),
      // src/main/chats/manager.ts startRun only when owner.source === 'catalog'
      b('Le chat del catalogo, incluso Generale, hanno una «run» con contatori e costo. La Regia e il ripiego compatibile quando Generale manca non hanno una run di catalogo.',
        'Catalog chats, including Generale, have a "run" with counters and cost. Regia and the compatible fallback when Generale is missing have no catalog run.'),
      // src/renderer/components/AgentCreateDialog.tsx; src/main/agents/authoring.ts agent_create, author-policy.ts checkCreationRequest
      b('Un agente nuovo nasce da «Crea agente» in Agenti: un breve questionario diventa un tuo messaggio all’Orchestrator, che lo crea con agent_create.',
        'A new agent starts from "Create agent" in Agents: a short questionnaire becomes your message to the Orchestrator, which creates it with agent_create.'),
      // src/main/agents/authoring.ts agent_suggest; rememberHumanMessage (only the UI's chat:create/chat:send)
      b('L’Orchestrator crea un agente solo da un messaggio scritto da te nell’app negli ultimi 30 minuti; altrimenti può solo proporlo, e decidi tu in Agenti.',
        'The Orchestrator creates an agent only from a message you wrote in the app in the last 30 minutes; otherwise it can only suggest one, and you decide in Agents.'),
      // src/main/agents/probation.ts; src/main/chats/manager.ts evaluateProbation
      b('Per i profili già in prova, il servizio valuta risultati confermati, correzioni, rifacimenti e inattività per tenerli o ritirarli.',
        'For profiles already on probation, the service evaluates confirmed results, corrections, rework and inactivity to keep or retire them.'),
    ],
    analogy: b(
      'Come uno studio con un elenco di specialisti: il coordinatore sceglie chi chiamare; se manca lo specialista giusto, per ora affida il lavoro a un generalista e ti suggerisce chi assumere.',
      'Like a practice with a list of specialists: the coordinator picks who to call; if the right one is missing, for now it hands the job to a generalist and suggests whom to hire.'),
    diagram: { kind: 'cycle', steps: [b('Compito', 'Task'), b('Orchestrator', 'Orchestrator'), b('Specialista o Generale', 'Specialist or Generale'), b('Risultato', 'Result'), b('Catalogo', 'Catalog')] },
    tech: [
      // src/shared/agents.ts AgentProfile / AgentOrigin
      tech(DATA, 'AgentProfile { id, name, purpose, instructions, manifest, engine, model, effort, tools, permissionCeiling, origin: preset | user | orchestrator, version }.',
        'AgentProfile { id, name, purpose, instructions, manifest, engine, model, effort, tools, permissionCeiling, origin: preset | user | orchestrator, version }.'),
      // src/main/agents/catalog.ts (agents.v2.json), src/main/agents/versions.ts (agent-history.json)
      tech(FILES, 'userData/agents.v2.json (catalogo) e agent-history.json (versioni, max 50 per agente).',
        'userData/agents.v2.json (catalog) and agent-history.json (versions, max 50 per agent).'),
      // src/main/agents/catalog.ts MAX_ACTIVE_AGENTS / MAX_AGENTS
      tech(LIMITS, 'Al massimo 64 agenti attivi e 256 in tutto.', 'At most 64 active agents and 256 in total.'),
    ],
    target: [
      // Automatic creation is absent; evaluation of existing probation profiles is implemented.
      b('L’Orchestrator che crea da solo un agente quando manca (origine «orchestrator»): non implementato.',
        'The Orchestrator creating an agent by itself when one is missing (origin "orchestrator"): not implemented.'),
      b('Riconoscere in automatico il «buco» (nessun agente adatto): oggi lo valuta solo l’Orchestrator leggendo il catalogo.',
        'Detecting the "gap" (no fitting agent) automatically: today only the Orchestrator judges it by reading the catalog.'),
      b('«Salva come agente» da una chat ad hoc riuscita: non esiste ancora.', '"Save as agent" from a successful ad-hoc chat: does not exist yet.'),
    ],
    sources: ['src/shared/agents.ts', 'src/main/agents/catalog.ts', 'src/main/agents/probation.ts', 'src/main/agents/discovery.ts', 'src/main/appctl/tools.ts', 'src/main/chats/manager.ts', 'src/renderer/components/AgentStartDialog.tsx'],
  },
  {
    id: 'agents',
    title: b('Agenti e preset', 'Agents and presets'),
    summary: b('Un agente è un profilo salvato: istruzioni, motore, modello, strumenti e limiti di permesso.',
      'An agent is a saved profile: instructions, engine, model, tools and permission limits.'),
    points: [
      // src/main/agents/catalog.ts ROLES
      b('L’app parte con sei agenti di base: Generale, Ricerca, Scrittura e documenti, Analisi, Pianificazione, Sviluppo.',
        'The app starts with six base agents: Generale, Research, Writing and documents, Analysis, Planning, Development.'),
      // src/shared/agents.ts BEHAVIOUR_FIELDS
      b('Cambiare istruzioni, manifesto, motore, modello, sforzo, strumenti o tetto dei permessi crea una nuova versione.',
        'Changing instructions, manifest, engine, model, effort, tools or permission ceiling creates a new version.'),
      // src/shared/agents.ts AgentManifest; src/shared/agent-manifest.ts
      b('Il manifesto dice quando usarlo e quando no, input, output e criteri di successo: sono dichiarazioni, non concedono permessi.',
        'The manifest says when to use it and when not, input, output and success criteria: declarations only, they grant no permissions.'),
      // src/main/chats/manager.ts (profile block on the first message)
      b('Le istruzioni del profilo entrano una volta, nel primo messaggio della chat, marcate come profilo che non approva azioni.',
        'The profile’s instructions go in once, in the chat’s first message, marked as a profile that approves no actions.'),
      // src/shared/role-presets.ts, src/shared/role-preset-catalog.ts, src/renderer/lib/role-consumers.ts
      b('I «ruoli» (dev, qa, po, cto) sono un’altra cosa: scelgono quali agenti consigliarti e quali pagine mostrarti.',
        '"Roles" (dev, qa, po, cto) are a different thing: they choose which agents to suggest and which pages to show you.'),
      // src/main/agents/catalog.ts resolve()
      b('All’avvio l’app controlla che motore, modello e sforzo della chat siano quelli dell’agente; se no rifiuta.',
        'At start the app checks the chat’s engine, model and effort match the agent’s; otherwise it refuses.'),
    ],
    analogy: b('Come la scheda di un collaboratore: cosa sa fare, con quali attrezzi, fin dove può spingersi senza chiedere.',
      'Like a colleague’s profile card: what they do, with which tools, how far they may go without asking.'),
    tech: [
      tech(DATA, 'Categorie: development, ops, personal, other. Classi di strumenti: read, edit, shell, web, browser, mail-draft, calendar-read, brain-write, mcp.',
        'Categories: development, ops, personal, other. Tool classes: read, edit, shell, web, browser, mail-draft, calendar-read, brain-write, mcp.'),
      // src/main/agents/catalog.ts text limits
      tech(LIMITS, 'Nome ≤ 80 caratteri, scopo ≤ 400, istruzioni ≤ 8000; manifesto: liste di al massimo 12 voci.',
        'Name ≤ 80 chars, purpose ≤ 400, instructions ≤ 8000; manifest: lists of at most 12 items.'),
      tech(WHERE, 'Pagina «Gestisci agenti» (AgentStudio); catalogo nel processo main (AgentCatalogService).', '"Manage agents" page (AgentStudio); catalog in the main process (AgentCatalogService).'),
    ],
    sources: ['src/shared/agents.ts', 'src/shared/agent-manifest.ts', 'src/main/agents/catalog.ts', 'src/shared/role-presets.ts', 'src/shared/role-preset-catalog.ts', 'src/renderer/lib/role-consumers.ts', 'src/renderer/components/AgentStudio.tsx'],
  },
  {
    id: 'orchestrator',
    title: b('L’Orchestrator e lo smistamento', 'The Orchestrator and routing work'),
    summary: b('La chat di coordinamento nella colonna a destra: pianifica, apre le chat di lavoro e legge la loro posta.',
      'The coordinating chat in the right column: it plans, opens work chats and reads their mail.'),
    points: [
      // src/renderer/lib/regia-route.ts, src/main/chats/orchestrator-service.ts, ADR 0068
      b('Ce n’è uno solo, sempre nella colonna di destra (Ctrl+R). Lo crei tu: un agente non può crearne un altro.',
        'There is only one, always in the right column (Ctrl+R). You create it: an agent cannot create another.'),
      // src/main/chats/orchestrator.ts ORCHESTRATOR_ROLE; src/main/chats/manager.ts agentCatalogBrief
      b('A ogni messaggio riceve il suo ruolo e un elenco compatto del catalogo agenti (id, nome, motore, quando usarlo).',
        'With every message it gets its role and a compact list of the agent catalog (id, name, engine, when to use it).'),
      // src/main/agents/discovery.ts agent_catalog
      b('Per scegliere chi fa il lavoro legge agent_catalog (4 profili per pagina, mai le istruzioni).',
        'To choose who does the work it reads agent_catalog (4 profiles per page, never the instructions).'),
      // src/main/appctl/tools.ts app_create_chat
      b('Apre il lavoro con app_create_chat: con un agentId valgono motore e modello dell’agente; senza, decide la tabella di instradamento.',
        'It opens the work with app_create_chat: with an agentId the agent’s engine and model apply; without, the routing table decides.'),
      // src/shared/newchat.ts
      b('Un tuo messaggio che inizia con «[nuova chat]» gli chiede di aprire una chat di lavoro nuova.',
        'A message of yours starting with "[nuova chat]" asks it to open a new work chat.'),
      // src/main/chats/regia-delivery.ts
      b('La posta delle chat gli arriva smistata: subito, raggruppata (30 s) o silenziosa.',
        'Mail from the chats reaches it sorted: now, grouped (30 s) or quiet.'),
    ],
    analogy: b('Come un caporedattore: non scrive ogni pezzo, sceglie chi lo scrive e tiene le fila.',
      'Like an editor-in-chief: does not write every piece, picks who writes it and keeps the threads together.'),
    diagram: { kind: 'flow', steps: [b('Tua richiesta', 'Your request'), b('Orchestrator', 'Orchestrator'), b('agent_catalog', 'agent_catalog'), b('app_create_chat', 'app_create_chat'), b('Chat di lavoro', 'Work chat')] },
    tech: [
      tech(DATA, 'Risposta di app_create_chat: { chatId, title, harness, cwd, model, effort, route { source, kind, area, tableVersion, reason } }.',
        'app_create_chat result: { chatId, title, harness, cwd, model, effort, route { source, kind, area, tableVersion, reason } }.'),
      // src/main/agents/discovery.ts
      tech(LIMITS, 'Elenco del catalogo nel prompt ≤ 8000 caratteri; «quando usarlo» tagliato a 240.', 'Catalog list in the prompt ≤ 8000 chars; "when to use" cut at 240.'),
      tech(WHERE, 'MCP dell’app su 127.0.0.1 (tool app_* e agent_catalog); la scelta dell’agente la fa il modello dell’Orchestrator, non un algoritmo dell’app.',
        'The app’s MCP on 127.0.0.1 (app_* and agent_catalog tools); the agent is chosen by the Orchestrator’s model, not by an app algorithm.'),
    ],
    sources: ['src/main/chats/orchestrator.ts', 'src/main/chats/orchestrator-service.ts', 'src/main/agents/discovery.ts', 'src/main/appctl/tools.ts', 'src/shared/newchat.ts', 'src/main/chats/regia-delivery.ts', 'src/renderer/lib/regia-route.ts'],
  },
  {
    id: 'runs',
    title: b('Le run degli agenti', 'Agent runs'),
    summary: b('Una run è un incarico di un agente del catalogo, dall’avvio alla fine, con i suoi contatori e il costo.',
      'A run is one assignment of a catalog agent, from start to end, with its counters and cost.'),
    points: [
      // src/main/chats/manager.ts startRun (owner.source === 'catalog')
      b('Nasce quando avvii una chat con un agente del catalogo; startedBy dice se l’hai avviata tu o l’Orchestrator.',
        'It starts when you open a chat with a catalog agent; startedBy says whether you or the Orchestrator started it.'),
      // src/main/chats/manager.ts countRequest
      b('Conta domande, permessi e comandi (una volta per richiesta), riaperture, picco di contesto, correzioni e tempo di esecuzione.',
        'It counts questions, permissions and commands (once per request), reopenings, context peak, corrections and execution time.'),
      // src/main/agents/runs.ts addTurn
      b('Somma costo e token di ogni turno; se un turno non li riporta, il totale diventa «sconosciuto» (null), non zero.',
        'It adds each turn’s cost and tokens; if a turn does not report them, the total becomes "unknown" (null), not zero.'),
      // src/main/chats/manager.ts ends: completed / closed / stale
      b('Finisce come completed (stato «Incarico concluso»), closed (chat chiusa o archiviata) o stale (72 ore senza turni).',
        'It ends as completed ("Assignment done" status), closed (chat closed or archived) or stale (72 hours without turns).'),
      // src/main/agents/runs.ts reopenRun; src/main/index.ts chat:send
      b('Se scrivi di nuovo o riapri manualmente una chat finita, la run si riapre e «reopened» sale; i messaggi degli agenti non la riaprono.',
        'Writing again or manually reopening an ended chat reopens its run and increases "reopened"; agent messages do not reopen it.'),
      // src/main/chats/manager.ts continuation; src/main/agents/run-metrics.ts indexRuns
      b('Una continuazione registra continuedFrom; le metriche lo considerano per i rifacimenti entro sette giorni dalla fine della run precedente.',
        'A continuation records continuedFrom; metrics use it for rework within seven days of the previous run ending.'),
      // src/main/run/outcome.ts (run:outcome IPC) → src/main/chats/manager.ts markRun; src/renderer/components/RunSurface.tsx
      b('Quando la run ha finito, nella striscia espansa dici tu com’è andata (riuscita, in parte, non riuscita): l’esito viene salvato con base «human».',
        'Once the run has finished, in the expanded strip you say how it went (success, partial, failed): the outcome is saved with basis "human".'),
      // src/main/agents/runs.ts pruning
      b('Le run finite più vecchie vengono potate quando l’archivio supera i limiti.', 'The oldest ended runs are pruned when the store exceeds its limits.'),
    ],
    analogy: b('Come una commessa in officina: si apre, accumula ore e materiali, si chiude; se il cliente torna, si riapre.',
      'Like a work order in a workshop: it opens, adds up hours and parts, closes; if the customer comes back, it reopens.'),
    diagram: { kind: 'flow', steps: [b('Avvio', 'Start'), b('Turni e richieste', 'Turns and requests'), b('Fine', 'End'), b('Riapertura?', 'Reopened?')] },
    tech: [
      // src/shared/agents.ts AgentRun
      tech(DATA, 'AgentRun { runId, chatId, agentId, version, goal, startedBy, startedAt, endedAt?, endReason?, outcome?, counters { questions, permissions, commands, reopened, contextPeak }, costUsd | null, tokens | null, report?, corrections?, executionMs?, parentRunId?, spawnedBy?, reviewOf?, reworkOf?, continuedFrom?, tags? }.',
        'AgentRun { runId, chatId, agentId, version, goal, startedBy, startedAt, endedAt?, endReason?, outcome?, counters { questions, permissions, commands, reopened, contextPeak }, costUsd | null, tokens | null, report?, corrections?, executionMs?, parentRunId?, spawnedBy?, reviewOf?, reworkOf?, continuedFrom?, tags? }.'),
      tech(FILES, 'userData/agent-runs.json è la fonte; ChatSummary.run ne è una copia.', 'userData/agent-runs.json is the source; ChatSummary.run mirrors it.'),
      // src/main/agents/runs.ts RUNS_MAX, RUNS_BYTES, STALE_MS
      tech(LIMITS, 'RUNS_MAX = 5000, RUNS_BYTES = 7 000 000, STALE_MS = 72 h.', 'RUNS_MAX = 5000, RUNS_BYTES = 7,000,000, STALE_MS = 72 h.'),
    ],
    target: [
      b('I legami di sotto-incarico e review sono supportati dall’archivio, ma manca ancora un percorso MCP per crearli.',
        'Sub-assignment and review links are supported by the store, but an MCP path to create them is still missing.'),
    ],
    sources: ['src/shared/agents.ts', 'src/main/agents/runs.ts', 'src/main/chats/manager.ts', 'src/main/index.ts', 'src/main/run/outcome.ts'],
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
      b('Il main calcola anche metriche per agente e versione dalle run concluse in agent-runs.json e dai riepiloghi delle run potate; non hanno ancora una vista dedicata.',
        'Main also computes per-agent and per-version metrics from ended runs in agent-runs.json and rollups of pruned runs; these have no dedicated view yet.'),
    ],
    analogy: b('Come il cruscotto di una flotta: consumi e tempi per veicolo, con scritto quando un dato manca invece di inventarlo.',
      'Like a fleet dashboard: consumption and times per vehicle, saying when a figure is missing instead of inventing it.'),
    tech: [
      tech(DATA, 'AgentMeasure { total, knownSubtotal, knownSessions, unknownSessions }; timing per categoria con medianMs.', 'AgentMeasure { total, knownSubtotal, knownSessions, unknownSessions }; timing per category with medianMs.'),
      // src/main/wiring.ts /api/agents/analytics
      tech(WHERE, 'Statistiche delle sessioni: /api/agents/analytics; metriche delle run: IPC agents:metrics, anche filtrate per tag skill, app e repo.', 'Session statistics: /api/agents/analytics; run metrics: agents:metrics IPC, also filtered by skill, app and repo tags.'),
    ],
    sources: ['src/shared/agent-analytics.ts', 'src/main/agents/analytics.ts', 'src/main/agents/run-metrics.ts', 'src/main/index.ts', 'src/main/agents/collector.ts', 'src/renderer/brain/pages/Costi.tsx', 'docs/agent-evidence.md'],
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
      // src/renderer/brain/pages/Miglioramento.tsx, src/renderer/brain/lib/learn.ts
      b('«Regole imparate» mostra le politiche di auto-miglioramento del brain (stime, scelta del modello, soglie) con Applica, No, Ripristina.',
        '"Learned rules" shows the brain’s self-improvement policies (estimates, model choice, thresholds) with Apply, No, Restore.'),
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
    sources: ['src/main/chats/manager.ts', 'src/main/agents/run-metrics.ts', 'src/renderer/brain/lib/stats.ts', 'src/renderer/lib/correction.ts', 'src/renderer/components/CorrectThought.tsx', 'src/renderer/brain/pages/Miglioramento.tsx', 'src/renderer/brain/lib/learn.ts', 'docs/adr/0037-useful-errors-and-stats.md', 'docs/adr/0058-correct-the-thought.md'],
  },
  {
    id: 'milestones',
    title: b('Traguardi personali', 'Personal milestones'),
    summary: b('Tre traguardi locali: primo agente personalizzato, spazio configurato e primo risultato confermato.',
      'Three local milestones: first custom agent, workspace set up and first confirmed result.'),
    points: [
      // src/shared/progress.ts ACHIEVEMENTS; src/renderer/lib/progress-bridge.ts labels
      b('I traguardi sono: «Primo agente personalizzato», «Spazio di lavoro configurato», «Primo risultato confermato».',
        'The milestones are: "First custom agent", "Workspace set up", "First confirmed result".'),
      // src/main/agents/progress.ts
      b('Sono salvati in progress.json nella cartella dati dell’app.', 'They are saved in progress.json in the app’s data folder.'),
      // src/main/wiring.ts ProgressService enabled:true; src/main/agents/progress.ts confirmResult
      b('Personalizzare un agente e completare la configurazione assegnano i primi due; il primo risultato richiede una tua conferma su un risultato idoneo.',
        'Customizing an agent and completing setup award the first two; the first result requires your confirmation of an eligible result.'),
      // src/renderer/components/ProgressPanel.tsx
      b('Il pannello in «Gestisci agenti» mostra i traguardi e si può nascondere; in demo o con errori di salvataggio spiega il problema.',
        'The panel in "Manage agents" shows milestones and can be hidden; in demo or with storage errors it explains the problem.'),
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
    summary: b('Dove l’app smista qualcosa da sola: tutte regole scritte nel codice (regex e soglie), nessuna chiamata a un modello.',
      'Where the app sorts something by itself: all rules written in code (regexes and thresholds), no model call.'),
    points: [
      // src/main/brain/routing.ts taskOf; src/main/brain/brain-estimates.ts areaOf
      b('Tipo di lavoro per l’instradamento: titolo, poi prompt, con le regole del brain (estimates.json); nel dubbio «altro». L’area viene dal prefisso «Area · …».',
        'Kind of work for routing: title, then prompt, with the brain’s rules (estimates.json); when in doubt "altro". The area comes from the "Area · …" prefix.'),
      // src/shared/runnable.ts prodRisk; src/main/run/runner.ts
      b('Comandi di produzione: regex su az, sqlcmd, script ops; se scatta, «Esegui» chiede un secondo clic e il main ricontrolla.',
        'Production commands: regexes on az, sqlcmd, ops scripts; if one fires, "Run" asks for a second click and main checks again.'),
      // src/shared/command-ask.ts askedBlocks
      b('«Comando da eseguire»: un blocco di codice alla fine della risposta, o preceduto da «esegui», «lancia», diventa una richiesta; «ad esempio» no.',
        '"Command to run": a code block at the end of the reply, or after "run this", "esegui", becomes a request; "for example" does not.'),
      // src/main/chats/claude.ts, src/main/chats/acp.ts
      b('Permessi e domande non sono indovinati: arrivano già strutturati dalla CLI (Claude, Cursor, Codex).',
        'Permissions and questions are not guessed: they arrive already structured from the CLI (Claude, Cursor, Codex).'),
      // src/shared/waiting.ts waitsForWork
      b('«Aspetta un lavoro»: frasi come «aspetto la QA» o «in background» impediscono che la chat venga chiusa da sola.',
        '"Waits for work": sentences like "waiting for QA" or "in background" stop the chat from being auto-closed.'),
      // src/main/chats/regia-delivery.ts mailClassifier
      b('Posta per l’Orchestrator: urgente → subito, richiesta → raggruppata, avanzamento → silenziosa; nel dubbio raggruppata.',
        'Mail for the Orchestrator: urgent → now, request → grouped, progress → quiet; when in doubt grouped.'),
      // src/renderer/lib/foreign.ts; src/main/chats/admission.ts
      b('Altri: messaggi non scritti da te (mostrati attenuati) e la coda per carico (CPU > 75% o RAM libera < 15%).',
        'Others: messages you did not type (shown muted) and the load queue (CPU > 75% or free RAM < 15%).'),
      // brain-template/ops/tools/signals-regex.mjs; ADR 0047
      b('Rilevare le correzioni nel testo libero e il giudice a campione dei lavori vivono negli strumenti del brain.',
        'Detecting corrections in free text and the sample judge of works live in the brain’s tools.'),
    ],
    analogy: b('Come lo smistamento della posta in portineria: regole fisse e scritte, e una casella «varie» quando non si capisce.',
      'Like mail sorting at the front desk: fixed written rules, and a "misc" box when it is unclear.'),
    diagram: { kind: 'flow', steps: [b('Testo o evento', 'Text or event'), b('Regole: regex, soglie', 'Rules: regex, thresholds'), b('Classe', 'Class'), b('Nel dubbio: default', 'When in doubt: default')] },
    tech: [
      // src/shared/contract.ts TaskKind
      tech(DATA, 'TaskKind: qa-run, review, bug-fix, ops-read, writing, triage, research-web, investigation, app-feature, regia, altro.',
        'TaskKind: qa-run, review, bug-fix, ops-read, writing, triage, research-web, investigation, app-feature, regia, altro.'),
      tech(LIMITS, 'Prompt letto per i primi 2000 caratteri; al massimo 3 comandi per risposta; blocco eseguibile ≤ 8000 caratteri.',
        'Prompt read for its first 2000 chars; at most 3 commands per reply; runnable block ≤ 8000 chars.'),
      // src/main/headline.ts
      tech(WHERE, 'Questi classificatori usano regole; altre funzioni chiamano un modello, come la battuta della Dashboard.',
        'These classifiers use rules; other features call a model, such as the Dashboard headline.'),
    ],
    sources: ['src/main/brain/routing.ts', 'src/main/brain/brain-estimates.ts', 'src/shared/runnable.ts', 'src/main/run/runner.ts', 'src/shared/command-ask.ts', 'src/shared/waiting.ts', 'src/main/chats/regia-delivery.ts', 'src/renderer/lib/foreign.ts', 'src/main/chats/admission.ts', 'src/main/headline.ts', 'src/main/agents/catalog.ts', 'src/main/wiring.ts'],
  },
  {
    id: 'permissions',
    title: b('Permessi e tetto dei permessi', 'Permissions and the permission ceiling'),
    summary: b('Quando un agente vuole fare qualcosa di delicato, la CLI chiede: l’app ti mostra il pannello e rispetta il tetto dell’agente.',
      'When an agent wants to do something sensitive, the CLI asks: the app shows you the panel and enforces the agent’s ceiling.'),
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
      b('Il tetto di un agente può essere plan, default o acceptEdits: una modalità più alta viene abbassata al tetto.',
        'An agent’s ceiling can be plan, default or acceptEdits: a higher mode is lowered to the ceiling.'),
      // src/main/chats/manager.ts (reset above ceiling, chat:set refusal)
      b('Se il motore sale da solo sopra il tetto, l’app lo riporta giù; cambiarlo a mano sopra il tetto è rifiutato.',
        'If the engine climbs above the ceiling by itself, the app sets it back; raising it by hand above the ceiling is refused.'),
      // src/main/agents/tool-policy.ts FAIL_CLOSED
      b('Una politica salvata illeggibile vale «solo lettura, tetto plan».', 'An unreadable stored policy means "read only, plan ceiling".'),
    ],
    analogy: b('Come la carta aziendale con un massimale: puoi chiedere un’autorizzazione, ma oltre il tetto non passa.',
      'Like a company card with a limit: you can ask for approval, but above the limit it does not go through.'),
    diagram: { kind: 'flow', steps: [b('Agente vuole agire', 'Agent wants to act'), b('Richiesta della CLI', 'CLI request'), b('Pannello', 'Panel'), b('Tua risposta', 'Your answer')] },
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
    target: [
      b('Il tetto dei permessi non si modifica ancora dall’interfaccia: arriva solo con il salvataggio dell’agente.',
        'The permission ceiling cannot be edited from the UI yet: it only comes with the agent’s saved data.'),
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
      // src/main/chats/regia-wake.ts QUIET; no timeout
      b('Non c’è scadenza: la richiesta sparisce solo se rispondi, se la CLI la ritira o se chiudi la chat.',
        'There is no timeout: the request goes away only if you answer, the CLI withdraws it, or you close the chat.'),
    ],
    analogy: b('Come i post-it sulla scrivania: restano lì finché non li togli tu, e puoi decidere di guardarli dopo pranzo.',
      'Like sticky notes on the desk: they stay until you remove them, and you can decide to look at them after lunch.'),
    diagram: { kind: 'flow', steps: [b('Chat chiede', 'Chat asks'), b('In attesa', 'Pending'), b('Riquadro o finestra', 'Tile or window'), b('Risposta', 'Answer'), b('La chat riparte', 'Chat resumes')] },
    tech: [
      tech(DATA, "Answer = { kind: 'permission', allow, always?, message? } | { kind: 'question', answers }.", "Answer = { kind: 'permission', allow, always?, message? } | { kind: 'question', answers }."),
      tech(FILES, 'Impostazione questionsModal (default false); stato «Rispondi dopo» in userData/answer-later.json.', 'Setting questionsModal (default false); "Answer later" state in userData/answer-later.json.'),
      tech(WHERE, 'Le domande non svegliano l’Orchestrator da sole (regia-wake.ts); l’ordine è quello di arrivo.', 'Questions never wake the Orchestrator by themselves (regia-wake.ts); the order is arrival order.'),
    ],
    sources: ['src/renderer/store/state.ts', 'src/renderer/lib/questions.ts', 'src/renderer/components/QuestionsWindow.tsx', 'src/renderer/components/TopBar.tsx', 'src/renderer/lib/later.ts', 'src/main/later.ts', 'src/main/chats/regia-wake.ts', 'src/shared/contract.ts'],
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
      b('Una striscia con un browser agganciato mostra un piccolo globo. I browser restano chiusi finché non premi il globo: allora stanno accanto alla chat aperta, oppure sotto se lo spazio è stretto, e ognuno si può mettere a tutto schermo. Restano visibili sempre quelli che richiedono il tuo intervento o sono massimizzati.',
        'A strip with an attached browser shows a small globe. Its browsers stay folded until you press the globe: then they sit beside the expanded chat, or below in a narrow space, and each can go full screen. Those awaiting your intervention or maximized always show.'),
      // src/renderer/components/ChildStrips.tsx
      b('Sotto ogni striscia compaiono i sottoagenti e i comandi ancora al lavoro; quelli finiti spariscono subito (l’elenco completo resta in «Dettagli e collaboratori»).',
        'Under each strip appear the subagents and commands still at work; finished ones leave at once (the full list stays in "Details and collaborators").'),
      // src/renderer/lib/agent-estimates.ts
      b('Una striscia al lavoro di un agente mostra una stima tratteggiata di tempo e costo: è la mediana delle sue esecuzioni concluse (almeno 3), non il tempo né il costo di questa esecuzione.',
        'A working agent strip shows a dashed estimate of time and cost: the median of its ended runs (at least 3), not this run’s own time or cost.'),
      // src/renderer/components/ChatTile.tsx
      b('Una striscia chiusa mostra agente, stato, sforzo e l’ultima risposta; aperta mostra la conversazione e l’input.',
        'A collapsed strip shows agent, state, effort and the last answer; expanded it shows the conversation and the input.'),
      // src/renderer/components/BrowserTile.tsx
      b('I browser nascosti (Ctrl+Shift+B) continuano a lavorare fuori schermo.', 'Hidden browsers (Ctrl+Shift+B) keep working off screen.'),
    ],
    analogy: b('Come il banco di regia di uno studio: un fader per ogni canale, e il monitor di ciascuno sotto.',
      'Like a studio mixing desk: one fader per channel, and each one’s monitor below it.'),
    tech: [
      tech(WHERE, 'Pagina «home» (brain/pages/Home.tsx), strisce in components/AgentStrips.tsx, ordine in lib/agent-order.ts; ADR 0068.',
        'Page "home" (brain/pages/Home.tsx), strips in components/AgentStrips.tsx, order in lib/agent-order.ts; ADR 0068.'),
      tech(DATA, 'Una striscia è aperta se prefs.chatExpanded[id], i suoi browser se anche prefs.browserOpen[id]; nessun ordine salvato, nessun trascinamento.', 'A strip is expanded if prefs.chatExpanded[id], its browsers if prefs.browserOpen[id] too; no saved order, no dragging.'),
    ],
    sources: ['src/renderer/brain/pages/Home.tsx', 'src/renderer/components/AgentStrips.tsx', 'src/renderer/lib/agent-order.ts', 'src/renderer/lib/grid.ts', 'src/renderer/components/ChatTile.tsx', 'src/renderer/components/BrowserTile.tsx'],
  },
  {
    id: 'dashboard',
    title: b('La Dashboard', 'The Dashboard'),
    summary: b('Sei viste dal vivo su agenti, brain, costi, contesto, errori e spunti, tutte da dati reali.',
      'Six live views on agents, brain, costs, context, errors and tips, all from real data.'),
    points: [
      // src/renderer/dashboard/Dashboard.tsx, src/renderer/dashboard/data.ts
      b('«Mappa agenti»: le chat aperte e chi parla con chi (proprietà dell’Orchestrator, messaggi tra chat).',
        '"Agents map": open chats and who talks to whom (Orchestrator ownership, messages between chats).'),
      b('«Mappa brain»: le note del brain e i loro collegamenti, letti ogni 30 secondi.', '"Brain map": the brain’s notes and their links, read every 30 seconds.'),
      b('«Costi» per giorno, modello, motore e agente; «Token e contesto» avvisa all’80% della finestra di compattazione Claude, se riportata con il contesto misurato; altrimenti usa contextWarnTokens (default 200 000).',
        '"Costs" by day, model, engine and agent; "Tokens & context" warns at 80% of the Claude compaction window when reported with measured context; otherwise it uses contextWarnTokens (default 200,000).'),
      b('«Errori» da ai-errors.md e dagli eventi; «Spunti» deriva segnali come contesti lunghi e costi alti.',
        '"Errors" from ai-errors.md and events; "Tips" derives signals such as long contexts and high costs.'),
      b('Ogni pannello ha «Discutine»: mette una bozza all’Orchestrator, non la invia mai da solo.',
        'Every panel has "Discuss": it puts a draft in the Orchestrator, never sends it by itself.'),
    ],
    analogy: b('Come il quadro strumenti dell’auto: non guida, ma ti dice com’è la situazione adesso.',
      'Like a car’s instrument panel: it does not drive, it tells you how things are right now.'),
    tech: [
      tech(DATA, 'Un contesto non riportato conta come sconosciuto, mai come sotto soglia.', 'An unreported context counts as unknown, never as below the threshold.'),
      tech(WHERE, 'API del brain /api/map, /api/cost, /api/tables più lo stato delle chat dell’app.', 'Brain APIs /api/map, /api/cost, /api/tables plus the app’s chat state.'),
    ],
    sources: ['src/renderer/dashboard/Dashboard.tsx', 'src/renderer/dashboard/data.ts', 'src/shared/context.ts'],
  },
  {
    id: 'brain',
    title: b('Il brain: memoria e procedure', 'The brain: memory and procedures'),
    summary: b('Una cartella di note scelta all’installazione: parte vuota, gli agenti la leggono e la scrivono, l’app la mostra dal vivo.',
      'A folder of notes chosen at setup: it starts empty, agents read and write it, the app shows it live.'),
    points: [
      // src/main/brain/detect.ts isBrainFolder
      b('Si riconosce da brain.json (un brain nuovo) oppure da AGENTS.md più ops/tools/brain-site.mjs (un brain di prima); il percorso è salvato in config.json (brainRoot).',
        'It is recognised by brain.json (a new brain) or by AGENTS.md plus ops/tools/brain-site.mjs (an older brain); the path is saved in config.json (brainRoot).'),
      // src/main/rules/new-brain.ts writeFreshBrain, src/main/rules/tools.ts (ADR 0072)
      b('Un brain nuovo contiene solo me.md (il tuo profilo) e brain.json: regole, procedure, skill, agenti e strumenti dell’app restano nell’app e arrivano a ogni chat. now.md, ideas.md, ai-errors.md e journal/ nascono al primo uso.',
        'A new brain holds only me.md (your profile) and brain.json: the app’s rules, procedures, skills, agents and tools stay in the app and reach every chat. now.md, ideas.md, ai-errors.md and journal/ appear on first use.'),
      // brain-template/ops/tools/mem.mjs; src/main/brain/profile.ts; src/main/chats/mail.ts; src/main/skills/service.ts
      b('Gli strumenti del brain aggiornano le note con mem.mjs; l’app scrive anche il profilo me.md, la posta in ops/state/inbox/, brain-settings.json e file di skill/agenti, oltre allo stato in ops/state/improve/.',
        'Brain tools update notes through mem.mjs; the app also writes the me.md profile, mail under ops/state/inbox/, brain-settings.json and skill/agent files, as well as state in ops/state/improve/.'),
      // src/main/brain/live.ts
      b('Il feed dal vivo osserva la cartella e mostra le novità (idee, errori, decisioni…); «mentre eri via» segna quelle arrivate a app chiusa.',
        'The live feed watches the folder and shows what changed (ideas, errors, decisions…); "while you were away" marks those that came while the app was closed.'),
      // src/main/brain/procedures.ts
      b('«Procedure» trova da sola runbook e passi numerati; nasconde le righe che sembrano credenziali e non esegue mai nulla.',
        '"Procedures" finds runbooks and numbered steps by itself; hides lines that look like credentials and never runs anything.'),
      // src/main/brain/domains.ts, src/main/brain/sync.ts
      b('Più domini e sincronizzazione tra PC sono opzionali (domain.json); prima di ogni push passa il controllo di pubblicazione.',
        'Several domains and sync between PCs are optional (domain.json); every push goes through the publish guard first.'),
    ],
    analogy: b('Come il quaderno di bordo condiviso di un equipaggio: chi entra in turno lo legge, chi esce scrive cosa è successo.',
      'Like a crew’s shared logbook: whoever starts a shift reads it, whoever ends one writes what happened.'),
    diagram: { kind: 'cycle', steps: [b('Agente legge', 'Agent reads'), b('Lavora', 'Works'), b('mem.mjs scrive', 'mem.mjs writes'), b('Feed dal vivo', 'Live feed')] },
    tech: [
      // src/main/brain/live.ts debounce; src/main/brain/index.ts FEED_MAX
      tech(LIMITS, 'Feed: osservazione con attesa di 400 ms, 500 eventi tenuti; procedure: profondità 4, 400 file, 512 KB per file.',
        'Feed: watching with a 400 ms debounce, 500 events kept; procedures: depth 4, 400 files, 512 KB per file.'),
      tech(DATA, "domain.json { name, scope: 'everywhere' | 'this-pc', remote?, denyList? }; senza file = un dominio «solo questo PC».",
        "domain.json { name, scope: 'everywhere' | 'this-pc', remote?, denyList? }; no file = one \"this PC only\" domain."),
      tech(WHERE, 'Il server dati del brain (brain-site.mjs) gira su una porta 127.0.0.1; il main inoltra solo GET su percorsi ammessi.',
        'The brain’s data server (brain-site.mjs) runs on a 127.0.0.1 port; main forwards only GETs on allowed paths.'),
    ],
    sources: ['src/main/rules/new-brain.ts', 'src/main/rules/tools.ts', 'src/main/brain/detect.ts', 'src/main/brain/live.ts', 'src/main/brain/index.ts', 'src/main/brain/procedures.ts', 'src/main/brain/domains.ts', 'src/main/brain/sync.ts', 'src/main/brain/profile.ts', 'src/main/chats/mail.ts', 'src/main/brain/brain-settings.ts', 'src/main/skills/service.ts', 'brain-template/ops/tools/mem.mjs', 'brain-template/map.md'],
  },
  {
    id: 'search',
    title: b('La ricerca (Ctrl+K)', 'Search (Ctrl+K)'),
    summary: b('Cerca per parole in chat, messaggi, branch e note del brain. Oggi è solo testuale: niente embeddings, niente modello.',
      'Searches by words in chats, messages, branches and brain notes. Today it is text only: no embeddings, no model.'),
    points: [
      // src/main/search/service.ts
      b('Indicizza le chat degli ultimi 30 giorni (sempre quelle aperte), i branch git delle cartelle delle chat e i file .md del brain.',
        'It indexes chats of the last 30 days (open ones always), the git branches of the chats’ folders and the brain’s .md files.'),
      // src/main/search/text-index.ts
      b('Ogni parola della ricerca deve comparire; maiuscole e accenti non contano.', 'Every word of the query must appear; case and accents do not matter.'),
      b('Punteggio: corrispondenza nel titolo, poi frase intera, poi parole sparse, più un premio per le cose recenti.',
        'Score: a match in the title, then the whole phrase, then loose words, plus a bonus for recent things.'),
      b('L’indice si aggiorna solo quando cerchi (al massimo ogni 2 secondi), senza timer né osservatori.', 'The index refreshes only when you search (at most every 2 seconds), with no timer or watcher.'),
      // src/renderer/components/CommandPalette.tsx
      b('Risultati in gruppi: «Chat trovate», «Nei messaggi», «Branch», «Nel brain»; al massimo 6 per gruppo.',
        'Results in groups: "Chats found", "In messages", "Branches", "In the brain"; at most 6 per group.'),
    ],
    analogy: b('Come l’indice analitico di un libro: trova le parole esatte, non i concetti simili.',
      'Like a book’s index: it finds the exact words, not similar ideas.'),
    tech: [
      tech(LIMITS, 'Ricerca da 2 a 200 caratteri; 2 000 000 caratteri per chat; 4000 file del brain, 1 MB l’uno.', 'Query from 2 to 200 chars; 2,000,000 chars per chat; 4000 brain files, 1 MB each.'),
      tech(DATA, 'Titolo 600 + testo + recenza (fino a 150, lineare su 30 giorni); frase 200; parole 100.', 'Title 600 + text + recency (up to 150, linear over 30 days); phrase 200; words 100.'),
      tech(WHERE, 'Indice in memoria nel processo main (src/main/search), canale search:query.', 'In-memory index in the main process (src/main/search), channel search:query.'),
    ],
    // TODO(after PR #12 feat/hybrid-search merges): describe the hybrid search in `points` and `tech` from its code, drop `coming`
    coming: [
      { pr: 12, text: b('Ricerca ibrida (parole + significato): è nella PR #12, non ancora su main. Oggi la ricerca è solo testuale.',
        'Hybrid search (words + meaning): it is in PR #12, not on main yet. Today search is text only.') },
    ],
    sources: ['src/main/search/service.ts', 'src/main/search/text-index.ts', 'src/main/search/sources.ts', 'src/renderer/components/CommandPalette.tsx', 'docs/adr/0023-full-text-search.md'],
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
      b('Testo fino a 1 MB; Markdown senza immagini; .jsonl come tabella; il resto come codice numerato.', 'Text up to 1 MB; Markdown without images; .jsonl as a table; the rest as numbered code.'),
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
    sources: ['src/shared/file-view.ts', 'src/main/file-view.ts', 'src/main/peek-file.ts', 'src/main/index.ts', 'src/renderer/brain/pages/FileViewer.tsx'],
  },
  {
    id: 'routing',
    title: b('Instradamento modelli', 'Model routing'),
    summary: b('Una tabella decide motore, modello e sforzo di ogni chat in base al tipo di lavoro e all’area.',
      'A table decides each chat’s engine, model and effort based on the kind of work and the area.'),
    points: [
      // src/main/brain/routing.ts taskOf, areaOf
      b('Il tipo di lavoro viene dal titolo e dal primo prompt, salvo un tipo esplicito; l’area dal chiamante o dal titolo, con App forzata nello spazio dell’app.',
        'Kind comes from the title and first prompt unless supplied explicitly; area comes from the caller or title, with App forced in the app workspace.'),
      // src/main/brain/routing.ts match
      b('Vince la riga più specifica: tipo + area, poi area, poi tipo, poi «qualsiasi»; a pari merito la prima.',
        'The most specific row wins: kind + area, then area, then kind, then "any"; on a tie the first one.'),
      // src/main/brain/routing.ts resolve
      b('Se la riga indica un motore che non si può avviare, valgono i tuoi predefiniti «Chat aperte dall’Orchestrator».',
        'If the row names an engine that cannot start, your "Chats opened by the Orchestrator" defaults apply.'),
      b('Un agente che vuole un modello diverso dalla tabella deve dare un motivo; lo sforzo max mai dalla tabella.',
        'An agent wanting a model other than the table’s must give a reason; max effort never from the table.'),
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
    summary: b('Tu usi una copia stabile e congelata. Oggi l’app scarica e prepara la versione nuova, ma non la installa da sola.',
      'You use a frozen stable copy. Today the app downloads and prepares the new version, but does not install it by itself.'),
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
      // src/main/wiring.ts allowLegacyPromotion: false
      b('Il vecchio «Aggiorna» in «Migliora l’app» è disattivato e rimanda al pacchetto preparato.',
        'The old "Aggiorna" button in "Improve the app" is disabled and points to the prepared package.'),
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
    sources: ['scripts/release.mjs', 'src/main/update/download.ts', 'src/main/update/wiring.ts', 'src/main/update/checkpoint.ts', 'src/main/wiring.ts', 'docs/adr/0007-self-hosting.md'],
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

/** What goes to the Orchestrator when no explainer agent exists: reuse one from the catalog, else propose one (it
 *  cannot write the catalog: src/main/appctl/tools.ts has no catalog-writing tool), and the card as context. */
export function regiaText(card: ConceptCard, lang: GuideLang): string {
  const ask = lang === 'en'
    ? `I want to discuss the concept «${card.title.en}» from the app's guide. Look in agent_catalog for an explainer agent ("${EXPLAINER_NAME}"): if there is one, open a chat with it through app_create_chat with its agentId and pass it the context below. If there is none, you cannot create it yourself: propose its definition (name "${EXPLAINER_NAME}", purpose, instructions, when to use it) so I can save it in "Manage agents", and meanwhile explain the concept to me yourself.`
    : `Voglio discutere il concetto «${card.title.it}» della guida dell'app. Cerca in agent_catalog un agente che spiega ("${EXPLAINER_NAME}"): se c'è, apri una chat con lui con app_create_chat e il suo agentId e passagli il contesto qui sotto. Se non c'è, non puoi crearlo tu: proponimi la sua definizione (nome "${EXPLAINER_NAME}", scopo, istruzioni, quando usarlo) da salvare in «Gestisci agenti», e intanto spiegami tu il concetto.`;
  return `${ask}\n\n---\n${discussText(card, lang)}`;
}

export const EXPLAINER_NAME = 'Explainer';
/** Only explicit names/ids identify the explainer; role can be ordinary purpose prose. */
const EXPLAINER = /^(explainer|spiegazioni)$/i;
export function isExplainer(p: { id: string; name: string; role?: string | null }): boolean {
  return EXPLAINER.test(p.id.trim()) || EXPLAINER.test(p.name.trim());
}
