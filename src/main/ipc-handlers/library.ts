// IPC handlers, Memoria → Artifact (ADR 0328): the index, a card's picture, a file opened with the system's app, a card
// taken off the list. Registered by src/main/index.ts with every other group (Handlers in ipc.ts keeps the set
// complete); each channel's shape is in src/shared/contract/library.ts. The service (library/service.ts) reads only
// what an agent declared.
import type { LibraryService } from '../library/service';
import type { HandlersOf } from './context';

export function libraryHandlers(library: LibraryService): HandlersOf<'library'> {
  return {
    'library:list': a => library.list({ check: a?.check === true }),
    'library:thumb': a => library.thumb(String(a?.id ?? '').slice(0, 64)),
    'library:open': a => (typeof a?.path === 'string' && a.path.length <= 4096 ? library.open(a.path) : { ok: false, error: 'not an artifact' }),
    'library:remove': a => library.remove(String(a?.id ?? '').slice(0, 64)),
  };
}
