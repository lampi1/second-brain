// Memoria → Artifact (ADR 0318): the index of the reports, analyses, documents and images the chats produce. One area of
// the IPC contract: src/shared/contract.ts re-exports it and assembles the channel maps (change a shape here first, then
// both sides). Handlers: src/main/ipc-handlers/library.ts.
import type { ArtifactList, ArtifactThumb } from '../library';

/** renderer → main, library: each entry [argument, result]. Part of InvokeMap (src/shared/contract.ts). */
export interface LibraryInvokeMap {
  /** the index as it is; `scan` (the tab opening) also starts a look through the folders when the last one is older
   *  than a minute */
  'library:list': [{ scan?: boolean } | void, ArtifactList];
  /** «Aggiorna»: look through the folders now; the index after it */
  'library:refresh': [void, ArtifactList];
  /** a card's picture: an image scaled down by main, or an HTML page's head for the renderer to draw; null = none */
  'library:thumb': [{ id: string }, ArtifactThumb | null];
  /** opens an artifact's file (the path the viewer shows: one of the index's versions or kept copies) with the system's
   *  app, for what the viewer does not render (Word, Excel, video…); any other path is refused */
  'library:open': [{ path: string }, { ok: boolean; error?: string }];
}
