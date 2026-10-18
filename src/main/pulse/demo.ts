// Deterministic in-memory Bacheca fixtures for demo UI. Never invokes a CLI, edits the brain, or spends tokens.
import type { ApprovalItem, PulseCard, PulseSettings } from '../../shared/pulse';
import { localDay } from '../jobs/scheduler';
import { pulseStubHandlers } from './handlers';
export function pulseDemoHandlers(now: number, options?: { settings(): PulseSettings | undefined; changed(): void; approvalsChanged(): void }): ReturnType<typeof pulseStubHandlers> {
  const base = pulseStubHandlers();
  const cards: PulseCard[] = [
    { id: 'pc_demoidea', type: 'idea', title: 'Raccogli le idee della settimana', body: 'Tre appunti parlano dello stesso progetto.', why: 'Un collegamento tra le ultime note.',
      refs: [{ kind: 'idea', ref: 'demo-idea' }], places: ['board', 'search'], runId: '', engine: 'claude', source: 'demo', createdAt: now, expiresAt: now + 86400_000, key: 'demo-idea', state: 'new' },
    { id: 'pc_demoreminder', type: 'promemoria', title: 'Riprendi la revisione', body: 'La revisione del progetto è ancora aperta.', why: 'Dal riepilogo delle attività.',
      refs: [{ kind: 'now', ref: 'demo-now' }], places: ['board'], runId: '', engine: null, source: 'demo', createdAt: now - 1, expiresAt: now + 86400_000, key: 'demo-now', state: 'new' },
  ];
  const approvals: ApprovalItem[] = [{ id: 'pa_demo', kind: 'learned-rule', agentId: 'default-pulse', title: 'Meno promemoria ripetuti', text: 'Non ripetere un promemoria già visto oggi.', evidence: ['pc_demoreminder'], engine: 'claude', createdAt: now, state: 'pending' }];
  const status = async () => { const s = await base['pulse:status'](undefined, undefined as never); return { ...s, today: { ...s.today, date: localDay(now) }, on: options?.settings()?.on !== false, reason: 'Demo: nessun modello viene avviato.', canSave: true, saveReason: undefined }; };
  return { ...base, 'pulse:status': status,
    'pulse:list': async a => { const set = options?.settings(); return { cards: structuredClone(cards.filter(c => set?.on !== false && set?.types[c.type] !== false && (c.state === 'new' || c.state === 'seen') && c.places.includes(a.place))), status: await status() }; },
    'pulse:seen': a => { for (const c of cards) if (a.ids.includes(c.id) && c.state === 'new') c.state = 'seen'; },
    'pulse:save': a => { const c = cards.find(c => c.id === a.id); if (!c) return { ok: false, error: 'Carta non trovata.' }; c.state = 'saved'; options?.changed(); return { ok: true }; },
    'pulse:dismiss': a => { const c = cards.find(c => c.id === a.id); if (!c) return { ok: false, error: 'Carta non trovata.' }; c.state = 'dismissed'; options?.changed(); return { ok: true }; },
    'approvals:list': a => structuredClone(approvals.filter(p => p.state === 'pending' && (!a?.agentId || p.agentId === a.agentId))),
    'approvals:decide': a => { const p = approvals.find(p => p.id === a.id); if (!p) return { ok: false, error: 'Proposta non trovata.' };
      if (a.decision === 'edit' && a.text?.trim()) p.text = a.text.trim();
      else if (a.decision === 'approve') p.state = 'approved'; else if (a.decision === 'discard') p.state = 'discarded'; else return { ok: false, error: 'Decisione non valida.' };
      options?.approvalsChanged(); return { ok: true }; },
  };
}
