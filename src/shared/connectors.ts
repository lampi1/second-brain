// App connector boundary, used by setup, Settings and sender-checked IPC: states carry no secret; the only secret is
// ConnectorToken, a token typed in a tool tile and sent once, write-only, to main (ADR 0119).
export type ConnectorId = 'github' | 'jira' | 'azure';
export interface ConnectorProject { id: string; name: string }
export interface ConnectorState {
  provider: ConnectorId;
  status: 'pending' | 'verified' | 'failed';
  checkedAt: string | null;
  account: string | null;
  projects: ConnectorProject[];
  selected: string[];
  detail: string;
  /** a sign-in started from any screen is still running in main (a reopened screen offers to cancel it) */
  signingIn?: boolean;
}
/** A token typed in a tool tile (ADR 0119), sent once to main and never read back: GitHub's fine-grained token, or
 *  Jira Cloud's site, email and API token. */
export type ConnectorToken = { provider: 'github'; token: string } | { provider: 'jira'; token: string; site: string; email: string };
export interface ConnectorPort {
  list(): Promise<ConnectorState[]>;
  login(provider: ConnectorId): Promise<void>;
  cancelLogin(): Promise<void>;
  probe(provider: ConnectorId): Promise<ConnectorState>;
  select(provider: ConnectorId, projects: string[]): Promise<ConnectorState>;
  disconnect(provider: ConnectorId): Promise<void>;
}
