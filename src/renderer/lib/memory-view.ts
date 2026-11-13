// Pure view helper of the Memoria page: a brain-relative path as an absolute one for the file viewer. The statistics
// helpers left with the Statistiche tab (ADR 0248). No React, no IPC: unit-tested in
// test/unit/brain-ui/memory-view.test.ts.

/** A brain-relative path as an absolute one under the brain root (the file viewer reads absolute paths in the real app
 *  and in the demo alike), with the root's own separator. */
export function brainFile(root: string | null, rel: string): string {
  if (!root) return rel;
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`;
}
