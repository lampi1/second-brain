// The models each engine's CLI itself offered, kept in userData by engine id (cursor-models.json: the name is the one
// of when only Cursor reported, so the list it already holds stays): an ACP answer to session/new and session/load
// carries models.availableModels ({modelId, name}), the exact ids `--model` accepts. The Settings
// page offers these for "Chat aperte dalla Regia" instead of a list typed by hand (the Regia, 2026-10-11: "l'elenco
// vero dei modelli della CLI ... mai inventato"). The app never starts a CLI only to ask: the list is the one of the
// engine's last chat that opened. Written by wiring.ts (ChatManager onModels), read by 'models:seen'.
import fs from 'node:fs';
import type { Harness, ModelsSeen } from '../../shared/contract';
import { log } from '../log';

type Model = { id: string; name: string };
const ID = /^[\w.:@/=[\],-]{1,120}$/;

/** Clean list: valid ids only, one each, names short and never empty, at most 300. */
export function cleanModels(list: unknown): Model[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>(), out: Model[] = [];
  for (const m of list) {
    const id = typeof m?.id === 'string' ? m.id.trim() : '';
    if (!ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 80) : id;
    out.push({ id, name });
    if (out.length >= 300) break;
  }
  return out;
}

export class ModelsSeenStore {
  private cache: ModelsSeen | null = null;
  constructor(private readonly file: string) {}

  get(): ModelsSeen {
    if (this.cache) return this.cache;
    const c: ModelsSeen = {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, { ids?: unknown; at?: unknown } | null>;
      for (const [engine, v] of Object.entries(raw)) {
        const ids = cleanModels(v?.ids);
        if (ids.length && ID.test(engine)) c[engine] = { ids, at: typeof v?.at === 'number' ? v.at : 0 };
      }
    } catch { /* no ACP chat yet, or a broken file: the UI uses its own list */ }
    return (this.cache = c);
  }

  /** An engine's session listed its models: saved only when the list changed. */
  record(harness: Harness, list: Model[]): void {
    const ids = cleanModels(list);
    if (!ids.length || !ID.test(harness)) return;
    const was = this.get()[harness];
    if (was && JSON.stringify(was.ids) === JSON.stringify(ids)) return;
    this.cache = { ...this.get(), [harness]: { ids, at: Date.now() } };
    try { fs.writeFileSync(this.file, JSON.stringify(this.cache)); } catch (e) {
      log.warn('brain', 'engine models not saved', { cause: String(e), hint: 'check that userData is writable; the list stays in memory until restart' });
    }
  }
}
