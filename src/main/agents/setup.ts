// Local setup preferences and resumable guide identity, never account credentials or permission grants.
import path from 'node:path';
import type { SetupDraft, SetupState, SetupGuide, SetupProfile } from '../../shared/agents';
import { readLocal, writeLocal } from './local-store';

const blank = (): SetupDraft => ({ step: 0, work: '', goals: '', tools: '', style: 'balanced', agentIds: [] });
export function checkSetup(value: unknown): SetupDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Preferenze non valide.');
  const v = value as Record<string, unknown>;
  if (v.engines !== undefined && (!Array.isArray(v.engines) || v.engines.length > 3 || !v.engines.every(id => typeof id === 'string' && ['claude', 'codex', 'cursor'].includes(id)))) throw new Error('Motori non validi.');
  let guide: SetupGuide | undefined;
  if (v.guide !== undefined) {
    if (!v.guide || typeof v.guide !== 'object' || Array.isArray(v.guide)) throw new Error('Guida non valida.');
    const g = v.guide as Record<string, unknown>;
    if (g.stage === 'fallback' || g.stage === 'choosing') guide = { stage: g.stage };
    else if (['connecting', 'guided'].includes(String(g.stage)) && ['claude', 'codex', 'kimi', 'cursor'].includes(String(g.engine)) && typeof g.chatId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(g.chatId)) guide = { stage: g.stage as 'connecting' | 'guided', engine: g.engine as 'claude' | 'codex' | 'kimi' | 'cursor', chatId: g.chatId };
    else throw new Error('Guida non valida.');
  }
  let profile: SetupProfile | undefined;
  if (v.profile !== undefined) {
    if (!v.profile || typeof v.profile !== 'object' || Array.isArray(v.profile)) throw new Error('Preferenze non valide.');
    const p = v.profile as Record<string, unknown>, limits = { name: 80, role: 240, language: 40, areas: 2000 } as const;
    profile = {};
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
      if (p[key] === undefined) continue;
      if (typeof p[key] !== 'string' || (p[key] as string).length > limits[key]) throw new Error('Preferenze non valide.');
      profile[key] = p[key] as string;
    }
    if (p.style !== undefined) { if (!['balanced', 'concise', 'detailed'].includes(String(p.style))) throw new Error('Preferenze non valide.'); profile.style = p.style as SetupDraft['style']; }
  }
  if (!Number.isInteger(v.step) || Number(v.step) < 0 || Number(v.step) > 20 || !['', 'employee', 'independent', 'other'].includes(String(v.work)) || !['balanced', 'concise', 'detailed'].includes(String(v.style)) || typeof v.goals !== 'string' || v.goals.length > 2000 || typeof v.tools !== 'string' || v.tools.length > 2000 || !Array.isArray(v.agentIds) || v.agentIds.length > 64 || !v.agentIds.every(x => typeof x === 'string' && /^[a-z][a-z0-9_-]{0,79}$/.test(x))) throw new Error('Preferenze non valide.');
  return { step: Number(v.step), work: v.work as SetupDraft['work'], goals: v.goals.trim(), tools: v.tools.trim(), style: v.style as SetupDraft['style'], agentIds: [...new Set(v.agentIds as string[])], ...(v.engines ? { engines: [...new Set(v.engines as string[])] } : {}), ...(guide ? { guide } : {}), ...(profile ? { profile } : {}) };
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
