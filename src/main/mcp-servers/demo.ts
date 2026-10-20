// The demo's MCP servers (SB_DEMO=1, ADR 0086): four made-up servers seeded once in the demo's own userData (an Azure
// DevOps one imported from Claude and tested, a GitHub one with a saved token, a Jira one whose token is missing, one
// not tried yet), a few role limits for the agent cards, and a fake upstream so "Prova" answers at once: no process,
// no network, no real token (the cipher is a reversible fake: the demo never touches the OS keyring). Used by
// demo-wiring.ts; the e2e connectors-hub spec and the README screenshots read it.
import type { McpServer } from '../mcp/server';
import type { SecretCipher } from '../engines/secrets';
import type { McpServerDef, McpServersState, McpTestResult } from '../../shared/mcp-servers';
import { McpServersService } from './service';
import { McpClientError, type Upstream, type UpstreamTool } from './client';

const tool = (name: string, description: string, readOnly: boolean): UpstreamTool => ({ name, description, readOnly, inputSchema: { type: 'object' }, annotations: { readOnlyHint: readOnly } });
export const DEMO_TOOLS: Record<string, UpstreamTool[]> = {
  'azure-devops': [
    tool('wit_my_work_items', 'I work item assegnati a te, per stato.', true),
    tool('wit_get_work_item', 'Un work item con campi, commenti e link.', true),
    tool('repo_list_pull_requests', 'Le pull request di un repository, filtrate per autore o revisore.', true),
    tool('pipelines_get_builds', 'Le ultime build di una pipeline con esito e durata.', true),
    tool('wit_add_comment', 'Aggiunge un commento a un work item.', false),
    tool('wit_update_work_item', 'Cambia stato, assegnatario o campi di un work item.', false),
  ],
  github: [
    tool('search_issues', 'Cerca issue e pull request.', true),
    tool('get_pull_request', 'Una pull request con file e revisioni.', true),
    tool('list_commits', 'I commit di un ramo.', true),
    tool('create_issue', 'Apre una issue.', false),
    tool('add_issue_comment', 'Commenta una issue o una pull request.', false),
  ],
};
const DEMO_CIPHER: SecretCipher = { unavailable: () => null, encrypt: s => Buffer.from(s, 'utf8'), decrypt: b => b.toString('utf8') };

const SEED: McpServerDef[] = [
  { id: 'azure-devops', label: 'Azure DevOps', transport: 'stdio', command: 'npx', args: ['-y', '@azure-devops/mcp', 'contoso'], secrets: [], enabled: true, importedFrom: 'claude', purpose: 'Work item, pull request e pipeline: la pagina Task e gli agenti che lavorano sui ticket.' },
  { id: 'github', label: 'GitHub', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', secrets: [{ where: 'header', name: 'Authorization', prefix: 'Bearer ' }], enabled: true, purpose: 'Issue e pull request dei repository: revisioni, ricerche, commenti.' },
  { id: 'jira', label: 'Jira Cloud', transport: 'http', url: 'https://mcp.atlassian.com/v1/mcp', secrets: [{ where: 'header', name: 'Authorization', prefix: 'Bearer ' }], enabled: true, importedFrom: 'cursor', purpose: 'I ticket del team prodotto, per l’Herald e lo Scribe.' },
  { id: 'docs-search', label: 'Documentazione', transport: 'http', url: 'https://mcp.context7.com/mcp', secrets: [], enabled: true, purpose: 'Documentazione aggiornata delle librerie per Scout e Artisan.' },
];

function fakeUpstream(def: McpServerDef): Upstream {
  return {
    serverInfo: `${def.id}-mcp 1.4.0`,
    tools: async () => {
      if (def.id === 'jira') throw new McpClientError('auth', 'Accesso rifiutato (HTTP 401).', 'Il token manca, è scaduto o non ha i permessi: inseriscine uno valido nel campo Token.');
      return DEMO_TOOLS[def.id] ?? [tool('resolve_library', 'Trova la libreria giusta per un nome.', true), tool('get_docs', 'La documentazione di una libreria, per argomento.', true)];
    },
    call: async name => ({ content: [{ type: 'text', text: `demo: ${name}` }] }),
    close: () => {},
  };
}

export function demoMcpServers(o: { userData: string; mcp: McpServer; emit: (st: McpServersState) => void; now: () => number }): McpServersService {
  const service = new McpServersService({ userData: o.userData, cipher: DEMO_CIPHER, mcp: o.mcp, context: () => null, emit: o.emit, connect: (_ep, def) => fakeUpstream(def), home: o.userData, now: o.now });
  if (!service.store.servers().length) {
    for (const def of SEED) service.store.upsert(def);
    service.store.setSecret('github', 'header:Authorization', 'ghp_demoDemoDemoDemoDemo9f2c');
    const ok = (id: string, ms: number, ago: number): McpTestResult => ({ ok: true, at: o.now() - ago, ms, tools: (DEMO_TOOLS[id] ?? []).map(({ name, description, readOnly }) => ({ name, description, readOnly })), serverInfo: `${id}-mcp 1.4.0` });
    service.store.recordTest('azure-devops', ok('azure-devops', 1840, 3_600_000));
    service.store.recordTest('github', ok('github', 420, 600_000));
    service.store.recordTest('jira', { ok: false, at: o.now() - 1_200_000, ms: 0, tools: [], error: { code: 'secret', message: 'Manca il token «Authorization».', fix: 'Inseriscilo nel campo Token della scheda del server: viene cifrato sul computer.' } });
    service.store.setAccess('herald', 'azure-devops', 'read');
    service.store.setAccess('scout', 'github', 'read');
    service.store.setAccess('sentinel', 'jira', 'none');
  }
  return service;
}
