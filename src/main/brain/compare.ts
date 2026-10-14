// The brain's A/B comparisons between models (<brain>/harness/compare: an experiment = a JSON file, its ON/OFF state in
// ops/state/compare/switch.json) as switches on the Settings page (the user, 2026-10-11: "vorrei più cose configurabili
// ad esempio dove sta l'abilitazione e disabilitazione del confronto tra modelli"). The app never writes switch.json:
// it reads through the harness's own config.mjs and switches through its own switch.mjs (the one command the user used
// by hand), each run as an Electron-node child in the brain folder. Cost so far = the sum of the rounds' frozen
// cursor.json / claude.json cost_usd (missing ones counted, never guessed). Used by brain/index.ts ('compare:*').
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { CompareExperiment, CompareState } from '../../shared/contract';
import { errText, log } from '../log';
import { runNode, type NodeRunner } from './node';

export const compareDir = (root: string) => path.join(root, 'harness', 'compare');

// The child: loads the experiments and their state with the harness's own modules, prints one JSON line.
const LIST = [
  "import path from 'node:path';",
  "import { pathToFileURL } from 'node:url';",
  'const dir = process.env.SB_COMPARE_DIR;',
  "const imp = f => import(pathToFileURL(path.join(dir, f)).href);",
  "const c = await imp('config.mjs');",
  "const L = await imp('lib.mjs');",
  'const rounds = L.captures().map(n => { const d = path.join(L.OUT, n); return { cap: L.readJson(path.join(d, "capture.json"), {}) ?? {},',
  '  cursor: L.readJson(path.join(d, "cursor.json"), null), claude: L.readJson(path.join(d, "claude.json"), null) }; });',
  'const out = c.experiments().map(e => {',
  '  const mine = rounds.filter(r => c.experimentOf(r.cap)?.name === e.name);',
  '  const usd = side => { const v = mine.map(r => r[side]?.cost_usd).filter(x => typeof x === "number"); return { usd: v.length ? v.reduce((a, b) => a + b, 0) : null, missing: mine.filter(r => r[side] && typeof r[side].cost_usd !== "number").length }; };',
  '  return { e, s: c.stateOf(e.name), rounds: mine.length, source: usd("cursor"), contender: usd("claude") };',
  '});',
  'process.stdout.write(JSON.stringify(out) + "\\n");',
].join('\n');

/** The line of a child's stderr that says what went wrong: the thrown error, not Node's closing "Node.js vX" line. */
export function errLine(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines.filter(l => /^(\w*Error|Error)\b/.test(l)).at(-1) ?? lines.find(l => !/^Node\.js v/.test(l)) ?? '';
}

const NAME = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const tool = (o: unknown): string => {
  const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  return [str(x.tool), str(x.model)].filter(Boolean).join(' ');
};

/** The child's raw JSON → the contract shape (defensive: the brain's files are hand-edited). */
export function normalize(raw: unknown): CompareExperiment[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(r => {
    const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const e = (x.e && typeof x.e === 'object' ? x.e : {}) as Record<string, unknown>;
    const s = (x.s && typeof x.s === 'object' ? x.s : {}) as Record<string, unknown>;
    const name = str(e.name);
    if (!NAME.test(name)) return [];
    const src = (e.source && typeof e.source === 'object' ? e.source : {}) as Record<string, unknown>;
    const agentsOn = (s.agents && typeof s.agents === 'object' ? s.agents : {}) as Record<string, unknown>;
    const agents = (Array.isArray(src.agents) ? src.agents : []).filter((a): a is string => typeof a === 'string' && NAME.test(a));
    const cost = (v: unknown) => {
      const c = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
      return { usd: typeof c.usd === 'number' && Number.isFinite(c.usd) ? Math.round(c.usd * 100) / 100 : null, missing: typeof c.missing === 'number' ? c.missing : 0 };
    };
    return [{
      name, title: str(e.title) || name, description: str(e.description),
      on: s.on === true, changedAt: str(s.changed_at) || null,
      source: tool(src), contender: tool(e.contender), judge: tool(e.judge),
      agents: agents.map(a => ({ name: a, on: agentsOn[a] === true })),
      rounds: typeof x.rounds === 'number' ? x.rounds : 0,
      cost: { source: cost(x.source), contender: cost(x.contender) },
    }];
  });
}

export class Compare {
  /** the last list read (names to check a switch against, without one more child per click) */
  private last: { root: string; experiments: CompareExperiment[] } | null = null;
  /** switches run one at a time: switch.mjs reads and rewrites the whole switch.json, two at once would lose one */
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private root: () => string | null, private node: NodeRunner, private timeoutMs = 30e3) {}

  private dir(): string | { error: string } {
    const root = this.root();
    if (!root) return { error: 'nessuna cartella del cervello scelta' };
    const d = compareDir(root);
    if (!fs.existsSync(path.join(d, 'config.mjs')) || !fs.existsSync(path.join(d, 'switch.mjs'))) return { error: 'questo cervello non ha il confronto tra modelli (harness/compare)' };
    return d;
  }

  list(): Promise<CompareState> {
    const root = this.root();
    const d = this.dir();
    if (typeof d !== 'string') return Promise.resolve({ ok: false, error: d.error });
    if (!root) return Promise.resolve({ ok: false, error: 'nessuna cartella del cervello scelta' });
    return new Promise(resolve => {
      execFile(this.node.exe, ['--input-type=module', '-e', LIST], { cwd: root, env: { ...this.node.env, SB_COMPARE_DIR: d }, timeout: this.timeoutMs, maxBuffer: 8e6, windowsHide: true },
        (err, stdout, stderr) => {
          if (err) {
            log.warn('brain', 'compare list failed', { data: { error: errText(err), stderr: String(stderr).slice(0, 500) } });
            resolve({ ok: false, error: `non riesco a leggere gli esperimenti: ${errLine(String(stderr)) || errText(err)}` });
            return;
          }
          try {
            const experiments = normalize(JSON.parse(String(stdout).trim().split('\n').at(-1) ?? '[]'));
            this.last = { root, experiments };
            resolve({ ok: true, experiments });
          }
          catch (e) { resolve({ ok: false, error: `risposta non valida dagli esperimenti: ${errText(e)}` }); }
        });
    });
  }

  /** Switch an experiment (no agent) or one of its agents through switch.mjs; only names the list knows pass. */
  set(experiment: unknown, on: unknown, agent?: unknown): Promise<CompareState> {
    const run = this.queue.then(() => this.setNow(experiment, on, agent));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async setNow(experiment: unknown, on: unknown, agent?: unknown): Promise<CompareState> {
    if (typeof on !== 'boolean') return { ok: false, error: 'acceso o spento (true/false)' };
    let known = this.last?.root === this.root() ? this.last.experiments : null;
    if (!known) { const cur = await this.list(); if (!cur.ok) return cur; known = cur.experiments; }
    const e = known.find(x => x.name === experiment);
    if (!e) return { ok: false, error: `esperimento sconosciuto: ${String(experiment)}` };
    if (agent != null && !e.agents.some(a => a.name === agent)) return { ok: false, error: `agente sconosciuto per ${e.name}: ${String(agent)}` };
    const d = this.dir();
    if (typeof d !== 'string') return { ok: false, error: d.error };
    const args = [e.name, on ? 'on' : 'off', ...(agent != null ? [String(agent)] : [])];
    const r = await runNode(this.node, path.join(d, 'switch.mjs'), args, this.root()!, this.timeoutMs);
    if (r.code !== 0) {
      log.warn('brain', 'compare switch failed', { data: { args, code: r.code, stderr: r.stderr.slice(0, 500) } });
      return { ok: false, error: `switch.mjs non ha cambiato lo stato: ${errLine(r.stderr) || r.error || `uscita ${r.code}`}` };
    }
    log.info('brain', 'compare switched', { data: { args } });
    const after = await this.list();
    if (after.ok) return after;
    // switch.json did change: a failed re-read must not make the UI put the switch back
    log.warn('brain', 'compare re-read after switch failed', { data: { args, error: after.error } });
    return { ok: true, experiments: known.map(x => (x.name !== e.name ? x : agent != null ? { ...x, agents: x.agents.map(a => (a.name === agent ? { ...a, on } : a)) } : { ...x, on })) };
  }
}
