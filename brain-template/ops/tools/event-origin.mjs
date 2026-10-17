// Immutable provenance for memory producers and table parsers. The app supplies a per-chat context
// containing actual provider observations; an absent/invalid context is never filled from profiles.
import fs from 'node:fs';

export function readEventOrigin(value) {
  try {
    const o = typeof value === 'string' ? JSON.parse(value) : value;
    if (!o || typeof o !== 'object' || Array.isArray(o) || (o.kind !== undefined && !['human', 'model'].includes(o.kind))) return undefined;
    const result = { kind: o.kind === 'human' ? 'human' : 'model' };
    for (const key of ['agentId', 'sessionId', 'turnId', 'itemId', 'engine', 'modelObserved', 'effortObserved', 'effortSubmitted', 'source']) {
      const field = o[key];
      if (field === undefined || field === null) continue;
      if (typeof field !== 'string' || !field.trim() || field.length > 300 || /[\x00-\x1f]/.test(field)) return undefined;
      result[key] = field;
    }
    for (const key of ['agentRevision', 'at']) {
      const field = o[key];
      if (field === undefined || field === null) continue;
      if (typeof field !== 'number' || !Number.isFinite(field) || field < 0) return undefined;
      result[key] = field;
    }
    if (result.kind === 'model' && (!result.modelObserved || !result.source || !result.engine || !result.sessionId || result.at === undefined)) return undefined;
    return result;
  } catch { return undefined; }
}

export function eventContext(file = process.env.SB_EVENT_CONTEXT) {
  try {
    if (!file || fs.statSync(file).size > 16384) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.version !== 1) return {};
    return { origin: readEventOrigin(data.origin), responsibleEpisode: readEventOrigin(data.responsibleEpisode) };
  } catch { return {}; }
}

// URI encoding keeps separators and quoted provider strings inside a single markdown field.
export const originField = origin => origin ? encodeURIComponent(JSON.stringify(origin)) : '';
export function parseOriginField(text) {
  try { const origin = readEventOrigin(decodeURIComponent(text)); return origin ? JSON.stringify(origin) : ''; }
  catch { return ''; }
}
