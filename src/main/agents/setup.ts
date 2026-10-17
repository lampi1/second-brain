import path from 'node:path';
import type { SetupDraft, SetupState } from '../../shared/agents';
import { readLocal, writeLocal } from './local-store';

const blank = (): SetupDraft => ({ step: 0, work: '', goals: '', tools: '', style: 'balanced', agentIds: [] });
export function checkSetup(value: unknown): SetupDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Preferenze non valide.');
  const v = value as Record<string, unknown>;
  if (!Number.isInteger(v.step) || Number(v.step) < 0 || Number(v.step) > 20 || !['', 'employee', 'independent', 'other'].includes(String(v.work)) || !['balanced', 'concise', 'detailed'].includes(String(v.style)) || typeof v.goals !== 'string' || v.goals.length > 2000 || typeof v.tools !== 'string' || v.tools.length > 2000 || !Array.isArray(v.agentIds) || v.agentIds.length > 64 || !v.agentIds.every(x => typeof x === 'string' && /^[a-z][a-z0-9_-]{0,79}$/.test(x))) throw new Error('Preferenze non valide.');
  return { step: Number(v.step), work: v.work as SetupDraft['work'], goals: v.goals.trim(), tools: v.tools.trim(), style: v.style as SetupDraft['style'], agentIds: [...new Set(v.agentIds as string[])] };
}
/** Local preferences only. Never applies brain paths, engine trust, permissions or account changes. */
export class SetupService {
  private readonly file: string;
  private value: SetupState;
  private problem = false;
  constructor(userData: string, existing: boolean, private readonly now = Date.now, private readonly onCompleted?: () => void) {
    this.file = path.join(userData, 'setup.json');
    this.value = { version: 1, status: existing ? 'existing' : 'new', preferences: blank(), updatedAt: 0 };
    try {
      const raw = readLocal(this.file) as Partial<SetupState> | undefined;
      if (raw === undefined) return;
      if (raw?.version !== 1 || !['new', 'existing', 'draft', 'completed', 'skipped'].includes(String(raw.status)) || typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) throw new Error('Invalid setup');
      this.value = { version: 1, status: raw.status!, preferences: checkSetup(raw.preferences), updatedAt: raw.updatedAt };
    } catch { this.problem = true; }
  }
  get(): SetupState { return structuredClone(this.value); }
  save(preferences: unknown, status: 'draft' | 'completed' | 'skipped'): SetupState {
    if (this.problem) throw new Error('Le preferenze locali non sono leggibili. Il file originale è conservato.');
    if (!['draft', 'completed', 'skipped'].includes(status)) throw new Error('Stato setup non valido.');
    const next: SetupState = { version: 1, status, preferences: checkSetup(preferences), updatedAt: this.now() };
    writeLocal(this.file, next);
    const firstCompletion = this.value.status !== 'completed' && status === 'completed';
    this.value = next;
    if (firstCompletion) this.onCompleted?.();
    return this.get();
  }
}
