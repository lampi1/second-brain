// A renderer click supplies bounded profile fields, never a destination path, script, runtime or global options.
import path from 'node:path';
import type { BrainCreationCapability, CreateBrainRequest, CreatedBrain } from '../../shared/brain-create';
import type { BrainCreator } from './create';

export interface BrainCreationDeps {
  creator: Pick<BrainCreator, 'capability' | 'create'>;
  chooseParent: (folderName: string) => Promise<string | null>;
  currentRoot: () => string | null;
  selectionRevision: () => number;
  connect: (root: string) => Promise<void>;
  engineKnown: (engine: string) => boolean;
  disabled?: boolean;
}
export class BrainCreationController {
  private busy = false;
  constructor(private readonly d: BrainCreationDeps) {}
  capability(): BrainCreationCapability {
    return this.d.disabled ? { available: false, reason: 'Collega una memoria esistente. La creazione richiede il template verificato di una versione installata.' } : this.d.creator.capability();
  }
  async create(value: CreateBrainRequest): Promise<CreatedBrain | null> {
    if (this.busy) throw new Error('Una memoria è già in preparazione.');
    const cap = this.capability();
    if (!cap.available) throw new Error(cap.reason ?? 'Template non disponibile.');
    const r = value;
    if (!r || typeof r.folderName !== 'string' || r.folderName !== r.folderName.trim() || !/^[^\\/:*?"<>|\x00-\x1f\x7f]{1,64}$/.test(r.folderName) || /[. ]$/.test(r.folderName) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(r.folderName) ||
      typeof r.name !== 'string' || !r.name.trim() || r.name.length > 80 || typeof r.role !== 'string' || r.role.length > 240 || !['it', 'en'].includes(r.language) || typeof r.harness !== 'string' || !this.d.engineKnown(r.harness)) throw new Error('Controlla nome, ruolo, lingua, motore e nome della nuova cartella.');
    // Copy only documented fields before awaiting the picker; later edits cannot change an in-flight request.
    const fields = { name: r.name, role: r.role, language: r.language, harness: r.harness }, folderName = r.folderName;
    this.busy = true;
    const previous = this.d.currentRoot();
    const revision = this.d.selectionRevision();
    try {
      const parent = await this.d.chooseParent(folderName);
      if (parent === null) return null;
      if (typeof parent !== 'string' || !path.isAbsolute(parent)) throw new Error('Scegli una cartella locale.');
      if (!this.d.engineKnown(fields.harness)) throw new Error('Il motore selezionato non è più disponibile.');
      const result = await this.d.creator.create(path.join(parent, folderName), fields);
      if (this.d.selectionRevision() !== revision || this.d.currentRoot() !== previous) return { root: result.root, connected: false };
      try { await this.d.connect(result.root); }
      catch { throw new Error(`Memoria creata e conservata in ${result.root}. Il collegamento non è riuscito: usa «Collega esistente».`); }
      return { root: result.root, connected: true };
    } finally { this.busy = false; }
  }
}
