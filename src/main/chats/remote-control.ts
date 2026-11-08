// Claude Code Remote Control (ADR 0229): the claude.ai bridge that lets the user's phone continue the Orchestrator's
// session at claude.ai/code. The protocol is not in the Agent SDK's sdk.d.ts: it was read from the embedded engine
// (2.1.283) and checked live, so every shape here is validated and anything else goes to drift.ts.
//   stdin  ← control_request {subtype:'remote_control', enabled, name?, reattach_session_id?}
//   stdout → its control_response {session_url, connect_url, environment_id, bridge_epoch, bridge_session_id} (on) or
//            nothing (off); system/bridge_state {state: ready|connected|failed|policy_disabled|…, detail?}
//   with --replay-user-messages every user message the engine queues comes back with isReplay: ours carry the uuid we
//   sent, a message typed on the phone does not.
// Used by claude.ts (the request, bridge_state, the phone's messages) and manager-remote.ts (state, reattach).
import type { RemoteControlState } from '../../shared/contract';

/** What the engine answered to remote_control on. */
export interface RemoteControlReply { url: string; bridgeSessionId: string | null }

const URL_RE = /^https:\/\/claude\.ai\/code[/?]/;
const BRIDGE_ID = /^[A-Za-z0-9_-]{1,120}$/;

/** The enable reply, or null when it carries no usable session link (protocol drift). Only a claude.ai link is ever
 *  shown in the app. */
export function readRemoteControlReply(r: Record<string, unknown>): RemoteControlReply | null {
  const url = typeof r.session_url === 'string' && URL_RE.test(r.session_url) ? r.session_url : null;
  if (!url) return null;
  const id = typeof r.bridge_session_id === 'string' && BRIDGE_ID.test(r.bridge_session_id) ? r.bridge_session_id : null;
  return { url, bridgeSessionId: id };
}

/** A bridge_state message as a state patch, or null for a state the app does not know (drift). */
export function bridgePatch(state: string, detail: string | undefined): { status: 'ready' | 'connected' | 'failed'; error?: string } | null {
  if (state === 'ready' || state === 'connected') return { status: state };
  if (state === 'policy_disabled') return { status: 'failed', error: detail || 'Remote Control è disattivato dalla policy dell’organizzazione.' };
  if (state === 'failed') return { status: 'failed', error: detail || 'Remote Control si è interrotto.' };
  return null;
}

/** A stored state as it is when its engine is not running: on → paused (it reattaches at the next start). */
export function pausedState(rc: RemoteControlState | undefined): RemoteControlState | undefined {
  if (!rc) return undefined;
  if (!rc.on) return { ...rc, status: 'off' };
  return { on: true, url: rc.url, bridgeSessionId: rc.bridgeSessionId, status: 'paused' };
}

/** A persisted remoteControl (chats.json), validated: only a wanted bridge survives a restart. */
export function readStoredRemote(v: unknown): RemoteControlState | undefined {
  const x = v as Record<string, unknown> | null;
  if (!x || typeof x !== 'object' || x.on !== true) return undefined;
  const url = typeof x.url === 'string' && URL_RE.test(x.url) ? x.url : null;
  const id = typeof x.bridgeSessionId === 'string' && BRIDGE_ID.test(x.bridgeSessionId) ? x.bridgeSessionId : null;
  return { on: true, url, bridgeSessionId: id, status: 'paused' };
}

/** The text of a replayed user message the phone typed, or null: one we sent (its uuid), a meta or synthetic message,
 *  a system reminder or a tool result is not the user's typing. */
export function phoneText(m: Record<string, unknown>, ours: ReadonlySet<string>): string | null {
  if (m.isReplay !== true || m.isSynthetic === true || m.isMeta === true) return null;
  if (typeof m.uuid === 'string' && ours.has(m.uuid)) return null;
  const msg = m.message as Record<string, unknown> | undefined;
  const c = msg?.content;
  const parts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.flatMap(b => {
    const x = b as Record<string, unknown> | null;
    return x && x.type === 'text' && typeof x.text === 'string' ? [x.text] : [];
  }) : [];
  if (Array.isArray(c) && c.some(b => (b as Record<string, unknown> | null)?.type === 'tool_result')) return null;
  const text = parts.join('\n').trim();
  if (!text || text.startsWith('<')) return null;
  return text;
}
