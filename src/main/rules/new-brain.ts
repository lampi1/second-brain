// Activate product machinery only in the unpublished fresh brain prepared by BrainCreator, never an existing brain.
// The brain keeps personal content only: the template's code moves to the app-owned copy (tools.ts), references to it
// become `{tools}/…`, its hook wiring is delivered per launch, and no global CLI hook files are changed.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { atomicWrite, configOf, read } from './storage';
import { assets } from './delivery';
import { productInstructions } from './instructions';
import { topics } from './topics';
import { isTemplateCode, shipped, templateRoot, STORED_VALUES, type TemplateValues } from './tools';

/** Template wiring files a product brain must not keep: they point global CLI settings at code it no longer holds. */
export const MACHINERY_FILES = ['harness/claude/settings.hooks.json', 'harness/cursor/hooks.json', '.claude/settings.json'];
const fwd = (p: string) => p.replace(/\\/g, '/');

function files(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.name === '.git') return [];
    const file = path.join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error('Fresh brain contains a link.');
    return e.isDirectory() ? files(file, base) : e.isFile() ? [fwd(path.relative(base, file))] : [];
  });
}
/** Rewrites references to template code (absolute under the brain, or brain-relative) as `{tools}/<rel>`; references to
 * personal scripts the owner adds later (e.g. ops/tools/devops-me.mjs) stay brain paths. */
export function toolReferences(text: string, brain: string): string {
  const B = fwd(brain).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const W = brain.replace(/\//g, '\\').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const code = String.raw`((?:ops/tools|harness/(?:claude|cursor|compare)|\.claude/hooks)/[\w./-]+\.m?js)`;
  const anySep = String.raw`((?:ops[/\\]tools|harness[/\\](?:claude|cursor|compare)|\.claude[/\\]hooks)[/\\][\w./\\-]+\.m?js)`;
  return text
    .replace(new RegExp(`(?:${B}|${W})[/\\\\]${anySep}`, 'g'), (m, rel: string) => shipped(rel) ? `{tools}/${fwd(rel)}` : m)
    .replace(new RegExp(`(?<![\\w/{}.\\\\-])${code}`, 'g'), (m, rel: string) => shipped(rel) ? `{tools}/${rel}` : m);
}
/** Day-one commit of the prepared brain, isolated from the user's git config and hooks (same as install.mjs). */
function commit(root: string, owner: string): void {
  if (!fs.existsSync(path.join(root, '.git'))) return;
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))), GIT_CONFIG_GLOBAL: path.join(root, '.git', 'no-global-config'), GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', `core.hooksPath=${path.join(root, '.git', 'no-hooks')}`, '-c', 'commit.gpgSign=false', ...args], { env, windowsHide: true, timeout: 20000, stdio: 'ignore' });
  git('add', '-A');
  git('-c', `user.name=${owner}`, '-c', 'user.email=brain@localhost', 'commit', '-q', '-m', 'brain: product machinery (tools and hooks owned by the app)');
}

/** `root` = the staged brain; `brain` = where it is published (the installer rendered that path into the files). */
export function prepareNewBrain(root: string, brain: string = root, stored: TemplateValues = {}): void {
  assets(); // a release without its built hooks must not create a brain that depends on them
  templateRoot(); // nor one whose utilities the app cannot render
  const old = read(root, 'brain.json');
  const json = old ? JSON.parse(old) as Record<string, unknown> : {};
  if ('machinery' in json) throw new Error('Fresh brain already has a machinery owner.');
  const all = files(root);
  for (const rel of all) {
    if (isTemplateCode(rel) || MACHINERY_FILES.includes(rel)) fs.unlinkSync(path.join(root, rel));
    else if (rel.endsWith('.md')) {
      const text = read(root, rel);
      const next = toolReferences(text, brain);
      if (next !== text) atomicWrite(root, rel, next);
    }
  }
  for (const dir of ['ops/tools/brain-site', 'ops/tools', '.claude/hooks', 'harness/compare', 'harness/cursor']) {
    try { fs.rmdirSync(path.join(root, dir)); } catch { /* not empty (personal files) or absent */ }
  }
  const topicFiles = all.filter(rel => rel.endsWith('.md') && /^---\nwhen: /.test(read(root, rel))).sort();
  if (!['code.md', 'brain-rules.md', 'hub.md'].every(f => topicFiles.includes(f))) throw new Error('New brain template is missing its topic frontmatter.');
  const rules = { ...configOf(root), topicFiles };
  atomicWrite(root, 'CLAUDE.md', ['# Claude Code entry point', '', 'The canonical context is AGENTS.md (imported below). Hooks and tools are delivered by the app at',
    'each launch; `{tools}` in these files is the folder the launch instructions name.', '', '@AGENTS.md', ''].join('\n'));
  // Product instructions are authoritative; the old script pointers are not part of the always-loaded context.
  atomicWrite(root, 'AGENTS.md', [
    '<!-- Brain boot index: personal content for app-launched agents; enforcement is shipped by the application. -->',
    '# Personal brain', '',
    'Read me.md for identity and safety. No secrets in this folder. Production actions are proposed; the owner runs them.',
    'Use the product memory command supplied at launch for now.md and ai-errors.md; never edit their lines directly.',
    'Keep your thread current (where, state, next step). Log verified errors immediately. Keep all other threads intact.',
    'Use map.md for memory locations. Topic rules are injected by the app or included in launch instructions.',
    'Code changes require tests and a fresh reviewer before completion. A failed or blocked check stays visible.',
    'Do not recursively search the home directory. Credentials stay outside the brain and must not be read.',
    'Do not change global CLI settings. Only the app owns machinery; personal rules remain editable content.',
    '`{tools}/…` in brain files is an app-owned utility: run it with node from the folder the launch names.',
    '',
  ].join('\n'));
  const template = Object.fromEntries(STORED_VALUES.flatMap(k => typeof stored[k] === 'string' ? [[k, stored[k]]] : []));
  atomicWrite(root, 'brain.json', JSON.stringify({ ...json, machinery: 'product-v1', template, rules }, null, 2) + '\n');
  const ctx = { root, state: '', config: rules };
  atomicWrite(root, 'topic-map.md', '<!-- Generated topic routing; regenerate from brain.json and frontmatter. -->\n' +
    topics(ctx).map(t => `- ${t.file}: ${[...t.when.prompt, ...t.when.tools, ...t.when.paths].join(', ')}`).join('\n') + '\n');
  productInstructions(root, false); // enforce the launch budget before the staged brain can be published
  try { commit(root, stored.OWNER ?? 'Owner'); } catch { /* git stays optional, as in install.mjs */ }
}

export function memoryInstructions(runtime: string, root: string, tools?: string): string {
  const cli = path.join(runtime, 'hooks/cli.mjs').replace(/\\/g, '/');
  const brain = root.replace(/\\/g, '/');
  return `Product memory writer (paths are literal arguments): node "${cli}" now "${brain}" "chat label" "where · state · next".\n` +
    `Error: node "${cli}" error "${brain}" "agent" "verified error and prevention".\n` +
    `Diagnostics: node "${cli}" lint "${brain}". Shell tools must preserve argument boundaries; never interpolate untrusted text.` +
    (tools ? `\nBrain utilities: {tools} = ${tools.replace(/\\/g, '/')} (app-owned, rendered for this brain); e.g. node "${tools.replace(/\\/g, '/')}/ops/tools/mem.mjs" idea "…".` : '');
}
