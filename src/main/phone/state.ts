// The phone bridge's saved state, <userData>/phone-state.json: the getUpdates offset, the paired ids, the on/off
// switches, quiet hours, counters and the last 20 phone actions (neutral labels only). Never a message text, never the
// token. Read defensively (a missing or broken file gives the defaults), written atomically (temp file + rename).
// Used by bridge.ts; tests: test/unit/phone/state.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { PhoneAction } from '../../shared/contract/phone';

export const RECENT_MAX = 20;
export const DEFAULT_QUIET = { from: 22, to: 7 };

export interface PhoneState {
  version: 1;
  /** next getUpdates offset (last update_id + 1) */
  offset: number;
  paired: { userId: number; chatId: number } | null;
  /** the PC's on/off switch (Impostazioni → Telefono) */
  enabled: boolean;
  /** /stop from the phone: off until re-enabled on the PC */
  stoppedFromPhone: boolean;
  /** /pausa: nothing outbound except urgent */
  paused: boolean;
  quietHours: { from: number; to: number } | null;
  counters: { dropped: number };
  recent: PhoneAction[];
}

export const defaultState = (): PhoneState => ({
  version: 1, offset: 0, paired: null, enabled: false, stoppedFromPhone: false, paused: false,
  quietHours: { ...DEFAULT_QUIET }, counters: { dropped: 0 }, recent: [],
});

const KINDS = new Set<PhoneAction['kind']>(['text', 'voice', 'answer', 'plan', 'command', 'backlog', 'dropped']);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const hour = (v: unknown) => isInt(v) && v >= 0 && v <= 23;

export function validQuiet(q: unknown): q is { from: number; to: number } {
  return !!q && typeof q === 'object' && hour((q as { from: unknown }).from) && hour((q as { to: unknown }).to);
}

/** Every field checked; anything odd falls back to its default. */
export function sanitizeState(raw: unknown): PhoneState {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const p = r.paired as Record<string, unknown> | null | undefined;
  const recent = Array.isArray(r.recent) ? r.recent : [];
  return {
    version: 1,
    offset: isInt(r.offset) && r.offset >= 0 ? r.offset : 0,
    paired: p && isInt(p.userId) && isInt(p.chatId) && p.userId === p.chatId ? { userId: p.userId, chatId: p.chatId } : null,
    enabled: r.enabled === true,
    stoppedFromPhone: r.stoppedFromPhone === true,
    paused: r.paused === true,
    quietHours: r.quietHours === null ? null : validQuiet(r.quietHours) ? { from: r.quietHours.from, to: r.quietHours.to } : d.quietHours,
    counters: { dropped: isInt((r.counters as { dropped?: unknown } | undefined)?.dropped) ? (r.counters as { dropped: number }).dropped : 0 },
    recent: recent
      .filter((a): a is PhoneAction => !!a && typeof a === 'object' && isInt((a as PhoneAction).at) && KINDS.has((a as PhoneAction).kind) && typeof (a as PhoneAction).label === 'string')
      .map(a => ({ at: a.at, kind: a.kind, label: a.label.slice(0, 60) }))
      .slice(-RECENT_MAX),
  };
}

export function loadState(file: string): PhoneState {
  try { return sanitizeState(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return defaultState(); }
}

/** Atomic: a crash mid-write leaves the previous file whole. */
export function saveState(file: string, s: PhoneState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Adds an action, keeping the last RECENT_MAX. */
export function pushAction(s: PhoneState, action: PhoneAction): void {
  s.recent.push({ at: action.at, kind: action.kind, label: action.label.slice(0, 60) });
  if (s.recent.length > RECENT_MAX) s.recent.splice(0, s.recent.length - RECENT_MAX);
}
