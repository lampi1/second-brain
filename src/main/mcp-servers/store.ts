// The app's MCP servers on disk (ADR 0086): their definitions, each role's access and the last test of each server in
// <userData>/mcp-servers.json; their tokens encrypted with the OS keyring (Electron safeStorage, the same cipher as the
// engines' API keys, ADR 0046) in <userData>/mcp-secrets.json. Write-only from the UI: a token is typed once and then
// only its mask is shown; nothing returns it but `secret()`, called by the gateway right before it opens that server.
// A token is bound to its server's fingerprint (transport, command or URL origin, slot): a definition that points
// somewhere else stops using it. Every token read or written is added to the logs' redaction. Validation is strict and
// fails closed (a damaged file loads as empty, never as a wider one). Used by service.ts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { addRedaction, log } from '../log';
import type { SecretCipher } from '../engines/secrets';
import { maskOf } from '../engines/secrets';
import { isRetiredRoleId } from '../../shared/roles';
import { MCP_ID, RESERVED_IDS, SECRET_NAME, checkAccess, secretLooking, slotKey, type McpSecretSlot, type McpServerDef, type McpTestResult, type RoleMcpAccess } from '../../shared/mcp-servers';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'content-type', 'accept', 'connection', 'mcp-session-id', 'mcp-protocol-version', 'transfer-encoding', 'cookie']);
const SHELL_CHARS = /["'`\r\n\0%&|<>^!;$*?]/;
const MAX_SERVERS = 40, MAX_TOKEN = 8192;

const str = (v: unknown, max: number, what: string, optional = false): string | undefined => {
  if (v === undefined || v === null || v === '') { if (optional) return undefined; throw new Error(`${what}: manca.`); }
  if (typeof v !== 'string' || v.length > max || /[\0\r\n]/.test(v)) throw new Error(`${what}: non valido.`);
  return v;
};
const record = (v: unknown, name: RegExp, what: string): Record<string, string> | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what}: non valido.`);
  const out: Record<string, string> = {};
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 32) throw new Error(`${what}: troppi valori.`);
  for (const [k, val] of entries) {
    if (!name.test(k) || typeof val !== 'string' || val.length > 4000 || /[\0\r\n]/.test(val)) throw new Error(`${what}: «${k.slice(0, 40)}» non valido.`);
    out[k] = val;
  }
  return Object.keys(out).length ? out : undefined;
};

/** A server definition from the renderer or a file: valid, or an Italian error saying what to fix. */
export function checkDef(raw: unknown): McpServerDef {
  if (!raw || typeof raw !== 'object') throw new Error('Server MCP non valido.');
  const d = raw as Record<string, unknown>;
  const id = str(d.id, 40, 'Nome tecnico')!;
  if (!MCP_ID.test(id) || RESERVED_IDS.includes(id)) throw new Error('Nome tecnico: solo lettere minuscole, cifre e trattini (second-brain è riservato all’app).');
  const label = str(d.label, 80, 'Nome')!.trim();
  if (!label) throw new Error('Nome: manca.');
  const transport = d.transport;
  if (transport !== 'stdio' && transport !== 'http') throw new Error('Tipo di collegamento non valido.');
  const secrets = checkSlots(d.secrets, transport);
  const purpose = str(d.purpose, 300, 'A cosa serve', true)?.trim();
  const importedFrom = d.importedFrom === 'claude' || d.importedFrom === 'cursor' || d.importedFrom === 'codex' ? d.importedFrom : undefined;
  const base: McpServerDef = { id, label, transport, secrets, enabled: d.enabled !== false, ...(purpose ? { purpose } : {}), ...(importedFrom ? { importedFrom } : {}) };
  if (transport === 'stdio') {
    const command = str(d.command, 400, 'Comando')!.trim();
    if (SHELL_CHARS.test(command)) throw new Error('Comando: un nome (npx, node) o un percorso completo, senza virgolette né caratteri della shell.');
    if (!Array.isArray(d.args ?? []) || ((d.args ?? []) as unknown[]).length > 64) throw new Error('Argomenti: non validi.');
    const args = ((d.args ?? []) as unknown[]).map((a, i) => str(a, 1000, `Argomento ${i + 1}`)!);
    args.forEach((a, i) => { if (secretLooking(a)) throw new Error(`Argomento ${i + 1}: sembra contenere un token (Bearer, Authorization: …): mettilo nel campo Token, che lo cifra.`); });
    const env = record(d.env, ENV_NAME, 'Variabili');
    for (const [k, v] of Object.entries(env ?? {})) if (SECRET_NAME.test(k) && v || secretLooking(v)) throw new Error(`La variabile ${k} sembra un segreto: mettila nel campo Token, che la cifra.`);
    return { ...base, command, args, ...(env ? { env } : {}) };
  }
  const urlText = str(d.url, 2000, 'Indirizzo')!.trim();
  let url: URL;
  try { url = new URL(urlText); } catch { throw new Error('Indirizzo: non è un URL (https://…).'); }
  const loopback = /^(127\.0\.0\.1|localhost|\[::1\])$/i.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Indirizzo: https, oppure http solo su questo computer.');
  if (url.username || url.password) throw new Error('Indirizzo: niente utente o password nell’URL: usa il campo Token.');
  for (const k of url.searchParams.keys()) if (SECRET_NAME.test(k)) throw new Error(`Indirizzo: il parametro «${k}» sembra un segreto: usa il campo Token.`);
  if (url.hash) throw new Error('Indirizzo: senza #.');
  const headers = record(d.headers, HEADER_NAME, 'Intestazioni');
  for (const k of Object.keys(headers ?? {})) {
    if (FORBIDDEN_HEADERS.has(k.toLowerCase())) throw new Error(`Intestazione ${k}: la imposta l’app.`);
    if (SECRET_NAME.test(k) || k.toLowerCase() === 'authorization' || secretLooking(headers![k]!)) throw new Error(`L’intestazione ${k} sembra un segreto: mettila nel campo Token, che la cifra.`);
  }
  return { ...base, url: url.toString(), ...(headers ? { headers } : {}) };
}

function checkSlots(v: unknown, transport: 'stdio' | 'http'): McpSecretSlot[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 4) throw new Error('Token: al massimo quattro.');
  const out: McpSecretSlot[] = [];
  for (const s of v as unknown[]) {
    const o = (s ?? {}) as Record<string, unknown>;
    const where = transport === 'stdio' ? 'env' : 'header';
    if (o.where !== where) throw new Error(transport === 'stdio' ? 'Un server locale riceve il token in una variabile.' : 'Un server remoto riceve il token in un’intestazione.');
    const name = str(o.name, 64, 'Nome del token')!;
    if (!(where === 'env' ? ENV_NAME : HEADER_NAME).test(name) || (where === 'header' && FORBIDDEN_HEADERS.has(name.toLowerCase()))) throw new Error(`Nome del token «${name.slice(0, 40)}» non valido.`);
    const prefix = str(o.prefix, 20, 'Prefisso del token', true);
    if (prefix !== undefined && !/^[\x20-\x7e]*$/.test(prefix)) throw new Error('Prefisso del token non valido.');
    if (out.some(x => slotKey(x) === `${where}:${name}`)) continue;
    out.push({ where, name, ...(prefix ? { prefix } : {}) });
  }
  return out;
}

/** Where a server's token may go: a different command, URL origin or slot is a different place. */
export function fingerprint(def: McpServerDef, slot: McpSecretSlot): string {
  // a stdio token is bound to the whole launch (command, arguments, plain env): `npx other-package` or a NODE_OPTIONS
  // never inherits it; an http one to the URL's origin (a path change keeps it)
  const where = def.transport === 'stdio' ? `stdio|${JSON.stringify([def.command ?? '', def.args ?? [], def.env ?? {}])}` : `http|${def.url ? new URL(def.url).origin : ''}`;
  return crypto.createHash('sha256').update(`${where}|${slotKey(slot)}`).digest('hex').slice(0, 32);
}

interface Saved { cipher: string; mask: string; bound: string }
interface FileShape { version: 1; servers: McpServerDef[]; access: Record<string, RoleMcpAccess>; tests: Record<string, McpTestResult> }

const writeAtomic = (file: string, data: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); }
  finally { fs.rmSync(tmp, { force: true }); }
};

export class McpServerStore {
  private readonly file: string;
  private readonly secretsFile: string;
  private data: FileShape = { version: 1, servers: [], access: {}, tests: {} };
  private secrets: Record<string, Record<string, Saved>> = {};

  constructor(userData: string, private readonly cipher: SecretCipher) {
    this.file = path.join(userData, 'mcp-servers.json');
    this.secretsFile = path.join(userData, 'mcp-secrets.json');
    this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<FileShape>;
      const servers: McpServerDef[] = [];
      for (const s of Array.isArray(raw.servers) ? raw.servers.slice(0, MAX_SERVERS) : []) {
        try { const d = checkDef(s); if (!servers.some(x => x.id === d.id)) servers.push(d); } catch (e) { log.warn('mcp-servers', 'a saved MCP server is invalid: left out', { cause: (e as Error).message, hint: 'add it again in Impostazioni → Connettori' }); }
      }
      const access: Record<string, RoleMcpAccess> = {};
      for (const [role, a] of Object.entries(raw.access ?? {})) {
        if (!/^[a-z][a-z0-9-]{0,40}$/.test(role)) continue;
        // a role ADR 0100 retired (Router, Judge, Scribe) runs no chat any more: its entry is dropped, never merged into
        // its successor, whose own narrowing is the user's for its own job (a Scribe narrowed off a server must not take
        // that server away from every Artisan)
        if (isRetiredRoleId(role)) continue;
        const out: RoleMcpAccess = { servers: {} };
        // an unreadable access entry narrows to none: a damaged file never widens a role
        for (const [server, v] of Object.entries((a as RoleMcpAccess | undefined)?.servers ?? {})) { if (MCP_ID.test(server)) { try { out.servers[server] = checkAccess(v); } catch { out.servers[server] = 'none'; } } }
        access[role] = out;
      }
      const tests: Record<string, McpTestResult> = {};
      for (const [id, t] of Object.entries(raw.tests ?? {})) if (servers.some(s => s.id === id) && t && typeof t === 'object' && Array.isArray((t as McpTestResult).tools)) tests[id] = t as McpTestResult;
      this.data = { version: 1, servers, access, tests };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('mcp-servers', 'mcp-servers.json unreadable: no MCP server loaded', { cause: (e as Error).message, hint: 'add the servers again in Impostazioni → Connettori' });
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.secretsFile, 'utf8')) as { servers?: Record<string, Record<string, Saved>> };
      for (const [id, slots] of Object.entries(raw.servers ?? {})) {
        if (!this.def(id)) continue;
        const ok: Record<string, Saved> = {};
        for (const [k, s] of Object.entries(slots ?? {})) if (s && typeof s.cipher === 'string' && typeof s.mask === 'string' && typeof s.bound === 'string') ok[k] = s;
        this.secrets[id] = ok;
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('mcp-servers', 'mcp-secrets.json unreadable: no MCP token loaded', { cause: (e as Error).message, hint: 'type the tokens again in Impostazioni → Connettori' });
    }
  }

  private save(): void { writeAtomic(this.file, this.data); }
  private saveSecrets(): void { writeAtomic(this.secretsFile, { version: 1, servers: this.secrets }); }

  servers(): McpServerDef[] { return structuredClone(this.data.servers); }
  def(id: string): McpServerDef | undefined { return this.data.servers.find(s => s.id === id); }
  access(): Record<string, RoleMcpAccess> { return structuredClone(this.data.access); }
  roleAccess(role: string): RoleMcpAccess | undefined { return this.data.access[role]; }
  test(id: string): McpTestResult | null { return this.data.tests[id] ?? null; }

  /** Adds or replaces a server (`previousId`: the one being edited, which may be renamed). Tokens whose place changed are dropped. */
  upsert(raw: unknown, previousId?: string): McpServerDef {
    const def = checkDef(raw);
    const others = this.data.servers.filter(s => s.id !== (previousId ?? def.id));
    if (others.some(s => s.id === def.id)) throw new Error(`Esiste già un server «${def.id}».`);
    if (!previousId && this.def(def.id)) throw new Error(`Esiste già un server «${def.id}».`);
    if (others.length >= MAX_SERVERS) throw new Error('Troppi server MCP (al massimo 40).');
    const at = previousId ? this.data.servers.findIndex(s => s.id === previousId) : -1;
    const servers = [...this.data.servers];
    if (at >= 0) servers[at] = def; else servers.push(def);
    const old = previousId ? this.secrets[previousId] : undefined;
    if (previousId && previousId !== def.id) {
      delete this.data.tests[previousId];
      for (const a of Object.values(this.data.access)) if (previousId in a.servers) { a.servers[def.id] = a.servers[previousId]!; delete a.servers[previousId]; }
    }
    if (old) {
      const kept: Record<string, Saved> = {};
      for (const slot of def.secrets) { const s = old[slotKey(slot)]; if (s && s.bound === fingerprint(def, slot)) kept[slotKey(slot)] = s; }
      if (previousId) delete this.secrets[previousId];
      if (Object.keys(kept).length) this.secrets[def.id] = kept;
      this.saveSecrets();
    }
    if (previousId && JSON.stringify(this.def(previousId)) !== JSON.stringify(def)) delete this.data.tests[def.id];
    this.data.servers = servers;
    this.save();
    log.info('mcp-servers', previousId ? 'MCP server changed' : 'MCP server added', { data: { server: def.id, transport: def.transport } });
    return structuredClone(def);
  }

  remove(id: string): void {
    if (!this.def(id)) return;
    this.data.servers = this.data.servers.filter(s => s.id !== id);
    delete this.data.tests[id];
    for (const a of Object.values(this.data.access)) delete a.servers[id];
    this.save();
    if (this.secrets[id]) { delete this.secrets[id]; this.saveSecrets(); }
    log.info('mcp-servers', 'MCP server removed', { data: { server: id } });
  }

  setAccess(role: string, server: string, value: unknown): void {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(role)) throw new Error('Ruolo non valido.');
    if (!this.def(server)) throw new Error(`Server MCP «${server}» sconosciuto.`);
    const access = checkAccess(value);
    const a = this.data.access[role] ?? { servers: {} };
    if (access === 'all') delete a.servers[server]; else a.servers[server] = access;
    if (Object.keys(a.servers).length) this.data.access[role] = a; else delete this.data.access[role];
    this.save();
  }

  recordTest(id: string, result: McpTestResult): void {
    if (!this.def(id)) return;
    this.data.tests[id] = result;
    this.save();
  }

  secretsAvailable(): string | null { return this.cipher.unavailable(); }

  masks(id: string): Record<string, string | null> {
    const def = this.def(id);
    if (!def) return {};
    return Object.fromEntries(def.secrets.map(slot => { const s = this.secrets[id]?.[slotKey(slot)]; return [slotKey(slot), s && s.bound === fingerprint(def, slot) ? s.mask : null]; }));
  }

  setSecret(id: string, key: string, value: unknown): void {
    const def = this.def(id), slot = def?.secrets.find(s => slotKey(s) === key);
    if (!def || !slot) throw new Error('Token sconosciuto.');
    const why = this.cipher.unavailable();
    if (why) throw new Error(`Token non salvato: ${why}.`);
    const v = typeof value === 'string' ? value.trim() : '';
    if (!v || v.length > MAX_TOKEN || /[\s\0]/.test(v)) throw new Error('Il token è vuoto, troppo lungo o contiene spazi.');
    addRedaction(v);
    this.secrets[id] = { ...this.secrets[id], [key]: { cipher: this.cipher.encrypt(v).toString('base64'), mask: maskOf(v), bound: fingerprint(def, slot) } };
    this.saveSecrets();
    delete this.data.tests[id];
    this.save();
    log.info('mcp-servers', 'MCP token saved', { data: { server: id, slot: key } });
  }

  deleteSecret(id: string, key: string): void {
    if (!this.secrets[id]?.[key]) return;
    delete this.secrets[id]![key];
    if (!Object.keys(this.secrets[id]!).length) delete this.secrets[id];
    this.saveSecrets();
    log.info('mcp-servers', 'MCP token deleted', { data: { server: id, slot: key } });
  }

  /** Main only, right before the gateway opens the server: the token, or null (missing, moved, or not decryptable). */
  secret(id: string, slot: McpSecretSlot): string | null {
    const def = this.def(id), s = this.secrets[id]?.[slotKey(slot)];
    if (!def || !s) return null;
    if (s.bound !== fingerprint(def, slot)) { log.warn('mcp-servers', 'MCP token not used: its server points elsewhere since it was saved', { data: { server: id }, hint: 'type the token again in Impostazioni → Connettori' }); return null; }
    if (this.cipher.unavailable()) return null;
    try { const v = this.cipher.decrypt(Buffer.from(s.cipher, 'base64')); addRedaction(v); return v; }
    catch (e) { log.warn('mcp-servers', 'MCP token could not be decrypted', { data: { server: id }, cause: (e as Error).message, hint: 'type the token again in Impostazioni → Connettori' }); return null; }
  }
}
