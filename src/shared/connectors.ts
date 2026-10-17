// Secret-free app connector boundary, used by setup, Settings and sender-checked IPC.
export type ConnectorId = 'github' | 'jira';
export interface ConnectorProject { id: string; name: string }
export interface ConnectorState {
  provider: ConnectorId;
  status: 'pending' | 'verified' | 'failed';
  checkedAt: string | null;
  account: string | null;
  projects: ConnectorProject[];
  selected: string[];
  detail: string;
}
export interface ConnectorPort {
  list(): Promise<ConnectorState[]>;
  login(provider: ConnectorId): Promise<void>;
  cancelLogin(): Promise<void>;
  probe(provider: ConnectorId): Promise<ConnectorState>;
  select(provider: ConnectorId, projects: string[]): Promise<ConnectorState>;
  disconnect(provider: ConnectorId): Promise<void>;
}
