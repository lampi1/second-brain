// Adding an MCP server by pasting what its README shows (ADR 0207; the owner, 2026-10-30: «MCP deve essere facilissimo
// configurarlo»): a JSON snippet in the Claude Desktop / Cursor / VS Code shape (`mcpServers`, `servers`, one named
// entry or one bare entry), a command line (`npx -y @x/server …`, `KEY=value npx …`, `claude mcp add name -- …`) or a
// URL (an HTTP or SSE endpoint) becomes the add form's definition. A secret never lands in the definition: a variable or
// header whose name or value looks like a credential becomes a token slot, its literal value kept apart (`values`, by
// slotKey) so the UI can put it in the masked token field, from which it goes only to the app's secret store; a token
// argument is dropped and listed. The same entry conversion serves the import from the engines' own configs
// (main/mcp-servers/import.ts), which ignores `values`. Also: a short catalog of popular servers, one click each.
// Pure; used by the add panel (renderer McpAddPanel.tsx), the import, and app_config (which never keeps `values`).
import { MCP_ID, RESERVED_IDS, SECRET_NAME, TOKENISH, idFrom, secretLooking, slotKey, type McpSecretSlot, type McpServerDef } from './mcp-servers';

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : {});
const TOKEN_FLAG = /^--?[a-z-]*?(token|pat|api[-_]?key|apikey|secret|password|auth(orization)?|bearer)(=|$)/i;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** A definition ready for the form, the secret values seen (by slotKey; never stored in it) and what was left out. */
export interface McpDraft { def: McpServerDef; values: Record<string, string>; dropped: string[] }
export type McpPasteKind = 'json' | 'command' | 'url';
export type McpPasteResult = { ok: true; kind: McpPasteKind; drafts: McpDraft[] } | { ok: false; error: 'empty' | 'json' | 'nothing' | 'command' | 'url' };

const isRef = (v: string) => /\$\{[^}]*\}|^\$[A-Z_]/.test(v);
/** What the paste box shows in place of a secret it read (maskSnippet); a value carrying it stays a token slot. */
export const SECRET_MASK = '•••';
const secretish = (name: string, v: string) => SECRET_NAME.test(name) || TOKENISH.test(v) || secretLooking(v) || isRef(v) || v.includes(SECRET_MASK);
/** A word with the shape of a credential: a known token prefix, or 24+ characters mixing upper case, lower case and digits
 *  (a package name, a path segment or a host is lower case or has no digits). */
const TOKEN_WORD = /[A-Za-z0-9_\-.+=]{16,}/g;
const tokenWord = (w: string) => /^(ghp_|gho_|ghs_|ghu_|github_pat_|glpat-|sk-|xox[abpr]-|AKIA|AIza)/.test(w)
  || (w.length >= 24 && /\d/.test(w) && /[a-z]/.test(w) && /[A-Z]/.test(w));

/** The paste box's text with every secret it carries replaced by ••• (ADR 0207: a token never stays in plain text in the
 *  UI). The values the parser kept apart (they go to the masked token fields), then whatever still looks like one: a
 *  bearer or basic credential, a secret-named URL parameter, credentials in an address, a token-shaped word. */
export function maskSnippet(text: string, drafts: readonly McpDraft[] = []): string {
  let out = text;
  const seen = drafts.flatMap(d => Object.values(d.values)).filter(v => v.length >= 4 && !v.includes(SECRET_MASK)).sort((a, b) => b.length - a.length);
  for (const v of seen) out = out.split(v).join(SECRET_MASK);
  return out
    .replace(/\b(bearer|basic)(\s+)[^\s"'\\,}]+/gi, (m, k: string, s: string, i: number, all: string) => (all.startsWith(SECRET_MASK, i + k.length + s.length) ? m : `${k}${s}${SECRET_MASK}`))
    .replace(/([?&][\w-]+=)([^&\s"']+)/g, (m, k: string, v: string) => (SECRET_NAME.test(k) && v !== SECRET_MASK ? `${k}${SECRET_MASK}` : m))
    .replace(/(\w+:\/\/)[^\s/@"']+@/g, `$1${SECRET_MASK}@`)
    .replace(TOKEN_WORD, w => (tokenWord(w) ? SECRET_MASK : w));
}

/** One engine entry (its name and object) → a draft. null: neither a command nor a URL. `values: false` (the import
 *  from the engines' files): no secret value is kept, every token slot is listed as left out. */
export function entryToDraft(name: string, raw: Raw, opts: { values?: boolean } = {}): McpDraft | null {
  if (RESERVED_IDS.includes(name)) return null;
  const dropped: string[] = [], secrets: McpSecretSlot[] = [], values: Record<string, string> = {};
  let id = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!MCP_ID.test(id) || RESERVED_IDS.includes(id)) id = idFrom(name);
  const base = { id, label: name.slice(0, 80) || id, enabled: true };
  const keep = (slot: McpSecretSlot, value: string, what: string) => {
    if (secrets.some(s => s.where === slot.where && s.name === slot.name)) return;
    secrets.push(slot);
    if (opts.values !== false && value && !isRef(value)) values[slotKey(slot)] = value; else dropped.push(what);
  };
  const url = typeof raw.url === 'string' ? raw.url : typeof raw.serverUrl === 'string' ? raw.serverUrl : typeof raw.httpUrl === 'string' ? raw.httpUrl : null;
  if (url) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj(raw.headers ?? raw.http_headers))) {
      if (typeof v !== 'string') continue;
      if (secretish(k, v) || k.toLowerCase() === 'authorization') {
        const bearer = /^bearer\s+/i.exec(v);
        keep({ where: 'header', name: k, ...(bearer ? { prefix: 'Bearer ' } : {}) }, bearer ? v.slice(bearer[0].length) : v, `intestazione ${k}`);
      } else headers[k] = v;
    }
    if (typeof raw.bearer_token_env_var === 'string') keep({ where: 'header', name: 'Authorization', prefix: 'Bearer ' }, '', `token da ${raw.bearer_token_env_var}`);
    let clean = url;
    try {
      const u = new URL(url);
      for (const k of [...u.searchParams.keys()]) if (SECRET_NAME.test(k)) { u.searchParams.delete(k); dropped.push(`parametro ${k}`); }
      if (u.username || u.password) { u.username = ''; u.password = ''; dropped.push('credenziali nell’indirizzo'); }
      clean = u.toString();
    } catch { return null; }
    return { def: { ...base, transport: 'http', url: clean, ...(Object.keys(headers).length ? { headers } : {}), secrets: secrets.slice(0, 4) }, values, dropped };
  }
  if (typeof raw.command !== 'string' || !raw.command.trim()) return null;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(raw.env))) {
    if (typeof v !== 'string' || !ENV_NAME.test(k)) continue;
    if (secretish(k, v)) keep({ where: 'env', name: k }, v, `variabile ${k}`);
    else env[k] = v;
  }
  for (const k of Array.isArray(raw.env_vars) ? raw.env_vars : []) if (typeof k === 'string' && ENV_NAME.test(k)) keep({ where: 'env', name: k }, '', `variabile ${k}`);
  const args: string[] = [];
  const list = Array.isArray(raw.args) ? raw.args.filter((a): a is string => typeof a === 'string') : [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    if (TOKEN_FLAG.test(a)) { dropped.push(`argomento ${a.split('=')[0]}`); if (!a.includes('=')) i++; continue; }
    if (secretLooking(a) || isRef(a)) {
      // the value of a separate flag (`--header "Authorization: Bearer …"`): the flag goes with it
      const prev = args[args.length - 1];
      if (!/^--?[\w-]+=/.test(a) && prev && /^--?[\w-]+$/.test(prev)) { args.pop(); dropped.push(`argomento ${prev} con il suo valore`); }
      else dropped.push('un argomento che sembra un token');
      continue;
    }
    args.push(a);
  }
  return { def: { ...base, transport: 'stdio', command: raw.command.trim(), args, ...(Object.keys(env).length ? { env } : {}), secrets: secrets.slice(0, 4) }, values, dropped };
}

/** Words of a command line, with "double" and 'single' quotes and backslash-escaped quotes (no other shell syntax). */
export function shellWords(line: string): string[] | null {
  const out: string[] = [];
  let cur = '', quote: '"' | "'" | null = null, has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) { if (c === quote) quote = null; else if (c === '\\' && quote === '"' && line[i + 1] === '"') { cur += '"'; i++; } else cur += c; continue; }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (/\s/.test(c)) { if (has || cur) out.push(cur); cur = ''; has = false; continue; }
    if (c === '\\' && /\r?\n/.test(line.slice(i + 1, i + 3))) continue; // a line continuation
    cur += c;
  }
  if (quote) return null;
  if (has || cur) out.push(cur);
  return out;
}

/** "@modelcontextprotocol/server-github" → "github"; "mcp-server-fetch" → "fetch"; "@playwright/mcp@latest" → "playwright". */
export function nameFromPackage(pkg: string): string {
  const bare = pkg.replace(/^@/, '').replace(/@[^/]*$/, '');
  const [scope, rest] = bare.includes('/') ? bare.split('/', 2) as [string, string] : ['', bare];
  const core = rest.replace(/^(mcp-server-|server-|mcp-)/, '').replace(/(-mcp-server|-mcp|-server)$/, '');
  return core === 'mcp' || !core ? scope || 'server' : core;
}
const label = (name: string) => name.split(/[-_]/).filter(Boolean).map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ') || name;

const RUNNERS = new Set(['npx', 'pnpx', 'bunx', 'uvx', 'pipx', 'docker', 'node', 'python', 'python3', 'uv', 'deno']);
/** A command line → one draft; `claude mcp add` (with -e/--env, --transport, --header) is read too. */
function fromCommand(text: string): McpDraft | null {
  let words = shellWords(text.replace(/\r?\n/g, ' ').trim());
  if (!words?.length) return null;
  const env: Record<string, string> = {}, headers: Record<string, string> = {};
  let name = '', url = '';
  if (words[0] === 'claude' && words[1] === 'mcp' && (words[2] === 'add' || words[2] === 'add-json')) {
    const rest = words.slice(3), cut = rest.indexOf('--');
    const head = cut >= 0 ? rest.slice(0, cut) : rest, tail = cut >= 0 ? rest.slice(cut + 1) : [];
    const plain: string[] = [];
    for (let i = 0; i < head.length; i++) {
      const w = head[i]!;
      if (w === '-e' || w === '--env') { const [k, ...v] = (head[++i] ?? '').split('='); if (k) env[k] = v.join('='); }
      else if (w === '-H' || w === '--header') { const h = head[++i] ?? '', at = h.indexOf(':'); if (at > 0) headers[h.slice(0, at).trim()] = h.slice(at + 1).trim(); }
      else if (w === '-t' || w === '--transport' || w === '-s' || w === '--scope') i++;
      else if (!w.startsWith('-')) plain.push(w);
    }
    name = plain[0] ?? '';
    if (plain[1] && /^https?:\/\//i.test(plain[1])) url = plain[1];
    words = tail;
    if (url) return entryToDraft(name || 'server', { url, headers });
    if (!words.length) return null;
  }
  // leading VAR=value assignments (and `env VAR=value …`)
  if (words[0] === 'env') words = words.slice(1);
  while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) { const [k, ...v] = words.shift()!.split('='); env[k!] = v.join('='); }
  const [command, ...args] = words;
  if (!command || /[|&;<>`$]/.test(command)) return null;
  if (!name) {
    const runner = RUNNERS.has(command.replace(/\.(cmd|exe)$/i, '').split(/[\\/]/).pop()!);
    const pkg = runner ? args.find(a => !a.startsWith('-') && a !== 'run' && a !== 'tool' && !/^[A-Za-z]:\\|^\//.test(a)) : command.split(/[\\/]/).pop();
    name = pkg ? nameFromPackage(pkg) : 'server';
  }
  const draft = entryToDraft(name, { command, args, env });
  if (draft) draft.def.label = label(draft.def.label);
  return draft;
}

function fromUrl(text: string): McpDraft | null {
  let u: URL;
  try { u = new URL(text.trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^(www|mcp|api)\./, '').split('.');
  const name = (host.length > 1 ? host[host.length - 2] : host[0]) || 'server';
  const draft = entryToDraft(name, { url: text.trim() });
  if (draft) draft.def.label = label(draft.def.label);
  return draft;
}

/** The entries of a parsed JSON config, whichever of the common shapes it has. */
function entriesOf(j: unknown): [string, Raw][] {
  const o = obj(j);
  if (typeof o.command === 'string' || typeof o.url === 'string' || typeof o.serverUrl === 'string' || typeof o.httpUrl === 'string') {
    const name = typeof o.name === 'string' ? o.name : typeof o.command === 'string' ? nameFromPackage(((o.args as unknown[] | undefined) ?? []).find((a): a is string => typeof a === 'string' && !a.startsWith('-')) ?? o.command) : 'server';
    return [[name, o]];
  }
  const holder = obj(o.mcpServers ?? o.servers ?? obj(o.mcp).servers ?? obj(o.mcp_servers));
  const source = Object.keys(holder).length ? holder : o;
  return Object.entries(source).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)) as [string, Raw][];
}

/** Whatever the user pasted → the drafts to fill the form with, or why nothing was understood. */
export function parseMcpSnippet(input: string): McpPasteResult {
  const text = input.trim();
  if (!text) return { ok: false, error: 'empty' };
  if (/^[{["]/.test(text)) {
    let j: unknown;
    // a fragment copied from inside mcpServers ("github": {…}) gets its braces back; trailing commas are forgiven
    const tries = [text, `{${text}}`].map(s => s.replace(/,\s*([}\]])/g, '$1').replace(/,\s*$/, ''));
    for (const s of tries) { try { j = JSON.parse(s); break; } catch { /* next */ } }
    if (j === undefined) return { ok: false, error: 'json' };
    const drafts = entriesOf(j).map(([n, raw]) => entryToDraft(n, raw)).filter((d): d is McpDraft => !!d);
    // a JSON key like "github" reads better as "Github"; a written name ("Azure DevOps") stays as it is
    for (const d of drafts) if (/^[a-z0-9_-]+$/.test(d.def.label)) d.def.label = label(d.def.label);
    return drafts.length ? { ok: true, kind: 'json', drafts: drafts.slice(0, 20) } : { ok: false, error: 'nothing' };
  }
  if (/^https?:\/\//i.test(text) && !/\s/.test(text)) { const d = fromUrl(text); return d ? { ok: true, kind: 'url', drafts: [d] } : { ok: false, error: 'url' }; }
  const d = fromCommand(text);
  return d ? { ok: true, kind: 'command', drafts: [d] } : { ok: false, error: 'command' };
}

/** The paste box after an edit: its text may carry ••• where a secret was; such a value comes from the previous reading
 *  (same server, same slot), or is left for the user to type. */
export function readPaste(text: string, prev: McpPasteResult | null): McpPasteResult {
  const r = parseMcpSnippet(text);
  if (!r.ok) return r;
  r.drafts.forEach((d, i) => {
    for (const [k, v] of Object.entries(d.values)) {
      if (!v.includes(SECRET_MASK)) continue;
      const old = prev?.ok ? prev.drafts.find(x => x.def.id === d.def.id)?.values[k] ?? prev.drafts[i]?.values[k] : undefined;
      if (old) d.values[k] = old; else delete d.values[k];
    }
  });
  return r;
}

/** A draft as an agent may see it: the definition and which tokens are still to type, never a value. */
export const publicDraft = (d: McpDraft): { def: McpServerDef; tokens: string[]; dropped: string[] } =>
  ({ def: d.def, tokens: d.def.secrets.map(s => s.name), dropped: [...d.dropped, ...Object.keys(d.values).map(k => `valore di ${k.split(':')[1]} (lo scrive l’utente)`)] });

/** Popular servers, one click each (README commands of their makers; checked 2026-10). `ask`: one value the user adds
 *  (appended as the last argument); `token`: the variable or header that takes a key, with where to get one. */
export interface McpCatalogEntry { id: string; label: string; purpose: string; snippet: string; ask?: { label: string; placeholder: string }; token?: { name: string; where: string }; docs: string }
export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  { id: 'filesystem', label: 'Filesystem', purpose: 'Leggere e scrivere i file di una cartella', snippet: 'npx -y @modelcontextprotocol/server-filesystem', ask: { label: 'Cartella', placeholder: 'C:\\progetti' }, docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem' },
  { id: 'fetch', label: 'Fetch', purpose: 'Scaricare pagine web come testo', snippet: 'uvx mcp-server-fetch', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch' },
  { id: 'memory', label: 'Memory', purpose: 'Un grafo di appunti persistente', snippet: 'npx -y @modelcontextprotocol/server-memory', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory' },
  { id: 'sequential-thinking', label: 'Sequential Thinking', purpose: 'Ragionare per passi su problemi lunghi', snippet: 'npx -y @modelcontextprotocol/server-sequential-thinking', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking' },
  { id: 'git', label: 'Git', purpose: 'Storia, diff e commit di un repository', snippet: 'uvx mcp-server-git', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git' },
  { id: 'playwright', label: 'Playwright', purpose: 'Un browser da guidare (clic, moduli, screenshot)', snippet: 'npx -y @playwright/mcp@latest', docs: 'https://github.com/microsoft/playwright-mcp' },
  { id: 'context7', label: 'Context7', purpose: 'Documentazione aggiornata delle librerie', snippet: 'https://mcp.context7.com/mcp', docs: 'https://github.com/upstash/context7' },
  { id: 'brave-search', label: 'Brave Search', purpose: 'Ricerca sul web', snippet: 'npx -y @brave/brave-search-mcp-server', token: { name: 'BRAVE_API_KEY', where: 'api-dashboard.search.brave.com' }, docs: 'https://github.com/brave/brave-search-mcp-server' },
];

/** A catalog entry → its draft (the extra value appended, the token slot added empty). */
export function catalogDraft(e: McpCatalogEntry, ask = ''): McpDraft | null {
  const r = parseMcpSnippet(ask.trim() && e.ask ? `${e.snippet} "${ask.trim().replace(/"/g, '')}"` : e.snippet);
  if (!r.ok) return null;
  const d = r.drafts[0]!;
  d.def = { ...d.def, id: e.id, label: e.label, purpose: e.purpose };
  if (e.token && !d.def.secrets.some(s => s.name === e.token!.name)) d.def.secrets = [...d.def.secrets, d.def.transport === 'stdio' ? { where: 'env', name: e.token.name } : { where: 'header', name: e.token.name }];
  return d;
}
