// The MCP tools over the brain's saved queries (ADR 0124), on every chat's own endpoint, beside brain_scripts and
// brain_script_add (scripts-tools.ts, ADR 0076 / 0096):
// - brain_queries (read only): find a saved query before writing one again; words over title, description, data
//   source, tags and language (the list is short and each query describes itself, as for scripts).
// - brain_query_add (add only): a chat saves a query it ran with success and someone will rerun, as one note in
//   queries/ with its header; an existing name and a credential are refused, the change is logged in the brain's
//   changelog. No approval card: the same freedom work chats have over new scripts (owner, 2026-10-19), and the app's
//   own endpoint asks no permission for its tools (agents/tool-policy.ts toolClassOf).
// Used by wiring.ts. Unit tests: test/unit/brain/queries.test.ts.
import type { McpTool } from '../mcp/server';
import type { BrainQuerySummary } from '../../shared/contract';
import type { BrainQueries } from './queries';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const text = (v: unknown, key: string, required = true): string => {
  if (v === undefined && !required) return '';
  if (typeof v !== 'string' || (required && !v.trim())) throw new Error(`${key}: required text`);
  return v;
};

/** Every word somewhere in the query's header; more words in title, tags or name first. */
export function findQueries(list: BrainQuerySummary[], q: string): BrainQuerySummary[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.map(x => {
    const strong = fold(`${x.title} ${x.tags.join(' ')} ${x.file}`), all = fold(`${strong} ${x.description} ${x.source} ${x.language} ${x.lang}`);
    return { x, hit: words.filter(w => all.includes(w)).length, strong: words.filter(w => strong.includes(w)).length };
  }).filter(s => s.hit === words.length).sort((a, b) => b.strong - a.strong).map(s => s.x);
}

export function brainQueriesTool(queries: BrainQueries): McpTool {
  return {
    name: 'brain_queries',
    description: 'The brain\'s saved queries (its queries/ folder, shown in Memoria → Script & Query): SQL, KQL / Kusto, GraphQL, PromQL, Splunk SPL and the like, each with what it answers and where it runs. Call it BEFORE writing a query for a data source again: reuse or adapt a fitting one. q: what you need, in plain words (all words must match title, description, data source, tags or language); empty = all. Read the file at its path for the query. Once a query someone will rerun WORKED, save it with brain_query_add (scripts stay in brain_script_add).',
    inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'What the query should answer (e.g. "clienti attivi kusto"). Optional.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: args => {
      const all = queries.list();
      const list = findQueries(all.queries, typeof args.q === 'string' ? args.q : '').slice(0, 30);
      return JSON.stringify({
        folder: all.root ? `${all.root}/${all.dir}` : null, total: all.queries.length,
        queries: list.map(x => ({ path: all.root ? `${all.root}/${x.file}` : x.file, title: x.title, description: x.description, language: x.language, runsOn: x.source, tags: x.tags })),
      });
    },
  };
}

export function chatQueryAddTool(queries: BrainQueries, titleOf: (chatId: string) => string | null): McpTool {
  return {
    name: 'brain_query_add',
    description: 'Save a NEW query in the user\'s brain (queries/<name>.md, Memoria → Script & Query) right after it ran and gave the right answer, when the user or an agent will rerun it: a report, a check, a lookup against a database, a Kusto cluster, a GraphQL API, Prometheus, Splunk. Not for a one-off look-up, and not a script (that is brain_script_add). Call brain_queries first: no near-duplicates. No secrets: a line that looks like a credential is refused (use a parameter or the connection the tool already has). The app writes the header; pass the query alone, it is kept byte for byte. Logged in the brain\'s changelog.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'New file name, e.g. "clienti-attivi" (letters, digits, . _ -; ".md" is added).' },
        language: { type: 'string', description: 'The query language as a fence tag: sql, tsql, postgresql, kusto, graphql, promql, spl, logql, cypher, sparql, …' },
        title: { type: 'string', description: 'Short human title, in the user’s language.' },
        description: { type: 'string', description: 'What it answers and when to rerun it, one or two sentences, in the user’s language.' },
        runsOn: { type: 'string', description: 'Where it runs: the tool, cluster, database or data source (no credentials).' },
        tags: { type: 'array', items: { type: 'string' }, description: 'A few words to find it (area, system, table).' },
        code: { type: 'string', description: 'The query itself.' },
      },
      required: ['name', 'language', 'title', 'description', 'code'], additionalProperties: false,
    },
    run: (a, ctx) => {
      const by = (ctx.params.chatId ? titleOf(ctx.params.chatId) : null)?.trim() || 'chat';
      const r = queries.add({
        name: text(a.name, 'name'), lang: text(a.language, 'language'), code: text(a.code, 'code'), by,
        meta: { title: text(a.title, 'title'), description: text(a.description, 'description'), source: text(a.runsOn, 'runsOn', false),
          tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === 'string').slice(0, 12) : [], from: `${by}, ${new Date().toISOString().slice(0, 10)}` },
      });
      return JSON.stringify({ ok: true, ...r, changelog: 'logged' });
    },
  };
}
