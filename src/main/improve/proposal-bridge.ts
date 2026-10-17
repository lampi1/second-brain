// Renderer-only orchestration for isolated proposals, exact-head ledgers and user-confirmed GitHub publication.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppProposal, ProposalAvailability, ProposalPublication } from '../../shared/improve-proposals';
import type { BrainService, ChatService } from '../services';
import { createRoutedChat } from '../chats/routed';
import { engineOn, agentsMayOpen } from '../engines/policy';
import { findGuard, scanCommits } from '../brain/guard';
import { electronNode } from '../brain/node';
import { readLocal } from '../agents/local-store';
import type { Checks } from './stages';
import { ProposalService } from './proposals';
import { proposalReviews } from './reviews';

export function proposalQuality(checks: Checks | undefined, head: string): boolean {
  const hit = checks?.[head];
  return !!hit && ['light', 'full'].includes(hit.kind ?? 'full') && Number.isFinite(Date.parse(hit.at));
}
const git = (cwd: string, args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', ...args], { cwd, windowsHide: true, timeout: 15_000, maxBuffer: 100_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } }, (error, stdout) => error ? reject(new Error('Repository non disponibile.')) : resolve(stdout.trim()));
});

export interface ProposalBridgeDeps {
  userData: string;
  repo: () => string | null;
  brain: Pick<BrainService, 'settings' | 'route'>;
  chats: Pick<ChatService, 'list' | 'create' | 'reopen'>;
  emit: (proposals: AppProposal[]) => void;
  focus: (chatId: string) => void;
  disabled?: boolean;
}

export class ProposalBridge {
  private active: { repo: string; service: Promise<ProposalService> } | null = null;
  constructor(private readonly d: ProposalBridgeDeps) {}
  private async service(): Promise<ProposalService> {
    const selected = this.d.repo();
    if (this.d.disabled || !selected) throw new Error('Collega prima il repository del prodotto nelle Impostazioni.');
    const repo = fs.realpathSync(selected);
    if (this.active?.repo === repo) return this.active.service;
    const service = this.open(repo);
    this.active = { repo, service };
    try { return await service; }
    catch (e) { if (this.active?.service === service) this.active = null; throw e; }
  }
  private async open(repo: string): Promise<ProposalService> {
    let baseBranch: 'main' | 'master';
    try { await git(repo, ['rev-parse', '--verify', 'refs/heads/main']); baseBranch = 'main'; }
    catch { await git(repo, ['rev-parse', '--verify', 'refs/heads/master']); baseBranch = 'master'; }
    const identity = createHash('sha256').update(repo).digest('hex').slice(0, 24);
    return new ProposalService({ repo, workspaceRoot: path.join(this.d.userData, 'app-proposals', identity), baseBranch,
      guard: async (directory, commits) => (await scanCommits(directory, commits, findGuard('deny-work.txt', process.env, 'app'), electronNode())).ok,
      verified: async (directory, head) => {
        const common = await git(directory, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
        let quality = false;
        try { const checks = readLocal(path.join(common, 'sb-checks.json')) as Checks | undefined; quality = proposalQuality(checks, head); } catch { /* An unreadable ledger proves nothing. */ }
        let reviews = false;
        try { reviews = proposalReviews(readLocal(path.join(common, 'sb-proposal-reviews.json')), head); } catch { /* Missing/corrupt attestations fail closed. */ }
        return { quality, reviews };
      },
      startWork: async proposal => {
        const previous = this.d.chats.list().find(c => c.space === 'app' && path.resolve(c.cwd) === path.resolve(proposal.directory));
        if (previous) { if (previous.closedAt) await this.d.chats.reopen(previous.id); this.d.focus(previous.id); return; }
        const settings = this.d.brain.settings(), defaults = settings.regiaChats;
        const model = defaults.harness === 'claude' ? defaults.claudeModel : defaults.harness === 'cursor' ? defaults.cursorModel : undefined;
        const chat = await createRoutedChat({ route: req => this.d.brain.route(req), engineOn: h => engineOn(settings, h), agentsMayOpen: h => agentsMayOpen(settings, h), create: req => this.d.chats.create(req) }, {
          title: 'Personalizza l’app', cwd: proposal.directory, kind: 'app-feature', area: 'App',
          prompt: 'Chiedi quale modifica all’app desidera preparare l’utente e attendi la sua descrizione. Lavora solo in questo worktree. Leggi le regole del repository, conserva i dati personali fuori da Git e prepara test e revisioni indipendenti. Dopo le verifiche registra ogni verdetto con scripts/record-proposal-review.mjs (vedi docs/proposal-publication.md). Non pubblicare, aggiornare o riavviare l’app. Non effettuare commit senza autorizzazione dell’utente.',
          defaults: { harness: defaults.harness, ...(model ? { model } : {}), ...(defaults.claudeEffort && defaults.harness === 'claude' ? { effort: defaults.claudeEffort } : {}) },
        }, { space: 'app', byUser: true });
        this.d.focus(chat.id);
      }, emit: rows => { if (this.active?.repo === repo) this.d.emit(rows); },
    });
  }
  async availability(): Promise<ProposalAvailability> {
    try { await this.service(); return { available: true, reason: null, publishBlocked: null }; }
    catch { return { available: false, reason: 'Il repository del prodotto non è disponibile oppure manca un ramo main/master. La cartella in uso resta invariata.', publishBlocked: 'Collega prima il repository del prodotto.' }; }
  }
  async list(): Promise<AppProposal[]> { try { return (await this.service()).list(); } catch { return []; } }
  async create(): Promise<AppProposal> { return (await this.service()).create(); }
  async refresh(id: string): Promise<AppProposal> { return (await this.service()).refresh(id); }
  async resume(id: string): Promise<AppProposal> { return (await this.service()).resume(id); }
  async publish(request: ProposalPublication): Promise<AppProposal> { return (await this.service()).openPullRequest(request); }
}
