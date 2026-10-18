// App-owned connections: explicit login/probes, bounded project evidence and encrypted Jira credentials.
// Does not edit harness settings or infer that a CLI has loaded an MCP connection.
import type { ConnectorId, ConnectorPort, ConnectorProject, ConnectorState } from '../../shared/connectors';
export interface JiraCredential { site: string; email: string; token: string }
export interface ConnectorVault { get(): Promise<JiraCredential | null>; set(value: JiraCredential | null): Promise<void>; available(): boolean }
export type ConnectorSelections = Partial<Record<ConnectorId, { identity: string; projects: string[] }>>;
export interface ConnectorProof { identity: string; account: string; projects: ConnectorProject[] }
export interface ConnectorAdapters {
  azureLogin?(): Promise<void>;
  azureProbe?(): Promise<ConnectorProof>;
  githubLogin(): Promise<void>;
  githubProbe(): Promise<ConnectorProof>;
  jiraLogin(save: (value: JiraCredential) => Promise<void>, signal: AbortSignal): Promise<void>;
  jiraProbe(value: JiraCredential): Promise<ConnectorProof>;
  vault: ConnectorVault;
  loadSelections(): ConnectorSelections;
  saveSelections(value: ConnectorSelections): Promise<void>;
}
export function connectorId(value: unknown): ConnectorId {
  if (value !== 'github' && value !== 'jira' && value !== 'azure') throw new Error('Strumento non supportato');
  return value;
}
export function jiraCredential(value: JiraCredential): JiraCredential {
  const site = new URL(value.site);
  if (site.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/.test(site.hostname) || site.port || site.username || site.password || site.search || site.hash || !['', '/'].includes(site.pathname)) throw new Error('Usa il sito Jira Cloud https://nome.atlassian.net');
  if (typeof value.email !== 'string' || value.email.length > 254 || !/^[^\s:@]+@[^\s:]+$/.test(value.email) || typeof value.token !== 'string' || !value.token || value.token.length > 4096 || /\s/.test(value.token)) throw new Error('Email o token non valido');
  return { site: site.origin, email: value.email, token: value.token };
}
const initial = (provider: ConnectorId): ConnectorState => ({ provider, status: 'pending', checkedAt: null, account: null, projects: [], selected: [], detail: 'Accesso e verifica da completare' });
export class AppConnectorService implements ConnectorPort {
  private states = { github: initial('github'), jira: initial('jira'), azure: initial('azure') };
  private busy = false;
  private loginAbort: AbortController | null = null;
  private loginDone: Promise<void> | null = null;
  private identities: Partial<Record<ConnectorId, string>> = {};
  private selections: ConnectorSelections;
  constructor(private readonly adapters: ConnectorAdapters) { this.selections = adapters.loadSelections(); }
  private signingIn: ConnectorId | null = null;
  async list() { return structuredClone(Object.values(this.states)).map(s => s.provider === this.signingIn ? { ...s, signingIn: true } : s); }
  private async exclusive<T>(_provider: ConnectorId, action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('Operazione già in corso');
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }
  async login(raw: ConnectorId) {
    const provider = connectorId(raw);
    const abort = new AbortController();
    const task = this.exclusive(provider, async () => {
      this.signingIn = provider;
      try {
        if (provider === 'github') await this.adapters.githubLogin();
        else if (provider === 'azure') {
          if (!this.adapters.azureLogin) throw new Error('Azure non disponibile');
          await this.adapters.azureLogin();
        }
        else {
          if (!this.adapters.vault.available()) throw new Error('Portachiavi cifrato di sistema non disponibile');
          this.loginAbort = abort;
          try { await this.adapters.jiraLogin(async value => { await this.adapters.vault.set(jiraCredential(value)); }, abort.signal); }
          finally { if (this.loginAbort === abort) this.loginAbort = null; }
        }
      } finally { this.signingIn = null; }
      this.states[provider] = initial(provider);
    });
    if (this.loginAbort === abort) this.loginDone = task.catch(() => {});
    await task;
  }
  async cancelLogin() { this.loginAbort?.abort(); await this.loginDone; }
  async probe(raw: ConnectorId): Promise<ConnectorState> {
    const provider = connectorId(raw);
    return this.exclusive(provider, async () => {
      try {
        const value = provider === 'jira' ? await this.adapters.vault.get() : null;
        if (provider === 'jira' && !value) throw new Error('missing');
        const result = provider === 'github' ? await this.adapters.githubProbe()
          : provider === 'azure' ? await this.adapters.azureProbe?.()
          : await this.adapters.jiraProbe(jiraCredential(value!));
        if (!result) throw new Error('Azure non disponibile');
        if (!result.account || !result.identity || !Array.isArray(result.projects)) throw new Error('invalid');
        this.identities[provider] = result.identity;
        const selected = this.selections[provider]?.identity === result.identity ? this.selections[provider]!.projects.filter(id => result.projects.some(p => p.id === id)) : [];
        this.states[provider] = { provider, status: 'verified', checkedAt: new Date().toISOString(), account: result.account.slice(0, 200), projects: result.projects.slice(0, 100), selected, detail: 'Accesso dell’app verificato in sola lettura. Elenco limitato a 100 progetti; i motori mantengono i propri accessi.' };
      } catch {
        // Never surface network/CLI errors: they may embed credentials or provider response bodies.
        this.states[provider] = { ...initial(provider), status: 'failed', checkedAt: new Date().toISOString(), detail: 'Verifica non riuscita. Controlla accesso, scadenza del token, rete e permessi, poi riprova.' };
      }
      return structuredClone(this.states[provider]);
    });
  }
  async select(raw: ConnectorId, projects: string[]) {
    const provider = connectorId(raw);
    return this.exclusive(provider, async () => {
      const state = this.states[provider];
      if (state.status !== 'verified' || !Array.isArray(projects) || projects.length > 100 || projects.some(id => typeof id !== 'string' || !state.projects.some(p => p.id === id))) throw new Error('Seleziona progetti verificati');
      const next = { ...this.selections, [provider]: { identity: this.identities[provider]!, projects: [...new Set(projects)] } };
      await this.adapters.saveSelections(next); this.selections = next;
      state.selected = next[provider]!.projects;
      return structuredClone(state);
    });
  }
  async disconnect(raw: ConnectorId) {
    const provider = connectorId(raw);
    await this.exclusive(provider, async () => {
      if (provider === 'jira') await this.adapters.vault.set(null);
      const next = { ...this.selections }; delete next[provider];
      await this.adapters.saveSelections(next); this.selections = next; this.states[provider] = initial(provider);
    });
  }
}
