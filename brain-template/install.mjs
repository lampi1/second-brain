#!/usr/bin/env node
// install: creates a new, empty brain from this template on day one: asks a few questions (name, folder, repos,
// Claude and/or Cursor), copies the template filling the placeholders, writes the owner's me.md, starts the brain's
// local git and, only after an explicit yes, wires it into the user's Claude Code / Cursor config (with backups).
// Why: the brain is data, the method is product; a colleague gets the same structure empty and fills it by use.
// Used by: a person installing second-brain (README "Use it with your agents"), and by the product's own install test.
//
// Usage: node brain-template/install.mjs                         (guided, asks everything)
//        node brain-template/install.mjs --yes --name "Mario Rossi" --dir D:/brain
//             [--repos <dir>] [--harness claude,cursor] [--role "<one line>"] [--lang italiano] [--devops-org <org>]
//             [--user-config]   (also wire ~/.claude and ~/.cursor; without it the steps are only printed)
//             [--home <dir>]    (tests: a fake home)
// Never overwrites a non-empty folder; never touches user config without --user-config or a "s" answer.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import os from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const has = n => argv.includes(n);
const HOME = resolve(opt('--home') ?? os.homedir());
const win = process.platform === 'win32';
const fwd = p => p.split(sep).join('/').replace(/\\/g, '/');

// ---- answers -----------------------------------------------------------------------------------------------------
const rl = has('--yes') ? null : createInterface({ input: process.stdin, output: process.stdout });
async function ask(q, def) {
  if (!rl) return def;
  const a = (await rl.question(`${q}${def ? ` [${def}]` : ''}: `)).trim();
  return a || def;
}
// The name lands inside JS strings and JSON of the tools: a straight apostrophe becomes a typographic one, and
// characters that would break code (" \ ` $ { } < >) are refused.
const name = (opt('--name') ?? await ask('Il tuo nome (come vuoi che gli agenti ti chiamino)', ''))?.trim().replace(/'/g, '’');
if (!name) { console.error('install: serve un nome (--name)'); process.exit(1); }
if (/["\\`${}<>]/.test(name)) { console.error('install: il nome non può contenere " \\ ` $ { } < >'); process.exit(1); }
const dir = resolve(opt('--dir') ?? await ask('Cartella del cervello', join(HOME, 'brain')));
const repos = resolve(opt('--repos') ?? await ask('Cartella dei tuoi repository', join(HOME, 'source', 'repos')));
const harness = (opt('--harness') ?? await ask('Harness: claude, cursor o claude,cursor', 'claude')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const role = opt('--role') ?? await ask('Il tuo ruolo in una riga (facoltativo)', 'developer');
const lang = opt('--lang') ?? await ask('Lingua in chat', 'italiano');
const org = opt('--devops-org') ?? await ask('Organizzazione Azure DevOps (facoltativo, vuoto se non la usi)', '');
const project = opt('--devops-project') ?? (org ? await ask('Progetto Azure DevOps dei test (facoltativo)', '') : '');
if (harness.some(h => !['claude', 'cursor'].includes(h))) { console.error('install: --harness accetta claude e/o cursor'); process.exit(1); }
// the folder name is also used inside the tools' regexes: letters, digits, spaces, dot, dash and underscore only
if (!/^[\p{L}\p{N} ._-]+$/u.test(basename(dir))) { console.error(`install: il nome della cartella "${basename(dir)}" può avere solo lettere, numeri, spazi, . _ -`); process.exit(1); }
if (existsSync(dir) && readdirSync(dir).length) { console.error(`install: ${dir} esiste e non è vuota: scegli un'altra cartella`); process.exit(1); }

const B = fwd(dir), R = fwd(repos), H = fwd(HOME);
const toWin = p => p.replace(/\//g, '\\');
const V = {
  OWNER: name.trim(), BRAIN_NAME: basename(dir), TODAY: new Date().toISOString().slice(0, 10),
  BRAIN: B, BRAIN_WIN: toWin(B), BRAIN_JS: toWin(B).replace(/\\/g, '\\\\'), BRAIN_RE: B.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'),
  REPOS: R, REPOS_WIN: toWin(R), REPOS_JS: toWin(R).replace(/\\/g, '\\\\'),
  HOME: H, HOME_WIN: toWin(H), HOME_JS: toWin(H).replace(/\\/g, '\\\\'),
  DEVOPS_ORG: org?.trim() || 'your-org', DEVOPS_PROJECT: project?.trim() || 'your-project', ROLE: role?.trim() || 'developer', LANG: lang,
  OS: win ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux', SHELL: win ? 'PowerShell' : 'bash',
  HARNESSES: harness.map(h => h === 'claude' ? 'Claude Code' : 'Cursor').join(' + '),
};
// In JavaScript the values land inside '...', "..." and `...` strings and regex literals: quotes, backticks and $ are
// escaped there (a folder like "D'Amico" must not break the tools); BRAIN_RE is already a regex source.
const jsSafe = (k, v) => k === 'BRAIN_RE' ? v.replace(/['"`]/g, '\\$&') : v.replace(/['"`$]/g, '\\$&');
export const render = (s, js = false) => s.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in V ? (js ? jsSafe(k, V[k]) : V[k]) : m));

// ---- copy the template -------------------------------------------------------------------------------------------
const SKIP = new Set(['install.mjs', 'README.md', 'me.template.md']);
const isText = buf => !buf.subarray(0, 8000).includes(0);
let files = 0;
function copy(from, to) {
  for (const n of readdirSync(from)) {
    const a = join(from, n);
    if (from === HERE && SKIP.has(n)) continue;
    const b = join(to, render(n));
    if (statSync(a).isDirectory()) { copy(a, b); continue; }
    mkdirSync(dirname(b), { recursive: true });
    const buf = readFileSync(a);
    if (isText(buf)) writeFileSync(b, render(buf.toString('utf8'), /\.(m?js|cjs)$/.test(n))); else copyFileSync(a, b);
    files++;
  }
}
copy(HERE, dir);
writeFileSync(join(dir, 'me.md'), render(readFileSync(join(HERE, 'me.template.md'), 'utf8')));
for (const d of ['journal/brief', 'playbooks', 'reviews']) mkdirSync(join(dir, d), { recursive: true });

try {
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'core.autocrlf', 'false']);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, '-c', 'user.name=' + V.OWNER, '-c', 'user.email=brain@localhost', 'commit', '-q', '-m', 'brain: day one (second-brain template)']);
} catch (e) { console.log(`git non inizializzato (${e.message.split('\n')[0]}): il cervello funziona lo stesso, ma senza storia`); }

// ---- user-level wiring (only with an explicit yes) ---------------------------------------------------------------
const steps = [];
const backup = p => { if (existsSync(p)) copyFileSync(p, `${p}.bak-${Date.now()}`); };
function mergeHooks(target, add) {
  // Claude: { hooks: { Event: [ { matcher?, hooks: [ {command} ] } ] } }; Cursor: { version, hooks: { event: [ {command} ] } }
  const cur = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};
  cur.hooks ??= {};
  const cmds = JSON.stringify(cur.hooks);
  for (const [ev, list] of Object.entries(add.hooks)) {
    cur.hooks[ev] ??= [];
    for (const entry of list) {
      const own = entry.hooks ? entry.hooks.map(h => h.command) : [entry.command];
      if (own.every(c => cmds.includes(JSON.stringify(c).slice(1, -1)))) continue;
      cur.hooks[ev].push(entry);
    }
  }
  for (const [k, v] of Object.entries(add)) if (k !== 'hooks' && !(k in cur)) cur[k] = v;
  return cur;
}
const plan = [];
if (harness.includes('claude')) {
  const C = join(HOME, '.claude');
  plan.push([`~/.claude/CLAUDE.md: aggiungere "@${B}/me.md"`, () => {
    const p = join(C, 'CLAUDE.md'); mkdirSync(C, { recursive: true }); backup(p);
    const t = existsSync(p) ? readFileSync(p, 'utf8') : '';
    if (!t.includes(`@${B}/me.md`)) writeFileSync(p, `${t}${t && !t.endsWith('\n') ? '\n' : ''}\n# ${V.BRAIN_NAME}: ${V.OWNER}'s brain\n- Durable knowledge lives in ${B} (AGENTS.md), not in Claude's private memory.\n\n@${B}/me.md\n`);
  }]);
  plan.push([`~/.claude/output-styles/${V.OWNER}.md e regia.md, skill ${V.BRAIN_NAME} ed explain in ~/.claude/skills`, () => {
    const os_ = join(C, 'output-styles'); mkdirSync(os_, { recursive: true });
    for (const [from, to] of [['owner.md', `${V.OWNER}.md`], ['regia.md', 'regia.md']]) {
      const p = join(os_, to); backup(p);
      writeFileSync(p, readFileSync(join(dir, 'harness', 'claude', 'output-styles', from), 'utf8'));
    }
    for (const s of readdirSync(join(dir, 'harness', 'claude', 'skills'))) {
      const to = join(C, 'skills', s); if (existsSync(to)) continue;
      mkdirSync(to, { recursive: true }); copyFileSync(join(dir, 'harness', 'claude', 'skills', s, 'SKILL.md'), join(to, 'SKILL.md'));
    }
  }]);
  plan.push(['~/.claude/settings.json: hook del cervello (copia di sicurezza prima)', () => {
    const p = join(C, 'settings.json'); backup(p);
    writeFileSync(p, JSON.stringify(mergeHooks(p, JSON.parse(readFileSync(join(dir, 'harness', 'claude', 'settings.hooks.json'), 'utf8'))), null, 2));
  }]);
}
if (harness.includes('cursor')) {
  plan.push(['~/.cursor/hooks.json: hook del cervello (copia di sicurezza prima)', () => {
    const p = join(HOME, '.cursor', 'hooks.json'); mkdirSync(dirname(p), { recursive: true }); backup(p);
    const merged = mergeHooks(p, JSON.parse(readFileSync(join(dir, 'harness', 'cursor', 'hooks.json'), 'utf8')));
    merged.version ??= 1; writeFileSync(p, JSON.stringify(merged, null, 2));
  }]);
}
let apply = has('--user-config');
if (!apply && rl && plan.length) {
  console.log('\nCollegamento a Claude Code / Cursor (file nella tua home, con copia di sicurezza):');
  for (const [what] of plan) console.log(`- ${what}`);
  apply = /^s/i.test(await ask('Lo faccio adesso? (s/n)', 'n'));
}
rl?.close();
if (apply) for (const [what, run] of plan) { run(); steps.push(`fatto: ${what}`); }
else for (const [what] of plan) steps.push(`da fare (rilancia con --user-config, o a mano): ${what}`);
if (harness.includes('cursor')) steps.push(`Cursor: puntatori degli agenti con "node ${B}/harness/cursor/sync-agents.mjs"`);

console.log(`\nCervello creato in ${dir} (${files} file, nome "${V.BRAIN_NAME}", proprietario ${V.OWNER}).`);
for (const s of steps) console.log(`- ${s}`);
console.log(`Prova: apri una chat in ${dir} e scrivi "cosa devo fare oggi?".`);
