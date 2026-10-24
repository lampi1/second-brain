// Strict model-output parser and dedupe for Battito. Only digest evidence may become a plain-text card.
import { createHash, randomBytes } from 'node:crypto';
import type { PulseCard, PulsePlace, PulseType } from '../../shared/pulse';
import type { PulseDigest } from './digest';
import { safeRelative } from './digest';
export const PULSE_TYPES: readonly PulseType[] = ['idea', 'consiglio', 'promemoria', 'collegamento', 'curiosita', 'agente'];
const HOURS: Record<PulseType, number> = { idea: 72, consiglio: 48, promemoria: 24, collegamento: 72, curiosita: 48, agente: 168 };
const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const cardKey = (type: PulseType, title: string) => createHash('sha1').update(`${type}:${normalize(title)}`).digest('hex');
const validText = (s: unknown, max: number): s is string => typeof s === 'string' && !!s.trim() && s.length <= max && !/[\u0000-\u001f]/.test(s);
export function similar(a: string, b: string): boolean {
  const x = new Set(normalize(a).split(' ')), y = new Set(normalize(b).split(' '));
  return [...x].filter(t => y.has(t)).length / Math.max(x.size, y.size) >= 0.6;
}
export function parseCards(answer: string, digest: PulseDigest, previous: PulseCard[], keys: string[], runId: string, engine: string | null, at: number): PulseCard[] {
  if (answer.length > 8000) return [];
  let raw: unknown;
  try { raw = JSON.parse(answer); } catch { return []; }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { cards?: unknown }).cards)) return [];
  const accepted: PulseCard[] = [];
  for (const value of (raw as { cards: unknown[] }).cards.slice(0, 4)) {
    if (!value || typeof value !== 'object') continue;
    const c = value as Record<string, unknown>, type = c.type as PulseType;
    // ideas come only from the user's «Manutenzione» now (ADR 0149): the Battito never makes an idea card
    if (type === 'idea') continue;
    if (!PULSE_TYPES.includes(type) || !validText(c.title, 80) || !validText(c.body, 280) || !validText(c.why, 160)
      || !Array.isArray(c.refs) || c.refs.length < 1 || c.refs.length > 3 || !Array.isArray(c.places) || !c.places.length || c.places.length > 4) continue;
    const refs = c.refs.map(r => typeof r === 'string' ? digest.entries.find(e => e.id === r)?.ref : undefined);
    if (refs.some(r => !r)) continue;
    const allowed = new Set<PulsePlace>(['board', 'search', ...digest.entries.flatMap(e => e.ref.kind === 'agent'
      ? [`agent:${e.ref.ref}` as const] : e.ref.kind === 'file' && safeRelative(e.ref.ref) ? [`file:${e.ref.ref}` as const] : [])]);
    if (c.places.some(p => typeof p !== 'string' || !allowed.has(p as PulsePlace))) continue;
    const key = cardKey(type, c.title);
    if (keys.includes(key) || [...previous.slice(-50), ...accepted].some(p => p.key === key || similar(p.title, c.title as string))) continue;
    let action: PulseCard['action'];
    if (c.action !== undefined) {
      const a = c.action as Record<string, unknown> | null;
      if (!a || a.kind !== 'chat' || !validText(a.prompt, 500)) continue;
      action = { kind: 'chat', prompt: a.prompt };
    }
    accepted.push({ id: `pc_${randomBytes(6).toString('hex')}`, type, title: c.title, body: c.body, why: c.why,
      refs: refs.filter(r => !!r), places: [...new Set([...(c.places as PulsePlace[]), ...refs.flatMap(r => r?.kind === 'agent'
        ? [`agent:${r.ref}` as const] : r?.kind === 'file' && safeRelative(r.ref) ? [`file:${r.ref}` as const] : [])])].slice(0, 4), ...(action ? { action } : {}),
      runId, engine, source: 'model', createdAt: at, expiresAt: at + HOURS[type] * 3600_000, key, state: 'new' });
  }
  return accepted;
}
