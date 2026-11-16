// The project map's MCP tools (ADR 0271):
// - project_map_read, project_map_save, project_map_update on every chat's own endpoint: the agent that reads a project
//   draws it (save: the whole drawing, a new version); the agents at work keep it current (update: the status of what
//   they touched, and working_on, the elements they work on, which binds them on the map). Read first: a redraw keeps
//   the element ids, the statuses it does not change and the user's corrections.
// - app_project_map on the Orchestrator's own endpoint: list, read (the map as text with its agents, to answer «a che
//   punto è X»), open (the Mappa page on that project, optionally zoomed into a system), brief (the self-contained task
//   for a Scout chat that draws or redraws it: the Orchestrator starts it with app_create_chat), correct (the user's
//   correction, kept for every later drawing), edit (ADR 0276: pieces added, changed, removed and linked from what the
//   user said, no redraw; a new piece is «previsto») and undo (the version before comes back).
// - Deeper, without code (ADR 0316): a part can hold its own pieces; each element can carry its rules, what it keeps,
//   why it is built so and its key files; a map carries paths, the project's questions told stop by stop (save sends
//   them all, update adds or drops some; brief with a question starts the Scout that answers one).
// Used by wiring-shared.ts (chat tools) and appctl/tools.ts (the Orchestrator's); pinned by test/unit/projectmap-tools.test.ts.
import type { EventMap } from '@shared/contract';
import { EDIT_OPS, MAP_ACTORS, MAP_KINDS, MAP_LIMITS, MAP_STATES, elementText, mapText, type ProjectMap } from '@shared/project-map';
import type { McpTool } from '../mcp/server';
import type { ProjectMaps } from './service';

const json = (v: unknown) => JSON.stringify(v);
const STATES = MAP_STATES.join(' | '), KINDS = MAP_KINDS.join(' | '), ACTORS = MAP_ACTORS.join(' | ');

const ELEMENT = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'stable id: lowercase letters, digits, dashes (keep it across redraws)' },
    kind: { type: 'string', enum: [...MAP_KINDS], description: `person = who uses it; system = the user's own system; external = a system of others it talks to; env = an environment (test host, pipeline); doc = a document; part = a piece inside a system (needs parent)` },
    name: { type: 'string', description: 'short name, in the user\'s language' },
    description: { type: 'string', description: 'what it is or does, one line (shown in the box)' },
    details: { type: 'string', description: 'how it works, 3 to 8 plain sentences in the user\'s language, no code: what it does step by step, what it reads and writes, the rules it applies, what happens when it fails, what is unusual in it. The user reads this in place of the code when the box is picked. Up to 1500 characters; a line break starts a paragraph. Omit on a redraw to keep the previous text.' },
    parent: { type: 'string', description: 'for a part: the id of the system, or of the part, it sits in (the user clicks a box to enter it)' },
    rules: { type: 'array', items: { type: 'string' }, description: 'the rules it applies, one short plain line each (limits, checks, when it refuses), up to 8' },
    keeps: { type: 'array', items: { type: 'string' }, description: 'what it keeps and where (a table, a file, a cache), one line each, up to 6' },
    why: { type: 'array', items: { type: 'string' }, description: 'why it is built this way: the decisions behind it (an ADR, a constraint), one line each, up to 6' },
    keyFiles: { type: 'array', items: { type: 'object', properties: { path: { type: 'string', description: 'relative to the root' }, what: { type: 'string', description: 'what it holds, one line' } }, required: ['path', 'what'] }, description: 'the 1-4 files worth opening first to see it at work (the user opens them in the app\'s viewer), up to 8' },
    status: { type: 'string', enum: [...MAP_STATES], description: 'ok = works or done; work = being built; blocked = stuck; planned = not started yet (planned, not there); unknown = not known. Omit to keep the previous one.' },
    note: { type: 'string', description: `one short line, at most ${MAP_LIMITS.note} characters: what is missing, what the user must do` },
    actor: { type: 'string', enum: [...MAP_ACTORS], description: 'who must act when it is blocked: user, agent, other (a colleague, a team)' },
    evidence: { type: 'array', items: { type: 'string' }, description: `the project files or folders (ending in /) it was read from, relative to the root (up to ${MAP_LIMITS.evidence}): the app watches them. Only paths inside the root: an absolute path or one with ../ is refused; name a source outside it (another repo, a wiki, the brain) in the note or details text instead.` },
  },
  required: ['id', 'kind', 'name'],
};
const LINK = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'stable id (default from--to)' }, from: { type: 'string' }, to: { type: 'string' },
    label: { type: 'string', description: 'what goes along it, a few words («chiama gli strumenti», «legge gli ordini»)' },
    details: { type: 'string', description: 'the passage in full, 1 to 4 plain sentences: when it happens, which data goes, how (a call, a file, a queue, by hand), what comes back, what happens if it fails. Up to 800 characters. Omit on a redraw to keep the previous text.' },
    status: { type: 'string', enum: [...MAP_STATES] }, note: { type: 'string', description: `at most ${MAP_LIMITS.note} characters` }, actor: { type: 'string', enum: [...MAP_ACTORS] },
  },
  required: ['from', 'to', 'label'],
};

const PATH = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'stable id (default from the question)' },
    question: { type: 'string', description: 'the question, in the user\'s language' },
    stops: { type: 'array', items: { type: 'object', properties: {
      on: { type: 'string', description: 'element id' }, text: { type: 'string', description: 'what happens there, 1-3 plain sentences, no code' },
      file: { type: 'string', description: 'optional: the file where it happens, relative to the root' } }, required: ['on', 'text'] }, description: '2 to 12 stops, in the order things happen' },
  },
  required: ['question', 'stops'],
};

export interface ChatMapDeps { maps: ProjectMaps; titleOf(chatId: string): string | null; cwdOf(chatId: string): string | null }

const projectOf = (maps: ProjectMaps, v: unknown): string => {
  const name = typeof v === 'string' ? v : '';
  const p = maps.resolve(name);
  if (!p) throw new Error(`nessuna mappa «${name.slice(0, 80)}»: ${maps.list().map(m => m.project).join(', ') || 'nessuna ancora'} (project_map_save la crea)`);
  return p;
};

export function chatMapTools(d: ChatMapDeps): McpTool[] {
  return [
    {
      name: 'project_map_read',
      description: 'The user\'s project maps (Mappa page → Progetti): each project drawn as people, systems, environments and the parts inside each system, with the links between them, their status and who must act. Without project: the list. With project: that map as text (ids, statuses, «da verificare» when nobody confirmed it lately or its files changed, the agents bound, the user\'s corrections). Read it before working on a mapped project: then say what you work on and update the status of what you finish with project_map_update.',
      inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'project name or id' }, element: { type: 'string', description: 'with project: one element in full (its details, its files, every link in and out with what goes along it)' } }, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      run: a => {
        if (typeof a.project !== 'string' || !a.project.trim()) return json({ projects: d.maps.list() });
        const v = d.maps.view(projectOf(d.maps, a.project))!;
        if (typeof a.element === 'string' && a.element) return elementText(v.map, a.element, Date.now(), v.changed);
        return mapText(v, Date.now());
      },
    },
    {
      name: 'project_map_save',
      description: `Draw (or redraw) a project's map for the user: what they look at instead of the code. Read the project first (code, configuration, pipelines, README, the brain's notes) and draw what it IS: who uses it (person), the user's system(s) (system) and their main parts (part, parent = the system), the external systems it talks to (external), the environments (env: test host, pipeline) and key documents (doc); the links with what goes along them. Keep it small enough to read (about 5-15 elements per level); a part with several pieces of its own holds them (parent = the part), so the user enters it and sees them. Give each element its status as far as you know it and the files you read it from (evidence, relative to the root: the app watches them). Never invent what the project does not show: mark it unknown with a note, and ask. The user reads this map in place of the code, to see how the system works and to spot what is wrong in its structure himself: draw what is there plainly, each link with what really goes along it. The boxes stay short; the substance goes in details, on every element and every link you understood, and in rules, keeps, why and keyFiles: a map with one-line boxes and nothing behind them tells the user too little. Add paths: the project's key questions told stop by stop. A redraw: read the map first (project_map_read), keep the ids, respect the user's corrections. Every save is a version in the map's history. kinds: ${KINDS}; statuses: ${STATES} (planned = not started yet); actors: ${ACTORS}. Limits, refused otherwise: evidence only inside the root (no absolute path, no ../), note at most ${MAP_LIMITS.note} characters, name ${MAP_LIMITS.name}, description ${MAP_LIMITS.description}, details ${MAP_LIMITS.details} (links ${MAP_LIMITS.linkDetails}). Renaming or moving a box, or adding one, is a save (or app_project_map edit for the Orchestrator): project_map_update changes only status, note, actor and paths.`,
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'an existing map\'s name or id (redraw); omit for a new one and give title' },
          title: { type: 'string', description: 'the project\'s name, in the user\'s language (a new map)' },
          root: { type: 'string', description: 'the project\'s folder on this PC (absolute); default: the map\'s folder, or yours for a new map' },
          summary: { type: 'string', description: 'what this version changes, one line in the user\'s language' },
          elements: { type: 'array', items: ELEMENT },
          links: { type: 'array', items: LINK },
          paths: { type: 'array', items: PATH, description: 'every path of the map (omit to keep the previous ones): 3-6 key questions about the project («Cosa succede quando…», «Come fa…»), each told stop by stop on the elements' },
        },
        required: ['elements', 'summary'], additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: (a, ctx) => {
        const chatId = ctx.params.chatId;
        const root = typeof a.root === 'string' && a.root.trim() ? a.root.trim() : undefined, cwd = chatId ? d.cwdOf(chatId) ?? undefined : undefined;
        const m = d.maps.save({ ...(typeof a.project === 'string' ? { project: a.project } : {}), ...(typeof a.title === 'string' ? { title: a.title } : {}), ...(root ? { root } : {}), ...(cwd ? { defaultRoot: cwd } : {}),
          map: { elements: a.elements, links: a.links, ...(a.paths !== undefined ? { paths: a.paths } : {}) }, by: (chatId ? d.titleOf(chatId) : null) || 'agente', summary: typeof a.summary === 'string' ? a.summary : '' });
        return json({ ok: true, project: m.project, version: m.version, elements: m.elements.length, links: m.links.length, paths: m.paths?.length ?? 0, root: m.root ?? null });
      },
    },
    {
      name: 'project_map_update',
      description: `Keep a project's map current while you work: working_on = the element ids you work on now (you show on the map beside them, with your progress); changes = the new status of what you finished, broke or found blocked (each confirmed now; a status nobody confirms for 2 hours, or whose files changed after it, reads «da verificare»). Call it when you start on a mapped project and before your report. statuses: ${STATES} (planned = a piece of a plan, not there yet); actor (who must act when blocked): ${ACTORS}. It changes only status, note (at most ${MAP_LIMITS.note} characters) and actor of existing ids, and the paths: a name, a description, a new box or link need project_map_save. A step of a plan drawn on the map moves its element by itself: no call needed for it. paths = add or tell again (same id) the project's questions as walks on the map; drop_paths = path ids to take away. A structural change (a new system, part or link) is a redraw: project_map_save.`,
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'the map\'s name or id' },
          working_on: { type: 'array', items: { type: 'string' }, description: 'element ids you work on now' },
          changes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', description: 'element or link id' }, status: { type: 'string', enum: [...MAP_STATES] }, note: { type: 'string', description: `at most ${MAP_LIMITS.note} characters` }, actor: { type: 'string', enum: [...MAP_ACTORS] } }, required: ['id'] } },
          paths: { type: 'array', items: PATH, description: 'walks to add, or to replace by id' },
          drop_paths: { type: 'array', items: { type: 'string' }, description: 'path ids to take away' },
          summary: { type: 'string', description: 'one line for the history (default: which ids changed)' },
        },
        required: ['project'], additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: (a, ctx) => {
        const chatId = ctx.params.chatId;
        if (a.working_on === undefined && a.changes === undefined && a.paths === undefined && a.drop_paths === undefined) throw new Error('working_on, changes, paths or drop_paths: at least one');
        const r = d.maps.update(projectOf(d.maps, a.project), { changes: a.changes, workingOn: a.working_on, paths: a.paths, dropPaths: a.drop_paths, ...(chatId ? { chatId } : {}), by: (chatId ? d.titleOf(chatId) : null) || 'agente', ...(typeof a.summary === 'string' ? { summary: a.summary } : {}) });
        return json({ ok: true, version: r.map?.version ?? null, changed: r.touched });
      },
    },
  ];
}

interface Tool { name: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }; run(a: Record<string, unknown>): string | object }

/** The task for a Scout chat that draws a project (app_project_map brief). */
export function drawBrief(title: string, root: string, prev: ProjectMap | null): string {
  return [
    prev ? `Ridisegna la mappa del progetto «${prev.title}» (project_map_read "${prev.project}" prima: tieni gli id, rispetta le correzioni dell'utente).`
      : `Disegna la mappa del progetto «${title}» per l'utente: è quello che guarda al posto del codice.`,
    `Cartella del progetto: ${root}.`,
    'Leggi il progetto (codice, configurazioni, pipeline, README, note del brain su di lui) e chiamati project_map_save con: chi lo usa, i suoi sistemi e le loro parti principali, i sistemi esterni con cui parla, gli ambienti, i collegamenti con cosa passa. 5-15 elementi per livello, nomi brevi in italiano.',
    'I riquadri restano brevi; la sostanza va in `details`, su ogni elemento e su ogni collegamento che hai capito: come funziona in 3-8 frasi semplici (cosa fa passo per passo, cosa legge e scrive, le regole che applica, cosa succede se fallisce), e per un collegamento quando avviene, quali dati passano, come, cosa torna indietro. L\'utente legge questo al posto del codice: niente codice, niente gergo.',
    'Più a fondo: una parte con più pezzi suoi li contiene (parent = la parte), fino a 4 livelli, così l\'utente ci entra. Su ogni elemento che hai capito: `rules` (le regole che applica), `keeps` (cosa tiene e dove), `why` (perché è fatto così: le decisioni, un ADR) e `keyFiles` (1-4 file da aprire per vederlo, con cosa contengono). Poi `paths`: 3-6 domande chiave sul progetto («Cosa succede quando…», «Come fa…») raccontate tappa per tappa sui riquadri, nell\'ordine in cui le cose succedono.',
    'Per ogni elemento: lo stato per quanto lo sai (ok, work, blocked, unknown), chi deve agire se è bloccato, e i file da cui l\'hai capito (evidence). Quello che il progetto non mostra non inventarlo: unknown con una nota.',
    'Sola lettura: non cambiare file del progetto. Alla fine riporta in 3 righe cosa hai disegnato e cosa resta da capire.',
  ].join('\n');
}

/** The task for a Scout chat that answers one question as a path on the map (app_project_map brief with question). */
export function pathBrief(map: ProjectMap, question: string): string {
  return [
    `Sulla mappa del progetto «${map.title}» (${map.project}) l'utente chiede: «${question}».`,
    `Cartella del progetto: ${map.root ?? 'quella della mappa'}. Leggi prima la mappa (project_map_read "${map.project}") e poi il codice che serve per rispondere.`,
    'Rispondi con un percorso sulla mappa: project_map_update con paths = [{ question, stops }], 2-12 tappe nell\'ordine in cui le cose succedono, ognuna su un elemento della mappa (on = il suo id) con cosa succede lì in 1-3 frasi semplici, senza codice, e se serve il file dove succede (file, relativo alla cartella).',
    'Se manca un pezzo per raccontarlo, mettilo sulla mappa prima (project_map_save, tenendo id, stati e correzioni). Sola lettura del progetto: non cambiare file. Alla fine riporta in 2 righe il percorso che hai aggiunto.',
  ].join('\n');
}

export function appProjectMapTool(maps: ProjectMaps, emitUi: (cmd: EventMap['ui:command']) => void): Tool {
  return {
    name: 'app_project_map',
    description: 'The user\'s project maps (Mappa page → Progetti, ADR 0271): each project drawn as people, systems, parts, environments and links, with their status, who must act, the agents at work on each part and the history from the first drawing. Use it when the user asks how a project is built, where it stands, or for its map, diagram, schema, lines («fili»): open shows the real map in a window (never draw your own diagram of a project with app_show_ui); none drawn yet → brief a Scout. action: list | read (the map as text, to answer; with element = that piece in full: how it works, its files, every link with what goes along it) | open (the maps window on screen, at project, element = a system to step into; no project = the maps window as it is) | brief (the task for a Scout chat that draws or redraws it: pass title and root for a new one, then start the Scout with app_create_chat, cwd = root; with question = the user\'s question about the project, the Scout answers it as a path on the map, a walk box by box) | correct (text = the user\'s correction, kept for every later drawing; then brief a redraw if the drawing must change) | edit (ops = the pieces the talk with the user adds, changes or removes, at once and without a redraw: only you change a map, the user never does by hand; a new piece is «previsto», dashed, until work starts on it; read first for the ids; say what changed in one line) | undo (the last change comes back). The user\'s message says which map and box he looks at ([app · the user looks at …]): «qui», «questo» mean that one. Work planned in Plan mode is drawn by its Strategist; to change a plan under way, write to that Strategist (app_send_to_chat).',
    inputSchema: { type: 'object', properties: {
      action: { type: 'string', enum: ['list', 'read', 'open', 'brief', 'correct', 'edit', 'undo'] },
      project: { type: 'string', description: 'the map\'s name or id' },
      element: { type: 'string', description: 'open: a system to zoom into; read: the piece to tell in full' },
      title: { type: 'string', description: 'brief: the new project\'s name' },
      root: { type: 'string', description: 'brief: the project\'s folder on this PC' },
      question: { type: 'string', description: 'brief: a question about the project to answer as a path on the map' },
      text: { type: 'string', description: 'correct: the user\'s correction, in their words' },
      ops: { type: 'array', maxItems: 40, description: 'edit: the changes, in order', items: { type: 'object', required: ['op'], properties: {
        op: { type: 'string', enum: [...EDIT_OPS], description: 'add (name, kind, parent for a part) | set (id + what changes) | remove (id; its parts and links go too) | link (from, to, label) | unlink (id)' },
        id: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string', enum: [...MAP_KINDS] }, description: { type: 'string' }, details: { type: 'string', description: 'how it works (an element) or what goes along it in full (a link)' }, parent: { type: 'string' },
        status: { type: 'string', enum: [...MAP_STATES] }, note: { type: 'string' }, actor: { type: 'string', enum: [...MAP_ACTORS] }, from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } } } },
    }, required: ['action'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: a => {
      const action = String(a.action);
      if (action === 'list') return { projects: maps.list() };
      if (action === 'brief') {
        const prev = typeof a.project === 'string' && a.project ? maps.view(projectOf(maps, a.project))?.map ?? null : null;
        const question = typeof a.question === 'string' ? a.question.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
        if (question) {
          if (!prev) throw new Error('brief with question: the project of an existing map');
          if (!prev.root) throw new Error('brief with question: this map has no folder; brief a redraw with root first');
          return { roleId: 'scout', cwd: prev.root ?? '', title: `Percorso · ${question}`.slice(0, 80), prompt: pathBrief(prev, question) };
        }
        const root = typeof a.root === 'string' && a.root.trim() ? a.root.trim() : prev?.root;
        const title = typeof a.title === 'string' && a.title.trim() ? a.title.trim() : prev?.title;
        if (!root || !title) throw new Error('brief: title and root for a new map (or project for a redraw)');
        return { roleId: 'scout', cwd: root, title: `Mappa · ${title}`.slice(0, 80), prompt: drawBrief(title, root, prev) };
      }
      // open with no project: the maps window as the user left it (or «nessun progetto disegnato» with what to ask)
      if (action === 'open' && !(typeof a.project === 'string' && a.project)) { emitUi({ action: 'maps', value: '' }); return maps.list().length ? 'ok' : 'ok: nessuna mappa ancora, la finestra dice come chiederla'; }
      const project = projectOf(maps, a.project);
      if (action === 'read') return typeof a.element === 'string' && a.element ? elementText(maps.view(project)!.map, a.element, Date.now(), maps.view(project)!.changed) : mapText(maps.view(project)!, Date.now());
      if (action === 'open') {
        const el = typeof a.element === 'string' && a.element ? a.element : '';
        if (el && !maps.view(project)!.map.elements.some(e => e.id === el)) throw new Error(`element: no «${el}» in this map`);
        emitUi({ action: 'maps', value: `${project}${el ? `/${el}` : ''}` }); // ADR 0275: the maps window, in «Stato»'s place
        return 'ok';
      }
      if (action === 'correct') { const m = maps.correct(project, typeof a.text === 'string' ? a.text : ''); return { ok: true, version: m.version, corrections: m.corrections.length }; }
      if (action === 'edit') { const r = maps.edit(project, a.ops, 'Orchestrator'); return { ok: true, version: r.map.version, changed: r.did, added: r.added }; }
      if (action === 'undo') { const m = maps.undo(project, 'Orchestrator'); return { ok: true, version: m.version, summary: m.summary }; }
      throw new Error('action: list | read | open | brief | correct | edit | undo');
    },
  };
}
