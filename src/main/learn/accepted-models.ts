// The models an engine's hidden runs really accept on their command line (Impara's teacher, compare/headless.ts). A CLI
// may name its models differently in a chat and on `--model`: Cursor's ACP sessions list `auto-smart`, `claude-opus-5-5`,
// `gpt-5.6-sol`, but `agent --model` takes `auto`, `claude-opus-5-5-high`, `gpt-5.6-sol-high` and refuses the rest with
// "Cannot use this model: X. Available models: a, b, …" (real run 2026-10-31). That refusal is the only list the CLI
// gives without a prompt: it is read here and kept per engine in userData/learn/accepted-models.json, so the start form
// offers only those (learn/sources.ts teacherOption). Used by wiring-builders.ts buildLearn and compare/headless.ts;
// tests: test/unit/learn-accepted-models.test.ts.
import fs from 'node:fs';
import path from 'node:path';

/** One model id as a CLI prints it in its list: never a flag, no spaces or shell characters. */
const ID = /^[A-Za-z0-9][\w.:-]{0,99}$/;
/** an engine id as the registry names it */
const ENGINE = /^[a-z][a-z0-9-]{0,40}$/;
/** at most this many ids per engine (Cursor listed 190 on 2026-10-31) */
const MAX = 400;

/** The model a CLI refused and the ones it says it accepts, or null when the text is not such a refusal. */
export function parseModelRefusal(text: string): { model: string; accepted: string[] } | null {
  const m = /Cannot use this model: (\S+?)\.\s+Available models: ([^\n]+)/.exec(text);
  if (!m) return null;
  const accepted = [...new Set(m[2]!.split(',').map(s => s.trim()).filter(s => ID.test(s)))].slice(0, MAX);
  return { model: m[1]!, accepted };
}

/** A model id no CLI has: a hidden run asked for it is refused before any model runs, and the refusal lists the
 *  accepted ones (probeAccepted). */
export const PROBE_MODEL = 'sb-list-models';

/** Asks the engine once for its list: one hidden run with PROBE_MODEL and no tools; true when it listed some. A run that
 *  answers instead (a CLI that took the id) only says it cannot tell. */
export async function probeAccepted(engine: string, store: AcceptedModels,
  run: (model: string) => Promise<{ ok: boolean; acceptedModels?: string[] }>): Promise<boolean> {
  const r = await run(PROBE_MODEL);
  if (r.ok || !r.acceptedModels?.length) return false;
  store.learn(engine, r.acceptedModels);
  return true;
}

/** The ids an engine accepts once one refusal listed them, on disk (written atomically: tmp + rename). */
export class AcceptedModels {
  constructor(private readonly file: string) {}

  private read(): Record<string, string[]> {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!raw || typeof raw !== 'object') return {};
      const out: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>))
        if (ENGINE.test(k) && Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string' && ID.test(x)).slice(0, MAX);
      return out;
    } catch { return {}; }
  }

  /** The ids the engine accepts, or null while no refusal has listed them. */
  get(engine: string): string[] | null {
    const ids = this.read()[engine];
    return ids?.length ? ids : null;
  }

  /** Keeps the list a refusal gave (a shorter one, e.g. a cut text, never replaces a longer one it is part of). */
  learn(engine: string, accepted: readonly string[]): void {
    const ids = accepted.filter(x => ID.test(x)).slice(0, MAX);
    if (!ENGINE.test(engine) || !ids.length) return;
    const all = this.read(), had = all[engine] ?? [];
    if (had.length > ids.length && ids.every(x => had.includes(x))) return;
    all[engine] = ids;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all));
    fs.renameSync(tmp, this.file);
  }
}
