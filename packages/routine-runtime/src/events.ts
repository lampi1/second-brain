// Live progress of a routine run (ADR 0175): the runtime appends one JSON line per event to <run>/events.jsonl (masked
// by the run store like every run file), and `progressFrom` folds them into the one status both renderers show: the
// terminal line of `routine` and the app's Routine section. Pure: no I/O in the reducer.

export type RunEvent =
  | { type: 'run-start'; at: number; runId: string; routine: string; total: number; workItem?: number }
  | { type: 'run-resume'; at: number; attempt: number }
  | { type: 'run-end'; at: number; status: string; error?: string }
  | { type: 'step-start'; at: number; n: number; total: number; id: string; title: string; attempt: number }
  | { type: 'step-end'; at: number; n: number; id: string; status: string; summary?: string; error?: string }
  | { type: 'action'; at: number; n: number; text: string }
  | { type: 'screenshot'; at: number; n: number; path: string }
  | { type: 'waiting-human'; at: number; n: number; url?: string; question: string }
  | { type: 'human-answer'; at: number; n: number; author: string }
  | { type: 'db-unavailable'; at: number; n: number; note: string }
  /** a DevOps write of a step: "not-verified" = its effect could not be confirmed, the run went on */
  | { type: 'write'; at: number; n: number; what: string; status: 'done' | 'not-verified' | 'failed' }
  /** review→fix: step `from` (number n) sent the run back to step `to`, which starts its round `round` */
  | { type: 'loop'; at: number; n: number; from: string; to: string; round: number; reason: string };

export const EVENTS_FILE = 'events.jsonl';

export interface RunProgress {
  status: string;
  step?: { n: number; total: number; title: string; id: string };
  /** when the current status (or step) started */
  since?: number;
  lastAction?: string;
  waiting?: { url?: string; question: string };
  dbUnavailable?: string;
  shots: string[];
  /** DevOps writes of the whole run whose effect could not be confirmed */
  notVerified?: string[];
  error?: string;
}

/** Parses events.jsonl text; unknown or broken lines are skipped. */
export function parseEvents(text: string): RunEvent[] {
  const out: RunEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line) as RunEvent; if (e && typeof e.type === 'string' && typeof e.at === 'number') out.push(e); } catch { /* a partial last line */ }
  }
  return out;
}

/** The status of a run from its events (both renderers use this). */
export function progressFrom(events: readonly RunEvent[]): RunProgress {
  const p: RunProgress = { status: 'pending', shots: [] };
  let total = 0;
  for (const e of events) {
    switch (e.type) {
      case 'run-start': p.status = 'running'; p.since = e.at; total = e.total; delete p.error; break;
      case 'run-resume': p.status = 'running'; p.since = e.at; delete p.error; delete p.waiting; break;
      case 'run-end': p.status = e.status; p.since = e.at; delete p.waiting; if (e.error) p.error = e.error; break;
      case 'step-start':
        total = e.total || total;
        p.step = { n: e.n, total, title: e.title, id: e.id }; p.status = 'running'; p.since = e.at;
        delete p.lastAction; delete p.waiting; delete p.dbUnavailable; p.shots = [];
        break;
      case 'step-end': if (p.step?.n === e.n && e.status !== 'done') p.status = e.status === 'needs-human' ? 'needs-human' : p.status; if (e.error) p.lastAction = e.error; break;
      case 'action': if (!p.step || p.step.n === e.n) p.lastAction = e.text; break;
      case 'screenshot': if (!p.step || p.step.n === e.n) p.shots.push(e.path); break;
      case 'waiting-human': p.status = 'waiting-human'; p.since = e.at; p.waiting = { question: e.question, ...(e.url ? { url: e.url } : {}) }; break;
      case 'human-answer': p.status = 'running'; delete p.waiting; p.lastAction = `${e.author} ha risposto su DevOps`; break;
      case 'db-unavailable': p.dbUnavailable = e.note; break;
      case 'write': if (e.status === 'not-verified') (p.notVerified ??= []).push(e.what); break;
      case 'loop': p.status = 'running'; p.since = e.at; p.lastAction = `${e.from} → ${e.to} (giro ${e.round}): ${clip(e.reason)}`; break;
    }
  }
  return p;
}

const clip = (s: string, n = 160) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The last agent action of a stream-json line, distilled to one short sentence; undefined = nothing to show. */
export function actionFromStreamLine(line: string): string | undefined {
  let v: Record<string, unknown>;
  try { v = JSON.parse(line) as Record<string, unknown>; } catch { return undefined; }
  if (v.type !== 'assistant') return undefined;
  const content = ((v.message as Record<string, unknown> | undefined)?.content ?? []) as Record<string, unknown>[];
  for (const c of [...content].reverse()) {
    if (c.type === 'tool_use') {
      const input = (c.input ?? {}) as Record<string, unknown>;
      const detail = ['command', 'file_path', 'path', 'url', 'pattern', 'query', 'description'].map(k => input[k]).find(x => typeof x === 'string') as string | undefined;
      return clip(`${String(c.name)}${detail ? `: ${detail}` : ''}`);
    }
    if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) return clip(c.text);
  }
  return undefined;
}
