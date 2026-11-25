// The check of a chat's required tools at every start, resume and engine change (ADR 0356, owner 2026-11-25: «controllo
// a ogni avvio, ripresa e cambio motore: confronta gli strumenti obbligatori con quelli che il motore espone davvero. Se
// ne manca uno, l'app ricarica la sessione o passa al canale di riserva, e lo scrive nel log. Mai lasciare il problema
// all'agente»). What the engine was really given: the list its MCP client read from the chat's endpoint in this session
// (every engine), or, better, what the engine itself says it loaded (Claude's init `tools`). Pure: one session's facts in,
// what to do out; ChatManager (manager-sessions.ts) keeps the facts, acts and logs. Tests: test/unit/chats/tool-check.test.ts.
import { missingTools } from '../../shared/role-tools';

/** One engine session's facts about the chat's tools. */
export interface ToolSession {
  /** the session's start (a new engine process, a resume, a new chat after an engine change) */
  startedAt: number;
  /** the names the endpoint served on the last tools/list since the start */
  served?: readonly string[];
  /** the names the engine says it loaded (Claude's init), when it says */
  engineSaw?: readonly string[];
  /** a first turn ended in this session */
  turnEnded?: boolean;
  /** already acted on in this session */
  acted?: 'reload' | 'fallback';
}

export type ToolAction = { kind: 'ok' } | { kind: 'wait' } | { kind: 'reload' | 'fallback'; missing: string[]; why: string };

/** What to do now. `reloads` = how many times the chat's session was already reloaded for its tools (at most one: a
 *  second gap goes to the fallback). `hasEndpoint` = the chat was given the app's endpoint at all. */
export function toolAction(required: readonly string[], s: ToolSession, reloads: number, hasEndpoint: boolean): ToolAction {
  if (!required.length || !hasEndpoint || s.acted === 'fallback') return { kind: 'ok' };
  // the app's own list lacked a tool: an app fault no reload fixes (the fallback reaches the full list)
  if (s.served) {
    const lacking = missingTools(required, s.served);
    if (lacking.length) return { kind: 'fallback', missing: lacking, why: 'the endpoint did not list them' };
  }
  if (s.engineSaw) {
    const lost = missingTools(required, s.engineSaw);
    if (lost.length) return s.acted || reloads >= 1 ? { kind: 'fallback', missing: lost, why: 'the engine did not load them, again after a reload' } : { kind: 'reload', missing: lost, why: 'the engine did not load them' };
    return { kind: 'ok' };
  }
  if (s.served) return { kind: 'ok' };
  // a first turn ended and the engine never read the endpoint in this session
  if (s.turnEnded) return s.acted || reloads >= 1 ? { kind: 'fallback', missing: [...required], why: 'the engine never listed the app tools, again after a reload' } : { kind: 'reload', missing: [...required], why: 'the engine never listed the app tools' };
  return { kind: 'wait' };
}
