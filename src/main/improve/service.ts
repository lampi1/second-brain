// "Migliora l'app" (ADR 0020): the section where the user improves and customizes their own app. This service reads the
// app's code folder with git (branches, what is in main, what is in the version in use, green checks recorded by
// scripts/check-pass.mjs), the releases folder (current.json, the launcher's launch-result.json), runs the user's
// "Aggiorna" (scripts/release.mjs promote in the code folder: check, test:stable, copy, switch) and then restarts the
// app through the launcher; at start it tells whether the new version came up or the launcher went back to the
// previous one, and why. It also creates the section's Regia with its role. Never run by an agent: the app-control
// tools only read its state. Used by wiring.ts (built once) and index.ts (the improve:* handlers).
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ChatSummary, Harness, ImproveLaunch, ImprovePromote, ImproveState } from '../../shared/contract';
import type { ChatService } from '../services';
import { errText, log } from '../log';
import { createRoutedChat, type RoutedChatDeps } from '../chats/routed';
import { branchStages, checkAt, launchOutcome, nextSeen, promoteGate, promoteStep, shaOfRelease, type Checks, type LaunchResult, type RefRow, type ReleaseState, type Seen } from './stages';

export interface ImproveDeps {
  userData: string;
  /** %LOCALAPPDATA%/second-brain (SB_RELEASES_ROOT in tests) */
  releasesBase: string;
  /** the release id in use (SB_RELEASE), 'dev' for a build run from the repo */
  running: string;
  stable: boolean;
  /** the setting appRepo (null = default) */
  appRepo: () => string | null;
  /** the repo a dev build runs from (out/.. when it holds a .git), for the default */
  devRepo: string | null;
  chats: Pick<ChatService, 'list' | 'create'>;
  emit: (s: ImproveState) => void;
  /** start the launcher and quit (wiring: the real one; tests: a recorder); failed: the launcher did not start */
  restart: (failed: () => void) => void;
  /** the Node that runs release.mjs (null = none found: "Aggiorna" stays off) */
  node: string | null;
  /** the routing table (ADR 0032): the section's Regia gets its model from it; none (tests) = the engine's default */
  routing?: Pick<RoutedChatDeps, 'route' | 'engineOn' | 'agentsMayOpen'>;
}

const LOG_MAX = 6000;
const git = (cwd: string, args: string[]): Promise<string> => new Promise((resolve, reject) => {
  // core.fsmonitor off: a chat working in the code folder could set it in .git/config and git would run it here, in
  // the app's own process, with no click (security review 2026-10-12)
  // GIT_OPTIONAL_LOCKS=0: `status` here never takes .git/index.lock, which would make a commit in that folder fail
  // (a chat's, or the next app instance's when the e2e suite runs several; ADR 0042)
  execFile('git', ['-c', 'core.fsmonitor=false', '-C', cwd, ...args], { windowsHide: true, maxBuffer: 16e6, timeout: 20_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout, stderr) => {
    if (err) reject(new Error(String(stderr || err.message).trim())); else resolve(String(stdout));
  });
});
const readJson = <T>(file: string): T | null => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; } };

/** The prompt that gives the section's Regia its role (generic: any user, any copy of the app). */
export function appRegiaPrompt(repo: string): string {
  return [
    "Sei la Regia di «Migliora l'app»: coordini le chat che migliorano e personalizzano questa app, come chiede l'utente.",
    `Il codice dell'app è in ${repo}: leggi prima il suo AGENTS.md e seguilo.`,
    '1. Ogni modifica la fa una chat sua, aperta con app_create_chat (titolo «App · cosa»), su un ramo e un worktree propri presi da main. Ometti harness, model ed effort: li sceglie la tabella «Instradamento modelli»; un override solo con un motivo (reason).',
    '2. Una modifica è finita quando `npm run check:branch` (il check leggero: typecheck, lint, unit e solo gli e2e della parte toccata) è verde sul suo commit: il check lo registra e app_improve_state la mostra «testata». Sui rami non serve il check completo.',
    '3. Appena un ramo è testato lo unisci in main tu (git merge, senza push), poi lanci il check completo `npm run check` su main, uno alla volta (mai due suite pesanti insieme sulla stessa macchina; se il cervello ha un lease per i test, prendilo): «Aggiorna» si accende solo quando la punta di main ha il check completo verde.',
    '4. Non aggiorni e non riavvii mai l’app: lo fa l’utente con il pulsante «Aggiorna» quando vuole. Mentre un aggiornamento è in corso (app_improve_state: promote.state «running») non unisci niente in main.',
    '5. Lo stato di rami e versioni lo leggi con app_improve_state. Rispondi all’utente in poche righe: cosa è pronto e cosa fare adesso.',
  ].join('\n');
}

export class ImproveService {
  private st: ImproveState;
  private promoteRun: ImprovePromote | null = null;
  private refreshing: Promise<ImproveState> | null = null;
  /** set before the first await of promote(): a second click while git is read never starts a second promotion */
  private promoting = false;

  constructor(private readonly d: ImproveDeps) {
    this.st = {
      repo: null, repoProblem: null, running: d.running, stable: d.stable, current: null, previous: null, bad: [], candidate: null,
      canPromote: false, promoteWhy: '', promote: null, launch: this.detectLaunch(), branches: [], at: 0,
    };
  }

  state(): ImproveState { return this.st; }

  /** The code folder: the setting, else the one the running release was built from, else the dev build's repo. */
  repo(): string | null {
    const set = this.d.appRepo();
    if (set) return set;
    if (this.d.stable) return readJson<{ repo?: string }>(path.join(this.d.releasesBase, 'releases', this.d.running, 'release.json'))?.repo ?? null;
    return this.d.devRepo;
  }

  /** Reads git and the releases folder again (one read at a time; callers share it). */
  refresh(): Promise<ImproveState> {
    this.refreshing ??= this.read().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async read(): Promise<ImproveState> {
    const rel = readJson<Partial<ReleaseState>>(path.join(this.d.releasesBase, 'current.json')) ?? {};
    const state: ReleaseState = { current: rel.current ?? null, previous: rel.previous ?? null, bad: Array.isArray(rel.bad) ? rel.bad.map(String) : [] };
    const failedSha = state.bad.map(shaOfRelease).filter((x): x is string => !!x);
    const repo = this.repo();
    let repoProblem: string | null = null;
    let branch: string | null = null, dirty = false, mainSha: string | null = null, main = 'main';
    let branches: ImproveState['branches'] = [];
    let candidate: ImproveState['candidate'] = null;
    let mainChecked = false;
    const runningSha = this.d.stable ? shaOfRelease(this.d.running) : null;
    if (!repo) repoProblem = "Non so dov'è il codice dell'app: impostalo nelle Impostazioni («Cartella del codice dell'app»).";
    else if (!fs.existsSync(repo)) repoProblem = `La cartella del codice non esiste: ${repo}`;
    else if (!fs.existsSync(path.join(repo, 'scripts', 'release.mjs'))) repoProblem = `In ${repo} manca scripts/release.mjs: non è il codice di questa app.`;
    else {
      try {
        // the reads that do not depend on each other run together: one git start costs 0.5-1 s on a loaded box and the
        // start notice waits for this state (seven in a row took over 5 s with the e2e suite in parallel; ADR 0042)
        const [refsOut, head, status, commonOut, trees] = await Promise.all([
          git(repo, ['for-each-ref', '--format=%(refname:short)%09%(objectname)%09%(committerdate:unix)%09%(subject)', 'refs/heads']),
          git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']),
          git(repo, ['status', '--porcelain']),
          git(repo, ['rev-parse', '--git-common-dir']),
          this.worktrees(repo),
        ]);
        const refs: RefRow[] = refsOut.split('\n').filter(Boolean).map(l => { const [name = '', sha = '', at = '0', ...subj] = l.split('\t'); return { name, sha, at: Number(at) * 1000, subject: subj.join('\t') }; });
        if (!refs.some(r => r.name === 'main') && refs.some(r => r.name === 'master')) main = 'master';
        mainSha = refs.find(r => r.name === main)?.sha ?? null;
        branch = head.trim();
        dirty = status.trim() !== '';
        const names = (out: string) => new Set(out.split('\n').map(s => s.trim()).filter(Boolean));
        const [merged, inUse] = await Promise.all([
          git(repo, ['branch', '--format=%(refname:short)', '--merged', main]).then(names),
          runningSha ? git(repo, ['branch', '--format=%(refname:short)', '--merged', runningSha]).then(names, () => null) : null,
        ]);
        const common = path.resolve(repo, commonOut.trim());
        const checks = readJson<Checks>(path.join(common, 'sb-checks.json')) ?? {};
        mainChecked = !!mainSha && checkAt(checks, mainSha, 'full') !== null;
        const chats = this.d.chats.list().filter(c => c.space === 'app' && !c.appRegia && !c.closedAt);
        const chatOf = (b: string) => {
          const dir = trees.get(b);
          const c = dir ? chats.filter(x => samePath(x.cwd, dir)).sort((a, z) => z.updatedAt - a.updatedAt)[0] : undefined;
          return c ? { id: c.id, title: c.title } : null;
        };
        const now = Date.now();
        branches = branchStages({ refs, main, mainSha, merged, inUse, checks, now, chatOf });
        const tip = refs.find(r => r.name === main);
        if (tip && !(runningSha && tip.sha.startsWith(runningSha))) {
          candidate = { sha: tip.sha.slice(0, 7), subject: tip.subject, at: tip.at, checkAt: checkAt(checks, tip.sha, 'full') };
        }
      } catch (e) {
        repoProblem = `Git non legge la cartella del codice: ${errText(e)}`;
        log.warn('improve', 'git read failed', { cause: errText(e), hint: 'check the code folder (setting appRepo) is a git repo and git is on PATH' });
      }
    }
    const gate = promoteGate({ stable: this.d.stable, repo, repoProblem, branch, main, dirty, mainSha, runningSha, busy: this.promoteRun?.state === 'running' || this.promoteRun?.state === 'restarting', node: !!this.d.node, mainChecked, failedBefore: !!mainSha && failedSha.some(x => mainSha!.startsWith(x)) });
    this.st = { ...this.st, repo, repoProblem, ...state, candidate, canPromote: gate.ok, promoteWhy: gate.why, promote: this.promoteRun, branches, at: Date.now() };
    this.d.emit(this.st);
    return this.st;
  }

  private async worktrees(repo: string): Promise<Map<string, string>> {
    const out = await git(repo, ['worktree', 'list', '--porcelain']).catch(() => '');
    const map = new Map<string, string>();
    let dir: string | null = null;
    for (const l of out.split('\n')) {
      if (l.startsWith('worktree ')) dir = l.slice(9).trim();
      else if (l.startsWith('branch ') && dir) map.set(l.slice(7).trim().replace(/^refs\/heads\//, ''), dir);
    }
    return map;
  }

  /** The user's click: test, copy and switch the release (release.mjs promote), then restart through the launcher. */
  async promote(): Promise<ImproveState> {
    if (this.promoting) throw new Error('Un aggiornamento è già in corso.');
    this.promoting = true;
    let s: ImproveState;
    try { s = await this.refresh(); } catch (e) { this.promoting = false; throw e; }
    if (!s.canPromote || !s.repo || !this.d.node) { this.promoting = false; throw new Error(s.promoteWhy || 'Aggiornamento non possibile adesso.'); }
    const repo = s.repo;
    const run: ImprovePromote = { state: 'running', startedAt: Date.now(), step: 'Avvio', log: '' };
    this.promoteRun = run;
    this.push();
    log.info('improve', 'promotion started by the user', { data: { repo, from: this.d.running, candidate: s.candidate?.sha } });
    // a clean environment: nothing of this running app (release id, userData, port, Electron-as-Node) leaks into the
    // tests and the build the promotion runs
    const env = cleanEnv(process.env);
    const child = spawn(this.d.node, [path.join(repo, 'scripts', 'release.mjs'), 'promote'], { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const add = (b: Buffer) => {
      run.log = (run.log + b.toString()).slice(-LOG_MAX);
      const step = promoteStep(run.log);
      if (step !== run.step) { run.step = step; this.push(); }
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    child.on('error', e => { run.log += `\n${errText(e)}`; });
    child.on('close', code => {
      run.endedAt = Date.now();
      if (code === 0) {
        run.version = /promoted (\S+)/.exec(run.log)?.[1];
        run.state = 'restarting';
        run.step = 'Riavvio sulla versione nuova';
        log.info('improve', 'promoted: restarting', { data: { version: run.version } });
        this.push();
        setTimeout(() => this.d.restart(() => {
          this.promoting = false;
          run.state = 'error';
          run.step = `Versione ${run.version ?? 'nuova'} pronta, ma il riavvio non è partito: chiudi e riapri l'app`;
          this.push();
        }), 1500);
      } else {
        this.promoting = false;
        run.state = 'error';
        // say where it stopped (tests, stable test, copy): the log below is npm's, in English
        run.step = `Non aggiornata, fermata a «${run.step.replace(/…$/, '')}»: la versione in uso non è cambiata`;
        log.warn('improve', 'promotion failed', { cause: `release.mjs promote exit ${code}`, hint: 'read the log tail in the section; run `npm run check` in the code folder' });
        this.push();
        void this.refresh();
      }
    });
    return this.st;
  }

  /** A folder the app's chats may work in: the code folder or one of its git worktrees. */
  async inRepo(dir: string): Promise<boolean> {
    const repo = this.repo();
    if (!repo || !path.isAbsolute(dir)) return false;
    if (samePath(dir, repo)) return true;
    const trees = await this.worktrees(repo);
    return [...trees.values()].some(t => samePath(dir, t));
  }

  dismissLaunch(): ImproveState {
    this.st = { ...this.st, launch: null };
    this.d.emit(this.st);
    return this.st;
  }

  /** The section's Regia, in the code folder, with its role; its model from the routing table (kind regia, area App),
   *  the engine the user picked beating the row (createRoutedChat). */
  async createRegia(harness: Harness, model?: string): Promise<ChatSummary> {
    const repo = this.repo();
    if (!repo || !fs.existsSync(repo)) throw new Error("Imposta prima la cartella del codice dell'app (Impostazioni).");
    const req = { harness, cwd: repo, title: "Regia dell'app", space: 'app' as const, appRegia: true, ...(model ? { model } : {}), prompt: appRegiaPrompt(repo) };
    if (!this.d.routing) return this.d.chats.create(req);
    const { route, engineOn, agentsMayOpen } = this.d.routing;
    return createRoutedChat({ route, engineOn, agentsMayOpen, create: r => this.d.chats.create(r) },
      { title: req.title, prompt: req.prompt, cwd: repo, defaults: { harness }, ask: { harness, ...(model ? { model } : {}), reason: 'motore scelto dall’utente' } },
      { space: 'app', appRegia: true });
  }

  private push(): void {
    this.st = { ...this.st, promote: this.promoteRun ? { ...this.promoteRun } : null };
    this.d.emit(this.st);
  }

  private detectLaunch(): ImproveLaunch | null {
    if (!this.d.stable) return null;
    const file = path.join(this.d.userData, 'improve-seen.json');
    const seen = readJson<Seen>(file);
    const rel = readJson<Partial<ReleaseState>>(path.join(this.d.releasesBase, 'current.json')) ?? {};
    const result = readJson<LaunchResult>(path.join(this.d.releasesBase, 'launch-result.json'));
    const now = Date.now();
    const launch = launchOutcome({ running: this.d.running, stable: true, state: { current: rel.current ?? null, previous: rel.previous ?? null, bad: Array.isArray(rel.bad) ? rel.bad : [], history: Array.isArray(rel.history) ? rel.history : [] }, result, seen, now });
    try { fs.writeFileSync(file, JSON.stringify(nextSeen(this.d.running, launch, seen, now))); } catch (e) { log.warn('improve', 'improve-seen.json not written', { cause: errText(e), hint: 'userData not writable: the restart notice may show again' }); }
    if (launch) log.info('improve', 'start outcome', { data: { ...launch } });
    return launch;
  }
}

const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() || path.resolve(a).toLowerCase().startsWith(`${path.resolve(b).toLowerCase()}${path.sep}`);

// what the launcher, the tests and this run set themselves; the user's own SB_* (SB_USER_DATA, SB_CLAUDE_PATH, SB_BRAIN,
// SB_MCP_PORT…) stay, or the restarted app would open another userData or miss a CLI (security review 2026-10-12)
const RUN_VARS = /^(SB_RELEASE|SB_RELEASE_ID|SB_ENGINE_CLAUDE|SB_TEST|SB_HIDDEN|SB_DEMO|SB_DEMO_FREEZE|SB_IMPROVE_.*|SB_LIVE|ELECTRON_RUN_AS_NODE)$/i;
/** The environment for the promotion and the launcher: without the variables this run was started with. */
export function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (!RUN_VARS.test(k)) out[k] = v;
  return out;
}

/** node(.exe) on PATH, or null. */
export function findNode(env: NodeJS.ProcessEnv = process.env): string | null {
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir.replace(/^"|"$/g, ''), exe);
    try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return null;
}
