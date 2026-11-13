// The hybrid search's two outward faces (SPEC 23: one search for the app and the agents): the brain_search tool on every
// chat's own MCP endpoint, and the answer of the brain pages' /api/search (main answers it instead of the brain's
// substring server: brain.serveApi). Both read the same index through HybridSearch.query. Used by wiring.ts.
import type { McpTool } from '../../mcp/server';
import type { Hit } from './engine';

type Query = (q: string, opts: { limit?: number; prefix?: string }) => Promise<Hit[]>;

const GUIDANCE = `Search Brother's brain (the second-brain folder: now.md, journal, ai-errors.md, ideas, rules, runbooks) by words AND by meaning, in Italian or English: exact names and codes match by words, paraphrases and the other language by meaning; small typos are tolerated. Returns the best places as path:line with the line's text and a short excerpt; read the file only when the excerpt is not enough. Use it before grep on the brain. path: limit to one file or folder (e.g. "ai-errors.md", "journal/").`;

export function brainSearchTool(query: Query): McpTool {
  return {
    name: 'brain_search', description: GUIDANCE,
    inputSchema: { type: 'object', properties: {
      q: { type: 'string', description: 'What to look for, in plain words (a question works).' },
      path: { type: 'string', description: 'Optional: a file or folder of the brain to search in.' },
      limit: { type: 'integer', minimum: 1, maximum: 30, description: 'How many places (default 8).' },
    }, required: ['q'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: async args => {
      const q = typeof args.q === 'string' ? args.q.trim() : '';
      if (q.length < 2) throw new Error('q: at least two characters');
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(30, Math.floor(args.limit))) : 8;
      const p = typeof args.path === 'string' ? args.path.trim().replace(/\\/g, '/').replace(/^\.?\//, '') : '';
      const hits = await query(q, { limit, ...(p ? { prefix: `brain:${p}` } : {}) });
      return JSON.stringify(hits.map(h => ({ at: `${h.path}:${h.line}`, line: h.text, excerpt: h.chunk.length > 400 ? `${h.chunk.slice(0, 400)}…` : h.chunk, via: h.via })));
    },
  };
}

/** /api/search?q=…: the brain pages' shape ({ file, line, text }) plus score and via, best first. */
export async function apiSearch(query: Query, params: URLSearchParams): Promise<{ file: string; line: number; text: string; score: number; via: Hit['via'] }[]> {
  const q = String(params.get('q') ?? '').trim();
  if (q.length < 2) return [];
  const hits = await query(q, { limit: 50 });
  return hits.map(h => ({ file: h.path, line: h.line, text: h.text, score: h.score, via: h.via }));
}
