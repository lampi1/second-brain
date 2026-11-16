// The Claude adapter (ADR 0060): the brain's skills, agents, output styles and hooks packed as a Claude Code plugin
// folder the app generates in its userData (`claude-plugin/second-brain/`) and passes with `--plugin-dir`, plus the
// domains' AGENTS.md as one file for `--append-system-prompt-file` (a plugin's own CLAUDE.md is not loaded). The user's
// ~/.claude is never read or written here (repo rule 6). Off by default (Settings): today the user's ~/.claude already
// loads the same rules, twice would double them. Plugin layout from code.claude.com/docs/en/plugins (16/10):
// `.claude-plugin/plugin.json` {name}, `skills/<n>/SKILL.md`, `agents/*.md`, `output-styles/*.md`, `hooks/hooks.json`
// ({"hooks": …}); components show namespaced `second-brain:<name>`. UNVERIFIED on a real run: both flags with this
// Claude Code version, hooks.json's `${CLAUDE_PLUGIN_ROOT}`, output styles from a plugin. The folder is rebuilt only
// when the brain's files changed (a signature of paths and contents: a same-bytes rewrite keeps the name, so the prompt
// cache survives), into a fresh copy swapped in at once, so a chat starting meanwhile never sees half a folder. A fresh
// brain (rules.appRules, ADR 0072) holds no agents or skills of the product: the plugin takes them from the app-owned copy (rules/tools.ts APP_PLUGIN_PARTS) after the brain's own,
// so a file the owner wrote with the same name wins. Used by engines/sessions.ts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { errText, log } from '../../log';
import { enabled, installHooks, productSignature, stopInProcess } from '../../rules/delivery';
import type { LaunchFacts } from '../../rules/types';
import { productInstructions } from '../../rules/instructions';
import { configOf } from '../../rules/storage';
import { APP_PLUGIN_PARTS, ensureTools, isProduct, templateHooks } from '../../rules/tools';
import { memoryInstructions } from '../../rules/new-brain';
import { isDir, launchRules, readText, resolvePlaceholders, instructionsOf, type BrainDomain } from './domains';

export const PLUGIN_NAME = 'second-brain';
/** how the product hooks are delivered (in process, Stop too unless the brain commits at the stop: ADR 0099, 0317),
 *  and which template hooks the plugin keeps (rules/tools.ts REPLACED_HOOKS): part of the plugin's signature */
const HOOKS_LAYOUT = 'hooks:in-process-v2';
/** what is copied from each domain's .claude folder into the plugin, and as which plugin folder */
const PARTS: readonly { from: string; to: string }[] = [
  // the brain's one copy of its skills (#361, skills/layout.ts); .claude/skills links to it, or is an older brain's
  { from: '.agents/skills', to: 'skills' },
  { from: '.claude/skills', to: 'skills' },
  { from: '.claude/agents', to: 'agents' },
  { from: '.claude/output-styles', to: 'output-styles' },
  { from: '.claude/hooks', to: 'hooks' },
];
const TEXT = /\.(md|json|txt|ya?ml|toml)$/i;
const MAX_FILE = 2_000_000;

export interface ClaudeLaunch { args: string[]; pluginDir: string | null; rulesFile: string | null;
  /** a product brain: the session answers the product hooks in process (ClaudeSession initHooks) */
  productHooks?: ProductHooks }
/** stop = Stop is answered in process too (rules/delivery.ts stopInProcess): the plugin's hooks.json has no runner then */
export interface ProductHooks { root: string; state: string; launch: LaunchFacts; stop?: true }

/** Legacy brains fail open with a warning. Migrated brains fail closed if product hooks cannot be delivered. */
/** `skills: false` = a role chat: the brain's skills stay out (its launch's own plugin carries the ones it was given). */
/** `cwd` = the chat's folder: the template's Stop hooks it runs by itself are left out of the plugin (ownStopHooks). */
export function claudeLaunch(userData: string, input?: { domains: BrainDomain[]; on?: boolean }, opts: { skills?: boolean; cwd?: string } = {}): ClaudeLaunch {
  const none: ClaudeLaunch = { args: [], pluginDir: null, rulesFile: null };
  const rules = input ? null : launchRules();
  const domains = input?.domains ?? rules?.domains ?? [];
  const root = domains[0]?.root;
  // A product brain (made by the app, no ~/.claude wiring to duplicate) is delivered unless it opted out in
  // brain.json rules.claudeLaunch; legacy brains follow the app-wide switch, off by default.
  const product = !!root && isProduct(root);
  const on = input?.on ?? (rules?.claude || (product && configOf(root!).claudeLaunch)) ?? false;
  if (!on || !domains.length || !root) return none;
  try {
    const base = path.join(userData, 'claude-plugin');
    const tools = product ? ensureTools(root) : null;
    const noSkills = opts.skills === false;
    const files = collect(domains, tools && configOf(root).appRules ? tools : null).filter(f => !noSkills || !f.rel.split(/[\\/]/)[0]!.startsWith('skills'));
    const productText = productInstructions(root, false, tools ? tools.replace(/\\/g, '/') : undefined);
    let instructions = productText === null ? instructionsOf(domains) : [productText, instructionsOf(domains.slice(1))].filter(Boolean).join('\n\n');
    // HOOKS_LAYOUT: a plugin built before the in-process hooks still runs every event as a process: rebuilt once
    const ownStop = product ? ownStopHooks(opts.cwd, root) : [];
    const sig = signature(files, (instructions ?? '') + productSignature(root) + HOOKS_LAYOUT + ownStop.join('|'));
    // A running chat keeps its exact product/root binding when another brain is selected or a release changes.
    const dir = path.join(base, product ? `${PLUGIN_NAME}-${sig}` : `${PLUGIN_NAME}${noSkills ? '-roles' : ''}`);
    const rulesFile = product ? path.join(dir, 'rules.md') : path.join(base, 'rules.md');
    if (product) instructions += '\n\n' + memoryInstructions(path.join(dir, 'product-rules'), root, tools ?? undefined);
    if (readText(path.join(dir, '.signature')) !== sig) build(base, dir, files, domains, sig, tools, ownStop);
    if (instructions) { if (readText(rulesFile) !== instructions) fs.writeFileSync(rulesFile, instructions); }
    else fs.rmSync(rulesFile, { force: true });
    const hasParts = files.length > 0 || product;
    const fwd = tools?.replace(/\\/g, '/');
    return {
      args: [...(hasParts ? ['--plugin-dir', dir] : []), ...(instructions ? ['--append-system-prompt-file', rulesFile] : [])],
      pluginDir: hasParts ? dir : null, rulesFile: instructions ? rulesFile : null,
      ...(product && enabled(root) ? { productHooks: { root, state: path.join(base, 'rule-state'), launch: fwd ? { tools: fwd, correctionHook: true } : {}, ...(stopInProcess(root) ? { stop: true as const } : {}) } } : {}),
    };
  } catch (e) {
    if (product) throw e; // a migrated brain must never silently lose its safety hooks
    log.warn('brain', 'the brain\'s rules could not be packed for Claude', { cause: errText(e), hint: 'the chat starts with the user\'s own ~/.claude only; check the userData folder is writable', data: { userData } });
    return none;
  }
}

/** The hook files a chat in the brain's own folder runs at the stop by itself: Claude Code reads that folder's
 * .claude/settings.json and settings.local.json (read here, never written), and an older brain wires its own copy of a
 * template hook there. The plugin's copy would do the same work a second time at every turn's end (measured on the
 * owner's brain: `runbook-reminder.mjs` twice, ~2 s each, ADR 0317). A chat in any other folder has only the plugin's.
 * Only a copy that can run counts: wired to this folder's own file (`$CLAUDE_PROJECT_DIR`, a relative path or the
 * folder itself), the file there, and every file it imports there too (a migrated brain keeps its hooks and loses
 * the ops/tools they import: its copy fails at load, and the plugin's is the one that works). */
function ownStopHooks(cwd: string | undefined, root: string): string[] {
  if (!cwd || !samePath(cwd, root)) return [];
  const names = new Set<string>();
  for (const file of ['settings.json', 'settings.local.json']) {
    try {
      const own = JSON.parse(fs.readFileSync(path.join(root, '.claude', file), 'utf8').replace(/^﻿/, '')) as { hooks?: { Stop?: { hooks?: { command?: unknown }[] }[] } };
      for (const g of own.hooks?.Stop ?? []) for (const h of g.hooks ?? []) {
        if (typeof h.command !== 'string') continue;
        for (const word of h.command.matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)) {
          const at = /^(.*?)[\\/]?\.claude[\\/]hooks[\\/]([\w.-]+\.mjs)$/.exec(word[1] ?? word[2] ?? word[3] ?? '');
          if (!at) continue;
          const from = at[1]!, name = at[2]!;
          const here = from === '' || from === '.' || /^(\$\{?CLAUDE_PROJECT_DIR\}?|%CLAUDE_PROJECT_DIR%)$/.test(from) || (path.isAbsolute(from) && samePath(from, root));
          if (here && runs(path.join(root, '.claude', 'hooks', name))) names.add(name);
        }
      }
    } catch { /* no such file, or not JSON: the folder runs nothing of its own */ }
  }
  return [...names].sort();
}
/** A hook file that is there with every file it imports by a relative path (one level: what fails at its load). */
function runs(file: string): boolean {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return [...text.matchAll(/^\s*import\s[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm)].every(m => fs.existsSync(path.resolve(path.dirname(file), m[1]!)));
  } catch { return false; }
}
const real = (p: string): string => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const samePath = (a: string, b: string): boolean => process.platform === 'win32' ? real(a).toLowerCase() === real(b).toLowerCase() : real(a) === real(b);

interface Src { abs: string; rel: string; size: number; mtime: number; domain: string }

/** Every file the plugin takes from the domains, then the app's own parts (`app`, the tools copy of a fresh brain): a
 * later source never overwrites an earlier one's file. */
function collect(domains: readonly BrainDomain[], app: string | null = null): Src[] {
  const out: Src[] = [];
  const seen = new Set<string>();
  const add = (abs: string, rel: string, domain: string): void => {
    const key = rel.toLowerCase();
    if (seen.has(key)) return;
    let st: fs.Stats;
    try { st = fs.statSync(abs); } catch { return; }
    if (!st.isFile() || st.size > MAX_FILE) return;
    seen.add(key);
    out.push({ abs, rel, size: st.size, mtime: st.mtimeMs, domain });
  };
  for (const d of domains) {
    for (const p of PARTS) walk(path.join(d.root, p.from), (abs, rel) => add(abs, path.join(p.to, rel), d.name));
  }
  if (app) for (const p of APP_PLUGIN_PARTS) walk(path.join(app, p.from), (abs, rel) => add(abs, path.join(p.to, rel), 'app'));
  return out;
}

function walk(dir: string, fn: (abs: string, rel: string) => void, rel = '', depth = 0): void {
  if (depth > 4 || !isDir(dir)) return;
  let names: fs.Dirent[];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const n of names) {
    if (n.name.startsWith('.') || n.isSymbolicLink()) continue;
    const abs = path.join(dir, n.name), r = path.join(rel, n.name);
    if (n.isDirectory()) walk(abs, fn, r, depth + 1);
    else if (n.isFile()) fn(abs, r);
  }
}

/** From the files' content, not their times: the folder's name is in every chat's system prompt (memoryInstructions), so
 * a rewrite with the same bytes (the tools copy re-rendered, a checkout, a maintenance job) must not change it and throw
 * away every chat's prompt cache. A file that cannot be read falls back to its size and time. */
function signature(files: readonly Src[], instructions: string | null): string {
  const h = crypto.createHash('sha256');
  for (const f of files) {
    h.update(`${f.rel}|${f.domain}|`);
    try { h.update(fs.readFileSync(f.abs)); } catch { h.update(`${f.size}|${f.mtime}`); }
    h.update('\n');
  }
  h.update(instructions ?? '');
  return h.digest('hex').slice(0, 24);
}

/** Writes the plugin into a fresh folder, then swaps it in (rename), so a chat starting meanwhile sees the old or the new. */
function build(base: string, dir: string, files: readonly Src[], domains: readonly BrainDomain[], sig: string, tools: string | null, ownStop: readonly string[] = []): void {
  fs.mkdirSync(base, { recursive: true });
  const tmp = path.join(base, `.${PLUGIN_NAME}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: PLUGIN_NAME, description: 'Le regole del brain (generato da second-brain: non modificare qui)', version: '0.0.0' }, null, 2)}\n`);
  for (const f of files) {
    const to = path.join(tmp, f.rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (TEXT.test(f.rel)) fs.writeFileSync(to, resolvePlaceholders(fs.readFileSync(f.abs, 'utf8'), domains));
    else fs.copyFileSync(f.abs, to);
  }
  const root = domains[0]!.root;
  const fwdTools = tools?.replace(/\\/g, '/');
  // the session answers the product hooks in process (claudeLaunch productHooks); the runner in hooks.json serves only
  // the Stop of a brain that commits its memory there (stopInProcess)
  installHooks(tmp, root, path.join(base, 'rule-state'), undefined, fwdTools ? { tools: fwdTools, correctionHook: true } : {}, stopInProcess(root) ? [] : ['Stop']);
  if (fwdTools && enabled(root)) addHooks(tmp, templateHooks(root, fwdTools, ownStop));
  fs.writeFileSync(path.join(tmp, '.signature'), sig);
  const old = `${dir}.old-${Date.now()}`;
  if (fs.existsSync(dir)) fs.renameSync(dir, old);
  fs.renameSync(tmp, dir);
  // the old copy may be held open by a running chat on Windows: removed when it can be, else at the next build
  fs.rm(old, { recursive: true, force: true }, () => {});
  for (const n of fs.readdirSync(base)) if (n.startsWith(`${PLUGIN_NAME}.old-`) && path.join(base, n) !== old) fs.rm(path.join(base, n), { recursive: true, force: true }, () => {});
  log.info('brain', 'claude plugin rebuilt from the brain', { data: { files: files.length, domains: domains.map(d => d.name) } });
}

/** Appends the template's kept hooks (rules/tools.ts templateHooks) after the product runner of each event. */
function addHooks(plugin: string, add: Record<string, unknown[]>): void {
  const file = path.join(plugin, 'hooks', 'hooks.json');
  const cur = JSON.parse(fs.readFileSync(file, 'utf8')) as { hooks: Record<string, unknown[]> };
  for (const [event, groups] of Object.entries(add)) cur.hooks[event] = [...(cur.hooks[event] ?? []), ...groups];
  fs.writeFileSync(file, JSON.stringify(cur));
}
