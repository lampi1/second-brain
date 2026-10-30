// The "MCP" section of an agent card's permissions (issue #91, ADR 0086): for each MCP server the user added in
// Settings → Connettori, what this role may use: every tool (the default: every role has every permission, owner
// 2026-10-19), only the reading ones (the server's readOnlyHint), none, or the tools picked one by one. A change is
// saved at once and counts at the role chats' next request (the gateway reads it live); a delegated chat never gets
// more than its parent's role allows. A role whose tool classes leave out "mcp" gets no server whatever is set here.
// The "Server MCP" section of the role's permissions card (RolePermissions.tsx PERMISSION_SECTIONS, ADR 0085): it
// follows that card's "Server MCP" tool-class toggle. Flash (ADR 0207) has no such class: its own access, off by default,
// reading tools only (no «tutti»). Styles in styles/connectors-hub.css (.agent-mcp).
import { useState } from 'react';
import { FLASH_MCP_ROLE, effectiveAccess, type McpToolAccess } from '@shared/mcp-servers';
import { HelpTip } from './HelpTip';
import { Select } from './Select';
import { t } from '../i18n';
import { toast } from '../store/ui';
import { serverStatus, toolsAllowed, useMcpServers } from '../lib/mcp-servers';
import { openPage } from '../store/ui';
import '../styles/connectors-hub.css';

type Mode = 'all' | 'read' | 'none' | 'pick';
const modeOf = (a: McpToolAccess | undefined): Mode => (a === undefined ? 'all' : typeof a === 'object' ? 'pick' : a);

export function AgentMcpSection({ roleId, roleName, mcpClass = true, embedded = false }: { roleId: string; roleName: string;
  /** the role's tool classes include 'mcp' (else no server reaches it) */ mcpClass?: boolean;
  /** inside the permissions card, which shows the section's title */ embedded?: boolean }) {
  const { state, set } = useMcpServers();
  // Flash (ADR 0207): no 'mcp' tool class, its own access (off by default, reading tools only)
  const flash = roleId === FLASH_MCP_ROLE;
  if (flash) mcpClass = true;
  const [open, setOpen] = useState<string | null>(null);
  const save = async (server: string, access: McpToolAccess) => {
    try { set(await window.sb.invoke('mcpservers:setAccess', { role: roleId, server, access })); }
    catch { toast(t('hub.error'), 'err'); }
  };
  const servers = state?.servers ?? [];
  return <section className="agent-mcp" aria-label={t('agentMcp.title')} data-testid={`agent-mcp-${roleId}`}>
    {!embedded && <h4>{t('agentMcp.title')}<HelpTip title={t('agentMcp.title')} label={`${t('agentMcp.title')} ${roleName}`} guide="mcp-servers">{t('agentMcp.tip')}</HelpTip></h4>}
    {!mcpClass && <p className="hub-muted">{t('agentMcp.noClass')}</p>}
    {state && !servers.length && <p className="hub-muted">{t('agentMcp.none')} <button type="button" className="btn btn-subtle btn-s" onClick={() => openPage('impostazioni', 'connectors')}>{t('agentMcp.goSettings')}</button></p>}
    {servers.length > 0 && <ul>{servers.map(s => {
      const access = flash ? effectiveAccess(roleId, state!.access[roleId]?.servers[s.id]) : state!.access[roleId]?.servers[s.id], mode = modeOf(access), tools = s.lastTest?.tools ?? [];
      const picked = typeof access === 'object' ? access.tools : [];
      return <li key={s.id} data-off={!s.enabled || !mcpClass || mode === 'none'}>
        <div className="agent-mcp-row">
          <span className="agent-mcp-name"><b>{s.label}</b><small>{serverStatus(s) === 'off' ? t('hub.status.off') : t('agentMcp.count', { n: toolsAllowed(s, access), total: tools.length })}</small></span>
          <Select aria-label={t('agentMcp.for', { name: s.label })} value={mode} disabled={!mcpClass} data-testid={`agent-mcp-${roleId}-${s.id}`}
            onChange={e => { const v = e.target.value as Mode; if (v === 'pick') { setOpen(s.id); void save(s.id, { tools: tools.filter(x => x.readOnly || mode === 'all').map(x => x.name) }); } else { setOpen(null); void save(s.id, v); } }}>
            {!flash && <option value="all">{t('agentMcp.all')}</option>}
            <option value="read">{t('agentMcp.read')}</option>
            <option value="pick" disabled={!tools.length}>{t('agentMcp.pick')}</option>
            <option value="none">{t('agentMcp.noneMode')}</option>
          </Select>
        </div>
        {mode === 'pick' && (open === s.id || picked.length > 0) && <fieldset className="agent-mcp-tools"><legend className="sr-only">{t('agentMcp.for', { name: s.label })}</legend>
          {tools.map(x => <label key={x.name}><input type="checkbox" checked={picked.includes(x.name)} onChange={e => void save(s.id, { tools: e.target.checked ? [...picked, x.name] : picked.filter(n => n !== x.name) })} /><code>{x.name}</code><small>{x.readOnly ? t('hub.read') : t('hub.write')}</small></label>)}
        </fieldset>}
      </li>;
    })}</ul>}
  </section>;
}
