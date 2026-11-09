// Launch context for product brains: only the fixed core (checked as a whole against its budget); topic rules are skills
// since #366 (ADR 0243), never injected.
// A fresh brain (rules.appRules, ADR 0072) has no AGENTS.md of the app's: its boot text is appBoot below, supplied
// here at every launch, so the owner's folder holds only what they wrote. Used by the launch adapters (brain/adapters).
import { configOf, read } from './storage';
import { expandTools } from './topics';
import { enabled } from './delivery';
import { fixedSize } from './guards';
import fs from 'node:fs';
import path from 'node:path';
import { APP_PLUGIN_PARTS } from './tools';
import { parseMd, field } from '../../shared/skillmd';

/** The app's topic-rule skills (regole-*) in the tools copy, as lines naming each SKILL.md: an adapter without the app's
 *  skills (ACP) reads them from there (#366). Bounded; [] without a copy. */
export function topicSkillIndex(tools: string): string[] {
  const dir = path.join(tools, APP_PLUGIN_PARTS.find(p => p.to === 'skills')!.from);
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter(n => n.startsWith('regole-')).sort().slice(0, 30); } catch { return []; }
  return names.flatMap(n => {
    const file = path.join(dir, n, 'SKILL.md');
    try {
      const desc = field(parseMd(fs.readFileSync(file, 'utf8')), 'description') ?? '';
      return [`- ${n}: ${desc.replace(/\s+/g, ' ').slice(0, 220)} Read ${file.replace(/\\/g, '/')}`];
    } catch { return []; }
  });
}

/** The product's always-loaded rules for a fresh brain (what the template's AGENTS.md and me.md "Safety" said). */
export function appBoot(root: string, tools?: string): string {
  const brain = root.replace(/\\/g, '/');
  const os = process.platform === 'win32' ? 'Windows; shell for the owner\'s commands: PowerShell' : process.platform === 'darwin' ? 'macOS; shell: bash' : 'Linux; shell: bash';
  return expandTools([
    `# Personal brain: ${brain}`, '',
    'This folder holds only the owner\'s own content. Product rules, tools, agents and skills come from the app at each',
    'launch (`{tools}`); the copy there is never edited. Files that do not exist yet are created on first real use; never',
    'seed rules, skills or example notes the owner did not ask for. me.md is the owner\'s profile.',
    'Safety: production and shared systems: propose the exact action; the owner runs it. Production queries, read-only',
    'too: never execute them; show the full text for the owner to run. No secrets in this folder; credentials stay outside',
    'and must not be read. Do not recursively search the home directory. Do not change global CLI settings.',
    'Memory: use the product memory command supplied at launch for now.md and ai-errors.md; never edit their lines',
    'directly. Keep your thread current (where, state, next step). Log verified errors immediately.',
    'Code changes require tests and a fresh reviewer before completion. A failed or blocked check stays visible.',
    'The product rules of each topic (hub, code, map, routines…) are skills named regole-<topic>: load the one that fits,',
    'like any skill. A rule the owner states goes where they ask (me.md by default), never into the product copy.',
    `Machine: ${os}.`,
  ].join('\n'), tools);
}

export function productInstructions(root: string, fallback: boolean, tools?: string): string | null {
  if (!enabled(root)) return null;
  const config = configOf(root);
  const own = [...new Set(config.fixedFiles)].map(file => expandTools(read(root, file), tools)).filter(Boolean);
  const fixed = [...(config.appRules ? [appBoot(root, tools)] : []), ...own].join('\n\n');
  if (fixedSize({ root, state: '', config }) > config.fixedBudget) throw new Error(`Fixed brain context exceeds ${config.fixedBudget} characters; shorten it before launching.`);
  if (!fallback) return fixed;
  // topic rules are no longer injected (#366, ADR 0243): they are skills; an adapter without the app's skills gets
  // where each one is, to read the one that fits
  const index = config.appRules && tools ? topicSkillIndex(tools) : [];
  return [fixed, 'Product pre-tool hooks are not available in this adapter.',
    ...(index.length ? [`The product rules of each topic, as skills: read the SKILL.md that fits the task before you start it.\n${index.join('\n')}`] : [])].join('\n\n');
}
