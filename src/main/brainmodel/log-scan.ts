// The log step of the maintenance pass the user starts (#150): the warn and error lines of the app's own logs
// (userData/logs/app-YYYY-MM-DD.jsonl, log.ts) written since the previous pass, grouped by scope | msg | cause with a
// count and one sample line each, no LLM. Numbers in the cause are folded (a pid, an id, a count), so the same problem
// is one group. The groups the user marked "noto, ignora" (maintenance-noise.json in userData) are flagged known and
// never made a card. Each new group becomes an app bug card «Apri issue» in Memoria → Proposte with its issue written
// (brainmodel/research.ts afterPass, ADR 0132, 0152; before it the groups went to the Orchestrator, #150). Pure but for the
// file reads; used by brainmodel/service.ts, pinned by test/unit/brainmodel/log-scan.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { LogGroup, LogScan } from '../../shared/brain-model';

const FILE = /^app-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const TWO_DAYS = 2 * 864e5;
const SAMPLE_MAX = 600, GROUPS_MAX = 40;

const fold = (s: string): string => s.replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 200);
export const groupKey = (scope: string, msg: string, cause: string): string => `${scope} | ${fold(msg)} | ${fold(cause)}`;

/** The groups of the log files in `dir` with lines after `since` (null = the last two days), worst first. */
export function scanLogs(dir: string, since: number | null, known: ReadonlySet<string>, now = Date.now()): LogScan {
  const from = since ?? now - TWO_DAYS, fromDay = new Date(from).toISOString().slice(0, 10);
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter(f => FILE.test(f) && FILE.exec(f)![1]! >= fromDay).sort(); } catch { /* no logs yet */ }
  const groups = new Map<string, LogGroup>(), files: string[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    files.push(file);
    for (const line of text.split('\n')) {
      if (!line.includes('"lvl":"warn"') && !line.includes('"lvl":"error"')) continue;
      let e: { t?: unknown; lvl?: unknown; scope?: unknown; msg?: unknown; cause?: unknown };
      try { e = JSON.parse(line) as typeof e; } catch { continue; }
      if (e.lvl !== 'warn' && e.lvl !== 'error') continue;
      const at = typeof e.t === 'string' ? Date.parse(e.t) : NaN;
      if (!Number.isFinite(at) || at <= from) continue;
      const scope = String(e.scope ?? ''), msg = String(e.msg ?? ''), cause = typeof e.cause === 'string' ? e.cause : '';
      const key = groupKey(scope, msg, cause), g = groups.get(key);
      if (g) { g.count++; if (e.lvl === 'error') g.lvl = 'error'; continue; }
      groups.set(key, { key, lvl: e.lvl, scope, msg, cause: cause.slice(0, 300), count: 1, sample: line.slice(0, SAMPLE_MAX), ...(known.has(key) ? { known: true as const } : {}) });
    }
  }
  const list = [...groups.values()].sort((a, b) => (a.lvl === b.lvl ? 0 : a.lvl === 'error' ? -1 : 1) || b.count - a.count).slice(0, GROUPS_MAX);
  return { since, files, groups: list };
}


/** The demo's logs (#150): a day of made-up warnings and errors, one group already marked known, for the Manutenzione
 *  dialog and its e2e. Written once per demo folder. */
export function writeDemoLogs(dir: string, noiseFile: string, now: number): string {
  fs.mkdirSync(dir, { recursive: true });
  const at = (min: number) => new Date(now - min * 60_000).toISOString();
  const day = new Date(now - 30 * 60_000).toISOString().slice(0, 10);
  const line = (min: number, lvl: string, scope: string, msg: string, cause?: string) => JSON.stringify({ t: at(min), lvl, scope, msg, ...(cause ? { cause } : {}) });
  fs.writeFileSync(path.join(dir, `app-${day}.jsonl`), [
    line(50, 'warn', 'chats', 'unsupported control request from CLI', 'subtype elicitation'), line(45, 'warn', 'chats', 'unsupported control request from CLI', 'subtype elicitation'),
    line(40, 'error', 'task', 'Lettura delle novità failed', 'Error: HTTP 503 on wiql'),
    line(35, 'warn', 'cli', 'unknown field from CLI', 'thinking_tokens'), line(30, 'warn', 'cli', 'unknown field from CLI', 'thinking_tokens'),
  ].join('\n') + '\n');
  writeNoise(noiseFile, new Set([groupKey('cli', 'unknown field from CLI', 'thinking_tokens')]));
  return dir;
}

/** The groups the user marked "noto, ignora". */
export function readNoise(file: string): Set<string> {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')) as { known?: unknown }; return new Set(Array.isArray(v.known) ? v.known.filter((k): k is string => typeof k === 'string') : []); }
  catch { return new Set(); }
}
export function writeNoise(file: string, known: ReadonlySet<string>): void {
  fs.writeFileSync(file, JSON.stringify({ known: [...known].sort() }, null, 2));
}
