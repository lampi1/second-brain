// Main-only composition for integrator IPC registration. Reuses one section registry and one context loader.
// Trusted configuration supplies confirmed canonical data and a masked allow-listed source resolver; no discovery.
import type { SectionStore } from './section-store';
import { loadUserContext } from '../brain/user-context';
import type { ContextPacket } from '../brain/user-context';

export interface ExtensionContextSources {
  /** Existing canonical user information only. Null on first use until the human confirms information. */
  getConfirmedEssential(): unknown | null;
  /** Resolve explicit IDs, never raw paths/URLs. Must mask/exclude credentials before returning any source. */
  readRequestedSource(id: string): unknown;
}

export class ExtensionService {
  constructor(private readonly sections: SectionStore, private readonly sources: ExtensionContextSources) {}
  list() { return this.sections.list(); }
  register(manifest: unknown, expectedRevision: number) { return this.sections.register(manifest, expectedRevision); }
  remove(id: string, expectedRevision: number) { return this.sections.remove(id, expectedRevision); }
  rollback(targetRevision: number, expectedRevision: number) { return this.sections.rollback(targetRevision, expectedRevision); }
  context(requestedSourceIds: string[] = [], budgetBytes = 4096): ContextPacket {
    // A failed canonical provider must never become an invented user profile or default rule set.
    let canonical: unknown;
    try { canonical = this.sources.getConfirmedEssential(); }
    catch { canonical = {}; } // loader reports essential unavailable, preserving legacy empty fallback
    return loadUserContext(canonical, requestedSourceIds, id => this.sources.readRequestedSource(id), budgetBytes);
  }
}
