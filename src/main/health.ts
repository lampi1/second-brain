// The app's own health since it started, for agents (app_state's `health`) and for the one warning the user must see
// (AppInfo.health → HealthBanner): the MCP port it got (and whether it fell back to a random one, so external MCP
// clients lose the browser), main-window renderer crashes and hangs (window.ts reloads it), engines killed by force
// (jobguard.ts) and the Job Object guard's state. Written by browser/service.ts (port) and window.ts (renderer);
// read by index.ts (app:info) and appctl/tools.ts (app_state).
import type { AppHealth } from '../shared/contract';
import { engineKills, jobGuard } from './chats/jobguard';

const state: Omit<AppHealth, 'forcedKills' | 'jobGuard'> = {
  mcp: { wanted: null, port: null, fallback: false, cause: null },
  renderer: { crashes: 0, hangs: 0, reloads: 0, last: null },
};

/** The MCP server is listening: `port` is where, `wanted` what was asked (a different one = the fallback). */
export function recordMcpPort(wanted: number, port: number, cause: string | null = null): void {
  state.mcp = { wanted, port, fallback: wanted !== 0 && wanted !== port, cause };
}

/** The main window's renderer crashed ('gone') or stopped answering ('hang'), or was reloaded after one. */
export function recordRenderer(what: 'gone' | 'hang' | 'reload', reason?: string): void {
  const r = state.renderer;
  if (what === 'gone') r.crashes++;
  else if (what === 'hang') r.hangs++;
  else r.reloads++;
  if (what !== 'reload') r.last = { what, reason: reason ?? null, at: Date.now() };
}

export function healthSnapshot(): AppHealth {
  return { mcp: { ...state.mcp }, renderer: { ...state.renderer, last: state.renderer.last ? { ...state.renderer.last } : null }, forcedKills: engineKills.count, jobGuard: jobGuard.state };
}

// e2e: read from the main process (Playwright's page dies with a crashed renderer)
(globalThis as Record<string, unknown>).__sbHealth = healthSnapshot;

