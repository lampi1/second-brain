// The models a CLI itself offered, kept in userData (cursor-models.json): Cursor's ACP answer to session/new and
// session/load carries models.availableModels ({modelId, name}), the exact ids `agent --model` accepts. The Settings
// page offers these for "Chat aperte dalla Regia" instead of a list typed by hand (the Regia, 2026-10-11: "l'elenco
// vero dei modelli della CLI ... mai inventato"). The app never starts a CLI only to ask: the list is the one of the
// last Cursor chat that opened. Written by wiring.ts (ChatManager onModels), read by 'models:seen'.
import fs from 'node:fs';
import type { ModelsSeen } from '../../shared/contract';
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
    let c: ModelsSeen = { cursor: null };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { cursor?: { ids?: unknown; at?: unknown } };
      const ids = cleanModels(raw.cursor?.ids);
      if (ids.length) c = { cursor: { ids, at: typeof raw.cursor?.at === 'number' ? raw.cursor.at : 0 } };
    } catch { /* no Cursor chat yet, or a broken file: the UI uses its own list */ }
    return (this.cache = c);
  }

  /** A Cursor session listed its models: saved only when the list changed. */
  record(harness: 'claude' | 'cursor', list: Model[]): void {
    if (harness !== 'cursor') return;
    const ids = cleanModels(list);
    if (!ids.length) return;
    const was = this.get().cursor;
    if (was && JSON.stringify(was.ids) === JSON.stringify(ids)) return;
    this.cache = { cursor: { ids, at: Date.now() } };
    try { fs.writeFileSync(this.file, JSON.stringify(this.cache)); } catch (e) {
      log.warn('brain', 'cursor models not saved', { cause: String(e), hint: 'check that userData is writable; the list stays in memory until restart' });
    }
  }
}
