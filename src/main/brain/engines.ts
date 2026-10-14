// The engines the brain defines (ADR 0046): the `engines` key of <brain>/harness/models.json, an ACP CLI or an HTTP
// endpoint per entry, read at start and again when the file changes (a cheap mtime check every few seconds), into the
// engine registry (engines/registry.ts setBrainEngines). An invalid entry is left out and logged once; a valid one
// still starts only once the user turned it on with this very definition (engines/trust.ts). Why: the owner, 14/10,
// "voglio che sia facilmente utilizzabile da tutte le cli": a new engine is one entry, no app release. Used by
// wiring.ts.
import fs from 'node:fs';
import path from 'node:path';
import { brainEngine, setBrainEngines, type EngineEntry } from '../engines/registry';
import { log } from '../log';

export class BrainEngines {
  private seen: string | null = null;
  private warned = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly root: () => string | null) {}

  /** Reads models.json when it changed since the last look; no brain or no file = no brain engines. */
  refresh(): void {
    const r = this.root();
    const f = r ? path.join(r, 'harness', 'models.json') : null;
    let mtime: number | null = null;
    try { if (f) mtime = fs.statSync(f).mtimeMs; } catch { mtime = null; }
    const now = `${f ?? ''}|${mtime ?? ''}`; // another brain folder, or the same file changed
    if (now === this.seen) return;
    this.seen = now;
    const list: EngineEntry[] = [];
    if (f && mtime !== null) {
      try {
        const raw = (JSON.parse(fs.readFileSync(f, 'utf8')) as { engines?: unknown }).engines;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          for (const [id, v] of Object.entries(raw)) {
            const e = brainEngine(id, v);
            if (typeof e !== 'string') { list.push(e); continue; }
            const why = `${id}: ${e}`;
            if (!this.warned.has(why)) { this.warned.add(why); log.warn('engines', 'engine of the brain left out', { data: { engine: id, why: e }, hint: 'fix its entry in harness/models.json (engines)' }); }
          }
        }
      } catch (e) {
        log.warn('engines', 'harness/models.json unreadable: no engine of the brain', { cause: (e as Error).message, hint: 'check the JSON of harness/models.json' });
      }
    }
    setBrainEngines(list);
    if (list.length) log.info('engines', 'engines of the brain', { data: { engines: list.map(e => e.id) } });
  }

  start(everyMs = 5000): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), everyMs);
    this.timer.unref?.();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
