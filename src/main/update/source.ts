// "Aggiorna" from GitHub (Settings → Aggiornamenti, ADR 0075) and the Orchestrator's app_update_code (ADR 0074): the
// app's code folder against GitHub's main (scripts/pull.mjs --check, git fetch only), the user's one-click update
// (pull.mjs: fast-forward main, npm ci only when the lockfile changed, build; then a dev build relaunches itself and a
// stable copy is switched with scripts/release.mjs promote-now and restarts through the launcher), the code folder
// update an Orchestrator runs when the user asks (pull()), and, at start, whether the new version came up or the
// launcher went back to the previous one, and why (the notice under the top bar, LaunchBanner.tsx). Only the user's
// click updates and restarts: no agent tool calls updateNow(). Moved here from the retired "Migliora l'app" section
// (ADR 0079). Used by wiring.ts (built once), index.ts (the source:* handlers) and appctl/tools.ts (app_update_code).
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AppSourceState, LaunchNotice, PromoteRun, SourceUpdate } from '../../shared/contract';
import { errText, log } from '../log';
import { launchOutcome, nextSeen, promoteStep, shaOfRelease, type LaunchResult, type ReleaseState, type Seen } from './launch';

/** scripts/pull.mjs --json */
export interface PullResult { ok: boolean; message: string; upToDate?: boolean; from?: string; to?: string; commits?: string[]; depsReinstalled?: boolean; built?: boolean; behind?: number; ahead?: number; canUpdate?: boolean; depsChanged?: boolean }

export interface AppSourceDeps {
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
  emit: (s: AppSourceState) => void;
  /** start the launcher and quit (wiring: the real one; tests: a recorder); failed: the launcher did not start */
  restart: (failed: () => void) => void;
  /** a dev build run from the code folder starts again on the new build (wiring: app.relaunch + quit; tests: a recorder) */
  relaunch?: () => void;
  /** demo and tests on the real checkout: never fetch from GitHub, never pull (wiring: SB_DEMO/SB_TEST without SB_UPDATE_REPO) */
  offline?: boolean;
  /** the Node that runs pull.mjs and release.mjs (null = none found: "Aggiorna" stays off) */
  node: string | null;
}

const LOG_MAX = 6000;
const SEEN = 'launch-seen.json';
/** the name the "seen" marker had before ADR 0079: read once, so a fallback already told is not told again */
const OLD_SEEN = 'improve-seen.json';
const IDLE_SOURCE: SourceUpdate = { state: 'idle', behind: null, commits: [], message: '', canUpdate: false, at: 0 };
const git = (cwd: string, args: string[]): Promise<string> => new Promise((resolve, reject) => {
  // core.fsmonitor off: a chat working in the code folder could set it in .git/config and git would run it here, in
  // the app's own process, with no click (security review 2026-10-12)
  // GIT_OPTIONAL_LOCKS=0: `status` here never takes .git/index.lock, which would make a commit in that folder fail
  execFile('git', ['-c', 'core.fsmonitor=false', '-C', cwd, ...args], { windowsHide: true, maxBuffer: 16e6, timeout: 20_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout, stderr) => {
    if (err) reject(new Error(String(stderr || err.message).trim())); else resolve(String(stdout));
  });
});
const readJson = <T>(file: string): T | null => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; } };

export class AppSourceService {
  private st: AppSourceState;
  private promoteRun: PromoteRun | null = null;
  private refreshing: Promise<AppSourceState> | null = null;
  private promoting = false;
  private pulling = false;

  constructor(private readonly d: AppSourceDeps) {
    this.st = { repo: null, repoProblem: null, running: d.running, stable: d.stable, candidate: null, promote: null, launch: this.detectLaunch(), source: { ...IDLE_SOURCE }, at: 0 };
  }

  state(): AppSourceState { return this.st; }

  /** The code folder: the setting, else the one the running release was built from, else the dev build's repo. */
  repo(): string | null {
    const set = this.d.appRepo();
    if (set) return set;
    if (this.d.stable) return readJson<{ repo?: string }>(path.join(this.d.releasesBase, 'releases', this.d.running, 'release.json'))?.repo ?? null;
    return this.d.devRepo;
  }

  /** Reads the code folder and the releases folder again (one read at a time; callers share it). */
  refresh(): Promise<AppSourceState> {
    this.refreshing ??= this.read().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  /** The version in use and main's tip when it is not the version in use (what a stable copy would switch to). */
  private async read(): Promise<AppSourceState> {
    const repo = this.repo();
    let repoProblem: string | null = null;
    let candidate: AppSourceState['candidate'] = null;
    let runningAt: number | null = null;
    const runningSha = this.d.stable ? shaOfRelease(this.d.running) : null;
    if (!repo) repoProblem = "Non so dov'è il codice dell'app: impostalo nelle Impostazioni («Cartella del codice dell'app»).";
    else if (!fs.existsSync(repo)) repoProblem = `La cartella del codice non esiste: ${repo}`;
    else if (!fs.existsSync(path.join(repo, 'scripts', 'release.mjs'))) repoProblem = `In ${repo} manca scripts/release.mjs: non è il codice di questa app.`;
    else {
      try {
        const [refsOut, madeAt] = await Promise.all([
          git(repo, ['for-each-ref', '--format=%(refname:short)%09%(objectname)%09%(committerdate:unix)%09%(subject)', 'refs/heads/main', 'refs/heads/master']),
          // the version in use as a date for the user ("del 14/10 alle 18:30"), not a hash
          runningSha ? git(repo, ['show', '-s', '--format=%ct', runningSha]).then(o => (Number(o.trim()) * 1000) || null, () => null) : null,
        ]);
        runningAt = madeAt;
        const refs = refsOut.split('\n').filter(Boolean).map(l => { const [name = '', sha = '', at = '0', ...subj] = l.split('\t'); return { name, sha, at: Number(at) * 1000, subject: subj.join('\t') }; });
        const tip = refs.find(r => r.name === 'main') ?? refs.find(r => r.name === 'master');
        if (tip && !(runningSha && tip.sha.startsWith(runningSha))) candidate = { sha: tip.sha.slice(0, 7), subject: tip.subject, at: tip.at };
      } catch (e) {
        repoProblem = `Git non legge la cartella del codice: ${errText(e)}`;
        log.warn('update', 'git read failed', { cause: errText(e), hint: 'check the code folder (setting appRepo) is a git repo and git is on PATH' });
      }
    }
    this.st = { ...this.st, repo, repoProblem, candidate, runningAt, promote: this.promoteRun, at: Date.now() };
    this.d.emit(this.st);
    return this.st;
  }

  /** release.mjs promote-now in the code folder, its steps in the state, then the restart through the launcher. */
  private spawnPromote(repo: string, on: { ok(version?: string): void; failed(why: string): void }): void {
    const run: PromoteRun = { state: 'running', startedAt: Date.now(), step: 'Avvio', log: '' };
    this.promoteRun = run;
    this.push();
    log.info('update', 'switch to the new version started by the user', { data: { repo, from: this.d.running, candidate: this.st.candidate?.sha } });
    // a clean environment: nothing of this running app (release id, userData, port, Electron-as-Node) leaks into the build
    const child = spawn(this.d.node!, [path.join(repo, 'scripts', 'release.mjs'), 'promote-now'], { cwd: repo, env: cleanEnv(process.env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
        log.info('update', 'switched: restarting', { data: { version: run.version } });
        this.push();
        on.ok(run.version);
        setTimeout(() => this.d.restart(() => {
          this.promoting = false;
          run.state = 'error';
          run.step = `Versione ${run.version ?? 'nuova'} pronta, ma il riavvio non è partito: chiudi e riapri l'app`;
          this.push();
          on.failed(run.step);
        }), 1500);
      } else {
        this.promoting = false;
        run.state = 'error';
        run.step = `Non aggiornata, fermata a «${run.step.replace(/…$/, '')}»: la versione in uso non è cambiata`;
        log.warn('update', 'switch failed', { cause: `release.mjs promote-now exit ${code}`, hint: 'run `npm run build` in the code folder and read its output' });
        this.push();
        on.failed(`${run.step}. ${run.log.trim().split('\n').pop() ?? ''}`.slice(0, 400));
        void this.refresh();
      }
    });
  }

  /** The user's "aggiornati" through the Orchestrator (app_update_code, ADR 0074): scripts/pull.mjs in the code folder
   *  fast-forwards main from GitHub, reinstalls changed dependencies and builds. Never promotes or restarts. */
  async pull(): Promise<PullResult> {
    if (this.pulling) throw new Error('Un aggiornamento del codice è già in corso.');
    if (this.promoting || this.promoteRun?.state === 'running' || this.promoteRun?.state === 'restarting') throw new Error('«Aggiorna» è in corso: riprova quando ha finito.');
    const repo = this.repo();
    if (!repo || !fs.existsSync(path.join(repo, 'scripts', 'pull.mjs'))) throw new Error(repo ? `In ${repo} manca scripts/pull.mjs: aggiorna a mano una volta (git pull, npm run setup).` : "Imposta prima la cartella del codice dell'app (Impostazioni).");
    if (!this.d.node) throw new Error('Serve Node.js installato per aggiornare il codice.');
    this.pulling = true;
    try {
      const r = await this.runPull(repo, []);
      log.info('update', 'code folder update', { data: { ok: r.ok, from: r.from, to: r.to, upToDate: r.upToDate } });
      return r;
    } finally {
      this.pulling = false;
      void this.refresh();
    }
  }

  private runPull(repo: string, extra: string[]): Promise<PullResult> {
    return new Promise<PullResult>((resolve, reject) => {
      execFile(this.d.node!, [path.join(repo, 'scripts', 'pull.mjs'), '--json', ...extra], { cwd: repo, env: cleanEnv(process.env), windowsHide: true, timeout: 15 * 60_000, maxBuffer: 4e6 }, (err, stdout) => {
        const line = String(stdout).trim().split('\n').pop() ?? '';
        try { resolve(JSON.parse(line) as PullResult); } catch { reject(new Error(`Aggiornamento del codice non riuscito: ${errText(err ?? new Error('nessuna risposta'))}`.slice(0, 500))); }
      });
    });
  }

  private setSource(patch: Partial<SourceUpdate>): AppSourceState {
    this.st = { ...this.st, source: { ...this.st.source, ...patch, at: Date.now() } };
    this.push();
    return this.st;
  }

  /** The folder "Aggiorna" updates: a dev build its own checkout (the one it relaunches from), a stable copy its code folder. */
  private updateRepo(): string | null { return this.d.stable ? this.repo() : this.d.devRepo; }
  /** pull.mjs flags: a stable copy is promoted, which needs a tree without untracked files too */
  private pullFlags(): string[] { return this.d.stable ? ['--strict'] : []; }

  /** Where the code folder stands against GitHub's main (git fetch only): the "Aggiorna" button's count. */
  async sourceCheck(): Promise<AppSourceState> {
    if (this.pulling || this.st.source.state === 'updating' || this.st.source.state === 'restarting') return this.st;
    if (this.d.offline) return this.setSource({ state: 'idle', behind: 0, commits: [], canUpdate: false, message: 'Hai già l’ultima versione.' });
    const repo = this.updateRepo();
    if (!repo || !this.d.node || !fs.existsSync(path.join(repo, 'scripts', 'pull.mjs'))) {
      return this.setSource({ state: 'idle', behind: null, commits: [], canUpdate: false,
        message: !repo ? "Questa installazione non viene da un clone del codice: aggiorna con il nuovo installer." : !this.d.node ? 'Serve Node.js installato per aggiornare.' : `In ${repo} manca scripts/pull.mjs: aggiorna a mano una volta (git pull, npm run setup).` });
    }
    this.pulling = true;
    this.setSource({ state: 'checking', message: 'Controllo GitHub…' });
    try {
      const r = await this.runPull(repo, ['--check', ...this.pullFlags()]);
      // a stable copy may be behind its own code folder even when the folder matches GitHub (never its local commits)
      const st = await this.read();
      const pending = this.d.stable && !!st.candidate && (r.ahead ?? 0) === 0;
      const deps = this.depsBlock(r);
      const canUpdate = r.ok && !deps && (!!r.canUpdate || (pending && r.behind === 0 && !st.repoProblem));
      return this.setSource({ state: 'idle', behind: r.behind ?? null, commits: r.commits ?? [], canUpdate,
        message: deps ?? (r.ok && r.behind === 0 ? (pending ? 'Il codice ha già la versione nuova: premi «Aggiorna» per passarci.' : 'Hai già l’ultima versione.') : r.message) });
    } catch (e) {
      return this.setSource({ state: 'error', canUpdate: false, message: errText(e).slice(0, 300) });
    } finally { this.pulling = false; }
  }

  /** A dev build on Windows runs Electron from node_modules: npm ci cannot replace it while the app is open. */
  private depsBlock(r: PullResult): string | null {
    return !this.d.stable && process.platform === 'win32' && r.depsChanged
      ? 'Questa versione cambia le dipendenze: chiudi l’app, esegui npm run pull nella cartella del codice e riaprila.' : null;
  }

  /** The user's click on "Aggiorna" (ADR 0075): the latest main from GitHub, built, and the app on it at once, no tests.
   *  A dev build restarts itself; a stable copy is switched with release.mjs promote-now and restarts through the
   *  launcher, which falls back to the previous release if the new one does not start. */
  async updateNow(): Promise<AppSourceState> {
    if (this.pulling || this.promoting) throw new Error('Un aggiornamento è già in corso.');
    if (this.d.offline) throw new Error('Nella demo l’app non si aggiorna.');
    const repo = this.updateRepo();
    if (!repo || !this.d.node || !fs.existsSync(path.join(repo, 'scripts', 'pull.mjs'))) { await this.sourceCheck(); throw new Error(this.st.source.message || 'Aggiornamento non possibile adesso.'); }
    this.pulling = true;
    this.setSource({ state: 'updating', message: 'Scarico la versione nuova da GitHub…' });
    let r: PullResult;
    try {
      const check = await this.runPull(repo, ['--check', ...this.pullFlags()]);
      const deps = this.depsBlock(check);
      r = !check.ok ? check : deps ? { ok: false, message: deps } : this.d.stable && (check.ahead ?? 0) > 0
        ? { ok: false, message: `main ha ${check.ahead} commit locali che GitHub non ha: «Aggiorna» non li promuove senza test. Usa npm run promote.` }
        : await this.runPull(repo, this.pullFlags());
    } catch (e) { r = { ok: false, message: errText(e) }; } finally { this.pulling = false; }
    log.info('update', 'update now: code folder', { data: { ok: r.ok, from: r.from, to: r.to, upToDate: r.upToDate } });
    if (!r.ok) return this.setSource({ state: 'error', canUpdate: false, message: r.message.slice(0, 400) });
    if (!this.d.stable) {
      if (r.upToDate) return this.setSource({ state: 'done', behind: 0, commits: [], canUpdate: false, message: 'Hai già l’ultima versione.' });
      this.setSource({ state: 'restarting', behind: 0, commits: [], canUpdate: false, message: `Versione nuova pronta (${r.to}): riavvio…` });
      setTimeout(() => this.d.relaunch?.(), 800);
      return this.st;
    }
    const st = await this.read();
    if (!st.candidate) return this.setSource({ state: 'done', behind: 0, commits: [], canUpdate: false, message: 'Hai già l’ultima versione.' });
    this.setSource({ state: 'updating', message: 'Preparo la versione nuova…' });
    this.promoting = true;
    this.spawnPromote(repo, {
      ok: version => this.setSource({ state: 'restarting', behind: 0, commits: [], canUpdate: false, message: `Versione ${version ?? 'nuova'} pronta: riavvio…` }),
      failed: why => this.setSource({ state: 'error', canUpdate: false, message: why }),
    });
    return this.st;
  }

  /** A folder inside the code folder or one of its git worktrees (an Orchestrator's chat on the app's code). */
  async inRepo(dir: string): Promise<boolean> {
    const repo = this.repo();
    if (!repo || !path.isAbsolute(dir)) return false;
    if (samePath(dir, repo)) return true;
    const out = await git(repo, ['worktree', 'list', '--porcelain']).catch(() => '');
    return out.split('\n').filter(l => l.startsWith('worktree ')).some(l => samePath(dir, l.slice(9).trim()));
  }

  dismissLaunch(): AppSourceState {
    this.st = { ...this.st, launch: null };
    this.d.emit(this.st);
    return this.st;
  }

  private push(): void {
    this.st = { ...this.st, promote: this.promoteRun ? { ...this.promoteRun } : null };
    this.d.emit(this.st);
  }

  private detectLaunch(): LaunchNotice | null {
    if (!this.d.stable) return null;
    const file = path.join(this.d.userData, SEEN);
    const old = path.join(this.d.userData, OLD_SEEN);
    const seen = readJson<Seen>(file) ?? readJson<Seen>(old);
    const rel = readJson<Partial<ReleaseState>>(path.join(this.d.releasesBase, 'current.json')) ?? {};
    const result = readJson<LaunchResult>(path.join(this.d.releasesBase, 'launch-result.json'));
    const now = Date.now();
    const launch = launchOutcome({ running: this.d.running, stable: true, state: { current: rel.current ?? null, previous: rel.previous ?? null, bad: Array.isArray(rel.bad) ? rel.bad.map(String) : [], history: Array.isArray(rel.history) ? rel.history : [] }, result, seen, now });
    try {
      fs.writeFileSync(file, JSON.stringify(nextSeen(this.d.running, launch, seen, now)));
      if (fs.existsSync(old)) fs.rmSync(old, { force: true });
    } catch (e) { log.warn('update', `${SEEN} not written`, { cause: errText(e), hint: 'userData not writable: the restart notice may show again' }); }
    if (launch) log.info('update', 'start outcome', { data: { ...launch } });
    return launch;
  }
}

const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() || path.resolve(a).toLowerCase().startsWith(`${path.resolve(b).toLowerCase()}${path.sep}`);

// what the launcher, the tests and this run set themselves; the user's own SB_* (SB_USER_DATA, SB_CLAUDE_PATH, SB_BRAIN,
// SB_MCP_PORT…) stay, or the restarted app would open another userData or miss a CLI (security review 2026-10-12)
const RUN_VARS = /^(SB_RELEASE|SB_RELEASE_ID|SB_ENGINE_CLAUDE|SB_TEST|SB_HIDDEN|SB_DEMO|SB_DEMO_FREEZE|SB_UPDATE_.*|SB_LIVE|ELECTRON_RUN_AS_NODE)$/i;
/** The environment for pull.mjs, release.mjs and the launcher: without the variables this run was started with. */
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
