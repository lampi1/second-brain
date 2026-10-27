// The terminal renderer of a routine run (ADR 0175): `routine run|resume|watch` show the live progress of a run from its
// events.jsonl through the shared reducer `progressFrom`, the same one the app's Routine section uses, so both always
// show the same current step. `renderProgress` is pure (lines of text); `followRun` polls the events file and repaints
// (one updating line block on a TTY, a new block only on change otherwise). Italian, like the app's UI.
import fs from 'node:fs';
import path from 'node:path';
import { EVENTS_FILE, parseEvents, progressFrom, type RunProgress } from './events';

const STATUS: Record<string, string> = {
  pending: 'in partenza', running: 'in corso', 'waiting-human': 'in attesa di una persona', 'needs-human': 'serve una persona',
  done: 'finita', failed: 'fallita', cancelled: 'annullata',
};

export function since(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return 'da meno di 1 min';
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** The lines for one moment of a run: "Passo 3 di 7: <title> · in corso 4 min", the last action, the wait for a person. */
export function renderProgress(p: RunProgress, now: number): string[] {
  const status = STATUS[p.status] ?? p.status;
  const elapsed = p.since !== undefined ? ` ${since(now - p.since)}` : '';
  const lines = [p.step ? `Passo ${p.step.n} di ${p.step.total}: ${p.step.title} · ${status}${elapsed}` : `Run ${status}${elapsed}`];
  if (p.lastAction) lines.push(`  ultima azione: ${p.lastAction}`);
  if (p.waiting) {
    lines.push(`  serve una persona: ${p.waiting.question}`);
    if (p.waiting.url) lines.push(`  rispondi nel commento DevOps: ${p.waiting.url}`);
  }
  if (p.dbUnavailable) lines.push(`  DB di test: ${p.dbUnavailable}`);
  if (p.shots.length) lines.push(`  screenshot: ${p.shots[p.shots.length - 1]}`);
  if (p.notVerified?.length) lines.push(`  scritture DevOps non verificate: ${p.notVerified.length}`);
  if (p.error && ['failed', 'needs-human', 'cancelled'].includes(p.status)) lines.push(`  errore: ${p.error}`);
  return lines;
}

/** The progress of a run folder now (events.jsonl through the shared reducer). */
export function readProgress(runDir: string): RunProgress {
  let text = '';
  try { text = fs.readFileSync(path.join(runDir, EVENTS_FILE), 'utf8'); } catch { /* not started yet */ }
  return progressFrom(parseEvents(text));
}

export interface Follower { stop(): void; paint(): void }

/** Repaints a run's progress every `everyMs` until stop(). On a TTY the block is rewritten in place. */
export function followRun(runDir: string, out: NodeJS.WriteStream | { write(s: string): unknown; isTTY?: boolean }, everyMs = 1000, now: () => number = Date.now): Follower {
  let last = '', drawn = 0;
  const tty = 'isTTY' in out && out.isTTY === true;
  const paint = () => {
    const lines = renderProgress(readProgress(runDir), now());
    const text = lines.join('\n');
    if (!tty) {
      // without a TTY: a new block only when something other than the elapsed time changed
      const key = text.replace(/ \d+ (h \d+ )?min| da meno di 1 min/g, '');
      if (key !== last) { out.write(`${text}\n`); last = key; }
      return;
    }
    if (text === last) return;
    out.write(`${drawn ? `\x1b[${drawn}A` : ''}${lines.map(l => `\x1b[2K${l}`).join('\n')}\n`);
    drawn = lines.length; last = text;
  };
  const timer = setInterval(paint, everyMs);
  paint();
  return { stop: () => { clearInterval(timer); paint(); }, paint };
}
