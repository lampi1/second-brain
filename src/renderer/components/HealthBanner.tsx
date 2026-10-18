// One line under the top bar when the MCP server could not take its port (another second-brain or the prototype held
// it) and fell back to a random one: app chats still work, but external MCP clients configured on the usual port
// (Claude desktop, Cursor, a terminal claude) lose the browser this run. Before it was only in the log (2 times in 48 h,
// nobody saw it). One banner, closable for this run; never a toast. Data: AppInfo.health (main/health.ts). Mounted by App.tsx.
import { t as auditText } from '../i18n';
import { useState } from 'react';
import { useApp } from '../store/store';

export function HealthBanner() {
  const mcp = useApp(s => s.info?.health?.mcp ?? null);
  const [hidden, setHidden] = useState(false);
  if (!mcp?.fallback || hidden) return null;
  return (
    <div className="brain-setup" role="alert" data-testid="health-mcp">
      <div className="brain-setup-text">
        <b>{auditText('audit.HealthBanner.mcpPort')}{' '}{mcp.wanted}{' '}{auditText('audit.HealthBanner.isBusy')}</b>{' '}
        <span>{auditText('audit.HealthBanner.theAppUses')}{' '}{mcp.port}{auditText('audit.HealthBanner.appChatsWorkButExternalClients')}{' '}{mcp.wanted}{' '}{auditText('audit.HealthBanner.cannotSeeTheBrowserCloseThe')}</span>
      </div>
      <button type="button" className="btn btn-s" onClick={() => setHidden(true)} data-testid="health-mcp-close" aria-label={auditText('audit.HealthBanner.dismissNotice')}>✕</button>
    </div>
  );
}
