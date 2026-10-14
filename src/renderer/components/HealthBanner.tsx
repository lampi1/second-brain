// One line under the top bar when the MCP server could not take its port (another second-brain or the prototype held
// it) and fell back to a random one: app chats still work, but external MCP clients configured on the usual port
// (Claude desktop, Cursor, a terminal claude) lose the browser this run. Before it was only in the log (2 times in 48 h,
// nobody saw it). One banner, closable for this run; never a toast. Data: AppInfo.health (main/health.ts). Mounted by App.tsx.
import { useState } from 'react';
import { useApp } from '../store/store';

export function HealthBanner() {
  const mcp = useApp(s => s.info?.health?.mcp ?? null);
  const [hidden, setHidden] = useState(false);
  if (!mcp?.fallback || hidden) return null;
  return (
    <div className="brain-setup" role="alert" data-testid="health-mcp">
      <div className="brain-setup-text">
        <b>Porta MCP {mcp.wanted} occupata.</b>{' '}
        <span>L’app usa la {mcp.port}: le chat dell’app funzionano, ma i client esterni configurati sulla {mcp.wanted} non vedono il browser. Chiudi l’altra istanza che la tiene e riavvia l’app.</span>
      </div>
      <button type="button" className="btn btn-s" onClick={() => setHidden(true)} data-testid="health-mcp-close" aria-label="Chiudi l’avviso">✕</button>
    </div>
  );
}
