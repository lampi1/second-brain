// Small synchronous context packs for chat-prompt.mjs --thread. Read exactly one now.md bullet,
// stat its named local references and inspect their git metadata; never read referenced file contents.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const MAX = 12000; // characters, including the explicit truncation notice
const ROOT = '{{BRAIN_JS}}';
const REF_MAX = 24;
const forbidden = value => String(value).split(/[\\/]/).some(part =>
  /^(?:\.env(?:\..*)?|\.brain\.env|\.ssh|\.aws|\.azure|\.gnupg|credentials(?:\..*)?|auth\.json|secrets?(?:\..*)?|.*\.pem|.*\.key)$/i.test(part));
const cleanRef = value => String(value).trim().replace(/^<|>$/g, '').replace(/:\d+(?::\d+)?$/, '');
const localRef = value => !/^[a-z][a-z\d+.-]*:\/\//i.test(value) && !/^(?:\\\\|\/\/)/.test(value)
  && (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^(?:\.{1,2}[\\/]|[\w.-]+[\\/])/.test(value) || /^[\w.-]+\.\w{1,8}$/.test(value) || /^\.[\w.-]+$/.test(value));

/** Unique local path strings named in code spans, Markdown links or bare absolute paths (at most 24).
 * URLs and branch: labels are not file references. Relative references are resolved by pack's root. */
export function refsOf(text) {
  const refs = new Set();
  const add = value => {
    const ref = cleanRef(value);
    if (ref && localRef(ref) && refs.size < REF_MAX) refs.add(ref);
  };
  const source = String(text ?? '');
  for (const m of source.matchAll(/`([^`\r\n]+)`|\[[^\]\r\n]*\]\(([^)\r\n]+)\)/g)) add(m[1] ?? m[2]);
  const bare = source.replace(/`[^`\r\n]*`|\[[^\]\r\n]*\]\([^)\r\n]*\)/g, ' ');
  for (const m of bare.matchAll(/(?:^|[\s(])([A-Za-z]:[\\/][^\s`<>"'()·]+|\/(?!\/)[^\s`<>"'()·]+)/g)) add(m[1].replace(/[.,;]$/, ''));
  return [...refs];
}

const git = (cwd, args) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  return r.status === 0 ? { ok: true, text: r.stdout.trim() } : { ok: false, text: r.error?.message ?? r.stderr?.trim() ?? 'git non disponibile' };
};

/** Only git metadata, without status/diff or a recursive file scan. Errors remain explicit to callers. */
export function gitState(directory) {
  const cwd = path.resolve(directory);
  const meta = git(cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir']);
  if (!meta.ok) return { ok: false, cwd, error: meta.text };
  const [root, gitDir, commonDir] = meta.text.split(/\r?\n/);
  const branch = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const head = git(cwd, ['rev-parse', '--short', 'HEAD']);
  return { ok: true, root, branch: branch.ok ? branch.text : null, head: head.ok ? head.text : null,
    worktree: path.resolve(gitDir) !== path.resolve(commonDir) };
}

const fail = text => ({ ok: false, text });
const within = (file, root) => { const rel = path.relative(root, file); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };

/** The one matching now.md bullet plus on-disk facts. No match or several matches is an error;
 * footer:false is used by chat-prompt.mjs when embedding this pack in a new chat's prompt. */
export function pack({ match, root = ROOT, footer = true } = {}) {
  const words = String(match ?? '').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return fail('ctx: --match deve indicare le parole di un solo filo in now.md');
  const file = path.join(root, 'now.md'); let text;
  try {
    const realRoot = fs.realpathSync(root), realFile = fs.realpathSync(file);
    if (!within(realFile, realRoot)) return fail('ctx: now.md punta fuori dalla cartella brain');
    if (fs.statSync(realFile).size > 256 * 1024) return fail('ctx: now.md supera il limite di lettura (256 KiB)');
    text = fs.readFileSync(realFile, 'utf8');
  } catch (e) { return fail(`ctx: impossibile leggere now.md: ${e.message}`); }
  const hits = text.split(/\r?\n/).map((line, i) => ({ line, number: i + 1 }))
    .filter(({ line }) => line.startsWith('- ') && words.every(word => line.toLocaleLowerCase().includes(word)));
  if (hits.length !== 1) return fail(`ctx: il filtro "${match}" trova ${hits.length} righe in now.md; serve un solo filo`);
  const hit = hits[0], lines = [`Filo (now.md:${hit.number}):`, hit.line], repos = new Map();
  const refs = refsOf(hit.line);
  if (refs.length) lines.push('', 'Riferimenti locali verificati (solo metadati):');
  for (const ref of refs) {
    const resolved = path.resolve(root, ref);
    if (forbidden(resolved)) { lines.push(`- ${ref}: escluso (percorso riservato)`); continue; }
    let real, stat;
    try { real = fs.realpathSync(resolved); if (forbidden(real)) { lines.push(`- ${ref}: escluso (destinazione riservata)`); continue; } stat = fs.statSync(real); }
    catch (e) { lines.push(`- ${ref}: ${e.code === 'ENOENT' ? 'assente' : `non verificabile (${e.code ?? 'errore'})`}`); continue; }
    lines.push(`- ${ref}: ${stat.isDirectory() ? 'cartella presente' : stat.isFile() ? `file presente (${stat.size} byte)` : 'presente, tipo speciale'}`);
    if (!stat.isDirectory() && !stat.isFile()) continue;
    const state = gitState(stat.isDirectory() ? real : path.dirname(real));
    if (state.ok) repos.set(state.root, state);
    else lines.push(`  Git non verificabile: ${state.error.split(/\r?\n/)[0]}`);
  }
  if (repos.size) {
    lines.push('', 'Git verificato:');
    for (const state of repos.values()) lines.push(`- ${state.root}: branch ${state.branch ?? '(HEAD separato)'}; ${state.worktree ? 'worktree collegato' : 'checkout principale'}; HEAD ${state.head ?? '(nessun commit)'}`);
  }
  const branches = [...new Set([...hit.line.matchAll(/\b(?:branch|ramo)\s*[:=]\s*`?([\w][\w./-]*)/gi)].map(m => m[1]))].slice(0, REF_MAX);
  for (const branch of branches) {
    const found = [...repos.keys()].filter(repo => git(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).ok);
    lines.push(`- Branch ${branch}: ${found.length ? `presente in ${found.join(', ')}` : repos.size ? 'assente nei repo riferiti' : 'non verificabile (nessun repo locale riferito)'}`);
  }
  if (footer) lines.push('', 'Contesto limitato al filo e ai riferimenti nominati; contenuti dei file non letti.');
  let output = lines.join('\n');
  if (output.length > MAX) { const notice = '\n[ctx: contesto troncato al limite di caratteri]'; output = output.slice(0, MAX - notice.length) + notice; }
  return { ok: true, text: output };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2), value = flag => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1]; };
  const result = pack({ match: value('--match'), ...(value('--root') ? { root: value('--root') } : {}) });
  console.log(result.text); if (!result.ok) process.exitCode = 1;
}
