// setup-pc: gets a new PC ready to run second-brain with the user's brain domains (ADR 0059). It clones the app repo and
// the "everywhere" domains from the URLs given, writes config.json in the app's userData (brainRoot + the domains list,
// merged with what is there), runs `npm run setup` in the app folder, and finally PRINTS (never runs) the commands that
// create a private remote for a domain folder that has none. It never creates a GitHub repo, never adds a remote, never
// pushes: on the first run nothing leaves this PC (the first push of a new remote is the app's, which runs the publish guard
// on the whole history). A config.json that is not valid JSON stops the setup. A folder that exists is left as it is.
// At the end it reports the app repo's guard (ADR 0061: hooks active, deny list and e-mail config) and prints the
// optional guard config commands. Used by the user by hand on a new PC; the pure parts are unit-tested (test/unit/setup-pc.test.ts).
//   node scripts/setup-pc.mjs --app <url> --app-dir <dir> --domain <url>=<dir> [--domain ...] [--brain <dir>]
//                             [--user-data <dir>] [--dry-run] [--no-setup]
//   --user-data defaults to %APPDATA%/second-brain (the stable instance's userData); --dry-run prints the plan only.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OPTIONAL_CONFIG, guardStatus, statusLines } from './guard-lib.mjs';

/** A clone URL git cannot turn into a command or an option (same rule as src/main/brain/domains.ts remoteOk). */
export function urlOk(u) {
  return typeof u === 'string' && u.length > 0 && u.length <= 500 && !u.startsWith('-') && !/[\s\x00-\x1f]/.test(u) && !/^(ext|fd)::/i.test(u);
}

/** argv → plan; throws an Error with an Italian message on bad input. */
export function parseArgs(argv, env = process.env) {
  const out = { app: null, appDir: null, domains: [], brain: null, userData: null, dryRun: false, setup: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`manca il valore di ${a}`); return v; };
    if (a === '--app') out.app = val();
    else if (a === '--app-dir') out.appDir = path.resolve(val());
    else if (a === '--brain') out.brain = path.resolve(val());
    else if (a === '--user-data') out.userData = path.resolve(val());
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-setup') out.setup = false;
    else if (a === '--domain') {
      const v = val();
      const eq = v.lastIndexOf('=');
      if (eq <= 0 || eq === v.length - 1) throw new Error(`--domain vuole <url>=<cartella>, non "${v}"`);
      out.domains.push({ url: v.slice(0, eq), dir: path.resolve(v.slice(eq + 1)) });
    } else throw new Error(`opzione sconosciuta: ${a}`);
  }
  if (out.app && !urlOk(out.app)) throw new Error('URL dell\'app non valido');
  if (out.app && !out.appDir) throw new Error('--app vuole anche --app-dir');
  for (const d of out.domains) if (!urlOk(d.url)) throw new Error(`URL del dominio non valido per ${d.dir}`);
  out.userData ??= path.join(env.APPDATA ?? path.join(os.homedir(), '.config'), 'second-brain');
  return out;
}

/** config.json after setup: the existing keys kept, brainRoot set when given (or when none yet: the first domain), the
 *  domains list = old ∪ new (by resolved path, case-insensitive on Windows), the brainRoot itself never listed twice. */
export function mergeConfig(existing, { brain, domainDirs }, platform = process.platform) {
  const cfg = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {};
  const key = p => (platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  if (brain) cfg.brainRoot = brain;
  else if (typeof cfg.brainRoot !== 'string' && domainDirs.length) cfg.brainRoot = domainDirs[0];
  const seen = new Set(typeof cfg.brainRoot === 'string' ? [key(cfg.brainRoot)] : []);
  const list = [];
  for (const d of [...(Array.isArray(cfg.domains) ? cfg.domains.filter(x => typeof x === 'string' && path.isAbsolute(x)) : []), ...domainDirs]) {
    if (seen.has(key(d))) continue;
    seen.add(key(d)); list.push(d);
  }
  if (list.length) cfg.domains = list; else delete cfg.domains;
  return cfg;
}

const psq = s => `'${String(s).replace(/'/g, "''")}'`;

/** The commands (Windows PowerShell 5.1) that would give a domain folder its private remote. Printed, never run. */
export function remoteCommands(dir, name) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'brain';
  return [
    `gh repo create ${slug} --private --source ${psq(dir)} --remote origin`,
    `# poi in ${path.join(dir, 'domain.json')}: "scope": "everywhere", "remote": "origin"`,
    '# nessun push a mano: il primo invio lo fa l\'app, che col remote vuoto controlla tutta la storia prima di inviarla',
  ];
}

/** config.json as it is now: {} when there is none; an error when it exists but is not a JSON object (setup stops:
 *  rewriting it would lose the user's settings). */
export function readConfig(file) {
  if (!fs.existsSync(file)) return { ok: true, cfg: {} };
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { ok: false, error: `${file} non è un oggetto JSON` };
    return { ok: true, cfg };
  } catch (e) { return { ok: false, error: `${file} non è JSON valido (${e.message})` }; }
}

function git(args, cwd) { return spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }); }

function clone(url, dir, dryRun) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) { console.log(`= ${dir} esiste già: lo lascio com'è`); return true; }
  console.log(`+ git clone ${url} ${dir}`);
  if (dryRun) return true;
  const r = spawnSync('git', ['-c', 'protocol.ext.allow=never', 'clone', '--', url, dir], { stdio: 'inherit', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.status !== 0) { console.error(`✗ clone non riuscito: ${url} → ${dir}. Controlla l'URL e l'accesso (git login), poi rilancia.`); return false; }
  return true;
}

function domainName(dir) {
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'domain.json'), 'utf8').replace(/^﻿/, '')); if (typeof j.name === 'string' && j.name) return j.name; } catch { /* none */ }
  return path.basename(dir);
}

function main() {
  let plan;
  try { plan = parseArgs(process.argv.slice(2)); } catch (e) {
    console.error(`✗ ${e.message}\n  uso: node scripts/setup-pc.mjs --app <url> --app-dir <dir> --domain <url>=<dir> [--brain <dir>] [--user-data <dir>] [--dry-run] [--no-setup]`);
    process.exit(2);
  }
  // a config.json that does not parse stops everything before any clone: rewriting it would lose the user's settings
  const cfgFile = path.join(plan.userData, 'config.json');
  const existing = readConfig(cfgFile);
  if (!existing.ok) { console.error(`✗ ${existing.error}: sistemalo (o spostalo) a mano, poi rilancia. Nessuna modifica fatta.`); process.exit(1); }
  let ok = true;
  if (plan.app) ok = clone(plan.app, plan.appDir, plan.dryRun) && ok;
  for (const d of plan.domains) ok = clone(d.url, d.dir, plan.dryRun) && ok;
  if (!ok) process.exit(1);

  const cfg = mergeConfig(existing.cfg,{ brain: plan.brain, domainDirs: plan.domains.map(d => d.dir) });
  console.log(`+ ${cfgFile}: brainRoot ${cfg.brainRoot ?? '(nessuno)'}; domini ${(cfg.domains ?? []).length}`);
  if (!plan.dryRun) {
    fs.mkdirSync(plan.userData, { recursive: true });
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  }

  const appDir = plan.appDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (plan.setup) {
    console.log(`+ npm run setup (${appDir})`);
    if (!plan.dryRun) {
      // fixed arguments only: npm is a .cmd shim on Windows, so it needs the shell
      const r = spawnSync('npm', ['run', 'setup'], { cwd: appDir, stdio: 'inherit', shell: process.platform === 'win32' });
      if (r.status !== 0) { console.error('✗ npm run setup non riuscito: guarda l\'errore sopra, poi rilancia con --no-setup dopo averlo sistemato.'); process.exit(1); }
    }
  }

  const noRemote = [cfg.brainRoot, ...(cfg.domains ?? [])].filter(d => typeof d === 'string' && fs.existsSync(path.join(d, '.git')) && !git(['remote'], d).stdout?.trim());
  if (noRemote.length) {
    console.log('\nQueste cartelle non hanno un remote. Se vuoi sincronizzarne una su tutti i tuoi PC, i comandi (da lanciare tu, nessuno è stato eseguito):');
    for (const d of noRemote) { console.log(`\n# ${domainName(d)}`); for (const c of remoteCommands(d, domainName(d))) console.log(c); }
  }
  // the app repo's guard (ADR 0061): npm run setup turned the hooks on; the deny list and the e-mail are the user's
  if (!plan.dryRun && fs.existsSync(appDir)) {
    const gs = guardStatus(appDir);
    console.log('');
    for (const l of statusLines(gs)) console.log(l);
    if (gs.repo && (gs.deny === 'unset' || gs.email === 'unset')) {
      console.log('Facoltativi, da lanciare tu nella cartella dell\'app:');
      for (const l of OPTIONAL_CONFIG) console.log(`  ${l}`);
    }
  }
  console.log('\n✓ Fatto. Nessun repository creato, nessun push.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
