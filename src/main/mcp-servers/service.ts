// The app's MCP servers (ADR 0086, issue #91): what Settings → Connettori and the agent card's MCP section call over
// IPC (only the user's clicks: no MCP tool and no agent can add a server, read a token or widen a role), and what the
// chat launch asks (launch(): the gateway endpoints a chat is given, the managed servers it may not use). It joins the
// store (definitions, access, tokens), the gateway (the chats' calls) and the import (the engines' own configs, read
// only). A test opens the server exactly as a chat would (its tokens included), lists its tools and records the result
// with a clear error and fix. Created by wiring.ts (and demo-wiring.ts with a fake upstream and seeded servers).
import os from 'node:os';
import { RoutineConnectors } from './routine';
import { FAIL_CLOSED, type AgentPolicy } from '../agents/tool-policy';
import { log, errText } from '../log';
import type { McpServer } from '../mcp/server';
import type { SecretCipher } from '../engines/secrets';
import type { McpImportCandidate, McpServerDef, McpServersState, McpTestResult } from '../../shared/mcp-servers';
import { slotKey } from '../../shared/mcp-servers';
import { McpServerStore } from './store';
import { McpGateway } from './gateway';
import { McpClientError, connect, describeError, type Endpoint, type Upstream } from './client';
import { scanImports } from './import';
import type { ChatMcpContext } from './access';

export interface McpServersOptions {
  userData: string;
  cipher: SecretCipher;
  mcp: McpServer;
  /** the chat's roles and policy (manager.mcpContext); null = unknown chat */
  context: (chatId: string) => ChatMcpContext | null;
  emit?: (state: McpServersState) => void;
  /** the folder the engines' configs are read from (tests: a temp home) */
  home?: string;
  /** Import environment override for hermetic tests; production uses its actual engine locations. */
  importEnv?: NodeJS.ProcessEnv;
  /** tests and the demo: a fake upstream instead of the network or a process */
  connect?: (ep: Endpoint, def: McpServerDef) => Upstream;
  testTimeoutMs?: number;
  routinePolicy?: (role: string) => AgentPolicy | null;
  /** the clock of a test's time (the frozen demo) */
  now?: () => number;
}

export class McpServersService {
  readonly store: McpServerStore;
  readonly gateway: McpGateway;
  readonly routines: RoutineConnectors;
  private imports: McpImportCandidate[] = [];

  constructor(private readonly opts: McpServersOptions) {
    this.store = new McpServerStore(opts.userData, opts.cipher);
    this.routines = new RoutineConnectors({ definitions: () => this.store.servers(), endpoint: id => this.endpoint(id), access: role => this.store.roleAccess(role), policy: role => this.opts.routinePolicy ? this.opts.routinePolicy(role) : FAIL_CLOSED, ...(opts.connect ? { connect: opts.connect } : {}) });
    this.gateway = new McpGateway({
      mcp: opts.mcp, servers: () => this.store.servers(), roleAccess: r => this.store.roleAccess(r),
      endpoint: id => this.endpoint(id), context: opts.context, ...(opts.connect ? { connect: opts.connect } : {}),
    });
  }

  state(): McpServersState {
    const why = this.store.secretsAvailable();
    return {
      servers: this.store.servers().map(s => ({ ...s, secretMasks: this.store.masks(s.id), lastTest: this.store.test(s.id) })),
      access: this.store.access(), secretsAvailable: why === null, ...(why ? { secretsWhy: why } : {}),
    };
  }

  private changed(server?: string): McpServersState {
    this.gateway.reset(server);
    const st = this.state();
    this.opts.emit?.(st);
    return st;
  }

  save(a: { def?: unknown; previousId?: unknown } | undefined): McpServersState {
    const previousId = typeof a?.previousId === 'string' && a.previousId ? a.previousId : undefined;
    const def = this.store.upsert(a?.def, previousId);
    if (previousId && previousId !== def.id) this.gateway.reset(previousId);
    return this.changed(def.id);
  }

  remove(id: unknown): McpServersState {
    if (typeof id !== 'string') throw new Error('Server MCP non valido.');
    this.store.remove(id);
    return this.changed(id);
  }

  setSecret(a: { id?: unknown; slot?: unknown; value?: unknown } | undefined): McpServersState {
    if (typeof a?.id !== 'string' || typeof a.slot !== 'string') throw new Error('Token non valido.');
    this.store.setSecret(a.id, a.slot, a.value);
    return this.changed(a.id);
  }

  deleteSecret(a: { id?: unknown; slot?: unknown } | undefined): McpServersState {
    if (typeof a?.id !== 'string' || typeof a.slot !== 'string') throw new Error('Token non valido.');
    this.store.deleteSecret(a.id, a.slot);
    return this.changed(a.id);
  }

  setAccess(a: { role?: unknown; server?: unknown; access?: unknown } | undefined): McpServersState {
    if (typeof a?.role !== 'string' || typeof a.server !== 'string') throw new Error('Accesso non valido.');
    this.store.setAccess(a.role, a.server, a.access);
    // no reset: the gateway reads access at every request, open connections stay
    const st = this.state();
    this.opts.emit?.(st);
    return st;
  }

  /** How a chat (or the test) reaches the server: its definition plus its tokens, read now, in main memory only. */
  private endpoint(id: string): Endpoint {
    const def = this.store.def(id);
    if (!def) throw new McpClientError('invalid', 'Server sconosciuto.', 'Aggiungilo in Impostazioni → Connettori.');
    const values: Record<string, string> = {};
    for (const slot of def.secrets) {
      const v = this.store.secret(id, slot);
      if (!v) throw new McpClientError('secret', `Manca il token «${slot.name}».`, 'Inseriscilo nel campo Token della scheda del server: viene cifrato sul computer.');
      values[slotKey(slot)] = v;
    }
    if (def.transport === 'http') {
      const headers: Record<string, string> = { ...def.headers };
      for (const slot of def.secrets) headers[slot.name] = `${slot.prefix ?? ''}${values[slotKey(slot)]}`;
      return { transport: 'http', url: def.url!, headers };
    }
    const env: Record<string, string> = { ...def.env };
    for (const slot of def.secrets) env[slot.name] = values[slotKey(slot)]!;
    return { transport: 'stdio', command: def.command!, args: def.args ?? [], env, cwd: this.opts.home ?? os.homedir() };
  }

  /** "Prova": opens the server as a chat would, lists its tools, records the result. Never throws. */
  async test(id: unknown): Promise<McpServersState> {
    if (typeof id !== 'string' || !this.store.def(id)) throw new Error('Server MCP sconosciuto.');
    const def = this.store.def(id)!;
    const now = this.opts.now ?? Date.now, t0 = Date.now();
    let up: Upstream | null = null;
    let result: McpTestResult;
    try {
      const ep = this.endpoint(id);
      up = (this.opts.connect ?? ((e: Endpoint) => connect(e, this.opts.testTimeoutMs ?? 45_000)))(ep, def);
      const tools = await up.tools();
      result = { ok: true, at: now(), ms: Date.now() - t0, tools: tools.map(t => ({ name: t.name, description: t.description.slice(0, 400), readOnly: t.readOnly })), ...(up.serverInfo ? { serverInfo: up.serverInfo } : {}) };
      log.info('mcp-servers', 'MCP server tested', { data: { server: id, tools: tools.length, ms: result.ms } });
    } catch (e) {
      const error = describeError(e);
      result = { ok: false, at: now(), ms: Date.now() - t0, tools: this.store.test(id)?.tools ?? [], error };
      log.warn('mcp-servers', 'MCP server test failed', { cause: errText(e), data: { server: id, code: error.code }, hint: error.fix });
    } finally { up?.close(); }
    this.store.recordTest(id, result);
    return this.changed(id);
  }

  importScan(): McpImportCandidate[] {
    this.imports = scanImports(this.opts.home ?? process.env.SB_HOME ?? os.homedir(), this.store.servers().map(s => s.id), process.platform, this.opts.importEnv);
    return structuredClone(this.imports);
  }

  importApply(keys: unknown): { state: McpServersState; added: string[]; errors: { key: string; message: string }[] } {
    if (!Array.isArray(keys) || keys.length > 40) throw new Error('Scelta non valida.');
    const added: string[] = [], errors: { key: string; message: string }[] = [];
    for (const key of keys) {
      const c = this.imports.find(i => i.key === key);
      if (!c) { errors.push({ key: String(key), message: 'Non più disponibile: cerca di nuovo.' }); continue; }
      try { this.store.upsert(c.def); added.push(c.def.id); }
      catch (e) { errors.push({ key: c.key, message: (e as Error).message }); }
    }
    return { state: this.changed(), added, errors };
  }

  /** What a chat gets at launch: the gateway endpoints of the servers it may use and the managed ids it may not. */
  launch(chatId: string, base: string): { servers: { name: string; url: string }[]; denied: string[] } {
    try { return { servers: this.gateway.urlsFor(chatId, base), denied: this.gateway.deniedFor(chatId) }; }
    catch (e) { log.warn('mcp-servers', 'MCP servers not given to a chat', { chat: chatId, cause: errText(e), hint: 'see Impostazioni → Connettori' }); return { servers: [], denied: this.store.servers().map(s => s.id) }; }
  }

  stop(): void { this.gateway.stop(); }
}
