// Memoria → Artifact (ADR 0328): the reports, documents and plans the agents made because the user asked for one. One
// area of the IPC contract: src/shared/contract.ts re-exports it and assembles the channel maps (change a shape here
// first, then both sides). Handlers: src/main/ipc-handlers/library.ts.
import type { ArtifactList, ArtifactThumb } from '../library';

/** renderer → main, library: each entry [argument, result]. Part of InvokeMap (src/shared/contract.ts). */
export interface LibraryInvokeMap {
  /** the index as it is; `check` (the tab opening) also looks at every known file again (gone, back, rewritten) and
   *  says so with 'library:changed' */
  'library:list': [{ check?: boolean } | void, ArtifactList];
  /** a card's picture: an image scaled down by main, or an HTML page's head for the renderer to draw; null = none */
  'library:thumb': [{ id: string }, ArtifactThumb | null];
  /** opens an artifact's file (the path the viewer shows: one of the index's versions or kept copies) with the system's
   *  app, for the original layout of a Word, Excel or PowerPoint file; any other path is refused */
  'library:open': [{ path: string }, { ok: boolean; error?: string }];
  /** takes an artifact off the list (the index entry and the app's copies; the file stays where it is); the index after it */
  'library:remove': [{ id: string }, ArtifactList];
}
