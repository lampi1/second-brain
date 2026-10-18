// Durable daily suggestion-job cost ledger. Main-owned paid jobs reserve their maximum cost before starting;
// direct MCP authoring calls generate no text and cost zero. Unknown or interrupted jobs retain their reservation.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readLocal, writeLocal } from './local-store';
interface Charge { id: string; day: string; reserved: number; actual?: number }
const day = (at: number) => new Date(at).toLocaleDateString('en-CA');
export class SuggestionBudget {
  private readonly file: string;
  private charges: Charge[] = [];
  private problem = false;
  constructor(userData: string, private readonly now = Date.now) {
    this.file = path.join(userData, 'agent-suggestion-spend.json');
    try {
      const raw = readLocal(this.file) as { version: number; charges: Charge[] } | undefined;
      if (raw) {
        if (raw.version !== 1 || !Array.isArray(raw.charges) || !raw.charges.every(c => typeof c.id === 'string' && typeof c.day === 'string' && Number.isFinite(c.reserved) && c.reserved >= 0 && (c.actual === undefined || Number.isFinite(c.actual) && c.actual >= 0))) throw new Error('Invalid ledger.');
        this.charges = raw.charges;
      }
    } catch { this.problem = true; }
  }
  spent(): number | null {
    return this.problem ? null : this.charges.filter(c => c.day === day(this.now())).reduce((sum, c) => sum + (c.actual ?? c.reserved), 0);
  }
  reserve(maxUsd: number): string {
    const spent = this.spent();
    if (spent === null || !Number.isFinite(maxUsd) || maxUsd <= 0 || spent + maxUsd > 0.5) throw new Error('Daily suggestion budget exhausted or unknown.');
    const id = randomUUID();
    this.save([...this.charges.filter(c => c.day === day(this.now())), { id, day: day(this.now()), reserved: maxUsd }]);
    return id;
  }
  settle(id: string, actual: number | null): void {
    const charge = this.charges.find(c => c.id === id);
    if (!charge || charge.actual !== undefined || actual !== null && (!Number.isFinite(actual) || actual < 0)) throw new Error('Invalid suggestion charge.');
    if (actual === null) return;
    this.save(this.charges.map(c => c.id === id ? { ...c, actual } : c));
  }
  private save(charges: Charge[]): void {
    if (this.problem) throw new Error('Suggestion ledger unreadable.');
    writeLocal(this.file, { version: 1, charges }); this.charges = charges;
  }
}
