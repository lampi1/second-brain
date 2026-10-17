// Messages between the main process (hybrid/service.ts) and the hybrid search worker (hybrid/worker.ts). Types only.

import type { SearchIndexStatus } from '../../../shared/contract';

export type HybridStatus = SearchIndexStatus;

export type WorkerReq =
  | { op: 'init'; download: boolean }
  | { op: 'download' }
  | { op: 'sync'; root: string }
  | { op: 'query'; q: string; limit?: number; prefix?: string }
  | { op: 'embed'; texts: string[]; mode: 'query' | 'passage' }
  | { op: 'vectors'; prefix: string }
  | { op: 'status' };
