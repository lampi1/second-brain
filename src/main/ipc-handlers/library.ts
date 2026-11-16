// IPC handlers, Memoria → Artifact (ADR 0317): the index, «Aggiorna», a card's picture, a file opened with the system's app. Registered by src/main/index.ts
// with every other group (Handlers in ipc.ts keeps the set complete); each channel's shape is in
// src/shared/contract/library.ts. The service (library/service.ts) reads only what it indexed itself.
import type { LibraryService } from '../library/service';
import type { HandlersOf } from './context';

export function libraryHandlers(library: LibraryService): HandlersOf<'library'> {
  return {
    'library:list': () => library.list(),
    'library:refresh': () => library.refresh(),
    'library:thumb': a => library.thumb(String(a?.id ?? '').slice(0, 64)),
    'library:open': a => (typeof a?.path === 'string' && a.path.length <= 4096 ? library.open(a.path) : { ok: false, error: 'not an artifact' }),
  };
}
