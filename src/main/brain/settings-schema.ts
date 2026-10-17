// The settings as DATA: every key with its type, default, Italian label and description, and whether it is protected
// (the user, 2026-10-11: "se chiedo all'IA di modificare qualche configurazione possa farlo ... in modo che io non me ne
// accorga nemmeno, fare modifiche deve essere molto figo vederle live"). Protected keys (engines on/off, spending
// limits, notifications off, security: the brain folder whose tools the app runs, the MCP port) can only be PROPOSED by
// an agent and need the user's click; the others an agent may change directly (logged, undoable). validate() is the one
// pure check used for the user's UI changes, agent requests and the saved file alike. The engines' keys follow the
// engine registry (engines/registry.ts), which the brain can extend at run time: `engineOn.<id>` and `engines.<id>` are
// valid for any engine id, like `mute.<kind>`. Used by config.ts (store, history, undo, proposals) and served to the UI
// by 'settings:schema'.
import path from 'node:path';
import type { Settings, SettingDef, SettingKey, SettingsPatch } from '../../shared/contract';
import { ENGINE_ID, engineLabel, engineOf, engines } from '../engines/registry';
import { canonicalRepoRoot } from './adapters/codex-policy';

/** The compaction window of the app's Claude chats (ADR 0031): 200000 since 2026-10-14 (the user: «ripartenza a ~200k
 *  token di contesto»; 300000 before, ADR 0051). */
export const COMPACT_WINDOW = 200_000;
/** the default before 2026-10-14: a saved value equal to it that the user never set follows the new one (config.ts) */
export const OLD_COMPACT_WINDOW = 300_000;

const H = { claude: 'Claude', cursor: 'Cursor' } as const;
const budgetDefs = (h: 'claude' | 'cursor'): SettingDef[] => [
  { key: `budget.${h}.mode`, type: 'enum', values: ['warn', 'ask', 'off'], default: 'warn', protected: true,
    label: `Limite ${H[h]}: cosa fare`, description: 'Avvisa (feed e notifica), chiedi se continuare, oppure spento. Non ferma mai niente da solo.' },
  { key: `budget.${h}.dailyUsd`, type: 'usd', nullable: true, default: null, protected: true,
    label: `Limite ${H[h]} al giorno ($)`,
    description: h === 'claude' ? 'A prezzo di listino API (su abbonamento è un costo equivalente). Vuoto = nessun limite.'
      : "Costo reale dall'export di Cursor; se l'export non copre oggi il costo è sconosciuto e non avvisa. Vuoto = nessun limite." },
  { key: `budget.${h}.perChatUsd`, type: 'usd', nullable: true, default: null, protected: true,
    label: `Limite ${H[h]} per chat ($ al giorno)`,
    description: h === 'claude' ? 'Quanto una sola chat spende oggi. Vuoto = nessun limite.' : 'Cursor non dice il costo per chat: per ora non avvisa.' },
];

const BASE: readonly SettingDef[] = [
  { key: 'brainRoot', type: 'path', nullable: true, default: null, protected: true, label: 'Cartella del cervello',
    description: "La cartella dei tuoi file (idee, errori, diario). L'app ne esegue gli strumenti: per questo la cambi solo tu." },
  { key: 'mcpPort', type: 'int', min: 0, max: 65535, default: 4319, protected: true, label: 'Porta MCP del browser',
    description: 'Porta locale (solo 127.0.0.1) dove gli agenti guidano il browser interno. 0 = una porta libera a caso.' },
  { key: 'theme', type: 'enum', values: ['dark', 'light', 'system'], default: 'dark', protected: false, label: 'Tema',
    description: 'Scuro, chiaro o come il sistema.' },
  { key: 'language', type: 'enum', values: ['system', 'it', 'en'], default: 'system', protected: false, label: 'Lingua',
    description: "Lingua dell'interfaccia: come il sistema (italiano se Windows è in italiano, altrimenti inglese), italiano o inglese." },
  { key: 'compactWindowTokens', type: 'int', min: 0, max: 1_000_000, default: COMPACT_WINDOW, protected: false, label: 'Compatta le chat Claude a (token)',
    description: 'Ogni chat Claude dell’app, Regia compresa, compatta da sola il suo contesto in un riassunto poco prima di questa finestra, anche con i modelli da 1M e nelle cartelle che ne chiedono un’altra. Da 100000 a 1000000; 0 = come dicono le impostazioni di Claude.' },
  { key: 'regiaDayCompact', type: 'boolean', default: true, protected: false, label: 'Regie corte: compatta a inizio giornata',
    description: 'Una Regia con un contesto di ieri (50k o più) lo compatta in un riassunto la prima volta che è ferma da 3 minuti in un giorno nuovo. Resta la stessa chat: la coda e le chat che segue non cambiano.' },
  { key: 'launchRulesClaude', type: 'boolean', default: false, protected: true, label: 'Regole del cervello alle chat Claude',
    description: 'A ogni avvio di una chat Claude l’app le passa le regole del cervello (AGENTS.md, skill, agenti, stili e hook) come plugin. Spento: Claude legge solo le sue impostazioni.' },
  { key: 'launchRulesCodex', type: 'boolean', default: true, protected: true, label: 'Regole del cervello alle chat Codex',
    description: 'A ogni avvio di una chat Codex l’app le passa le regole del cervello (AGENTS.md come istruzioni e le cartelle delle skill). Spento: Codex legge solo le sue impostazioni.' },
  { key: 'codexAutonomyRoots', type: 'repo-paths', default: [], protected: true, label: 'Autonomia Codex nei repository',
    description: 'Solo in queste cartelle repository o worktree: Codex lavora senza richieste di escalation, dentro la sandbox di scrittura. Fuori scope le azioni restano bloccate. Vale dal prossimo turno; vuoto = chiedi quando serve.' },
  { key: 'contextWarnTokens', type: 'int', min: 10_000, max: 2_000_000, default: 200_000, protected: false, label: 'Soglia del contesto lungo per Cursor (token)',
    description: 'Il misuratore del contesto diventa ambra sopra questa dimensione nelle chat che non dicono la loro finestra (Cursor); le chat Claude diventano ambra vicino alla loro compattazione.' },
  { key: 'contextHandoff', type: 'boolean', default: false, protected: false, label: 'Continua le chat fredde in una sessione nuova',
    description: 'Una chat Claude ferma con un contesto lungo (100k o più) scrive il passaggio di consegne finché la cache è calda (pochi centesimi); se poi le scrivi dopo che la cache è scaduta, il messaggio va in una sessione nuova che parte dal passaggio. Stessa chat e stesso titolo, la sessione vecchia resta sopra, piegata.' },
  { key: 'coldHandoffMin', type: 'int', min: 5, max: 50, default: 50, protected: false, label: 'Passaggio delle chat ferme dopo (minuti)',
    description: 'Quanti minuti dopo l’ultima chiamata una chat Claude ferma e lunga scrive il suo passaggio di consegne. La cache dura circa un’ora: oltre 50 minuti il passaggio rischierebbe di costare come rileggere tutto.' },
  { key: 'autoCloseMin', type: 'int', min: 0, max: 240, default: 2, protected: false, label: 'Chiudi le chat finite dopo (minuti)',
    description: 'Una chat di lavoro che ha finito bene, senza domande, coda o lavori in background, e che non tocchi da tanti minuti si chiude da sola e libera spazio; la ritrovi con Ctrl+K e la riapri con Invio. 0 = mai.' },
  { key: 'engineIdleMin', type: 'int', min: 0, max: 1440, default: 30, protected: false, label: 'Libera il motore delle chat ferme dopo (minuti)',
    description: 'Una chat ferma da tanti minuti, senza domande, coda o lavori in background, chiude il suo processo (con server MCP e shell) e resta sulla griglia; al prossimo messaggio riparte da sola dalla sua storia. La Regia non viene mai liberata. 0 = mai.' },
  // protected: an agent turning the queue off, or raising its limits, would start its own chats ahead of the machine
  { key: 'loadQueue', type: 'boolean', default: true, protected: true, label: 'Coda per carico',
    description: 'Con il PC sotto sforzo, le chat e i messaggi aperti dalla Regia o da altre chat aspettano in coda e partono uno alla volta quando il carico scende. I tuoi messaggi partono sempre subito; niente viene fermato.' },
  { key: 'loadQueueCpu', type: 'int', min: 30, max: 100, default: 75, protected: true, label: 'Coda per carico: CPU oltre (%)',
    description: 'Sopra questa CPU (media degli ultimi secondi) le chat e i messaggi degli agenti aspettano.' },
  { key: 'loadQueueRam', type: 'int', min: 0, max: 90, default: 15, protected: true, label: 'Coda per carico: RAM libera sotto (%)',
    description: 'Sotto questa memoria libera le chat e i messaggi degli agenti aspettano. 0 = non guardare la RAM.' },
  { key: 'osToasts', type: 'enum', values: ['urgent', 'normal', 'off'], default: 'urgent', protected: true, label: 'Notifiche di sistema',
    description: 'Solo le urgenti (una chat ti aspetta), anche le normali, o nessuna (resta tutto nel feed).' },
  { key: 'dndUntil', type: 'int', min: 0, max: 8.64e15, nullable: true, default: null, protected: true, label: 'Non disturbare fino a',
    description: 'Nessuna notifica di sistema fino a quest’ora (1 ora, fino a domani…); poi tornano da sole. Vuoto = spento.' },
  { key: 'dnd', type: 'boolean', default: false, protected: true, label: 'Non disturbare',
    description: 'Nessuna notifica di sistema; tutto resta nel feed.' },
  { key: 'mute.*', type: 'boolean', default: false, protected: true, label: 'Silenzia un tipo di novità',
    description: 'Nessuna notifica per questo tipo (idea, errore, chat finita…); resta nel feed.' },
  // the engines' own keys (engineOn.<id>, engines.<id>, regiaChats.harness) come from engineDefs below
  { key: 'devops.enabled', type: 'boolean', default: false, protected: true, label: 'Aggiornamento DevOps automatico',
    description: 'Rilegge da sola i tuoi work item, le PR e le novità sui ticket che segui, con gli script del cervello (niente IA, zero token). Spento: solo con «Aggiorna ora».' },
  { key: 'devops.everyMin', type: 'int', min: 5, max: 720, default: 30, protected: false, label: 'DevOps: ogni quanti minuti',
    description: 'Ogni quanto rileggere DevOps quando l’aggiornamento automatico è acceso (da 5 a 720 minuti).' },
  { key: 'devops.sound', type: 'boolean', default: true, protected: true, label: 'DevOps: suono degli avvisi',
    description: 'Un suono breve con l’avviso di una menzione o di un cambio sulle tue cose in DevOps. Spento: solo l’avviso a schermo.' },
  { key: 'budget.enabled', type: 'boolean', default: true, protected: true, label: 'Limiti di spesa',
    description: "Interruttore generale degli avvisi di spesa (all'80% e al 100%)." },
  ...budgetDefs('claude'),
  ...budgetDefs('cursor'),
  // the chats the Regia opens (and where "Nuova chat" starts). Protected: an agent choosing the engine or the model
  // chooses whose credits and how many are spent
  { key: 'regiaChats.claudeModel', type: 'model', default: '', protected: true, label: 'Modello per le chat Claude',
    description: 'Il modello delle chat Claude aperte dalla Regia. Vuoto = il predefinito di Claude Code.' },
  { key: 'regiaChats.claudeEffort', type: 'enum', values: ['', 'low', 'medium', 'high', 'xhigh', 'max'], default: '', protected: true, label: 'Effort per le chat Claude',
    description: 'Quanto ragiona Claude prima di rispondere. Vuoto = il predefinito di Claude Code.' },
  { key: 'regiaChats.cursorModel', type: 'model', default: '', protected: true, label: 'Modello per le chat Cursor',
    description: 'Il modello delle chat Cursor aperte dalla Regia. Vuoto = il predefinito di Cursor.' },
  // every Cursor chat (the user, 2026-10-12: Grok medium, fast off): applied with ACP session/set_config_option
  { key: 'regiaChats.cursorReasoning', type: 'enum', values: ['', 'low', 'medium', 'high', 'xhigh'], default: 'medium', protected: true, label: 'Ragionamento per le chat Cursor',
    description: 'Quanto ragiona il modello di ogni chat Cursor. Vuoto = il predefinito del modello. Se il modello non lo offre, la chat lo dice.' },
  { key: 'regiaChats.cursorFast', type: 'boolean', default: false, protected: true, label: 'Fast per le chat Cursor',
    description: 'Acceso: ogni chat Cursor usa la variante fast del modello, se c’è (più veloce, consuma di più).' },
  // the floating Regia (ADR 0021; the user, 2026-10-12: "voglio poter scegliere l'opacità della regia")
  { key: 'regiaOpacity', type: 'int', min: 40, max: 100, default: 100, protected: false, label: 'Opacità della Regia (%)',
    description: 'Quanto si vede il riquadro della Regia sopra le chat. Con il mouse sopra o mentre scrivi torna pieno.' },
  // the Regia hears about the other chats by itself (the user, 2026-10-12: "quando le chat finiscono non ti notificano nulla")
  { key: 'regiaEvents', type: 'boolean', default: true, protected: true, label: 'Eventi alla Regia',
    description: "Quando una chat di lavoro finisce, si ferma su un errore, aspetta una tua risposta o ti lascia un comando, l'app lo scrive alla Regia (una riga per chat, al massimo una volta ogni 2 minuti per chat) e la sveglia se è ferma: decide lei se dirtelo. Ogni risveglio è un turno della Regia." },
  // the chat learns how its command went (the user, 2026-10-12: "vorrei che ti accorgessi da sola quando eseguo un
  // comando dal play senza che ti scriva fatto")
  { key: 'runResults', type: 'boolean', default: true, protected: true, label: 'Esito dei comandi alla chat',
    description: "Quando un comando lanciato con Esegui finisce, l'app scrive alla chat che l'ha proposto il comando, l'exit code e le ultime righe dell'output: non devi scriverle «fatto» né incollarle il risultato. Se la chat sta lavorando, il messaggio parte appena è libera. Ogni esito è un turno della chat." },
  // the user, 2026-10-12: "le domande vorrei un toggle per farle comparire proprio come modale"
  { key: 'questionsModal', type: 'boolean', default: false, protected: true, label: 'Domande in finestra',
    description: 'Ogni domanda e permesso compare in una finestra in primo piano, una alla volta in coda, con il contesto. Mentre scrivi aspetta che ti fermi e non ti prende la tastiera. Spento: le domande restano nelle chat e nella Regia.' },
  // "Migliora l'app" (ADR 0020): the chats there change and run this code, and "Aggiorna" builds from it
  { key: 'appRepo', type: 'path', nullable: true, default: null, protected: true, label: "Cartella del codice dell'app",
    description: "Dove «Migliora l'app» lavora e da dove «Aggiorna» prende la nuova versione (una cartella git). Vuoto = quella da cui è stata fatta la versione in uso." },
];
/** a CLI model id as the CLIs accept it ("claude-opus-5-5", "grok-4.7", "gpt-5.6-sol[effort=high]"), '' = the default */
export const MODEL_ID = /^[\w.:@/=[\],-]{0,120}$/;

const MUTE_KEY = /^mute\.([a-z][a-z-]{0,40})$/;
const ENGINE_KEY = /^(engineOn|engines)\.(.+)$/;

// the engines (ADR 0046, engines/policy.ts): each on or off, and whether the Regie may use it; engines.* keeps the key
// older releases read, with the same meaning (safe rollback). Default: on only for the built-ins (registry defaultOn)
function engineDef(group: 'engineOn' | 'engines', id: string): SettingDef {
  const label = engineLabel(id), on = engineOf(id)?.defaultOn ?? false;
  return group === 'engineOn'
    ? { key: `engineOn.${id}`, type: 'boolean', default: on, protected: true, label: `${label} acceso`,
      description: `Spento: nessuna chat parte su ${label}, né quelle che apri tu né quelle delle Regie; si spegne anche «Le Regie possono usare ${label}».` }
    : { key: `engines.${id}`, type: 'boolean', default: on, protected: true, label: `Le Regie possono usare ${label}`,
      description: `Spento: nessuna Regia apre o riprende chat su ${label}; tu sì, da Nuova chat.` };
}

/** The engine a Regia's work chats start on: one that works with tools (an API model cannot, ADR 0046). */
function regiaEngineDef(): SettingDef {
  return { key: 'regiaChats.harness', type: 'enum', values: engines().filter(e => e.caps.tools).map(e => e.id), default: 'claude', protected: true, label: 'Chat aperte dalla Regia: motore',
    description: 'Con cosa la Regia apre le chat di lavoro quando non lo dice lei. Anche il punto di partenza di "Nuova chat".' };
}

/** Every setting, the engines' ones for the engines in the registry now. */
export function schema(): SettingDef[] {
  return [...BASE, regiaEngineDef(), ...engines().flatMap(e => [engineDef('engineOn', e.id), engineDef('engines', e.id)])];
}

export function defOf(key: string): SettingDef | null {
  if (MUTE_KEY.test(key)) return BASE.find(d => d.key === 'mute.*')!;
  const eng = ENGINE_KEY.exec(key);
  if (eng) return ENGINE_ID.test(eng[2]!) ? engineDef(eng[1] as 'engineOn' | 'engines', eng[2]!) : null;
  if (key === 'regiaChats.harness') return regiaEngineDef();
  return BASE.find(d => d.key === key && d.key !== 'mute.*') ?? null;
}

export type Checked = { ok: true; key: SettingKey; value: unknown } | { ok: false; error: string };

/** The one check of a value for a key (UI, agents, saved file). Returns the normalized value or an Italian error. */
export function validate(key: unknown, value: unknown): Checked {
  if (typeof key !== 'string') return { ok: false, error: 'chiave mancante' };
  const d = defOf(key);
  if (!d) return { ok: false, error: `impostazione sconosciuta: ${key}` };
  const k = key as SettingKey;
  if (value === null && d.nullable) return { ok: true, key: k, value: null };
  switch (d.type) {
    case 'repo-paths': {
      if (!Array.isArray(value) || value.length > 32) return { ok: false, error: `${d.label}: al massimo 32 cartelle repository o worktree` };
      try { return { ok: true, key: k, value: [...new Set(value.map(canonicalRepoRoot))] }; }
      catch (e) { return { ok: false, error: `${d.label}: ${e instanceof Error ? e.message : String(e)}` }; }
    }
    case 'path':
      if (typeof value !== 'string' || value.length > 1000 || !path.isAbsolute(value)) return { ok: false, error: `${d.label}: percorso assoluto di una cartella${d.nullable ? ', oppure vuoto' : ''}` };
      return { ok: true, key: k, value: path.normalize(value) };
    case 'int':
      if (!Number.isInteger(value) || (value as number) < (d.min ?? -Infinity) || (value as number) > (d.max ?? Infinity)) return { ok: false, error: `${d.label}: un numero intero da ${d.min} a ${d.max}` };
      return { ok: true, key: k, value };
    case 'boolean':
      if (typeof value !== 'boolean') return { ok: false, error: `${d.label}: sì o no (true/false)` };
      return { ok: true, key: k, value };
    case 'enum':
      if (!d.values!.includes(value as string)) return { ok: false, error: `${d.label}: uno tra ${d.values!.join(', ')}` };
      return { ok: true, key: k, value };
    case 'model':
      if (typeof value !== 'string' || !MODEL_ID.test(value.trim())) return { ok: false, error: `${d.label}: un id di modello (lettere, numeri, . - _ : [ ] =), oppure vuoto` };
      return { ok: true, key: k, value: value.trim() };
    case 'usd': {
      // rounded to cents first: 0.004 would otherwise pass "> 0" and be saved as 0 (= no limit)
      const v = typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN;
      if (!(v > 0) || v > 1e6) return { ok: false, error: `${d.label}: un importo in $ da 0,01 a 1000000${d.nullable ? ', oppure vuoto' : ''}` };
      return { ok: true, key: k, value: v };
    }
  }
}

export function defaults(): Settings {
  return {
    brainRoot: null, mcpPort: 4319, autoCloseMin: 2, engineIdleMin: 30, mute: {}, osToasts: 'urgent', theme: 'dark', language: 'system', dnd: false, dndUntil: null,
    contextWarnTokens: 200_000, contextHandoff: false, compactWindowTokens: COMPACT_WINDOW, regiaDayCompact: true, launchRulesClaude: false, launchRulesCodex: true, codexAutonomyRoots: [], coldHandoffMin: 50,
    engineOn: Object.fromEntries(engines().map(e => [e.id, e.defaultOn])),
    engines: Object.fromEntries(engines().map(e => [e.id, e.defaultOn])),
    messaging: { crossHarness: true },
    devops: { enabled: false, everyMin: 30, sound: true },
    budget: { enabled: true, claude: { mode: 'warn', dailyUsd: null, perChatUsd: null }, cursor: { mode: 'warn', dailyUsd: null, perChatUsd: null } },
    regiaChats: { harness: 'claude', claudeModel: '', cursorModel: '', claudeEffort: '', cursorReasoning: 'medium', cursorFast: false },
    regiaOpacity: 100,
    regiaEvents: true,
    runResults: true,
    questionsModal: false,
    appRepo: null,
    loadQueue: true, loadQueueCpu: 75, loadQueueRam: 15,
  };
}

/** Value of a dot key in a settings object (mute.<kind> absent = false). */
export function getAt(s: Settings, key: SettingKey): unknown {
  const m = key.match(MUTE_KEY);
  if (m) return !!s.mute[m[1]!];
  return key.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined), s);
}

/** A copy of `s` with the (already validated) value at a dot key. */
export function setAt(s: Settings, key: SettingKey, value: unknown): Settings {
  const out = structuredClone(s);
  const m = key.match(MUTE_KEY);
  if (m) { if (value) out.mute[m[1]!] = true; else delete out.mute[m[1]!]; return out; }
  const parts = key.split('.');
  let o = out as unknown as Record<string, unknown>;
  for (const p of parts.slice(0, -1)) o = o[p] as Record<string, unknown>;
  o[parts.at(-1)!] = value;
  return out;
}

/** A nested patch from the UI → dot keys and values (unknown fields are an error, so typos never pass silently). */
export function flattenPatch(patch: unknown): [string, unknown][] {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('impostazioni: oggetto atteso');
  const out: [string, unknown][] = [];
  const walk = (o: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if ((key === 'mute' || key === 'engineOn' || key === 'engines' || key === 'messaging' || key === 'regiaChats' || key === 'devops' || key === 'budget' || key === 'budget.claude' || key === 'budget.cursor')) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${key}: oggetto atteso`);
        walk(v as Record<string, unknown>, key);
      } else if (key === 'locked') continue; // echoed back by a client: never settable
      else out.push([key, v]);
    }
  };
  walk(patch as SettingsPatch as Record<string, unknown>, '');
  return out;
}
