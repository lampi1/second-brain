// Main-owned registry plus the existing canonical confirmed archive. No setup inference, path discovery or duplicate store.
import { validRevision, validSectionId } from '../../shared/data-sections';
import { SectionStore } from './section-store';
import { ExtensionService } from './service';
import { ConfirmedContextSource, validateContextFacts } from './context-source';
import { maskSecrets } from '../brain/procedures';
import { loadUserContext } from '../brain/user-context';

export class SectionController {
  private readonly store: SectionStore;
  private readonly service: ExtensionService;
  private readonly canonical: ConfirmedContextSource;
  private confirming = false;
  constructor(root: string, private readonly confirm: (text: string, kind: 'memory' | 'source') => Promise<boolean>) {
    this.store = new SectionStore(root);
    this.canonical = new ConfirmedContextSource(root, () => new Date(), id => this.source(id));
    this.service = new ExtensionService(this.store, this.canonical);
  }
  list() { return this.service.list(); }
  register(arg: unknown) { const a = this.revisionArg(arg); return this.service.register(a.manifest, a.expectedRevision as number); }
  remove(arg: unknown) {
    const a = this.revisionArg(arg);
    if (!validSectionId(a.id)) throw Error('INVALID_SECTION_ID');
    return this.service.remove(a.id, a.expectedRevision as number);
  }
  rollback(arg: unknown) {
    const a = this.revisionArg(arg);
    if (!validRevision(a.targetRevision)) throw Error('INVALID_SECTION_REVISION');
    return this.service.rollback(a.targetRevision, a.expectedRevision as number);
  }
  context(arg: unknown) {
    if (!arg || typeof arg !== 'object' || !Array.isArray((arg as { ids?: unknown }).ids)) throw Error('INVALID_SECTION_CONTEXT');
    const ids = (arg as { ids: unknown[] }).ids;
    if (ids.length > 5 || ids.some(id => !validSectionId(id))) throw Error('INVALID_SECTION_CONTEXT');
    return this.service.context([...new Set(ids as string[])], 4096);
  }
  archive() { return this.canonical.load(); }
  async saveContext(arg: unknown) {
    const a = this.revisionArg(arg), facts = validateContextFacts(a.facts);
    if (this.confirming) throw Error('CONTEXT_REVIEW_BUSY');
    if (this.canonical.load().revision !== a.expectedRevision) throw Error('CONTEXT_CHANGED');
    this.confirming = true;
    try {
      if (!await this.confirm(facts.map(f => `${f.key}: ${f.value}`).join('\n'), 'memory')) return null;
      return this.canonical.save(facts, a.expectedRevision as number);
    } finally { this.confirming = false; }
  }
  async requestedContext(arg: unknown) {
    // The ordinary inspection path validates the IDs and never promotes pending table data to confirmed facts.
    this.context(arg);
    const ids = (arg as { ids: string[] }).ids, before = this.store.list().revision;
    if (this.confirming) throw Error('CONTEXT_REVIEW_BUSY');
    const at = new Date().toISOString();
    const packet = loadUserContext(this.canonical.getConfirmedEssential(), ids, id => {
      const source = this.source(id);
      return { ...source, facts: source.facts.map(fact => ({ ...fact, confirmation: 'confirmed', confirmedAt: at })) };
    }, 4096);
    if (!packet.text) return packet;
    this.confirming = true;
    try {
      if (!await this.confirm(packet.text, 'source')) return null;
      if (this.store.list().revision !== before) throw Error('CONTEXT_SOURCE_CHANGED');
      return packet; // One reviewed packet only; no persistent source permission or automatic message send.
    } finally { this.confirming = false; }
  }
  private revisionArg(arg: unknown): Record<string, unknown> {
    if (!arg || typeof arg !== 'object' || !validRevision((arg as { expectedRevision?: unknown }).expectedRevision)) throw Error('INVALID_SECTION_REVISION');
    return arg as Record<string, unknown>;
  }
  private source(id: string) {
    const snapshot = this.store.list(), section = snapshot.sections.find(s => s.id === id);
    if (!section || maskSecrets(section.title).masked) throw Error('SOURCE_NOT_AVAILABLE');
    return { schemaVersion: 1, id, label: section.title, revision: snapshot.revision, scope: 'task', facts: section.rows.slice(0, 100).flatMap((row, index) => {
      const value = row.cells.join(' · ');
      // Observed table rows are inspectable sources, not automatically confirmed identity/preferences.
      return value.length <= 2000 && !maskSecrets(value).masked ? [{ id: 'row-'+index, key: id.slice(0, 42)+'-'+index, value, confirmation: 'pending', confirmedAt: null }] : [];
    }) };
  }
}
