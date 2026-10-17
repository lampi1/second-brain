// Private layout/preferences for the agents workspace, versioned independently of legacy grid fractions.
// Only stable pane IDs/topology and user-authored purposes live here; no transcript, browser state or credentials.
import { createStore } from './createStore';
import { boundedLayout, restoreWorkspace, type LayoutNode } from '../lib/agents-layout';

const KEY = 'sb.agents.workspace.v1';
interface WorkspaceState { root: LayoutNode | null; purposes: Record<string, string> }
function load(): WorkspaceState {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    const root = restoreWorkspace(raw);
    const p = raw && typeof raw === 'object' && 'purposes' in raw ? raw.purposes : null;
    const purposes: Record<string, string> = Object.create(null) as Record<string, string>;
    if (p && typeof p === 'object') for (const [key, value] of Object.entries(p).slice(0, 500)) {
      if (key !== '__proto__' && key !== 'constructor' && typeof value === 'string') purposes[key] = value.slice(0, 500);
    }
    return { root, purposes };
  } catch { return { root: null, purposes: {} }; }
}
export const workspace = createStore<WorkspaceState>(load());
function save(): void {
  try {
    const state=workspace.get();
    // Excessive panel counts remain usable in memory; never replace a recoverable saved layout with invalid data.
    if(state.root&&!restoreWorkspace({version:1,root:state.root}))return;
    localStorage.setItem(KEY, JSON.stringify({ version: 1, ...state }));
  } catch { /* memory-only if storage is unavailable */ }
}
export function setWorkspace(root: LayoutNode | null): void { workspace.set(s => ({ ...s, root:boundedLayout(root) })); save(); }
export function setAgentPurpose(id: string, purpose: string): void {
  workspace.set(s => ({ ...s, purposes: { ...s.purposes, [id]: purpose.trim().slice(0, 500) } })); save();
}

export function checkpointWorkspace():string{const state=workspace.get();if(Object.keys(state.purposes).length>500)throw Error('Gli scopi salvati superano il limite di ripristino. L’app resta aperta.');if(state.root&&!restoreWorkspace({version:1,root:state.root}))throw Error('La disposizione supera il limite di salvataggio.');const value=JSON.stringify({version:1,...state});localStorage.setItem(KEY,value);return value;}
export function restoreCheckpointWorkspace():void{workspace.set(load());}
