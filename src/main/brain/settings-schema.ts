// The settings as DATA: every key with its type, default, Italian label and description, and whether it is protected
// (the user, 2026-10-11: "se chiedo all'IA di modificare qualche configurazione possa farlo ... in modo che io non me ne
// accorga nemmeno, fare modifiche deve essere molto figo vederle live"). Protected keys (engines on/off, spending
// limits, notifications off, security: the brain folder whose tools the app runs, the MCP port) can only be PROPOSED by
// an agent and need the user's click; the others an agent may change directly (logged, undoable). validate() is the one
// pure check used for the user's UI changes, agent requests and the saved file alike. Used by config.ts (store, history,
// undo, proposals) and served to the UI by 'settings:schema'.
import path from 'node:path';
import type { Settings, SettingDef, SettingKey, SettingsPatch } from '../../shared/contract';

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

export const SCHEMA: readonly SettingDef[] = [
  { key: 'brainRoot', type: 'path', nullable: true, default: null, protected: true, label: 'Cartella del cervello',
    description: "La cartella dei tuoi file (idee, errori, diario). L'app ne esegue gli strumenti: per questo la cambi solo tu." },
  { key: 'mcpPort', type: 'int', min: 0, max: 65535, default: 4319, protected: true, label: 'Porta MCP del browser',
    description: 'Porta locale (solo 127.0.0.1) dove gli agenti guidano il browser interno. 0 = una porta libera a caso.' },
  { key: 'view', type: 'enum', values: ['mosaico', 'corsie'], default: 'mosaico', protected: false, label: 'Vista',
    description: 'Mosaico: le chat come riquadri. Corsie: le chat in colonne per stato.' },
  { key: 'theme', type: 'enum', values: ['dark', 'light', 'system'], default: 'dark', protected: false, label: 'Tema',
    description: 'Scuro, chiaro o come Windows.' },
  { key: 'osToasts', type: 'enum', values: ['urgent', 'normal', 'off'], default: 'urgent', protected: true, label: 'Notifiche di Windows',
    description: 'Solo le urgenti (una chat ti aspetta), anche le normali, o nessuna (resta tutto nel feed).' },
  { key: 'dndUntil', type: 'int', min: 0, max: 8.64e15, nullable: true, default: null, protected: true, label: 'Non disturbare fino a',
    description: 'Nessuna notifica di Windows fino a quest’ora (1 ora, fino a domani…); poi tornano da sole. Vuoto = spento.' },
  { key: 'dnd', type: 'boolean', default: false, protected: true, label: 'Non disturbare',
    description: 'Nessuna notifica di Windows; tutto resta nel feed.' },
  { key: 'mute.*', type: 'boolean', default: false, protected: true, label: 'Silenzia un tipo di novità',
    description: 'Nessuna notifica per questo tipo (idea, errore, chat finita…); resta nel feed.' },
  { key: 'engines.claude', type: 'boolean', default: true, protected: true, label: 'Motore Claude',
    description: "Le chat Claude Code dentro l'app (con il tuo login di Claude)." },
  { key: 'engines.cursor', type: 'boolean', default: true, protected: true, label: 'Motore Cursor',
    description: "Le chat Cursor dentro l'app (con il tuo login di Cursor)." },
  { key: 'messaging.crossHarness', type: 'boolean', default: true, protected: true, label: 'Messaggi tra Claude e Cursor',
    description: 'Le chat Claude e le chat Cursor possono scriversi (posta tra chat). Spento: i messaggi tra motori diversi sono bloccati; tra chat dello stesso motore passano sempre. Vale anche fuori dall’app.' },
  { key: 'budget.enabled', type: 'boolean', default: true, protected: true, label: 'Limiti di spesa',
    description: "Interruttore generale degli avvisi di spesa (all'80% e al 100%)." },
  ...budgetDefs('claude'),
  ...budgetDefs('cursor'),
];

const MUTE_KEY = /^mute\.([a-z][a-z-]{0,40})$/;

export function defOf(key: string): SettingDef | null {
  if (MUTE_KEY.test(key)) return SCHEMA.find(d => d.key === 'mute.*')!;
  return SCHEMA.find(d => d.key === key && d.key !== 'mute.*') ?? null;
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
    case 'usd':
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1e6) return { ok: false, error: `${d.label}: un importo in $ maggiore di 0${d.nullable ? ', oppure vuoto' : ''}` };
      return { ok: true, key: k, value: Math.round(value * 100) / 100 };
  }
}

export function defaults(): Settings {
  return {
    brainRoot: null, mcpPort: 4319, view: 'mosaico', mute: {}, osToasts: 'urgent', theme: 'dark', dnd: false, dndUntil: null,
    engines: { claude: true, cursor: true },
    messaging: { crossHarness: true },
    budget: { enabled: true, claude: { mode: 'warn', dailyUsd: null, perChatUsd: null }, cursor: { mode: 'warn', dailyUsd: null, perChatUsd: null } },
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
      if ((key === 'mute' || key === 'engines' || key === 'budget' || key === 'budget.claude' || key === 'budget.cursor')) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${key}: oggetto atteso`);
        walk(v as Record<string, unknown>, key);
      } else if (key === 'locked') continue; // echoed back by a client: never settable
      else out.push([key, v]);
    }
  };
  walk(patch as SettingsPatch as Record<string, unknown>, '');
  return out;
}
