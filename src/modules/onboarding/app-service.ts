// App-owned connections: explicit login/probes, bounded project evidence and encrypted Jira credentials.
// Does not edit harness settings or infer that a CLI has loaded an MCP connection. A verified state (account, last
// check, the projects it saw; never a credential) is saved beside the project selections, so it survives a restart
// until a failed probe, a new sign-in or a disconnect clears it (issue #95); a good read of the app's own Task page is
// the same proof for Azure DevOps and marks it verified too (observe), unless the user disconnected it (saved too, until
// a probe or a sign-in). A tool tile (ADR 0119) hands a token over in place (useToken): GitHub's kept in its own
// encrypted vault and probed with GitHub's REST API, Jira's in the Jira vault, both checked at once.
import type { ConnectorId, ConnectorPort, ConnectorProject, ConnectorState, ConnectorToken } from '../../shared/connectors';
export interface JiraCredential { site: string; email: string; token: string }
export interface ConnectorVault { get(): Promise<JiraCredential | null>; set(value: JiraCredential | null): Promise<void>; available(): boolean }
/** GitHub's token from a tool tile, encrypted by the OS like the Jira vault (app-vault.ts GithubVault). */
export interface TokenVault { get(): Promise<string | null>; set(value: string | null): Promise<void>; available(): boolean }
/** The last good verification of a connector as saved on disk: what Settings shows, never a secret. */
export interface ConnectorVerified { account: string; checkedAt: string; projects: ConnectorProject[] }
/** disconnected: the user disconnected it (identity and projects empty); kept across restarts so a Task read does not
 *  verify it again until they sign in or probe it (issue #95). */
export type ConnectorSelections = Partial<Record<ConnectorId, { identity: string; projects: string[]; verified?: ConnectorVerified; disconnected?: true }>>;
export interface ConnectorProof { identity: string; account: string; projects: ConnectorProject[] }
export interface ConnectorAdapters {
  azureLogin?(): Promise<void>;
  azureProbe?(): Promise<ConnectorProof>;
  githubLogin(): Promise<void>;
  githubProbe(): Promise<ConnectorProof>;
  jiraLogin(save: (value: JiraCredential) => Promise<void>, signal: AbortSignal): Promise<void>;
  jiraProbe(value: JiraCredential): Promise<ConnectorProof>;
  vault: ConnectorVault;
  /** a GitHub token typed in a tool tile: when one is saved, the probe reads GitHub with it instead of gh */
  githubToken?: TokenVault;
  githubTokenProbe?(token: string): Promise<ConnectorProof>;
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
const VERIFIED_DETAIL = 'Accesso dell’app verificato in sola lettura. Elenco limitato a 100 progetti; i motori mantengono i propri accessi.';
const short = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
/** A saved verification checked field by field (a hand-edited or old file never verifies anything by itself). */
export function verifiedOf(v: unknown): ConnectorVerified | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!short(o.account, 200) || !short(o.checkedAt, 40) || Number.isNaN(Date.parse(o.checkedAt)) || !Array.isArray(o.projects) || o.projects.length > 100) return null;
  const projects = o.projects.filter((p): p is ConnectorProject => !!p && typeof p === 'object' && short((p as ConnectorProject).id, 200) && short((p as ConnectorProject).name, 200))
    .map(p => ({ id: p.id, name: p.name }));
  return projects.length === o.projects.length ? { account: o.account, checkedAt: o.checkedAt, projects } : null;
}
export class AppConnectorService implements ConnectorPort {
  private states = { github: initial('github'), jira: initial('jira'), azure: initial('azure') };
  private busy = false;
  /** Disconnected by the user (in this run or saved by an earlier one): a Task read does not verify it again until they
   *  sign in or probe it (Prova). */
  private disconnected = new Set<ConnectorId>();
  private loginAbort: AbortController | null = null;
  private loginDone: Promise<void> | null = null;
  private identities: Partial<Record<ConnectorId, string>> = {};
  private selections: ConnectorSelections;
  constructor(private readonly adapters: ConnectorAdapters) { this.selections = adapters.loadSelections(); this.restore(); }
  /** The verified states saved by an earlier run (call again once the saved file is loaded); a connector already
   *  probed in this run keeps its own state. */
  restore(): void {
    for (const provider of ['github', 'jira', 'azure'] as const) {
      const entry = this.selections[provider];
      if (entry?.disconnected === true && this.states[provider].status === 'pending') { this.disconnected.add(provider); continue; }
      const verified = entry ? verifiedOf(entry.verified) : null;
      if (!entry || !verified || this.states[provider].status !== 'pending' || !short(entry.identity, 600)) continue;
      this.identities[provider] = entry.identity;
      this.states[provider] = { provider, status: 'verified', checkedAt: verified.checkedAt, account: verified.account, projects: verified.projects,
        selected: entry.projects.filter(id => verified.projects.some(p => p.id === id)), detail: VERIFIED_DETAIL };
    }
  }
  /** Saves (or with null clears) a provider's verification beside its selections; a failed write keeps the state in
   *  memory only (it is proof of this run, not a setting). */
  private async remember(provider: ConnectorId, identity: string | null, verified: ConnectorVerified | null): Promise<void> {
    const old = this.selections[provider];
    if (!verified && !old?.verified) return;
    const next = { ...this.selections };
    if (verified && identity) next[provider] = { identity, projects: old?.identity === identity ? old.projects : [], verified };
    else if (old) { const { verified: _gone, ...rest } = old; next[provider] = rest; }
    try { await this.adapters.saveSelections(next); this.selections = next; } catch { /* kept for this run only */ }
  }
  /** The user signs in or probes again: the disconnection no longer holds, here and in the saved file. */
  private async reconnect(provider: ConnectorId): Promise<void> {
    this.disconnected.delete(provider);
    if (this.selections[provider]?.disconnected !== true) return;
    const next = { ...this.selections }; delete next[provider];
    try { await this.adapters.saveSelections(next); this.selections = next; } catch { /* cleared for this run only */ }
  }
  private verified(provider: ConnectorId, result: ConnectorProof): ConnectorState {
    this.identities[provider] = result.identity;
    const selected = this.selections[provider]?.identity === result.identity ? this.selections[provider]!.projects.filter(id => result.projects.some(p => p.id === id)) : [];
    return { provider, status: 'verified', checkedAt: new Date().toISOString(), account: result.account.slice(0, 200), projects: result.projects.slice(0, 100), selected, detail: VERIFIED_DETAIL };
  }
  /** A proof that came from elsewhere (Azure: a good read of the Task page) marks the connector verified, as a probe
   *  would; skipped while another connector action runs (a probe started the read and sets the state itself). */
  async observe(raw: ConnectorId, proof: () => Promise<ConnectorProof>): Promise<void> {
    const provider = connectorId(raw);
    if (this.busy || this.disconnected.has(provider)) return;
    try {
      await this.exclusive(provider, async () => {
        const result = await proof();
        if (!result.account || !result.identity || !Array.isArray(result.projects)) throw new Error('invalid');
        this.states[provider] = this.verified(provider, result);
        await this.remember(provider, result.identity, { account: this.states[provider].account!, checkedAt: this.states[provider].checkedAt!, projects: this.states[provider].projects });
      });
    } catch { /* not a probe: a missing proof leaves the connector as it was */ }
  }
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
    this.disconnected.delete(provider);
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
      // signed in again: the saved disconnection no longer holds; a new sign-in may be another account, so the old
      // verification is not proof of it
      await this.reconnect(provider);
      await this.remember(provider, null, null);
    });
    if (this.loginAbort === abort) this.loginDone = task.catch(() => {});
    await task;
  }
  /** A tool tile's token (ADR 0119): kept encrypted for this account (never logged, never sent back), then probed at
   *  once; a token that cannot be stored or is malformed is refused before anything is written. */
  async useToken(raw: ConnectorToken): Promise<ConnectorState> {
    const provider = connectorId(raw?.provider);
    if (provider === 'azure' || typeof raw.token !== 'string') throw new Error('Strumento non supportato');
    const token = raw.token.trim();
    await this.exclusive(provider, async () => {
      if (raw.provider === 'jira') {
        if (!this.adapters.vault.available()) throw new Error('Portachiavi cifrato di sistema non disponibile');
        let value: JiraCredential;
        try { value = jiraCredential({ site: String(raw.site ?? ''), email: String(raw.email ?? '').trim(), token }); }
        catch { throw new Error('Controlla sito, email e token di Jira'); }
        await this.adapters.vault.set(value);
      } else {
        const vault = this.adapters.githubToken;
        if (!vault || !this.adapters.githubTokenProbe) throw new Error('Strumento non supportato');
        if (!vault.available()) throw new Error('Portachiavi cifrato di sistema non disponibile');
        if (!/^[A-Za-z0-9_]{20,255}$/.test(token)) throw new Error('Il token GitHub non sembra valido: copialo di nuovo da GitHub');
        await vault.set(token);
      }
      this.states[provider] = initial(provider);
      await this.reconnect(provider);
      await this.remember(provider, null, null);
    });
    return this.probe(provider);
  }
  async cancelLogin() { this.loginAbort?.abort(); await this.loginDone; }
  async probe(raw: ConnectorId): Promise<ConnectorState> {
    const provider = connectorId(raw);
    return this.exclusive(provider, async () => {
      await this.reconnect(provider);
      try {
        const value = provider === 'jira' ? await this.adapters.vault.get() : null;
        if (provider === 'jira' && !value) throw new Error('missing');
        const token = provider === 'github' && this.adapters.githubTokenProbe ? await this.adapters.githubToken?.get() ?? null : null;
        const result = token ? await this.adapters.githubTokenProbe!(token)
          : provider === 'github' ? await this.adapters.githubProbe()
          : provider === 'azure' ? await this.adapters.azureProbe?.()
          : await this.adapters.jiraProbe(jiraCredential(value!));
        if (!result) throw new Error('Azure non disponibile');
        if (!result.account || !result.identity || !Array.isArray(result.projects)) throw new Error('invalid');
        this.states[provider] = this.verified(provider, result);
      } catch {
        // Never surface network/CLI errors: they may embed credentials or provider response bodies.
        this.states[provider] = { ...initial(provider), status: 'failed', checkedAt: new Date().toISOString(), detail: 'Verifica non riuscita. Controlla accesso, scadenza del token, rete e permessi, poi riprova.' };
      }
      const st = this.states[provider];
      // a good probe is remembered across restarts; a failed one clears what was remembered
      await this.remember(provider, st.status === 'verified' ? this.identities[provider] ?? null : null, st.status === 'verified' ? { account: st.account!, checkedAt: st.checkedAt!, projects: st.projects } : null);
      return structuredClone(this.states[provider]);
    });
  }
  async select(raw: ConnectorId, projects: string[]) {
    const provider = connectorId(raw);
    return this.exclusive(provider, async () => {
      const state = this.states[provider];
      if (state.status !== 'verified' || !Array.isArray(projects) || projects.length > 100 || projects.some(id => typeof id !== 'string' || !state.projects.some(p => p.id === id))) throw new Error('Seleziona progetti verificati');
      const old = this.selections[provider];
      const next = { ...this.selections, [provider]: { ...(old?.identity === this.identities[provider] && old?.verified ? { verified: old.verified } : {}), identity: this.identities[provider]!, projects: [...new Set(projects)] } };
      await this.adapters.saveSelections(next); this.selections = next;
      state.selected = next[provider]!.projects;
      return structuredClone(state);
    });
  }
  async disconnect(raw: ConnectorId) {
    const provider = connectorId(raw);
    await this.exclusive(provider, async () => {
      if (provider === 'jira') await this.adapters.vault.set(null);
      if (provider === 'github') await this.adapters.githubToken?.set(null);
      // remembered across restarts: a Task read after a restart must not verify it again by itself
      const next: ConnectorSelections = { ...this.selections, [provider]: { identity: '', projects: [], disconnected: true } };
      await this.adapters.saveSelections(next); this.selections = next; this.states[provider] = initial(provider);
      this.disconnected.add(provider);
    });
  }
}
