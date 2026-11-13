// The project map's MCP tools (ADR 0271):
// - project_map_read, project_map_save, project_map_update on every chat's own endpoint: the agent that reads a project
//   draws it (save: the whole drawing, a new version); the agents at work keep it current (update: the status of what
//   they touched, and working_on, the elements they work on, which binds them on the map). Read first: a redraw keeps
//   the element ids, the statuses it does not change and the user's corrections.
// - app_project_map on the Orchestrator's own endpoint: list, read (the map as text with its agents, to answer «a che
//   punto è X»), open (the Mappa page on that project, optionally zoomed into a system), brief (the self-contained task
//   for a Scout chat that draws or redraws it: the Orchestrator starts it with app_create_chat), correct (the user's
//   correction, kept for every later drawing).
// Used by wiring-shared.ts (chat tools) and appctl/tools.ts (the Orchestrator's); pinned by test/unit/projectmap-tools.test.ts.
import type { EventMap } from '@shared/contract';
import { MAP_ACTORS, MAP_KINDS, MAP_STATES, mapText, type ProjectMap } from '@shared/project-map';
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
    description: { type: 'string', description: 'what it is or does, one line' },
    parent: { type: 'string', description: 'for a part: the id of the system it sits in (zoom)' },
    status: { type: 'string', enum: [...MAP_STATES], description: 'ok = works or done; work = being built; blocked = stuck; unknown = not known. Omit to keep the previous one.' },
    note: { type: 'string', description: 'one short line: what is missing, what the user must do' },
    actor: { type: 'string', enum: [...MAP_ACTORS], description: 'who must act when it is blocked: user, agent, other (a colleague, a team)' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'the project files or folders (ending in /) it was read from, relative to the root: the app watches them' },
  },
  required: ['id', 'kind', 'name'],
};
const LINK = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'stable id (default from--to)' }, from: { type: 'string' }, to: { type: 'string' },
    label: { type: 'string', description: 'what goes along it, a few words («chiama gli strumenti», «legge gli ordini»)' },
    status: { type: 'string', enum: [...MAP_STATES] }, note: { type: 'string' }, actor: { type: 'string', enum: [...MAP_ACTORS] },
  },
  required: ['from', 'to', 'label'],
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
      inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'project name or id' } }, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      run: a => {
        if (typeof a.project !== 'string' || !a.project.trim()) return json({ projects: d.maps.list() });
        const v = d.maps.view(projectOf(d.maps, a.project))!;
        return mapText(v, Date.now());
      },
    },
    {
      name: 'project_map_save',
      description: `Draw (or redraw) a project's map for the user: what they look at instead of the code. Read the project first (code, configuration, pipelines, README, the brain's notes) and draw what it IS: who uses it (person), the user's system(s) (system) and their main parts (part, parent = the system), the external systems it talks to (external), the environments (env: test host, pipeline) and key documents (doc); the links with what goes along them. Keep it small enough to read (about 5-15 elements per level). Give each element its status as far as you know it and the files you read it from (evidence, relative to the root: the app watches them). Never invent what the project does not show: mark it unknown with a note, and ask. A redraw: read the map first (project_map_read), keep the ids, respect the user's corrections. Every save is a version in the map's history. kinds: ${KINDS}; statuses: ${STATES}; actors: ${ACTORS}.`,
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'an existing map\'s name or id (redraw); omit for a new one and give title' },
          title: { type: 'string', description: 'the project\'s name, in the user\'s language (a new map)' },
          root: { type: 'string', description: 'the project\'s folder on this PC (absolute); default: the map\'s folder, or yours for a new map' },
          summary: { type: 'string', description: 'what this version changes, one line in the user\'s language' },
          elements: { type: 'array', items: ELEMENT },
          links: { type: 'array', items: LINK },
        },
        required: ['elements', 'summary'], additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: (a, ctx) => {
        const chatId = ctx.params.chatId;
        const root = typeof a.root === 'string' && a.root.trim() ? a.root.trim() : undefined, cwd = chatId ? d.cwdOf(chatId) ?? undefined : undefined;
        const m = d.maps.save({ ...(typeof a.project === 'string' ? { project: a.project } : {}), ...(typeof a.title === 'string' ? { title: a.title } : {}), ...(root ? { root } : {}), ...(cwd ? { defaultRoot: cwd } : {}),
          map: { elements: a.elements, links: a.links }, by: (chatId ? d.titleOf(chatId) : null) || 'agente', summary: typeof a.summary === 'string' ? a.summary : '' });
        return json({ ok: true, project: m.project, version: m.version, elements: m.elements.length, links: m.links.length, root: m.root ?? null });
      },
    },
    {
      name: 'project_map_update',
      description: `Keep a project's map current while you work: working_on = the element ids you work on now (you show on the map beside them, with your progress); changes = the new status of what you finished, broke or found blocked (each confirmed now; a status nobody confirms for 2 hours, or whose files changed after it, reads «da verificare»). Call it when you start on a mapped project and before your report. statuses: ${STATES}; actor (who must act when blocked): ${ACTORS}. A structural change (a new system, part or link) is a redraw: project_map_save.`,
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'the map\'s name or id' },
          working_on: { type: 'array', items: { type: 'string' }, description: 'element ids you work on now' },
          changes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', description: 'element or link id' }, status: { type: 'string', enum: [...MAP_STATES] }, note: { type: 'string' }, actor: { type: 'string', enum: [...MAP_ACTORS] } }, required: ['id'] } },
          summary: { type: 'string', description: 'one line for the history (default: which ids changed)' },
        },
        required: ['project'], additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: (a, ctx) => {
        const chatId = ctx.params.chatId;
        if (a.working_on === undefined && a.changes === undefined) throw new Error('working_on or changes: at least one');
        const r = d.maps.update(projectOf(d.maps, a.project), { changes: a.changes, workingOn: a.working_on, ...(chatId ? { chatId } : {}), by: (chatId ? d.titleOf(chatId) : null) || 'agente', ...(typeof a.summary === 'string' ? { summary: a.summary } : {}) });
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
    'Per ogni elemento: lo stato per quanto lo sai (ok, work, blocked, unknown), chi deve agire se è bloccato, e i file da cui l\'hai capito (evidence). Quello che il progetto non mostra non inventarlo: unknown con una nota.',
    'Sola lettura: non cambiare file del progetto. Alla fine riporta in 3 righe cosa hai disegnato e cosa resta da capire.',
  ].join('\n');
}

export function appProjectMapTool(maps: ProjectMaps, emitUi: (cmd: EventMap['ui:command']) => void): Tool {
  return {
    name: 'app_project_map',
    description: 'The user\'s project maps (Mappa page → Progetti, ADR 0271): each project drawn as people, systems, parts, environments and links, with their status, who must act, the agents at work on each part and the history from the first drawing. Use it when the user asks how a project is built, where it stands, or for its map, diagram, schema, lines («fili»): open shows the real map in a window (never draw your own diagram of a project with app_show_ui); none drawn yet → brief a Scout. action: list | read (the map as text, to answer) | open (the maps window on screen, at project, element = a system to step into; no project = the maps window as it is) | brief (the task for a Scout chat that draws or redraws it: pass title and root for a new one, then start the Scout with app_create_chat, cwd = root) | correct (text = the user\'s correction, kept for every later drawing; then brief a redraw if the drawing must change).',
    inputSchema: { type: 'object', properties: {
      action: { type: 'string', enum: ['list', 'read', 'open', 'brief', 'correct'] },
      project: { type: 'string', description: 'the map\'s name or id' },
      element: { type: 'string', description: 'open: a system to zoom into' },
      title: { type: 'string', description: 'brief: the new project\'s name' },
      root: { type: 'string', description: 'brief: the project\'s folder on this PC' },
      text: { type: 'string', description: 'correct: the user\'s correction, in their words' },
    }, required: ['action'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: a => {
      const action = String(a.action);
      if (action === 'list') return { projects: maps.list() };
      if (action === 'brief') {
        const prev = typeof a.project === 'string' && a.project ? maps.view(projectOf(maps, a.project))?.map ?? null : null;
        const root = typeof a.root === 'string' && a.root.trim() ? a.root.trim() : prev?.root;
        const title = typeof a.title === 'string' && a.title.trim() ? a.title.trim() : prev?.title;
        if (!root || !title) throw new Error('brief: title and root for a new map (or project for a redraw)');
        return { roleId: 'scout', cwd: root, title: `Mappa · ${title}`.slice(0, 80), prompt: drawBrief(title, root, prev) };
      }
      // open with no project: the maps window as the user left it (or «nessun progetto disegnato» with what to ask)
      if (action === 'open' && !(typeof a.project === 'string' && a.project)) { emitUi({ action: 'maps', value: '' }); return maps.list().length ? 'ok' : 'ok: nessuna mappa ancora, la finestra dice come chiederla'; }
      const project = projectOf(maps, a.project);
      if (action === 'read') return mapText(maps.view(project)!, Date.now());
      if (action === 'open') {
        const el = typeof a.element === 'string' && a.element ? a.element : '';
        if (el && !maps.view(project)!.map.elements.some(e => e.id === el)) throw new Error(`element: no «${el}» in this map`);
        emitUi({ action: 'maps', value: `${project}${el ? `/${el}` : ''}` }); // ADR 0275: the maps window, in «Stato»'s place
        return 'ok';
      }
      if (action === 'correct') { const m = maps.correct(project, typeof a.text === 'string' ? a.text : ''); return { ok: true, version: m.version, corrections: m.corrections.length }; }
      throw new Error('action: list | read | open | brief | correct');
    },
  };
}
