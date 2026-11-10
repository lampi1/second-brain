// The models each engine's live source listed, kept in userData by engine id (cursor-models.json: the name is the one
// of when only Cursor reported, so the list it already holds stays). Two writers: a chat's own session (an ACP
// session/new's availableModels, Codex's model/list, Claude Code's initialize) and the scheduled or on-demand refresh
// of engines/model-lists.ts (ADR 0256), which asks each engine without opening a chat. The file is the cache: when a
// live source fails the last list stays, and only an engine with no list at all falls back to the brain's
// harness/models.json (engines/sessions.ts withApiModels). The Settings page and every model picker offer these (the
// Orchestrator, 2026-10-11: "l'elenco vero dei modelli della CLI ... mai inventato"). Read by 'models:seen'.
import fs from 'node:fs';
import type { Effort, Harness, ModelsSeen, SeenModel } from '../../shared/contract';
import { log } from '../log';

type Model = SeenModel;
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const ID = /^[\w.:@/=[\],-]{1,120}$/;

/** Clean list: valid ids only, one each, names short and never empty, known effort names only, at most 300. */
export function cleanModels(list: unknown): Model[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>(), out: Model[] = [];
  for (const m of list) {
    const id = typeof m?.id === 'string' ? m.id.trim() : '';
    if (!ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 80) : id;
    const efforts = Array.isArray(m.efforts) ? EFFORTS.filter(e => (m.efforts as unknown[]).includes(e)) : null;
    const window = Number.isSafeInteger(m.contextWindow) && m.contextWindow > 0 ? m.contextWindow as number : null;
    out.push({ id, name, ...(efforts ? { efforts } : {}), ...(window ? { contextWindow: window } : {}) });
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
