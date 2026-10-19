// "Importa da Claude e Cursor" (ADR 0086, issue #91 point 5): the MCP servers already configured in the user's own
// engines, read once when the user asks, never changed (AGENTS.md rule 6). Sources: Claude Code (~/.claude.json, its
// user and per-project servers), Claude desktop (claude_desktop_config.json), Cursor (~/.cursor/mcp.json) and Codex
// (~/.codex/config.toml, its [mcp_servers.*] tables only). A secret is never copied: an environment variable or a
// header whose name looks like a credential, a value that looks like a token, a ${VAR} reference or a token argument
// becomes an empty token slot (or is dropped) and is listed, so the user types it once in the app. Files are capped
// at 2 MB; unreadable ones are skipped. Pure apart from the reads; used by service.ts.
import fs from 'node:fs';
import path from 'node:path';
import { MCP_ID, RESERVED_IDS, SECRET_NAME, idFrom, type McpImportCandidate, type McpImportSource, type McpSecretSlot, type McpServerDef } from '../../shared/mcp-servers';

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : {});
const TOKENISH = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_\-.=+/:]{24,}$/;
const TOKEN_FLAG = /^--?[a-z-]*?(token|pat|api[-_]?key|apikey|secret|password|auth(orization)?|bearer)(=|$)/i;

function read(file: string): string | null {
  try { const st = fs.statSync(file); if (!st.isFile() || st.size > 2 * 1024 * 1024) return null; return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

/** One engine entry → a definition with no secret in it, and what was left out. */
export function convert(name: string, raw: Raw, source: McpImportSource): { def: McpServerDef; dropped: string[] } | null {
  const dropped: string[] = [], secrets: McpSecretSlot[] = [];
  let id = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!MCP_ID.test(id) || RESERVED_IDS.includes(id)) id = idFrom(name);
  if (RESERVED_IDS.includes(name)) return null;
  const url = typeof raw.url === 'string' ? raw.url : typeof raw.serverUrl === 'string' ? raw.serverUrl : null;
  const base = { id, label: name.slice(0, 80) || id, importedFrom: source, enabled: true };
  if (url) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj(raw.headers ?? raw.http_headers))) {
      if (typeof v !== 'string') continue;
      if (SECRET_NAME.test(k) || k.toLowerCase() === 'authorization' || TOKENISH.test(v) || v.includes('${')) {
        const bearer = /^bearer\s/i.test(v);
        secrets.push({ where: 'header', name: k, ...(bearer ? { prefix: 'Bearer ' } : {}) });
        dropped.push(`intestazione ${k}`);
      } else headers[k] = v;
    }
    if (typeof raw.bearer_token_env_var === 'string') { secrets.push({ where: 'header', name: 'Authorization', prefix: 'Bearer ' }); dropped.push(`token da ${raw.bearer_token_env_var}`); }
    let clean = url;
    try {
      const u = new URL(url);
      for (const k of [...u.searchParams.keys()]) if (SECRET_NAME.test(k)) { u.searchParams.delete(k); dropped.push(`parametro ${k}`); }
      if (u.username || u.password) { u.username = ''; u.password = ''; dropped.push('credenziali nell’indirizzo'); }
      clean = u.toString();
    } catch { return null; }
    return { def: { ...base, transport: 'http', url: clean, ...(Object.keys(headers).length ? { headers } : {}), secrets: dedupe(secrets) }, dropped };
  }
  if (typeof raw.command !== 'string' || !raw.command) return null;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(raw.env))) {
    if (typeof v !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) continue;
    if (SECRET_NAME.test(k) || TOKENISH.test(v) || v.includes('${')) { secrets.push({ where: 'env', name: k }); dropped.push(`variabile ${k}`); }
    else env[k] = v;
  }
  for (const k of Array.isArray(raw.env_vars) ? raw.env_vars : []) if (typeof k === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) { secrets.push({ where: 'env', name: k }); dropped.push(`variabile ${k}`); }
  const args: string[] = [];
  const list = Array.isArray(raw.args) ? raw.args.filter((a): a is string => typeof a === 'string') : [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    if (TOKEN_FLAG.test(a)) { dropped.push(`argomento ${a.split('=')[0]}`); if (!a.includes('=')) i++; continue; }
    if (TOKENISH.test(a) && !/[\\/]/.test(a) && !a.startsWith('@')) { dropped.push('un argomento che sembra un token'); continue; }
    args.push(a);
  }
  return { def: { ...base, transport: 'stdio', command: raw.command, args, ...(Object.keys(env).length ? { env } : {}), secrets: dedupe(secrets) }, dropped };
}

const dedupe = (s: McpSecretSlot[]): McpSecretSlot[] => s.filter((x, i) => s.findIndex(y => y.where === x.where && y.name === x.name) === i).slice(0, 4);

/** The [mcp_servers.<name>] tables of a Codex config.toml: strings, arrays of strings and inline tables of strings. */
export function codexServers(toml: string): Record<string, Raw> {
  const out: Record<string, Raw> = {};
  let cur: Raw | null = null;
  const value = (v: string): unknown => {
    v = v.trim();
    const s = /^"((?:[^"\\]|\\.)*)"$/.exec(v) ?? /^'([^']*)'$/.exec(v);
    if (s) return s[1]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    if (v.startsWith('[') && v.endsWith(']')) return [...v.slice(1, -1).matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map(m => (m[1] ?? m[2] ?? '').replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    if (v.startsWith('{') && v.endsWith('}')) return Object.fromEntries([...v.slice(1, -1).matchAll(/([A-Za-z0-9_-]+|"[^"]+")\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/g)].map(m => [m[1]!.replace(/"/g, ''), value(m[2]!)]));
    return undefined;
  };
  for (const line of toml.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const table = /^\[\s*mcp_servers\.("?)([A-Za-z0-9_-]+)\1(?:\.(env|http_headers))?\s*\]$/.exec(l);
    if (table) {
      const server: Raw = out[table[2]!] ??= {};
      cur = table[3] ? (server[table[3]] = obj(server[table[3]])) as Raw : server;
      continue;
    }
    if (l.startsWith('[')) { cur = null; continue; }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(l);
    if (cur && kv) { const v = value(kv[2]!.replace(/\s+#.*$/, '')); if (v !== undefined) cur[kv[1]!] = v; }
  }
  return out;
}

/** Every importable server found, newest wins when two sources name the same one. `existing` = ids already in the app. */
export function scanImports(home: string, existing: readonly string[], platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): McpImportCandidate[] {
  const found: McpImportCandidate[] = [];
  const add = (source: McpImportSource, file: string, servers: Raw) => {
    for (const [name, raw] of Object.entries(servers)) {
      const c = convert(name, obj(raw), source);
      if (!c) continue;
      const key = `${source}:${c.def.id}`;
      if (found.some(f => f.key === key)) continue;
      found.push({ key, source, file, def: c.def, secretsDropped: c.dropped, exists: existing.includes(c.def.id) });
    }
  };
  const claudeJson = path.join(env.CLAUDE_CONFIG_DIR || home, '.claude.json');
  const cj = read(claudeJson);
  if (cj) {
    try {
      const j = obj(JSON.parse(cj));
      add('claude', claudeJson, obj(j.mcpServers));
      for (const p of Object.values(obj(j.projects))) add('claude', claudeJson, obj(obj(p).mcpServers));
    } catch { /* not JSON: skipped */ }
  }
  const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const desktop = platform === 'win32' ? path.join(appData, 'Claude', 'claude_desktop_config.json')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
  for (const [source, file] of [['claude', desktop], ['cursor', path.join(home, '.cursor', 'mcp.json')]] as const) {
    const text = read(file);
    if (!text) continue;
    try { add(source, file, obj(obj(JSON.parse(text)).mcpServers)); } catch { /* not JSON: skipped */ }
  }
  const codexFile = path.join(env.CODEX_HOME || path.join(home, '.codex'), 'config.toml');
  const toml = read(codexFile);
  if (toml) add('codex', codexFile, codexServers(toml));
  return found;
}
