// The brain's rules as each CLI loads them per launch (ADR 0060): the shared part of the adapters. A brain is a list of
// domains (ADR 0059), each a folder holding its rules once: `AGENTS.md` (the instructions), `.claude/skills/<n>/SKILL.md`,
// `.claude/agents/*.md`, `.claude/output-styles/*.md`, `.claude/hooks/hooks.json` (Claude's plugin hook shape) and,
// for Codex, `.agents/skills/<n>/SKILL.md`. UNVERIFIED: the layout is the one the brain template and the skills page use
// today (src/main/skills/service.ts); the domains service of ADR 0059 (another branch) may name folders differently:
// only this file changes then. Files may hold `{brain}` / `{domain:<name>}` placeholders (no absolute paths in a domain,
// ADR 0059): resolved here per PC. Who sets the source: wiring.ts (setLaunchRules); who reads it: claude-plugin.ts,
// codex.ts, engines/sessions.ts. Nothing here writes outside the app's userData.
import fs from 'node:fs';
import path from 'node:path';

export interface BrainDomain { name: string; root: string }
export interface LaunchRules {
  domains: BrainDomain[];
  /** load the brain into Claude chats (plugin folder + extra rules); default off: the user's ~/.claude does it today */
  claude: boolean;
  /** load the brain into Codex chats (instructions, skills, the app's MCP); default on: Codex has no other way */
  codex: boolean;
}

const NONE: LaunchRules = { domains: [], claude: false, codex: true };
let source: () => LaunchRules = () => NONE;

/** wiring.ts: where the domains and the two switches come from (Settings, the brain's domains). */
export function setLaunchRules(fn: () => LaunchRules): void { source = fn; }

/** The rules for a launch now; a source that throws counts as no brain (the chat still starts). */
export function launchRules(): LaunchRules {
  try {
    const r = source();
    return { domains: (r.domains ?? []).filter(d => d && typeof d.root === 'string' && fs.existsSync(d.root)), claude: r.claude === true, codex: r.codex !== false };
  } catch { return { ...NONE }; }
}

/** `{brain}` → the first domain's folder, `{domain:<name>}` → that domain's folder (forward slashes: valid in .md, JSON
 *  and shell lines on Windows too). An unknown domain stays as written. */
export function resolvePlaceholders(text: string, domains: readonly BrainDomain[]): string {
  const slash = (p: string): string => p.replace(/\\/g, '/');
  const first = domains[0];
  return text
    .replace(/\{brain\}/g, () => (first ? slash(first.root) : '{brain}'))
    .replace(/\{domain:([\w.-]+)\}/g, (m, name: string) => { const d = domains.find(x => x.name === name); return d ? slash(d.root) : m; });
}

/** The domains' `AGENTS.md`, each under its domain's name, placeholders resolved, capped (a CLI's instructions are
 *  context every turn pays for). null = none. */
export function instructionsOf(domains: readonly BrainDomain[], maxChars = 60_000): string | null {
  const parts: string[] = [];
  for (const d of domains) {
    const text = readText(path.join(d.root, 'AGENTS.md'));
    if (text?.trim()) parts.push(`<!-- brain domain: ${d.name} -->\n${resolvePlaceholders(text.trim(), domains)}`);
  }
  if (!parts.length) return null;
  const all = parts.join('\n\n');
  return all.length > maxChars ? `${all.slice(0, maxChars)}\n\n[… troncato: le regole del cervello superano ${maxChars} caratteri]` : all;
}

/** The existing skill folders of the domains (each holds <name>/SKILL.md), in the given sub-paths. */
export function skillDirs(domains: readonly BrainDomain[], subs: readonly string[]): string[] {
  const out: string[] = [];
  for (const d of domains) for (const sub of subs) {
    const dir = path.join(d.root, sub);
    if (isDir(dir) && !out.includes(dir)) out.push(dir);
  }
  return out;
}

export function readText(file: string): string | null {
  try { return fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); } catch { return null; }
}

export function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
