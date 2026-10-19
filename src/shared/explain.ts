// One plain Italian line that says what a tool call does ("Legge now.md", "Lancia i test", "Azure DevOps: legge un work
// item"), plus the raw command shown folded under it. Why: the user (2026-10-11) "la ui dei comandi non mi spiega cosa
// fanno ... vorrei una riga di spiegazione come avviene su claude desktop, il tutto compatibile anche quando userò la
// cursor cli". Claude tools by name and input (Bash/PowerShell: the `description` the model writes); Cursor tools by ACP
// kind (Shell, Read, Edit, … as acp.ts names them) with their title and raw input; MCP tools by a readable server and
// action. Pure, no I/O: used by the chat tool rows (ChatItems.tsx) and the permission panels (RequestPanel.tsx).

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const first = (s: string): string => s.split(/\r?\n/)[0] ?? '';
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** The last part of a path ("C:/a/b/now.md" → "now.md"); a folder keeps its name. */
export function baseName(p: string): string {
  const parts = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}

export interface Explained {
  /** the plain line, Italian, sentence case, no trailing period */
  line: string;
  /** the raw command / target to show folded under the line ('' = nothing more to show) */
  raw: string;
}

/** Readable MCP server names; any "<team>-devops" server is Azure DevOps; others: "claude_ai_Google_Drive" → "Google Drive". */
const SERVERS: Record<string, string> = {
  'second-brain': 'Browser dell’app', 'sb-browser': 'Browser dell’app', app: 'App second-brain',
  Claude_Browser: 'Browser', 'claude-in-chrome': 'Chrome', 'computer-use': 'Computer', wiz: 'Wiz',
};
export function serverName(server: string): string {
  if (/(^|[-_])devops$/i.test(server)) return 'Azure DevOps';
  return SERVERS[server] ?? server.replace(/^claude_ai_/, '').replace(/[_-]+/g, ' ').trim();
}

/** Browser-like actions (the app's own browser, Claude's browser, Chrome) in plain words. */
const BROWSER: Record<string, (i: Obj) => string> = {
  navigate: i => (str(i.url) ? `apre ${host(str(i.url))}` : 'apre una pagina'),
  click: () => 'clicca nella pagina', type: () => 'scrive nella pagina', key: () => 'preme un tasto nella pagina',
  fill_form: () => 'compila un modulo', select_option: () => 'sceglie un’opzione', scroll: () => 'scorre la pagina', hover: () => 'passa sopra un elemento',
  drag: () => 'trascina un elemento', screenshot: () => 'fa uno screenshot', read_page: () => 'legge la pagina', get_page_text: () => 'legge il testo della pagina',
  find: i => (str(i.query) ? `cerca «${cut(str(i.query), 40)}» nella pagina` : 'cerca nella pagina'), wait_for: () => 'aspetta la pagina',
  javascript: () => 'esegue codice nella pagina', javascript_tool: () => 'esegue codice nella pagina', console_messages: () => 'legge la console', network_requests: () => 'legge le richieste di rete',
  tabs_create: i => (str(i.url) ? `apre una scheda su ${host(str(i.url))}` : 'apre una scheda'), tabs_list: () => 'elenca le schede', tabs_select: () => 'cambia scheda', tabs_close: () => 'chiude una scheda',
  batch: () => 'esegue più azioni nella pagina', handle_dialog: () => 'risponde a un avviso della pagina', handoff_to_user: () => 'ti chiede di agire nella pagina', environments: () => 'elenca gli ambienti', computer: () => 'usa mouse e tastiera nella pagina',
};

/** The delegation tools of a chat's own endpoint (ADR 0083): who it hands work to, what it hands back. */
const DELEGATION: Record<string, (i: Obj) => string> = {
  agent_delegate: i => {
    const tasks = Array.isArray(i.tasks) ? i.tasks.filter((x): x is Obj => !!x && typeof x === 'object') : [];
    const names = tasks.slice(0, 3).map(x => `«${cut(str(x.title) || '?', 40)}»${str(x.role) ? ` (${str(x.role).charAt(0).toUpperCase()}${str(x.role).slice(1)})` : ''}`);
    return tasks.length ? `Delega ${names.join(', ')}${tasks.length > 3 ? ` e altre ${tasks.length - 3}` : ''}` : 'Delega parti del lavoro';
  },
  agent_report: i => (str(i.summary) ? `Consegna il risultato: ${cut(str(i.summary), 80)}` : 'Consegna il risultato a chi ha delegato'),
  agent_children: () => 'Controlla le chat delegate',
  agent_ask_parent: i => (str(i.question) ? `Chiede a chi ha delegato: ${cut(str(i.question), 80)}` : 'Chiede a chi ha delegato'),
  agent_answer_child: i => (i.askUser === true ? 'Rimanda la domanda all’utente' : str(i.answer) ? `Risponde alla chat delegata: ${cut(str(i.answer), 80)}` : 'Risponde alla chat delegata'),
};

const VERBS: Record<string, string> = {
  get: 'legge', read: 'legge', list: 'elenca', show: 'mostra', create: 'crea', add: 'aggiunge', new: 'crea', update: 'aggiorna', set: 'imposta', edit: 'modifica',
  delete: 'elimina', remove: 'rimuove', trash: 'cestina', search: 'cerca', query: 'interroga', find: 'cerca', send: 'invia', reply: 'risponde a', forward: 'inoltra',
  run: 'esegue', execute: 'esegue', vote: 'vota', link: 'collega', unlink: 'scollega', assign: 'assegna', download: 'scarica', upload: 'carica', copy: 'copia', share: 'condivide',
  label: 'etichetta', mark: 'segna', unmark: 'toglie il segno da', apply: 'applica', discover: 'cerca', my: 'legge i tuoi',
};

/** "wit_get_work_item" → "legge work item"; "repo_get_pull_request_by_id" → "legge pull request". */
export function actionWords(tool: string): string {
  const words = tool.split(/[_-]+/).filter(Boolean);
  const v = words.findIndex(w => Object.hasOwn(VERBS, w.toLowerCase()));
  if (v < 0) return words.join(' ');
  let rest = words.slice(v + 1);
  const by = rest.findIndex(w => w.toLowerCase() === 'by' || w.toLowerCase() === 'for');
  if (by > 0) rest = rest.slice(0, by);
  return [VERBS[words[v]!.toLowerCase()], ...rest].join(' ').trim();
}

function host(url: string): string {
  try { return new URL(url).host || url; } catch { return cut(url, 60); }
}

function mcp(name: string, input: Obj): Explained | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  if (!m) return null;
  const server = m[1]!, tool = m[2]!;
  if (server === 'second-brain' && Object.hasOwn(DELEGATION, tool)) return { line: DELEGATION[tool]!(input), raw: tool };
  const t = tool.replace(/^browser_/, '');
  const browserish = /browser|chrome|second-brain|^Claude_Browser$/i.test(server);
  const action = browserish ? (Object.hasOwn(BROWSER, t) ? BROWSER[t]!(input) : null) ?? actionWords(t) : actionWords(tool);
  const arg = str(input.url) || str(input.query) || str(input.path) || str(input.title) || '';
  return { line: `${serverName(server)}: ${action}`, raw: [tool, arg && !action.includes(host(arg)) ? cut(arg, 300) : ''].filter(Boolean).join(' · ') };
}

/** What a tool call does, in one plain line.
 *  - name: the tool name (Claude: "Bash", "Read", "mcp__x__y"; Cursor: the ACP kind name "Shell", "Read", "Edit"…)
 *  - input: its arguments (Claude's tool input; Cursor's rawInput)
 *  - title: the engine's own one-line title (Cursor's tool_call title), used when the input says too little */
export function explainTool(name: string, input: unknown, title = ''): Explained {
  const i = obj(input);
  const file = str(i.file_path) || str(i.notebook_path) || str(i.target_file) || str(i.path) || str(i.filePath);
  const desc = str(i.description) || str(i.explanation);
  const cleanTitle = title.replace(/`/g, '').trim();
  const fromMcp = mcp(name, i);
  if (fromMcp) return fromMcp;
  switch (name) {
    case 'Bash': case 'PowerShell': case 'Shell': {
      const cmd = str(i.command) || str(i.cmd);
      // no description: the program and its subcommand ("Esegue git commit"), the full command stays in raw
      const words: string[] = [];
      for (const w of cmd.trim().split(/\s+/)) { if (words.length === 2 || !/^[\w.:\\/][\w.:\\/-]*$/.test(w)) break; words.push(baseName(w)); }
      const prog = words.join(' ');
      const line = desc ? cap(first(desc)) : name === 'Shell' && cleanTitle && cleanTitle !== cmd ? cap(cleanTitle)
        : prog ? `Esegue ${prog}` : `Esegue un comando ${name === 'PowerShell' ? 'PowerShell' : 'nel terminale'}`;
      return { line: cut(line, 140), raw: cmd || (name === 'Shell' ? cleanTitle : '') };
    }
    case 'Read': {
      const range = typeof i.offset === 'number' ? ` (dalla riga ${i.offset})` : '';
      return { line: file ? `Legge ${baseName(file)}${range}` : cleanTitle ? cap(cleanTitle) : 'Legge un file', raw: file };
    }
    case 'Write': return { line: file ? `Scrive ${baseName(file)}` : 'Scrive un file', raw: file };
    case 'Edit': case 'MultiEdit': return { line: file ? `Modifica ${baseName(file)}` : cleanTitle ? cap(cleanTitle) : 'Modifica un file', raw: file };
    case 'NotebookEdit': return { line: `Modifica il notebook ${baseName(file)}`, raw: file };
    case 'Delete': return { line: file ? `Elimina ${baseName(file)}` : cleanTitle ? cap(cleanTitle) : 'Elimina un file', raw: file };
    case 'Move': return { line: cleanTitle ? cap(cleanTitle) : 'Sposta un file', raw: file };
    case 'Grep': {
      const where = file ? ` in ${baseName(file)}` : '';
      return { line: `Cerca «${cut(str(i.pattern), 50)}»${where}`, raw: [str(i.pattern), file].filter(Boolean).join('  ·  ') };
    }
    case 'Glob': return { line: `Cerca i file ${cut(str(i.pattern), 60)}`, raw: [str(i.pattern), file].filter(Boolean).join('  ·  ') };
    case 'Search': return { line: cleanTitle ? cap(cleanTitle) : `Cerca «${cut(str(i.query) || str(i.pattern), 50)}»`, raw: str(i.query) || str(i.pattern) };
    case 'WebFetch': case 'Fetch': return { line: str(i.url) ? `Apre ${host(str(i.url))}` : cleanTitle ? cap(cleanTitle) : 'Apre una pagina web', raw: str(i.url) };
    case 'WebSearch': return { line: `Cerca sul web «${cut(str(i.query), 60)}»`, raw: str(i.query) };
    case 'Task': case 'Agent': return { line: `Affida a un agente: ${cut(first(desc || str(i.prompt)), 100)}`, raw: str(i.prompt) };
    case 'TodoWrite': return { line: 'Aggiorna la lista delle attività', raw: '' };
    case 'AskUserQuestion': case 'AskQuestion': return { line: 'Ti fa una domanda', raw: '' };
    case 'ExitPlanMode': case 'CreatePlan': return { line: 'Ti propone il piano', raw: '' };
    case 'Skill': return { line: `Usa la skill ${str(i.skill) || str(i.command)}`, raw: '' };
    case 'ToolSearch': return { line: 'Carica altri strumenti', raw: str(i.query) };
    case 'Think': return { line: 'Ragiona', raw: '' };
    case 'Mode': return { line: 'Cambia modalità', raw: '' };
    default: return { line: cleanTitle ? cap(cut(cleanTitle, 140)) : name, raw: '' };
  }
}
