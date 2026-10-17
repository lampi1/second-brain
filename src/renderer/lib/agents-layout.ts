// Serializable panel topology for the agents workspace. Original implementation; no editor/workbench dependency.
// Stable pane IDs keep UI layout separate from native browser ownership, pages, cookies and chat state.
export type DockSide = 'left' | 'right' | 'top' | 'bottom';
export type LayoutNode = { kind: 'pane'; key: string } | { kind: 'split'; id: string; axis: 'row' | 'column'; ratio: number; first: LayoutNode; second: LayoutNode };
export interface SavedWorkspace { version: 1; root: LayoutNode | null }
export const clampRatio = (n: number) => Math.max(0.15, Math.min(0.85, Number.isFinite(n) ? n : 0.5));
export const paneKeys = (node: LayoutNode | null): string[] => !node ? [] : node.kind === 'pane' ? [node.key] : [...paneKeys(node.first), ...paneKeys(node.second)];
const splitId = (a: LayoutNode, b: LayoutNode) => `split:${paneKeys(a)[0]}:${paneKeys(b)[0]}`;

/** Validate private localStorage as untrusted input: bounded depth/size, finite dimensions, unique stable IDs. */
export function restoreWorkspace(raw: unknown): LayoutNode | null {
  const keys = new Set<string>(); let count = 0;
  const read = (value: unknown, depth: number): LayoutNode => {
    if (!value || typeof value !== 'object' || depth > 32 || ++count > 511) throw new Error();
    const n = value as Record<string, unknown>;
    if (n.kind === 'pane' && typeof n.key === 'string' && /^(chat|browser):[^\x00-\x1f]{1,160}$/.test(n.key) && !keys.has(n.key)) {
      keys.add(n.key); return { kind: 'pane', key: n.key };
    }
    if (n.kind !== 'split' || !['row', 'column'].includes(String(n.axis)) || typeof n.ratio !== 'number' || !Number.isFinite(n.ratio)) throw new Error();
    const first = read(n.first, depth + 1), second = read(n.second, depth + 1);
    return { kind: 'split', id: splitId(first, second), axis: n.axis as 'row' | 'column', ratio: clampRatio(n.ratio), first, second };
  };
  try {
    if (!raw || typeof raw !== 'object' || !('version' in raw) || raw.version !== 1 || !('root' in raw)) return null;
    return raw.root === null ? null : read(raw.root, 0);
  } catch { return null; }
}

/** Hiding/focusing a panel projects the tree; it never mutates the saved arrangement. */
export function visibleLayout(node: LayoutNode | null, visible: ReadonlySet<string>): LayoutNode | null {
  if (!node) return null;
  if (node.kind === 'pane') return visible.has(node.key) ? node : null;
  const first = visibleLayout(node.first, visible), second = visibleLayout(node.second, visible);
  if (!first) return second;
  if (!second) return first;
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function balancedLayout(keys: readonly string[], depth = 0): LayoutNode | null {
  if (!keys.length) return null;
  if (keys.length === 1) return { kind: 'pane', key: keys[0]! };
  const mid = Math.ceil(keys.length / 2);
  const first = balancedLayout(keys.slice(0, mid), depth + 1)!, second = balancedLayout(keys.slice(mid), depth + 1)!;
  return { kind: 'split', id: splitId(first, second), axis: depth % 2 === 0 ? 'row' : 'column', ratio: 0.5, first, second };
}

/** Drop one pane beside another; removing the old leaf collapses empty splits before inserting exactly once. */
export function dockPane(root: LayoutNode | null, moving: string, target: string, side: DockSide): LayoutNode | null {
  const keys = paneKeys(root);
  if (moving === target || !keys.includes(moving) || !keys.includes(target)) return root;
  const reduced = visibleLayout(root, new Set(keys.filter(k => k !== moving)));
  const insert = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'pane') {
      if (node.key !== target) return node;
      const pane: LayoutNode = { kind: 'pane', key: moving };
      const first = side === 'left' || side === 'top' ? pane : node;
      const second = first === pane ? node : pane;
      return { kind: 'split', id: splitId(first, second), axis: side === 'left' || side === 'right' ? 'row' : 'column', ratio: 0.5, first, second };
    }
    const first = insert(node.first), second = insert(node.second);
    return { ...node, id: splitId(first, second), first, second };
  };
  return reduced ? insert(reduced) : root;
}

/** New panels join the workspace without reflowing the user's existing topology; browser owner is a preferred anchor. */
export function reconcileLayout(root: LayoutNode | null, keys: readonly string[], owner: Readonly<Record<string, string>> = {}): LayoutNode | null {
  const unique = [...new Set(keys)];
  if (!root) return balancedLayout(unique);
  let next = visibleLayout(root, new Set(unique));
  for (const key of unique.filter(k => !paneKeys(next).includes(k))) {
    const leaf: LayoutNode = { kind: 'pane', key };
    if (!next) { next = leaf; continue; }
    const first = next;
    next = { kind: 'split', id: splitId(first, leaf), axis: 'row', ratio: 0.65, first, second: leaf };
    const anchor = owner[key];
    if (anchor && paneKeys(first).includes(anchor)) next = dockPane(next, key, anchor, 'right');
  }
  // Keep every layout emitted by this writer within the reader's depth bound, including repeated manual docking.
  return boundedLayout(next);
}

function depth(node:LayoutNode|null):number { return !node ? 0 : node.kind==='pane' ? 1 : 1+Math.max(depth(node.first),depth(node.second)); }
export function boundedLayout(node:LayoutNode|null):LayoutNode|null { return depth(node)>30 ? balancedLayout(paneKeys(node)) : node; }

export function resizeSplit(node: LayoutNode, id: string, ratio: number): LayoutNode {
  if (node.kind === 'pane') return node;
  if (node.id === id) return { ...node, ratio: clampRatio(ratio) };
  return { ...node, first: resizeSplit(node.first, id, ratio), second: resizeSplit(node.second, id, ratio) };
}

export function dropSide(x: number, y: number, width: number, height: number): DockSide {
  const horizontal = Math.abs(x / width - 0.5), vertical = Math.abs(y / height - 0.5);
  return horizontal >= vertical ? x < width / 2 ? 'left' : 'right' : y < height / 2 ? 'top' : 'bottom';
}
