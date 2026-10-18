// The brain's model comparisons (src/main/brain/compare.ts) against a fake harness/compare (test/fixtures/brain/
// compare: same exports as the brain's config.mjs/lib.mjs, a switch.mjs that logs its calls): experiments listed with
// their switches and cost so far, switching only through switch.mjs and only for known names, fail-soft without one.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Compare, errLine, normalize } from '../../../src/main/brain/compare';
import { FIXTURES, plainNode, tmpDir } from './helpers';

const EXP = {
  name: 'cursor-vs-claude', title: 'Code review agents: Cursor vs Claude Code', description: 'x',
  source: { tool: 'cursor', agents: ['reviewer', 'code-investigator'] }, contender: { tool: 'claude-code', model: 'opus' },
  judge: { tool: 'cursor-agent', model: 'gpt-5' }, defaults: { on: false, agents: { reviewer: true, 'code-investigator': false } },
};

function brain(): string {
  const root = tmpDir();
  const d = path.join(root, 'harness', 'compare');
  fs.mkdirSync(path.join(d, 'experiments'), { recursive: true });
  for (const f of ['lib.mjs', 'config.mjs', 'switch.mjs']) fs.copyFileSync(path.join(FIXTURES, 'compare', f), path.join(d, f));
  fs.writeFileSync(path.join(d, 'experiments', 'cursor-vs-claude.json'), JSON.stringify(EXP));
  const round = (name: string, files: Record<string, unknown>) => {
    const r = path.join(root, 'reviews', 'compare', name);
    fs.mkdirSync(r, { recursive: true });
    for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(r, f), JSON.stringify(v));
  };
  round('r1', { 'capture.json': { agent: 'reviewer' }, 'cursor.json': { cost_usd: 0.5 }, 'claude.json': { cost_usd: 1.25 } });
  round('r2', { 'capture.json': { agent: 'reviewer', experiment: 'cursor-vs-claude' }, 'cursor.json': { status: 'completed' }, 'claude.json': { cost_usd: 2 } });
  round('r3', { 'capture.json': { agent: 'reviewer', experiment: 'other' }, 'claude.json': { cost_usd: 99 } }); // another experiment's
  return root;
}

// every case starts Node children (1-5 s each on a busy Windows machine)
describe('model comparisons', { timeout: 120e3 }, () => {
  it('lists each experiment with what it compares, its switches and the cost so far', async () => {
    const r = await new Compare(() => brain(), plainNode).list();
    // an experiment written before sides a/b (source / contender / judge.tool): read as sides a and b on engines
    expect(r).toEqual({ ok: true, experiments: [{
      name: 'cursor-vs-claude', title: EXP.title, description: 'x', on: false, changedAt: null,
      a: { engine: 'cursor', label: 'Cursor', agents: ['reviewer', 'code-investigator'] },
      b: { engine: 'claude', label: 'Claude', model: 'opus', effort: null },
      judge: { engine: 'cursor', label: 'Cursor', model: 'gpt-5' },
      agents: [{ name: 'reviewer', on: true }, { name: 'code-investigator', on: false }],
      rounds: 2, cost: { a: { usd: 0.5, missing: 1 }, b: { usd: 3.25, missing: 0 } },
    }] });
  });

  it('reads an experiment with sides a and b, and sums a.json / b.json, falling back to an old round\'s files', async () => {
    const root = brain();
    const d = path.join(root, 'harness', 'compare', 'experiments');
    fs.writeFileSync(path.join(d, 'ab.json'), JSON.stringify({
      name: 'ab', title: 'A contro B', description: 'y',
      a: { engine: 'cursor', capture: { agents: ['reviewer'] } }, b: { engine: 'claude', model: 'opus', effort: 'medium' }, judge: { engine: 'codex', model: 'gpt-5' },
      defaults: { on: true, agents: { reviewer: true } },
    }));
    const round = (name: string, files: Record<string, unknown>) => {
      const r = path.join(root, 'reviews', 'compare', name);
      fs.mkdirSync(r, { recursive: true });
      for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(r, f), JSON.stringify(v));
    };
    round('r4', { 'capture.json': { experiment: 'ab' }, 'a.json': { cost_usd: 0.2 }, 'b.json': { cost_usd: 1 } });
    round('r5', { 'capture.json': { experiment: 'ab' }, 'a.json': { cost_usd: 0.3 }, 'claude.json': { cost_usd: 0.7 } });
    const r = await new Compare(() => root, plainNode).list();
    expect(r.ok && r.experiments.find(e => e.name === 'ab')).toEqual({
      name: 'ab', title: 'A contro B', description: 'y', on: true, changedAt: null,
      a: { engine: 'cursor', label: 'Cursor', agents: ['reviewer'] },
      b: { engine: 'claude', label: 'Claude', model: 'opus', effort: 'medium' },
      judge: { engine: 'codex', label: 'Codex', model: 'gpt-5' },
      agents: [{ name: 'reviewer', on: true }],
      rounds: 2, cost: { a: { usd: 0.5, missing: 0 }, b: { usd: 1.7, missing: 0 } },
    });
  });

  it('switches an experiment and one agent only through switch.mjs, and refuses unknown names', async () => {
    const root = brain();
    const c = new Compare(() => root, plainNode);
    const on = await c.set('cursor-vs-claude', true);
    expect(on.ok && on.experiments[0]!.on).toBe(true);
    const agent = await c.set('cursor-vs-claude', true, 'code-investigator');
    expect(agent.ok && agent.experiments[0]!.agents).toEqual([{ name: 'reviewer', on: true }, { name: 'code-investigator', on: true }]);
    expect(agent.ok && agent.experiments[0]!.changedAt).toBe('2026-10-11 21:00:00');
    expect(fs.readFileSync(path.join(root, 'harness', 'compare', 'calls.log'), 'utf8')).toBe('cursor-vs-claude on\ncursor-vs-claude on code-investigator\n');
    expect(await c.set('nope', true)).toEqual({ ok: false, error: 'esperimento sconosciuto: nope' });
    expect(await c.set('cursor-vs-claude', true, 'prod-log-reader')).toEqual({ ok: false, error: 'agente sconosciuto per cursor-vs-claude: prod-log-reader' });
    expect(await c.set('cursor-vs-claude', 'yes')).toEqual({ ok: false, error: 'acceso o spento (true/false)' });
    expect(fs.readFileSync(path.join(root, 'harness', 'compare', 'calls.log'), 'utf8').split('\n').filter(Boolean)).toHaveLength(2); // refused ones never ran it
  });

  it('runs two switches one after the other, so neither change is lost', async () => {
    const root = brain();
    const c = new Compare(() => root, plainNode);
    const [a, b] = await Promise.all([c.set('cursor-vs-claude', true), c.set('cursor-vs-claude', true, 'code-investigator')]);
    expect(a.ok && b.ok).toBe(true);
    const now = await c.list();
    expect(now.ok && now.experiments[0]!.on).toBe(true);
    expect(now.ok && now.experiments[0]!.agents.find(x => x.name === 'code-investigator')!.on).toBe(true);
  });

  it('errLine keeps the thrown error, not Node\'s closing version line', () => {
    expect(errLine('file:///x/switch.mjs:3\n  throw e\nError: EBUSY: resource busy, open switch.json\n    at x\n\nNode.js v24.21.0\n')).toBe('Error: EBUSY: resource busy, open switch.json');
    expect(errLine('SyntaxError: Unexpected token\nNode.js v24.21.0')).toBe('SyntaxError: Unexpected token');
    expect(errLine('switch.json bloccato\n')).toBe('switch.json bloccato');
  });

  it('reports switch.mjs failures with its own words', async () => {
    const root = brain();
    fs.writeFileSync(path.join(root, 'harness', 'compare', 'switch.mjs'), "console.error('switch.json bloccato'); process.exit(3);\n");
    expect(await new Compare(() => root, plainNode).set('cursor-vs-claude', true)).toEqual({ ok: false, error: 'switch.mjs non ha cambiato lo stato: switch.json bloccato' });
  });

  it('a switch that worked stays switched when the re-read after it fails', async () => {
    const root = brain();
    const c = new Compare(() => root, plainNode);
    await c.list();
    // switch.mjs succeeds, then the experiments can no longer be read (config.mjs broken by the switch itself)
    fs.writeFileSync(path.join(root, 'harness', 'compare', 'switch.mjs'), "import fs from 'node:fs'; fs.writeFileSync(new URL('./config.mjs', import.meta.url), 'throw new Error(\"rotto\")');\n");
    const r = await c.set('cursor-vs-claude', true, 'code-investigator');
    expect(r.ok && r.experiments[0]!.agents).toEqual([{ name: 'reviewer', on: true }, { name: 'code-investigator', on: true }]);
  });

  it('fails soft without a brain or without the harness', async () => {
    expect(await new Compare(() => null, plainNode).list()).toEqual({ ok: false, error: 'nessuna cartella del cervello scelta' });
    expect(await new Compare(() => tmpDir(), plainNode).list()).toEqual({ ok: false, error: 'questo cervello non ha il confronto tra modelli (harness/compare)' });
  });

  it('normalize drops bad names and keeps only string agents', () => {
    expect(normalize([{ e: { name: '../x' } }, { e: { name: 'ok', source: { agents: ['a', 3, '../b'] } }, s: { agents: { a: true } } }, null])).toEqual([{
      name: 'ok', title: 'ok', description: '', on: false, changedAt: null,
      a: { engine: '', label: '', agents: ['a'] }, b: { engine: '', label: '', model: null, effort: null }, judge: { engine: '', label: '', model: null },
      agents: [{ name: 'a', on: true }], rounds: 0, cost: { a: { usd: null, missing: 0 }, b: { usd: null, missing: 0 } },
    }]);
    expect(normalize('x')).toEqual([]);
  });
});
