// Row-major grid geometry used directly by AgentsWorkspace, with uniform rows that grow when a chat expands.
export const MOSAIC_MIN_WIDTH = 480;
export const MOSAIC_GAP = 12;
export function mosaicGrid(count: number, width: number, expanded: readonly number[] = []) {
  const columns = Math.max(1, Math.min(count, Math.floor((Math.max(0, width) + MOSAIC_GAP) / (MOSAIC_MIN_WIDTH + MOSAIC_GAP))));
  const rows = Array.from({ length: Math.ceil(count / columns) }, (_, row) => expanded.some(index => Math.floor(index / columns) === row) ? 480 : 320);
  return { columns, rows, cells: Array.from({ length: count }, (_, i) => ({ column: i % columns + 1, row: Math.floor(i / columns) + 1 })) };
}
// Hidden panes keep their saved position; moving one pane preserves every other pane's relative order.
export function reorderPane(keys: readonly string[], moving: string, target: string, after: boolean): string[] {
  if (moving === target || !keys.includes(moving) || !keys.includes(target)) return [...keys];
  const next = keys.filter(key => key !== moving);
  next.splice(next.indexOf(target) + Number(after), 0, moving);
  return next;
}
