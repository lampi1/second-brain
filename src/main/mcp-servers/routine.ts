// Host-only deterministic routine calls through existing connector credentials. Discovery grants no authority.
import type { McpServerDef, RoleMcpAccess } from '../../shared/mcp-servers';
import type { FlowConnectorCall } from '../../shared/flow-connector';
import type { AgentPolicy } from '../agents/tool-policy';
import { connectorHash } from '../flows/connector-call';
import { toolFor } from './access';
import { connect, type Endpoint, type Upstream, type UpstreamTool } from './client';
import { redact } from '../log';
export interface RoutineConnectorOptions {
  definitions(): McpServerDef[]; endpoint(id: string): Endpoint;
  access(role: string): RoleMcpAccess | undefined; policy(role: string): AgentPolicy | null;
  connect?: (endpoint: Endpoint, def: McpServerDef) => Upstream;
}
const toolHash = (tool: UpstreamTool) => connectorHash({ name: tool.name, schema: tool.inputSchema, description: tool.description, readOnly: tool.readOnly, annotations: tool.annotations ?? {} });
export class RoutineConnectors {
  constructor(private readonly options: RoutineConnectorOptions) {}
  catalog() { return this.options.definitions().map(s => ({ id: s.id, label: s.label, enabled: s.enabled, routineTest: s.routineTest === true, serverHash: connectorHash(s) })); }
  private definition(id: string, hash?: string): McpServerDef {
    const def = this.options.definitions().find(s => s.id === id);
    if (!def?.enabled || def.routineTest !== true) throw new Error('Connector not enabled for test routines: the user must confirm its test-only account/targets in Settings → Connectors. No app code change is needed.');
    if (hash && connectorHash(def) !== hash) throw new Error('Connector configuration changed; inspect it and approve a new routine version');
    return def;
  }
  check(recipe: FlowConnectorCall): void {
    this.definition(recipe.serverId, recipe.serverHash);
    const policy = this.options.policy(recipe.role);
    if (!toolFor({ roles: [recipe.role], policy }, this.options.access, recipe.serverId, { name: recipe.tool, readOnly: false })) {
      // A read-only role may still use a read-only recipe: live tool metadata makes that decision before dispatch.
      if (!toolFor({ roles: [recipe.role], policy }, this.options.access, recipe.serverId, { name: recipe.tool, readOnly: true })) throw new Error('Connector tool is outside the current role permissions');
    }
  }
  async inspect(id: string, name?: string) {
    const def = this.definition(id), up = this.options.connect ? this.options.connect(this.options.endpoint(id), def) : connect(this.options.endpoint(id));
    try {
      const tools = await up.tools(); this.definition(id, connectorHash(def));
      return { serverId: id, serverHash: connectorHash(def), tools: tools.filter(t => !name || t.name === name).slice(0, name ? 1 : 20).map(t => ({ ...t, toolHash: toolHash(t) })), total: tools.length, note: 'Choose an exact tool to inspect its complete schema. A registered test connector is a trusted integration; its backend account must be restricted to test systems.' };
    } finally { up.close(); }
  }
  async execute(recipe: FlowConnectorCall, args: Record<string, unknown>, readOnly: boolean, signal: AbortSignal, authorize: () => void, dispatch: () => void): Promise<{ outcome: 'done' | 'unknown'; summary: string }> {
    authorize(); this.check(recipe);
    const def = this.definition(recipe.serverId, recipe.serverHash);
    const up = this.options.connect ? this.options.connect(this.options.endpoint(def.id), def) : connect(this.options.endpoint(def.id));
    const abort = () => up.close();
    signal.addEventListener('abort', abort, { once: true });
    try {
      const tool = (await up.tools()).find(t => t.name === recipe.tool);
      authorize(); this.definition(def.id, recipe.serverHash);
      if (signal.aborted) throw new Error('Routine connector call cancelled before dispatch');
      if (!tool || toolHash(tool) !== recipe.toolHash) throw new Error('Connector tool/schema changed; inspect and approve a new version');
      if (readOnly && !tool.readOnly) throw new Error('A write tool cannot run in a read-only step');
      const policy = this.options.policy(recipe.role);
      if (!toolFor({ roles: [recipe.role], policy }, this.options.access, def.id, tool) || (!readOnly && policy?.ceiling === 'plan')) throw new Error('Connector tool is outside the current role permissions');
      authorize(); dispatch();
      const result = await up.call(tool.name, args, signal);
      // A remote error may follow a partial effect: never infer that retry is safe from isError alone.
      const body = result.content.flatMap(c => c && typeof c === 'object' && (c as { type?: string }).type === 'text' && typeof (c as { text?: unknown }).text === 'string' ? [(c as { text: string }).text] : []).join('\n');
      return { outcome: result.isError ? 'unknown' : 'done', summary: redact(body).replace(/\u0000/g, '').slice(0, 8000) || (result.isError ? 'Connector reported an error; verify effects before retrying.' : 'Connector returned success; inspect the declared evidence.') };
    } finally { signal.removeEventListener('abort', abort); up.close(); }
  }
}
