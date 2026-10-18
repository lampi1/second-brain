// Brings a developer's checkout up to date with GitHub ("aggiornati", ADR 0074): fetch the remote's main, fast-forward
// the local main (never a merge, rebase, reset or push: local commits stay and stop the update), reinstall the pinned
// dependencies when the lockfile changed (npm ci, install scripts off by .npmrc, then the Electron binary) and build.
// It never promotes, restarts or touches the stable release: "Aggiorna" (the user's click) does that.
// Used by `npm run pull`, by the app's Orchestrator through the app_update_code tool (main/improve/service.ts), and
// by test/unit/pull.test.ts (pullPlan, changedDeps).
//   node scripts/pull.mjs [--json] [--remote origin] [--no-build]
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEP_FILES = ['package.json', 'package-lock.json', '.npmrc'];

/** What to do from what git says; every refusal is in Italian, for the user, with the way out. */
export function pullPlan(o) {
  if (o.branch !== 'main') return { ok: false, why: `La cartella del codice è sul ramo «${o.branch || '?'}»: torna su main (git switch main), poi aggiorna.` };
  if (o.dirty) return { ok: false, why: 'Ci sono modifiche non salvate in un commit: fai commit o mettile da parte (git stash), poi aggiorna.' };
  if (o.behind === 0) return { ok: true, upToDate: true, why: o.ahead > 0 ? `Già aggiornata (main ha ${o.ahead} commit locali non su GitHub).` : 'Già aggiornata: nessuna novità su GitHub.' };
  if (o.ahead > 0) return { ok: false, why: `main ha ${o.ahead} commit locali che GitHub non ha e GitHub ne ha ${o.behind} nuovi: unisci a mano (git pull), l’aggiornamento automatico non mescola il tuo lavoro.` };
  return { ok: true, upToDate: false, why: '' };
}

/** Did the update touch the files npm ci depends on? */
export function changedDeps(files) {
  return files.some(f => DEP_FILES.includes(f.replace(/\\/g, '/')));
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const remote = args.includes('--remote') ? args[args.indexOf('--remote') + 1] : 'origin';
  if (!/^[\w.-]+$/.test(remote ?? '')) throw new Error('invalid remote name');
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  // core.fsmonitor off: a hook set in .git/config never runs from here (same rule as main/improve/service.ts)
  const git = (...a) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', repo, ...a], { encoding: 'utf8', windowsHide: true }).trim();
  const npm = a => execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', a, { cwd: repo, stdio: json ? ['ignore', 'ignore', 'inherit'] : 'inherit', shell: process.platform === 'win32', windowsHide: true });
  const out = r => { if (json) console.log(JSON.stringify(r)); else console.log(r.message); if (!r.ok) process.exitCode = 1; };

  const branch = git('branch', '--show-current');
  const dirty = git('status', '--porcelain', '--untracked-files=no') !== '';
  if (branch !== 'main' || dirty) { out({ ok: false, message: pullPlan({ branch, dirty, ahead: 0, behind: 0 }).why }); return; }
  git('fetch', '--no-tags', '--quiet', remote, '+refs/heads/main:refs/remotes/' + remote + '/main');
  const upstream = `refs/remotes/${remote}/main`;
  const [ahead, behind] = git('rev-list', '--left-right', '--count', `HEAD...${upstream}`).split(/\s+/).map(Number);
  const plan = pullPlan({ branch, dirty, ahead, behind });
  const from = git('rev-parse', '--short', 'HEAD');
  if (!plan.ok || plan.upToDate) { out({ ok: plan.ok, upToDate: !!plan.upToDate, from, to: from, commits: [], message: plan.why }); return; }

  const commits = git('log', '--format=%h %s', '--max-count=20', `HEAD..${upstream}`).split('\n').filter(Boolean);
  const files = git('diff', '--name-only', `HEAD..${upstream}`).split('\n').filter(Boolean);
  git('merge', '--ff-only', '--quiet', upstream);
  const to = git('rev-parse', '--short', 'HEAD');
  const deps = changedDeps(files);
  if (deps) {
    if (!json) console.log('dipendenze cambiate: npm ci …');
    npm(['ci']);
    execFileSync(process.execPath, [path.join(repo, 'node_modules', 'electron', 'install.js')], { cwd: repo, stdio: json ? ['ignore', 'ignore', 'inherit'] : 'inherit', windowsHide: true });
  }
  const build = !args.includes('--no-build');
  if (build) {
    if (!json) console.log('build …');
    execFileSync(process.execPath, [path.join(repo, 'scripts', 'build.mjs')], { cwd: repo, stdio: json ? ['ignore', 'ignore', 'inherit'] : 'inherit', windowsHide: true });
  }
  out({ ok: true, upToDate: false, from, to, commits, behind, depsReinstalled: deps, built: build,
    message: `Aggiornata da ${from} a ${to} (${behind} commit${deps ? ', dipendenze reinstallate' : ''}${build ? ', build fatta' : ''}). Versione stabile: premi «Aggiorna» in «Migliora l'app». Versione di sviluppo: riavviala (npm start).` });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { main(); } catch (e) {
    const message = `Aggiornamento non riuscito: ${String(e instanceof Error ? e.message : e).split('\n')[0].slice(0, 300)}`;
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, message })); else console.error(message);
    process.exitCode = 1;
  }
}
