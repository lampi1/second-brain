// A fresh brain starts empty (the owner, 2026-10-18: "a installazione pulita ... mi aspetto pulito ... tutto quello che
// riguarda l'app deve essere invisibile nel brain dell'utente"; ADR 0072). The app's only creator (the automatic
// memory of modules/ai-first, the first setup's new memory) ends here: the brain gets only the owner's profile (me.md, their own data), brain.json (the
// machinery marker, the values the owner typed, the rules settings) and a credentials .gitignore. Rules,
// skills, agents, tools, hooks and the model table come from the app's own copy (rules/tools.ts, rules.appRules) at
// each launch; files like now.md or ideas.md appear only when the owner or an agent first writes them. Never run on an
// existing brain: a legacy brain keeps all its files (migration.ts is its separate, reviewed path).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { atomicWrite } from './storage';
import { assets } from './delivery';
import { productInstructions } from './instructions';
import { templateRoot, STORED_VALUES, type TemplateValues } from './tools';
export { toolReferences } from './tools';

/** Template wiring files a product brain must not keep: they point global CLI settings at code it no longer holds. */
export const MACHINERY_FILES = ['harness/claude/settings.hooks.json', 'harness/cursor/hooks.json', '.claude/settings.json'];
/** Everything a fresh brain holds (the unit test pins it): the rest is the app's. */
export const FRESH_FILES = ['.gitignore', 'brain.json', 'me.md'] as const;
/** The "Main work" placeholder brain/profile.ts recognises as empty. */
const MAIN_WORK = '- **Main work**: (one line per area; the agents learn the rest from `now.md` and the journal)';

/** The owner's profile with only what they typed: the sections Settings → Il mio profilo reads and patches
 * (brain/profile.ts), no preset rules. The working style and safety rules the template's me.md carried are product
 * rules now (rules/instructions.ts). */
export function freshProfile(v: TemplateValues): string {
  const owner = v.OWNER?.trim() || 'Owner', role = v.ROLE?.trim() || 'professional', lang = v.LANG?.trim() || 'italiano';
  if (/[\x00-\x1f\x7f]/.test(owner + role + lang)) throw new Error('Invalid profile value.');
  return [`# ${owner}`, '', '## Who', '', `${owner}, ${role}. Language: ${lang} in chat.`, '', MAIN_WORK, '', `## How to work with ${owner}`, ''].join('\n');
}
/** Day-one commit of the prepared brain, isolated from the user's git config and hooks (same as install.mjs). */
function commit(root: string, owner: string): void {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))), GIT_CONFIG_GLOBAL: path.join(root, '.git', 'no-global-config'), GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', `core.hooksPath=${path.join(root, '.git', 'no-hooks')}`, '-c', 'commit.gpgSign=false', ...args], { env, windowsHide: true, timeout: 20000, stdio: 'ignore' });
  git('init', '-q', '--initial-branch=main', '--template=');
  git('config', 'core.autocrlf', 'false');
  git('add', '-A');
  git('-c', `user.name=${owner}`, '-c', 'user.email=brain@localhost', 'commit', '-q', '-m', 'brain: day one (empty; the app owns its machinery)');
}

/** Writes the fresh brain's few files into `root`, an empty folder the caller reserved. Fails before writing when this
 * release could not deliver the machinery the brain will depend on (hook runtime, template utilities). */
export function writeFreshBrain(root: string, stored: TemplateValues = {}): void {
  assets(); // a release without its built hooks must not create a brain that depends on them
  templateRoot(); // nor one whose utilities, rules and agents the app cannot render
  if (fs.readdirSync(root).length) throw new Error('A fresh brain starts in an empty folder.');
  const template = Object.fromEntries(STORED_VALUES.flatMap(k => typeof stored[k] === 'string' ? [[k, stored[k]]] : []));
  atomicWrite(root, 'me.md', freshProfile(stored));
  atomicWrite(root, '.gitignore', '# Never commit credentials\n.env\n*.env\n*credentials*\n# Local state of the tools\nops/state/\n*.log\n');
  atomicWrite(root, 'brain.json', JSON.stringify({ machinery: 'product-v1', template, rules: { topicFiles: [], appRules: true } }, null, 2) + '\n');
  productInstructions(root, false); // the launch text must build before the brain is handed over
  try { commit(root, stored.OWNER ?? 'Owner'); } catch { fs.rmSync(path.join(root, '.git'), { recursive: true, force: true }); /* git stays optional */ }
}

export function memoryInstructions(runtime: string, root: string, tools?: string): string {
  const cli = path.join(runtime, 'hooks/cli.mjs').replace(/\\/g, '/');
  const brain = root.replace(/\\/g, '/');
  return `Product memory writer (paths are literal arguments): node "${cli}" now "${brain}" "chat label" "where · state · next".\n` +
    `Error: node "${cli}" error "${brain}" "agent" "verified error and prevention".\n` +
    `Agent memory (one per agent, when your instructions name your id): node "${cli}" agent "${brain}" "<id>" "one fact worth remembering".\n` +
    `Diagnostics: node "${cli}" lint "${brain}". Shell tools must preserve argument boundaries; never interpolate untrusted text.` +
    (tools ? `\nBrain utilities: {tools} = ${tools.replace(/\\/g, '/')} (app-owned, rendered for this brain); e.g. node "${tools.replace(/\\/g, '/')}/ops/tools/mem.mjs" idea "…".` : '');
}
