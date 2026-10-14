// Fake of the brain's harness/compare/config.mjs (same exports the app reads: experiments, stateOf, experimentOf):
// experiments = experiments/*.json, state = ops/state/compare/switch.json { experiments: { <name>: { on, agents } } }.
// Used by test/unit/brain/compare.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { HERE, STATE, readJson } from './lib.mjs';

export const SWITCH_FILE = path.join(STATE, 'switch.json');
const DIR = path.join(HERE, 'experiments');
export const experiments = () => (fs.existsSync(DIR) ? fs.readdirSync(DIR) : []).filter(f => f.endsWith('.json')).sort()
  .map(f => readJson(path.join(DIR, f), null)).filter(e => e?.name);
export const experiment = name => experiments().find(e => e.name === name) ?? null;
export function stateOf(name) {
  const s = readJson(SWITCH_FILE, {})?.experiments?.[name] ?? {};
  const d = experiment(name)?.defaults ?? {};
  return { on: s.on ?? d.on ?? false, agents: { ...(d.agents ?? {}), ...(s.agents ?? {}) }, changed_at: s.changed_at ?? null };
}
export const experimentOf = cap => experiment(cap?.experiment ?? 'cursor-vs-claude');
