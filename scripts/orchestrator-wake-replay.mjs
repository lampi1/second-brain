// `node scripts/orchestrator-wake-replay.mjs [app-YYYY-MM-DD.jsonl ...] [--json]`: replays the news the app sent to the
// Orchestrator on a day (log lines "news sent to the Orchestrator") through the old and the current classification of
// orchestrator-delivery.ts newsClass, and counts how many deliveries open a new Orchestrator turn (gate "queue": the
// Orchestrator was idle or closed; an "inject" delivery joins a running turn and costs no turn). Why: cloudroom comms
// proposal 1 (2026-11-07) made a plain "finished"/"started" quiet; on 07/11 50 of the 56 turns an app news opened ended with
// a bare 👍. The log has each delivery's kinds but not whether a 'done' was a root chat's routed report (an active work
// thread or away mode): the current count is a range, low = no 'done' was one, high = every 'done' delivered within
// RESULT_WINDOW_MS after a "root chat reported" line was one. Default log: today's in %APPDATA%/second-brain/logs.
// Read-only. Its pure part, replay(), is unit-tested in test/unit/orchestrator-wake-replay.test.ts with the real newsClass.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const RESULT_WINDOW_MS = 60_000;

/** The classification before 2026-11-07: a failure at once, any turn end grouped, what waits for the user quiet. */
export const oldNewsClass = (kind, endsTurn) => (kind === 'error' ? 'now' : kind === 'done' || endsTurn ? 'group' : 'quiet');

/** The deliveries and root reports of a log's lines (JSON lines; others skipped). */
export function parse(lines) {
  const deliveries = [], reports = [];
  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const at = Date.parse(o?.t);
    if (!Number.isFinite(at)) continue;
    if (o.msg === 'news sent to the Orchestrator' && Array.isArray(o.data?.kinds)) deliveries.push({ at, gate: String(o.data.gate), kinds: o.data.kinds.map(String) });
    else if (o.msg === 'root chat reported') reports.push(at);
  }
  return { deliveries, reports };
}

/** How many deliveries open a new Orchestrator turn under each classification. classify(kind, endsTurn, result) is
 *  newsClass; 'user-message' is always quiet (orchestrator-wake.ts classOf). */
export function replay({ deliveries, reports }, current, previous = oldNewsClass) {
  const loud = (kinds, cls, result) => kinds.some(k => k !== 'user-message' && cls(k, false, result) !== 'quiet');
  const queued = deliveries.filter(d => d.gate === 'queue');
  const afterReport = d => reports.some(at => at <= d.at && d.at - at <= RESULT_WINDOW_MS);
  const byKinds = {};
  for (const d of queued) { const k = [...new Set(d.kinds)].sort().join(','); byKinds[k] = (byKinds[k] ?? 0) + 1; }
  return {
    deliveries: deliveries.length,
    queued: queued.length,
    injected: deliveries.length - queued.length,
    before: queued.filter(d => loud(d.kinds, previous, false)).length,
    afterLow: queued.filter(d => loud(d.kinds, current, false)).length,
    afterHigh: queued.filter(d => loud(d.kinds, current, afterReport(d))).length,
    byKinds,
  };
}

async function main(argv) {
  const json = argv.includes('--json');
  const day = new Date().toISOString().slice(0, 10);
  const files = argv.filter(a => !a.startsWith('--'));
  if (!files.length) files.push(path.join(process.env.APPDATA ?? '', 'second-brain', 'logs', `app-${day}.jsonl`));
  const { newsClass } = await import(pathToFileURL(path.resolve(import.meta.dirname, '../src/main/chats/orchestrator-delivery.ts')).href);
  for (const file of files) {
    const r = replay(parse(fs.readFileSync(file, 'utf8').split(/\r?\n/)), newsClass);
    if (json) { console.log(JSON.stringify({ file, ...r })); continue; }
    console.log(`${path.basename(file)}: ${r.deliveries} deliveries (${r.queued} queued, ${r.injected} injected into a running turn)`);
    console.log(`  new Orchestrator turns: before ${r.before} → now ${r.afterLow}${r.afterHigh !== r.afterLow ? `-${r.afterHigh}` : ''}`);
    console.log(`  queued deliveries by kinds: ${JSON.stringify(r.byKinds)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main(process.argv.slice(2));
