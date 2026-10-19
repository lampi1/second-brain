// Whether a click on an agent's strip (ChatTile.tsx) is really the end of a text selection, pure so it is unit-tested
// (test/unit/strip-click.test.ts). Only a selection the same pointer gesture made inside the strip (a drag over its
// transcript) holds the click back. A selection made before, anywhere else (an Orchestrator answer, a file), never
// counts: the app's body is not selectable, so a click on a strip does not clear it, and it swallowed every strip click
// until the selection went away (#78, 2026-10-19: "clicking an agent does not expand it").
export interface SelectionLike {
  readonly isCollapsed: boolean;
  readonly rangeCount: number;
  toString(): string;
  getRangeAt(index: number): { readonly commonAncestorContainer: unknown };
}

/** True when the gesture that ended in this click selected new text inside `tile`; `before` = the selected text at its
 *  pointerdown. */
export function selectedHere(sel: SelectionLike | null, tile: { contains(node: never): boolean }, before: string): boolean {
  const text = sel?.toString() ?? '';
  if (!sel || !text || sel.isCollapsed || text === before || sel.rangeCount < 1) return false;
  return tile.contains(sel.getRangeAt(0).commonAncestorContainer as never);
}
