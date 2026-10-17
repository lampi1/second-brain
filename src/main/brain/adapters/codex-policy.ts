// Resolves opt-in Codex autonomy for one repository/worktree, without changing user or machine configuration.
// Settings validate and canonicalize roots; resolution rechecks them for every turn and fails closed on path errors.
// Used by codex.ts (launch overrides), engines/sessions.ts (live policy) and the settings schema.
import fs from 'node:fs';
import path from 'node:path';
import { localPath } from '../../open-path';

export interface CodexExecutionPolicy {
  approvalPolicy: 'on-request' | 'never';
  sandbox: 'read-only' | 'workspace-write';
  writableRoots: string[];
}

let readRoots: () => readonly string[] = () => [];
/** App-owned settings provider, read at launch and every new turn; tests can reset it to an empty provider. */
export function setCodexAutonomyRoots(read: () => readonly string[]): void { readRoots = read; }
export function codexPolicyFor(cwd: string, readOnly = false): CodexExecutionPolicy {
  return resolveCodexPolicy(cwd, readRoots(), readOnly);
}

const real = (file: string): string => fs.realpathSync.native(file);
/** On Windows reject aliases before following any component, including local-link chains that end in UNC. */
function localWithoutLinks(raw: string): string | null {
  const local = localPath(raw);
  if (!local) return null;
  if (process.platform === 'win32') {
    let current = path.parse(local).root;
    for (const part of path.relative(current, local).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) return null;
    }
  }
  return local;
}
export const samePolicyPath = (a: string, b: string): boolean => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** Only complete, existing repository roots; persist real paths so replacing a selected junction cannot widen scope. */
export function canonicalRepoRoot(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1000 || !path.isAbsolute(value)) throw new Error('percorso assoluto di un repository');
  const local = localWithoutLinks(value);
  if (!local) throw new Error('scegli il percorso reale di un repository locale, senza collegamenti o condivisioni');
  const root = real(local);
  const marker = fs.lstatSync(path.join(root, '.git'));
  if (samePolicyPath(root, path.parse(root).root) || root.startsWith('\\\\') || !fs.statSync(root).isDirectory() || marker.isSymbolicLink() || !(marker.isFile() || marker.isDirectory()))
    throw new Error('scegli la cartella di un repository o worktree, non una radice disco o una condivisione');
  return root;
}

/** A root is scoped to its descendants by path components, never a string-prefix match or a sibling junction. */
export function resolveCodexPolicy(cwd: string, roots: readonly string[], readOnly = false): CodexExecutionPolicy {
  if (readOnly) return { approvalPolicy: 'on-request', sandbox: 'read-only', writableRoots: [] };
  const fallback: CodexExecutionPolicy = { approvalPolicy: 'on-request', sandbox: 'workspace-write', writableRoots: [] };
  try {
    const local = localWithoutLinks(cwd);
    if (!local) return fallback;
    const current = real(local);
    const matches = roots.flatMap(saved => {
      try {
        const root = canonicalRepoRoot(saved);
        // A changed symlink in persisted input cannot grant a different root.
        if (!samePolicyPath(path.normalize(saved), root)) return [];
        const relative = path.relative(root, current);
        return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) ? [root] : [];
      } catch { return []; }
    }).sort((a, b) => b.length - a.length);
    return matches.length ? { approvalPolicy: 'never', sandbox: 'workspace-write', writableRoots: [matches[0]!] } : fallback;
  } catch { return fallback; }
}
