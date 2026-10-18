// App-owned copy of the template utilities for product brains (ADR 0062): the brain holds personal content only, the
// app renders the scripts of its own release per brain under userData. Legacy brains keep running their own copy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { enabled } from './delivery';
import { read } from './storage';

/** Template code the app owns for a product brain; everything else in the template is personal content. */
export const isTemplateCode = (rel: string): boolean =>
  /^(?:ops\/tools\/brain-site\/|ops\/tools\/[^/]+\.m?js$|harness\/(?:claude|cursor|compare)\/[^/]+\.m?js$|\.claude\/hooks\/[^/]+\.mjs$)/.test(rel);
/** Values the installer rendered that are not derived from the brain folder; stored in brain.json `template`. */
export const STORED_VALUES = ['OWNER', 'ROLE', 'LANG', 'REPOS', 'DEVOPS_ORG', 'DEVOPS_PROJECT', 'HARNESSES', 'TODAY'] as const;
export type TemplateValues = Partial<Record<(typeof STORED_VALUES)[number], string>>;

let home: string | null = null;
let template: string | null = null;
/** Tests and the integrator pin the locations; otherwise Electron's userData and the release's template are used. */
export function useToolsHome(dir: string | null): void { home = dir; }
export function useTemplateRoot(dir: string | null): void { template = dir; }
function electronApp(): { getPath(n: string): string; getAppPath(): string } | null {
  try { return (createRequire(import.meta.url)('electron') as { app?: { getPath(n: string): string; getAppPath(): string } }).app ?? null; } catch { return null; }
}
function toolsHome(): string {
  const dir = home ?? electronApp()?.getPath('userData');
  if (!dir) throw new Error('App data folder unavailable for the brain tools.');
  return dir;
}
export function templateRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const app = electronApp();
  const candidates = template ? [template] : [app && path.join(app.getAppPath(), 'brain-template'), path.resolve(here, '../../brain-template'), path.resolve(here, '../../../brain-template')];
  const found = candidates.find((p): p is string => !!p && fs.existsSync(path.join(p, 'install.mjs')));
  if (!found) throw new Error('The release template is missing; reinstall this release before using a product brain.');
  return found;
}

const fwd = (p: string) => p.replace(/\\/g, '/');
const win = (p: string) => p.replace(/\//g, '\\');
function values(root: string): Record<string, string> {
  const raw = read(root, 'brain.json');
  const stored = (raw ? (JSON.parse(raw) as { template?: TemplateValues }).template : undefined) ?? {};
  const B = fwd(root), H = fwd(os.homedir()), R = fwd(stored.REPOS ?? path.join(os.homedir(), 'source', 'repos'));
  const out: Record<string, string> = {
    OWNER: stored.OWNER ?? 'Owner', BRAIN_NAME: path.basename(root), TODAY: stored.TODAY ?? new Date().toISOString().slice(0, 10),
    BRAIN: B, BRAIN_WIN: win(B), BRAIN_JS: B, BRAIN_RE: B.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'),
    REPOS: R, REPOS_WIN: win(R), REPOS_JS: R, HOME: H, HOME_WIN: win(H), HOME_JS: H,
    DEVOPS_ORG: stored.DEVOPS_ORG ?? 'your-org', DEVOPS_PROJECT: stored.DEVOPS_PROJECT ?? 'your-project',
    ROLE: stored.ROLE ?? 'developer', LANG: stored.LANG ?? 'italiano', HARNESSES: stored.HARNESSES ?? 'Claude Code',
    OS: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux', SHELL: process.platform === 'win32' ? 'PowerShell' : 'bash',
  };
  for (const [k, v] of Object.entries(out)) if (/[\x00-\x1f]/.test(v)) throw new Error(`Invalid template value ${k}.`);
  return out;
}
/** Same substitution as install.mjs: inside JavaScript the values are escaped for quotes, backticks and `$`. */
export function render(text: string, V: Record<string, string>, js: boolean): string {
  const safe = (k: string, v: string) => k === 'BRAIN_RE' ? v.replace(/['"`]/g, '\\$&') : v.replace(/['"`$]/g, '\\$&');
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in V ? (js ? safe(k, V[k]!) : V[k]!) : m));
}
function codeFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const file = path.join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error('The release template contains links.');
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : codeFiles(file, base);
    const rel = fwd(path.relative(base, file));
    return e.isFile() && isTemplateCode(rel) && !/\.test\.mjs$/.test(rel) ? [rel] : [];
  });
}
/** A release manifest (brain-template.manifest.json next to the template) must match every copied file. */
function verified(source: string, files: string[]): void {
  const manifest = path.join(path.dirname(source), 'brain-template.manifest.json');
  if (!fs.existsSync(manifest)) return; // a source checkout: the files are the repo's own
  const expected = (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { files?: Record<string, string> }).files ?? {};
  for (const rel of files) {
    if (createHash('sha256').update(fs.readFileSync(path.join(source, rel))).digest('hex') !== expected[rel]) throw new Error('The release template changed after install; reinstall this release.');
  }
}
export function toolsDir(root: string): string {
  return path.join(toolsHome(), 'brain-tools', createHash('sha256').update(process.platform === 'win32' ? fs.realpathSync(root).toLowerCase() : fs.realpathSync(root)).digest('hex').slice(0, 16));
}
/** Renders the release's utilities for this brain once per (release, values); the swap keeps the old copy on failure. */
export function ensureTools(root: string): string {
  const source = templateRoot();
  const files = codeFiles(source).sort();
  const V = values(fs.realpathSync(root));
  const sig = createHash('sha256').update(JSON.stringify(V));
  for (const rel of files) sig.update(rel).update(fs.readFileSync(path.join(source, rel)));
  const digest = sig.digest('hex');
  const target = toolsDir(root);
  const marker = path.join(target, '.sb-tools.json');
  const current = () => { try { return (JSON.parse(fs.readFileSync(marker, 'utf8')) as { sig?: string }).sig === digest; } catch { return false; } };
  if (current()) return target;
  verified(source, files);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const stage = fs.mkdtempSync(`${target}.new-`);
  try {
    for (const rel of files) {
      const out = path.join(stage, rel);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const buf = fs.readFileSync(path.join(source, rel));
      if (buf.subarray(0, 8000).includes(0)) fs.copyFileSync(path.join(source, rel), out);
      else fs.writeFileSync(out, render(buf.toString('utf8'), V, /\.(m?js|cjs)$/.test(rel)));
    }
    fs.writeFileSync(path.join(stage, '.sb-tools.json'), JSON.stringify({ root: fs.realpathSync(root), sig: digest }));
    const old = `${target}.old-${process.pid}-${Date.now()}`;
    if (fs.existsSync(target)) fs.renameSync(target, old);
    try { fs.renameSync(stage, target); }
    catch (e) { if (current()) return target; /* a concurrent launch won */ if (fs.existsSync(old)) fs.renameSync(old, target); throw e; }
    fs.rmSync(old, { recursive: true, force: true });
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  return target;
}
/** Where the app runs `rel` (e.g. ops/tools/cost.mjs) for this brain: the app copy for template code of a product brain,
 * else the brain's own file (legacy brains, personal scripts); null when neither exists. */
export function brainScript(root: string, rel: string): string | null {
  rel = fwd(rel);
  try {
    if (isTemplateCode(rel) && isProduct(root) && shipped(rel)) return path.join(ensureTools(root), rel);
  } catch { return null; } // a product brain never falls back to stale code in its folder; the caller reports it missing
  const own = path.join(root, rel);
  return fs.existsSync(own) ? own : null;
}
/** Template code this release ships (the pattern alone also matches personal scripts such as ops/tools/devops-me.mjs). */
export function shipped(rel: string): boolean {
  rel = fwd(rel);
  return isTemplateCode(rel) && !/\.test\.mjs$/.test(rel) && fs.existsSync(path.join(templateRoot(), rel));
}
/** Product brain check that never throws (an unreadable brain.json is not product machinery). */
export function isProduct(root: string): boolean { try { return enabled(root); } catch { return false; } }
/** Value of `{tools}` in product text: the folder holding ops/tools, harness and .claude/hooks for this brain. */
export const toolsRef = (root: string): string => fwd(ensureTools(root));

type HookGroup = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] };
/** Template hooks the product runtime replaces: limits and vendor checks (guards.ts), the feed (runtime metadata feed,
 * the app's own Live feed) and auto-commit (maintenance.ts). */
export const REPLACED_HOOKS = ['vendor-guard.mjs', 'brain-limits.mjs', 'chat-feed.mjs', 'auto-commit.mjs'];
/** The template's Claude hooks a product brain keeps (panel dismissed, compact, correction/praise/recall, inbox, runbook
 * reminder), pointed at the app-owned copy. Read from the release template; the brain's own settings are never used. */
export function templateHooks(root: string, tools: string): Record<string, HookGroup[]> {
  const source = templateRoot();
  const V = { ...values(fs.realpathSync(root)), BRAIN: fwd(tools) };
  const wiring = JSON.parse(render(fs.readFileSync(path.join(source, 'harness/claude/settings.hooks.json'), 'utf8'), V, false)) as { hooks: Record<string, HookGroup[]> };
  const project = JSON.parse(render(fs.readFileSync(path.join(source, '.claude/settings.json'), 'utf8'), V, false)) as { hooks?: Record<string, HookGroup[]> };
  const out: Record<string, HookGroup[]> = {};
  for (const set of [wiring.hooks, project.hooks ?? {}]) {
    for (const [event, groups] of Object.entries(set)) {
      for (const g of groups) {
        const hooks = g.hooks
          .map(h => ({ ...h, command: h.command.replace('$CLAUDE_PROJECT_DIR', fwd(tools)) }))
          .filter(h => !REPLACED_HOOKS.some(n => h.command.includes(`/${n}`)) && h.command.includes(fwd(tools)));
        if (hooks.length) (out[event] ??= []).push({ ...(g.matcher ? { matcher: g.matcher } : {}), hooks });
      }
    }
  }
  return out;
}
