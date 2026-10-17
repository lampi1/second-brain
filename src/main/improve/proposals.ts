// Isolated application proposals: creates worktrees, reviews exact commits and publishes only on the user's PR click.
// Uses Git's existing credentials and gh's own secure login; never reads, stores or logs tokens. No updater lives here.
// The integrator supplies the existing scanCommits guard, check ledger and fresh reviewers, and renderer-only IPC.
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AppProposal, ProposalPublication } from '../../shared/improve-proposals';

export interface ProposalDeps {
  repo: string;
  workspaceRoot: string;
  /** Fixed by main, never selected by the renderer. */
  baseBranch: 'main' | 'master';
  /** Fail closed. Use shipped brain/guard.scanCommits, private deny/allow lists, every outgoing commit. */
  guard: (directory: string, commits: string[]) => Promise<boolean>;
  /** Existing check ledger: light checks AND fresh correctness/security/UI reviews for the exact head. */
  verified: (directory: string, head: string) => Promise<{ quality: boolean; reviews: boolean }>;
  /** Creates or focuses this proposal's work chat in its directory. Must be idempotent by proposal id. */
  startWork: (proposal: AppProposal) => Promise<void>;
  emit: (proposals: AppProposal[]) => void;
  /** Injectable process boundary for focused tests. No shell, no raw stderr in UI/logs. */
  run?: (cwd: string, command: 'git' | 'gh', args: string[]) => Promise<string>;
}

class ProposalProblem extends Error {}

const MAX_DIFF = 160_000;
const SHA = /^[0-9a-f]{40,64}$/;
const forbidden = /(^|\/)(brain|brain-template|notes?|journal|\.git|\.aws|\.ssh|\.codex|\.claude|credentials?)(\/|\.|$)|(^|\/)\.env(\.|$)|(^|\/)(now|me|ideas|ai-errors|ai-wins)\.md$|\.(pem|pfx|p12|key|sqlite|db|bak)$/i;
const allowed = /^(src\/|test\/|scripts\/|tools\/|docs\/|build\/|\.github\/|(?:package(?:-lock)?\.json|[a-z][a-z0-9.-]*\.(?:json|ts|mjs|md)|LICENSE)$)/i;
export const productPath = (file: string): boolean => !!file && !/[\x00-\x1f\\]/.test(file) && !file.split('/').some(s => !s || s === '.' || s === '..') && allowed.test(file) && !forbidden.test(file);

/** Only credential-free github.com clone URLs; never display the original value on rejection. */
export function githubRepository(remote: string): { slug: string; url: string } | null {
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remote.trim());
  if (!m || m[1] === '.' || m[1] === '..' || m[2] === '.' || m[2] === '..') return null;
  const slug = `${m[1]}/${m[2]}`;
  return { slug, url: `https://github.com/${slug}.git` };
}

const processRun: NonNullable<ProposalDeps['run']> = (cwd, command, args) => new Promise((resolve, reject) => {
  execFile(command, args, {
    cwd, windowsHide: true, timeout: 90_000, maxBuffer: 4_000_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GH_PROMPT_DISABLED: '1' },
  }, (error, stdout) => error ? reject(new Error('Command failed')) : resolve(String(stdout)));
});
const pending = () => ({ state: 'pending' as const, head: null });
const check = (ok: boolean, head: string) => ({ state: ok ? 'passed' as const : 'failed' as const, head });

export class ProposalService {
  private readonly proposals = new Map<string, AppProposal>();
  private readonly busy = new Set<string>();
  private readonly run: NonNullable<ProposalDeps['run']>;
  constructor(private readonly d: ProposalDeps) {
    this.run = d.run ?? processRun;
    const repo = fs.realpathSync(d.repo);
    const insideRepo = (dir: string) => { const rel = path.relative(repo, dir); return !rel || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); };
    if (insideRepo(path.resolve(d.workspaceRoot))) throw new ProposalProblem('La cartella delle modifiche deve essere separata dal repository del prodotto.');
    fs.mkdirSync(d.workspaceRoot, { recursive: true });
    if (insideRepo(fs.realpathSync(d.workspaceRoot))) throw new ProposalProblem('La cartella delle modifiche non può puntare al repository del prodotto.');
    this.restore();
  }
  list(): AppProposal[] { return structuredClone([...this.proposals.values()]); }
  private publishState(): void { this.d.emit(this.list()); }
  private metadataFile(): string { return path.join(this.d.workspaceRoot, 'proposals.json'); }
  private save(): void {
    // Only recovery metadata, never diffs, prompts, requests or credentials. Written outside every Git worktree.
    const temporary = `${this.metadataFile()}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, proposals: [...this.proposals.values()].map(p => ({ id: p.id, base: p.base })) }), { mode: 0o600 });
      fs.renameSync(temporary, this.metadataFile());
    } catch { throw new ProposalProblem('Non è stato possibile salvare il punto di ripresa. La modifica locale è conservata.'); }
  }
  private restore(): void {
    if (!fs.existsSync(this.metadataFile())) return;
    try {
      const data: unknown = JSON.parse(fs.readFileSync(this.metadataFile(), 'utf8'));
      if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('proposals' in data) || !Array.isArray(data.proposals)) throw new ProposalProblem();
      const root = fs.realpathSync(this.d.workspaceRoot);
      for (const row of data.proposals) {
        if (!row || typeof row.id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(row.id) || typeof row.base !== 'string' || !SHA.test(row.base)) throw new ProposalProblem();
        const directory = path.join(root, row.id);
        const available = fs.existsSync(directory) && fs.realpathSync(directory) === directory;
        this.proposals.set(row.id, { id: row.id, directory, branch: `app-improve/${row.id}`, base: row.base, phase: available ? 'editing' : 'blocked', head: null, files: [], diff: null, quality: pending(), privacy: pending(), reviews: pending(), problem: available ? 'Modifica locale recuperata. Rileggi le differenze e le verifiche prima di condividerla.' : 'La cartella di questa modifica non è disponibile. Le altre modifiche restano utilizzabili.', url: null, publication: null });
      }
    } catch { throw new ProposalProblem('Punto di ripresa non leggibile. Le cartelle delle modifiche sono conservate; serve recuperare il registro prima di continuare.'); }
  }
  private git(cwd: string, args: string[]): Promise<string> {
    return this.run(cwd, 'git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', ...args]);
  }
  private get(id: string): AppProposal {
    const p = this.proposals.get(id);
    if (!p) throw new ProposalProblem('Modifica non trovata.');
    return p;
  }

  /** Creates a fresh branch from main, without checking out or changing the user's active worktree. */
  async create(): Promise<AppProposal> {
    const id = randomUUID();
    const base = (await this.git(this.d.repo, ['rev-parse', `refs/heads/${this.d.baseBranch}`])).trim();
    if (!SHA.test(base)) throw new ProposalProblem('Versione di partenza non disponibile.');
    fs.mkdirSync(this.d.workspaceRoot, { recursive: true });
    const directory = path.join(fs.realpathSync(this.d.workspaceRoot), id);
    const branch = `app-improve/${id}`;
    try { await this.git(this.d.repo, ['worktree', 'add', '-b', branch, directory, base]); }
    catch { throw new ProposalProblem('Ambiente di modifica non preparato. La cartella di lavoro è rimasta invariata.'); }
    const p: AppProposal = { id, directory, branch, base, phase: 'editing', head: null, files: [], diff: null, quality: pending(), privacy: pending(), reviews: pending(), problem: null, url: null, publication: null };
    this.proposals.set(id, p);
    // Recovery metadata changes only when a proposal is created. Status/preview updates must not repeatedly replace
    // the same JSON file (nor turn a successful verification into a disk-write error on Windows).
    this.save();
    this.busy.add(id);
    this.publishState();
    try { await this.assertEnvironment(p); await this.d.startWork(structuredClone(p)); }
    catch { p.phase = 'blocked'; p.problem = 'La chat di lavoro non è partita. Puoi riaprirla: la modifica è conservata.'; this.publishState(); }
    finally { this.busy.delete(id); }
    return structuredClone(p);
  }

  /** Reopens/focuses the work chat after a failed start or application restart, preserving its isolated worktree. */
  async resume(id: string): Promise<AppProposal> {
    return this.exclusive(id, async p => { await this.assertEnvironment(p); await this.d.startWork(structuredClone(p)); p.problem = null; });
  }

  private async assertEnvironment(p: AppProposal): Promise<void> {
    const root = fs.realpathSync(this.d.workspaceRoot);
    if (p.directory !== path.join(root, p.id) || fs.realpathSync(p.directory) !== p.directory) throw new ProposalProblem('Ambiente della modifica spostato. La condivisione è bloccata.');
    const common = (await this.git(p.directory, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
    const expected = (await this.git(this.d.repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
    if (!common || path.resolve(common) !== path.resolve(expected)) throw new ProposalProblem('La modifica non appartiene al repository previsto.');
    const branch = (await this.git(p.directory, ['symbolic-ref', '--short', 'HEAD'])).trim();
    if (branch !== p.branch) throw new ProposalProblem('Ambiente di modifica cambiato. Prepara una nuova modifica.');
  }

  private async snapshot(p: AppProposal): Promise<{ head: string; commits: string[] }> {
    await this.assertEnvironment(p);
    // Uncommitted/untracked files are never silently staged or published.
    if ((await this.git(p.directory, ['status', '--porcelain', '--untracked-files=all'])).trim()) throw new ProposalProblem('La modifica è ancora in lavorazione. Chiedi di completarla e verificarla.');
    const head = (await this.git(p.directory, ['rev-parse', 'HEAD'])).trim();
    if (!SHA.test(head) || head === p.base) throw new ProposalProblem('Non ci sono modifiche da rivedere.');
    if ((await this.git(p.directory, ['merge-base', p.base, head])).trim() !== p.base) throw new ProposalProblem('La modifica non parte dalla versione prevista.');
    // Merge commits could bring unrelated history: each application proposal stays linear.
    if ((await this.git(p.directory, ['rev-list', '--merges', `${p.base}..${head}`])).trim()) throw new ProposalProblem('La modifica include altre lavorazioni. Chiedi di isolarla prima della condivisione.');
    const commits = (await this.git(p.directory, ['rev-list', '--reverse', `${p.base}..${head}`])).trim().split('\n').filter(Boolean);
    if (!commits.length || commits.some(c => !SHA.test(c))) throw new ProposalProblem('Cronologia della modifica non verificabile.');
    // Check every commit, including files added and later removed, before showing any diff content.
    for (const commit of commits) {
      const names = (await this.git(p.directory, ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', `${commit}^`, commit])).split('\0').filter(Boolean);
      if (names.some(f => !productPath(f))) throw new ProposalProblem('La modifica include file personali o estranei al prodotto. Chiedi di rimuoverli anche dalla cronologia.');
      const modes = await this.git(p.directory, ['diff-tree', '--no-commit-id', '--raw', '--no-renames', '-r', commit]);
      if (/\b(?:120000|160000)\b/.test(modes)) throw new ProposalProblem('Collegamenti e moduli esterni richiedono una revisione separata.');
    }
    return { head, commits };
  }

  private async inspect(p: AppProposal): Promise<void> {
    p.phase = 'checking'; p.problem = null; p.diff = null; p.files = [];
    p.quality = pending(); p.privacy = pending(); p.reviews = pending();
    this.publishState();
    const { head, commits } = await this.snapshot(p);
    p.head = head;
    const safe = await this.d.guard(p.directory, commits);
    p.privacy = check(safe, head);
    if (!safe) throw new ProposalProblem('Controllo dati riservati non superato o non disponibile. Nessun contenuto è condiviso.');
    const verified = await this.d.verified(p.directory, head);
    p.quality = check(verified.quality, head); p.reviews = check(verified.reviews, head);
    const files = (await this.git(p.directory, ['diff', '--name-only', '--no-renames', '-z', p.base, head])).split('\0').filter(Boolean);
    const diff = await this.git(p.directory, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', p.base, head, '--']);
    if (diff.length > MAX_DIFF) throw new ProposalProblem('La modifica è troppo ampia da rivedere qui. Chiedi di dividerla.');
    const current = await this.snapshot(p);
    if (current.head !== head) throw new ProposalProblem('La modifica è cambiata durante i controlli. Rileggi le verifiche.');
    p.files = files; p.diff = diff;
    p.phase = verified.quality && verified.reviews ? 'ready' : 'editing';
    if (p.phase !== 'ready') p.problem = 'Restano da completare le verifiche e le revisioni indicate.';
    this.publishState();
  }

  async refresh(id: string): Promise<AppProposal> {
    return this.exclusive(id, async p => { if (!p.url) await this.inspect(p); });
  }

  /** Renderer click only. reviewedHead is the full SHA the user actually saw, never a renderer-provided path/ref. */
  async openPullRequest(request: ProposalPublication): Promise<AppProposal> {
    return this.exclusive(request.id, async p => {
      if (p.url) return;
      if (!request.reviewedHead || p.head !== request.reviewedHead || p.phase !== 'ready') throw new ProposalProblem('Rivedi prima la modifica e tutte le verifiche.');
      await this.inspect(p);
      if (p.head !== request.reviewedHead || p.phase !== 'ready') throw new ProposalProblem('La modifica è cambiata: rivedila prima di condividerla.');
      const remote = githubRepository(await this.git(this.d.repo, ['remote', 'get-url', 'origin']));
      if (!remote) throw new ProposalProblem('Collega il repository GitHub del prodotto nelle impostazioni.');
      try { await this.run(p.directory, 'gh', ['auth', 'status', '--hostname', 'github.com']); }
      catch { throw new ProposalProblem('GitHub non è pronto su questo computer. La modifica resta locale; completa il collegamento GitHub prima di condividerla.'); }
      const args = ['--repo', remote.slug, '--head', p.branch, '--base', this.d.baseBranch];
      const existing = await this.run(p.directory, 'gh', ['pr', 'list', ...args, '--state', 'all', '--json', 'url,state,headRefOid', '--limit', '1']);
      const found: unknown = JSON.parse(existing);
      const prior: { url?: unknown; state?: unknown; headRefOid?: unknown } | null = Array.isArray(found) && found[0] && typeof found[0] === 'object' ? found[0] : null;
      if (prior) {
        if (prior.headRefOid !== p.head || !['OPEN', 'CLOSED', 'MERGED'].includes(String(prior.state))) throw new ProposalProblem('La PR esistente non corrisponde alla modifica rivista. Nessuna nuova richiesta è stata aperta.');
        this.recordPublication(p, prior.url, remote.slug, prior.state);
        return;
      }
      const baseRemote = (await this.git(p.directory, ['ls-remote', '--refs', remote.url, `refs/heads/${this.d.baseBranch}`])).trim().split(/\s+/)[0];
      // Prevent local main commits outside the scanned range from leaving the machine.
      if (baseRemote !== p.base) throw new ProposalProblem('La versione di partenza è diversa da GitHub. Prepara la modifica sulla versione aggiornata.');
      const remoteHead = (await this.git(p.directory, ['ls-remote', '--refs', remote.url, `refs/heads/${p.branch}`])).trim().split(/\s+/)[0];
      if (remoteHead && remoteHead !== p.head) throw new ProposalProblem('Esiste già una modifica diversa con questo identificativo. Nessun file è stato sovrascritto.');
      p.phase = 'publishing'; this.publishState();
      // Push an immutable SHA to a fresh ref. Hooks stay enabled, no force, no implicit commits.
      await this.git(p.directory, ['push', '--no-follow-tags', '--porcelain', remote.url, `${p.head}:refs/heads/${p.branch}`]);
      const url = (await this.run(p.directory, 'gh', ['pr', 'create', ...args, '--title', 'Improve application', '--body', 'Application change prepared and reviewed in Second Brain. Relevant checks passed for the reviewed commit.'])).trim();
      this.recordPublication(p, url, remote.slug, 'OPEN');
    });
  }

  private recordPublication(p: AppProposal, url: unknown, slug: string, state: unknown): void {
    const expectedPrefix = `https://github.com/${slug}/pull/`;
    if (typeof url !== 'string' || !url.startsWith(expectedPrefix) || !/^\d+$/.test(url.slice(expectedPrefix.length))) throw new ProposalProblem('Non è stato possibile verificare il collegamento della PR. Riprova per recuperarlo.');
    p.url = url; p.phase = 'published'; p.publication = state === 'CLOSED' ? 'closed' : state === 'MERGED' ? 'merged' : 'open';
    p.problem = p.publication === 'closed' ? 'Questa PR è stata chiusa. Per proporre un nuovo intervento prepara una nuova modifica.' : null;
    this.publishState();
  }

  private async exclusive(id: string, action: (p: AppProposal) => Promise<void>): Promise<AppProposal> {
    const p = this.get(id);
    if (this.busy.has(id)) throw new ProposalProblem('Una verifica o condivisione è già in corso.');
    this.busy.add(id);
    try { await action(p); }
    catch (e) {
      p.phase = 'blocked'; p.diff = null;
      // Only our fixed user-facing errors cross IPC. Child stderr may contain URLs or credentials.
      p.problem = e instanceof ProposalProblem ? e.message : 'Operazione non completata. La modifica locale è conservata: rileggi le verifiche e riprova.';
      this.publishState();
    } finally { this.busy.delete(id); }
    return structuredClone(p);
  }
}
