// Event-level provenance used by memory tables and ModelOrigin. Historical records stay unknown;
// callers must never manufacture this snapshot from a chat title or the selected model.
export interface EventOrigin {
  kind?: 'human' | 'model';
  agentId?: string | null;
  agentRevision?: number | null;
  sessionId?: string | null;
  turnId?: string | null;
  itemId?: string | null;
  engine?: string | null;
  modelObserved?: string | null;
  effortObserved?: string | null;
  effortSubmitted?: string | null;
  source?: string | null;
  at?: number | null;
}

/** Parse the snapshot carried by an individual event, including scalar table cells. */
export function readEventOrigin(value: unknown): EventOrigin | undefined {
  try {
    const origin = typeof value === 'string' ? JSON.parse(value) : value;
    if (!origin || typeof origin !== 'object' || Array.isArray(origin)) return undefined;
    const o = origin as Record<string, unknown>;
    if (o.kind !== undefined && o.kind !== 'human' && o.kind !== 'model') return undefined;
    const result: EventOrigin = { kind: o.kind === 'human' ? 'human' : 'model' };
    for (const key of ['agentId', 'sessionId', 'turnId', 'itemId', 'engine', 'modelObserved', 'effortObserved', 'effortSubmitted', 'source'] as const) {
      const field = o[key];
      if (field === undefined || field === null) continue;
      if (typeof field !== 'string' || !field.trim() || field.length > 300 || /[\x00-\x1f]/.test(field)) return undefined;
      result[key] = field;
    }
    for (const key of ['agentRevision', 'at'] as const) {
      const field = o[key];
      if (field === undefined || field === null) continue;
      if (typeof field !== 'number' || !Number.isFinite(field) || field < 0) return undefined;
      result[key] = field;
    }
    if (result.kind === 'model' && (!result.modelObserved || !result.source || !result.engine || !result.sessionId || result.at === undefined)) return undefined;
    return result;
  } catch { return undefined; }
}

export const normalizeEventOrigin = readEventOrigin;
