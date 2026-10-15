// Fake of the brain's harness/compare/config.mjs (same exports the app reads: experiments, stateOf, experimentOf):
// experiments = experiments/*.json normalized like the real one (sides a/b, a = { engine, capture: { agents } }; a file
// written before sides a/b, with source / contender / judge.tool, is read into that shape). Unlike the real one it adds
// no compatibility keys (source, contender) for an app before sides a/b, so the tests prove the app reads the new shape.
// State = ops/state/compare/switch.json { experiments: { <name>: { on, agents } } }.
// Used by test/unit/brain/compare.test.ts and switch.mjs here.
import fs from 'node:fs';
import path from 'node:path';
import { HERE, STATE, readJson } from './lib.mjs';

export const SWITCH_FILE = path.join(STATE, 'switch.json');
const DIR = path.join(HERE, 'experiments');
const OLD_TOOLS = { 'claude-code': 'claude', 'cursor-agent': 'cursor' };
const engineOf = tool => OLD_TOOLS[tool] ?? tool;

/** An experiment file in the new shape, whatever shape it was written in (as the real config.mjs normalize). */
export function normalize(e) {
  if (!e?.name) return null;
  const a = e.a ?? (e.source ? { engine: engineOf(e.source.tool ?? 'cursor'), capture: { agents: e.source.agents ?? [] } } : null);
  const b = e.b ?? (e.contender ? { engine: engineOf(e.contender.tool), model: e.contender.model ?? null, effort: e.contender.effort ?? null } : null);
  const j = e.judge ?? { engine: 'manual' };
  const judge = { ...j, engine: j.engine ?? engineOf(j.tool ?? 'manual') };
  delete judge.tool;
  const { source: _source, contender: _contender, ...rest } = e;
  return { ...rest, a, b, judge };
}
/** The agents side a captures (on Cursor only, as the real one). */
export const captureAgents = e => (e?.a?.engine === 'cursor' ? e.a.capture?.agents ?? [] : []);

export const experiments = () => (fs.existsSync(DIR) ? fs.readdirSync(DIR) : []).filter(f => f.endsWith('.json')).sort()
  .map(f => normalize(readJson(path.join(DIR, f), null))).filter(Boolean);
export const experiment = name => experiments().find(e => e.name === name) ?? null;
export function stateOf(name) {
  const s = readJson(SWITCH_FILE, {})?.experiments?.[name] ?? {};
  const d = experiment(name)?.defaults ?? {};
  return { on: s.on ?? d.on ?? false, agents: { ...(d.agents ?? {}), ...(s.agents ?? {}) }, changed_at: s.changed_at ?? null };
}
export const experimentOf = cap => experiment(cap?.experiment ?? 'cursor-vs-claude');
