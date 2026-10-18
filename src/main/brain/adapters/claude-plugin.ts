// The Claude adapter (ADR 0060): the brain's skills, agents, output styles and hooks packed as a Claude Code plugin
// folder the app generates in its userData (`claude-plugin/second-brain/`) and passes with `--plugin-dir`, plus the
// domains' AGENTS.md as one file for `--append-system-prompt-file` (a plugin's own CLAUDE.md is not loaded). The user's
// ~/.claude is never read or written here (repo rule 6). Off by default (Settings): today the user's ~/.claude already
// loads the same rules, twice would double them. Plugin layout from code.claude.com/docs/en/plugins (16/10):
// `.claude-plugin/plugin.json` {name}, `skills/<n>/SKILL.md`, `agents/*.md`, `output-styles/*.md`, `hooks/hooks.json`
// ({"hooks": …}); components show namespaced `second-brain:<name>`. UNVERIFIED on a real run: both flags with this
// Claude Code version, hooks.json's `${CLAUDE_PLUGIN_ROOT}`, output styles from a plugin. The folder is rebuilt only
// when the brain's files changed (a signature of paths, sizes and times), into a fresh copy swapped in at once, so a
// chat starting meanwhile never sees half a folder. Used by engines/sessions.ts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { errText, log } from '../../log';
import { enabled, installHooks, productSignature } from '../../rules/delivery';
import { productInstructions } from '../../rules/instructions';
import { configOf } from '../../rules/storage';
import { ensureTools, isProduct, templateHooks } from '../../rules/tools';
import { memoryInstructions } from '../../rules/new-brain';
import { isDir, launchRules, readText, resolvePlaceholders, instructionsOf, type BrainDomain } from './domains';

export const PLUGIN_NAME = 'second-brain';
/** what is copied from each domain's .claude folder into the plugin, and as which plugin folder */
const PARTS: readonly { from: string; to: string }[] = [
  { from: '.claude/skills', to: 'skills' },
  { from: '.claude/agents', to: 'agents' },
  { from: '.claude/output-styles', to: 'output-styles' },
  { from: '.claude/hooks', to: 'hooks' },
];
const TEXT = /\.(md|json|txt|ya?ml|toml)$/i;
const MAX_FILE = 2_000_000;

export interface ClaudeLaunch { args: string[]; pluginDir: string | null; rulesFile: string | null }

/** Legacy brains fail open with a warning. Migrated brains fail closed if product hooks cannot be delivered. */
export function claudeLaunch(userData: string, input?: { domains: BrainDomain[]; on?: boolean }): ClaudeLaunch {
  const none: ClaudeLaunch = { args: [], pluginDir: null, rulesFile: null };
  const rules = input ? null : launchRules();
  const domains = input?.domains ?? rules?.domains ?? [];
  const root = domains[0]?.root;
  // A product brain (made by BrainCreator, no ~/.claude wiring to duplicate) is delivered unless it opted out in
  // brain.json rules.claudeLaunch; legacy brains follow the app-wide switch, off by default.
  const product = !!root && isProduct(root);
  const on = input?.on ?? (rules?.claude || (product && configOf(root!).claudeLaunch)) ?? false;
  if (!on || !domains.length || !root) return none;
  try {
    const base = path.join(userData, 'claude-plugin');
    const files = collect(domains);
    const tools = product ? ensureTools(root) : null;
    const productText = productInstructions(root, false, tools ? tools.replace(/\\/g, '/') : undefined);
    let instructions = productText === null ? instructionsOf(domains) : [productText, instructionsOf(domains.slice(1))].filter(Boolean).join('\n\n');
    const sig = signature(files, (instructions ?? '') + productSignature(root));
    // A running chat keeps its exact product/root binding when another brain is selected or a release changes.
    const dir = path.join(base, product ? `${PLUGIN_NAME}-${sig}` : PLUGIN_NAME);
    const rulesFile = product ? path.join(dir, 'rules.md') : path.join(base, 'rules.md');
    if (product) instructions += '\n\n' + memoryInstructions(path.join(dir, 'product-rules'), root, tools ?? undefined);
    if (readText(path.join(dir, '.signature')) !== sig) build(base, dir, files, domains, sig, tools);
    if (instructions) { if (readText(rulesFile) !== instructions) fs.writeFileSync(rulesFile, instructions); }
    else fs.rmSync(rulesFile, { force: true });
    const hasParts = files.length > 0 || product;
    return {
      args: [...(hasParts ? ['--plugin-dir', dir] : []), ...(instructions ? ['--append-system-prompt-file', rulesFile] : [])],
      pluginDir: hasParts ? dir : null, rulesFile: instructions ? rulesFile : null,
    };
  } catch (e) {
    if (product) throw e; // a migrated brain must never silently lose its safety hooks
    log.warn('brain', 'the brain\'s rules could not be packed for Claude', { cause: errText(e), hint: 'the chat starts with the user\'s own ~/.claude only; check the userData folder is writable', data: { userData } });
    return none;
  }
}

interface Src { abs: string; rel: string; size: number; mtime: number; domain: string }

/** Every file the plugin takes from the domains: a later domain never overwrites an earlier one's file. */
function collect(domains: readonly BrainDomain[]): Src[] {
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

function signature(files: readonly Src[], instructions: string | null): string {
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(`${f.rel}|${f.size}|${f.mtime}|${f.domain}\n`);
  h.update(instructions ?? '');
  return h.digest('hex').slice(0, 24);
}

/** Writes the plugin into a fresh folder, then swaps it in (rename), so a chat starting meanwhile sees the old or the new. */
function build(base: string, dir: string, files: readonly Src[], domains: readonly BrainDomain[], sig: string, tools: string | null): void {
  fs.mkdirSync(base, { recursive: true });
  const tmp = path.join(base, `.${PLUGIN_NAME}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: PLUGIN_NAME, description: 'Le regole del cervello (generato da second-brain: non modificare qui)', version: '0.0.0' }, null, 2)}\n`);
  for (const f of files) {
    const to = path.join(tmp, f.rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (TEXT.test(f.rel)) fs.writeFileSync(to, resolvePlaceholders(fs.readFileSync(f.abs, 'utf8'), domains));
    else fs.copyFileSync(f.abs, to);
  }
  const root = domains[0]!.root;
  const fwdTools = tools?.replace(/\\/g, '/');
  installHooks(tmp, root, path.join(base, 'rule-state'), undefined, fwdTools ? { tools: fwdTools, correctionHook: true } : {});
  if (fwdTools && enabled(root)) addHooks(tmp, templateHooks(root, fwdTools));
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
