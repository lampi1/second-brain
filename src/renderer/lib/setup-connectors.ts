// The first-run setup's tools step, kept pure so it is unit-tested without a DOM (test/unit/setup-connectors.test.ts):
// what a connector card says and what "Collega" does. Why: the owner could not tell after a sign-in whether a tool was
// really connected (2026-10-19). Here every sign-in ends in a REAL check (the app's read-only probe: the account and
// its projects, the same 'connectors:probe' Settings uses) and the card shows its outcome: connected with the account
// and what was checked, still waiting for the sign-in window (checked again by itself), or not connected with the
// reason and what to do. Used by components/SetupConnectors.tsx; the port is the existing connectors IPC.
import type { ConnectorId, ConnectorPort, ConnectorState } from '@shared/connectors';
import { plainError } from './setup-wizard';

export const TOOL_IDS: readonly ConnectorId[] = ['github', 'azure', 'jira'];
export type ToolPhase = 'idle' | 'signingIn' | 'waiting' | 'verifying' | 'connected' | 'failed' | 'error';
export interface ToolLink {
  phase: ToolPhase;
  account?: string | null;
  /** how many projects the check could read with this account */
  projects?: number;
  checkedAt?: string | null;
  /** the app's own sentence (a sign-in that did not start), never a provider response */
  error?: string | null;
}
/** a sign-in in its own window: checked again every POLL_MS, POLL_TRIES times (3 minutes), then "not connected" */
export const POLL_MS = 4000, POLL_TRIES = 45;
/** the sign-ins that finish in a separate window (the call returns as soon as it opens): GitHub CLI, Azure CLI.
 *  Jira's sign-in returns once the token is saved, so its first check is final. */
export const opensWindow = (id: ConnectorId): boolean => id !== 'jira';

/** the card from what main knows (a status read, no network) */
export function linkFromState(state: ConnectorState | undefined): ToolLink {
  if (!state) return { phase: 'idle' };
  if (state.signingIn) return { phase: 'signingIn' };
  if (state.status === 'verified') return { phase: 'connected', account: state.account, projects: state.projects.length, checkedAt: state.checkedAt };
  if (state.status === 'failed') return { phase: 'failed', checkedAt: state.checkedAt };
  return { phase: 'idle' };
}

/** the real check: the provider's read-only probe in main */
export async function verifyTool(port: Pick<ConnectorPort, 'probe'>, id: ConnectorId): Promise<ToolLink> {
  try { return linkFromState(await port.probe(id)); }
  catch (error) { return { phase: 'error', error: plainError(error) }; }
}

/** "Collega": the official sign-in, then at once the real check. A window still open → 'waiting' (the card checks again
 *  by itself); a sign-in that did not start → 'error' with the app's reason. */
export async function connectTool(port: Pick<ConnectorPort, 'login' | 'probe'>, id: ConnectorId): Promise<ToolLink> {
  try { await port.login(id); }
  catch (error) { return { phase: 'error', error: plainError(error) }; }
  const checked = await verifyTool(port, id);
  return checked.phase === 'failed' && opensWindow(id) ? { phase: 'waiting', checkedAt: checked.checkedAt } : checked;
}

/** one automatic re-check while waiting: connected ends it; the last try turns a still-missing sign-in into 'failed' */
export async function pollTool(port: Pick<ConnectorPort, 'probe'>, id: ConnectorId, attempt: number): Promise<ToolLink> {
  const checked = await verifyTool(port, id);
  if (checked.phase === 'connected' || checked.phase === 'error') return checked;
  return attempt + 1 >= POLL_TRIES ? { phase: 'failed', checkedAt: checked.checkedAt } : { phase: 'waiting', checkedAt: checked.checkedAt };
}

export const toolBusy = (link: ToolLink): boolean => link.phase === 'signingIn' || link.phase === 'verifying';
