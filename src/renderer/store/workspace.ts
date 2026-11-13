// Private agent purposes typed by the user (setAgentPurpose), kept across restarts and updates. No layout or order lives
// here: the Orchestrator orders the agents (lib/agent-order.ts). The stored shape stays { version: 1, root, purposes } so
// copies written by older versions still load; their saved `root` (the retired drag layout) is ignored and saved as null.
import { createStore } from './createStore';
import { t } from '../i18n';

const KEY = 'sb.agents.workspace.v1';
interface WorkspaceState { purposes: Record<string, string> }

/** The purposes of a stored copy, read as untrusted input (the first 500, no prototype keys); null = not a valid copy. */
export function readPurposes(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || !('version' in raw) || raw.version !== 1) return null;
  const p = 'purposes' in raw ? raw.purposes : {};
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const purposes: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(p).slice(0, 500)) if (key !== '__proto__' && key !== 'constructor' && typeof value === 'string') purposes[key] = value.slice(0, 500);
  return purposes;
}
function load(): WorkspaceState {
  try { return { purposes: readPurposes(JSON.parse(localStorage.getItem(KEY) ?? 'null')) ?? {} }; } catch { return { purposes: {} }; }
}
const stored = () => JSON.stringify({ version: 1, root: null, ...workspace.get() });
export const workspace = createStore<WorkspaceState>(load());
function save(): void {
  try { localStorage.setItem(KEY, stored()); } catch { /* memory-only if storage is unavailable */ }
}
export function setAgentPurpose(id: string, purpose: string): void {
  workspace.set(s => ({ ...s, purposes: { ...s.purposes, [id]: purpose.trim().slice(0, 500) } })); save();
}

export function checkpointWorkspace(): string {
  if (Object.keys(workspace.get().purposes).length > 500) throw Error(t('appText.workspace.tooMany'));
  const value = stored(); localStorage.setItem(KEY, value); return value;
}
export function restoreCheckpointWorkspace(): void { workspace.set(load()); }
