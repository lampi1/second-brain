// Impara «News» (ADR 0265): the default sources, chosen and justified in the ADR (each opened on 2026-11-10), and how a
// source the user adds is recognised. The list is data: the user pauses, removes or adds sources from the «Fonti»
// panel (service.ts keeps their edits; «Ripristina» brings this list back). weight: how much a story from it counts;
// primary: the lab, the project or the researcher who did the work (wins the deduplication over a newsletter or a
// link site). Used by service.ts; tests: test/unit/news-service.test.ts.
import type { NewsRead, NewsSection, NewsSource } from '@shared/news';

type Def = Omit<NewsSource, 'on' | 'builtin'> & { on?: boolean };
const DEFS: Def[] = [
  // AI labs
  { id: 'anthropic-news', name: 'Anthropic News', url: 'https://www.anthropic.com/news', read: 'page', match: '^/(news/[\\w-]+|claude-[\\w-]+|research/[\\w-]+)$', section: 'models', weight: 1, primary: true },
  { id: 'anthropic-engineering', name: 'Anthropic Engineering', url: 'https://www.anthropic.com/engineering', read: 'page', match: '^/(engineering|research)/[\\w-]+$', section: 'skills', weight: 1, primary: true },
  { id: 'claude-platform', name: 'Claude Platform release notes', url: 'https://platform.claude.com/docs/en/release-notes/overview.md', read: 'page', section: 'models', weight: 0.95, primary: true },
  { id: 'openai-news', name: 'OpenAI News', url: 'https://openai.com/news/rss.xml', read: 'feed', section: 'models', weight: 0.9, primary: true },
  { id: 'deepmind', name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', read: 'feed', section: 'models', weight: 0.9, primary: true },
  { id: 'mistral', name: 'Mistral AI', url: 'https://mistral.ai/news/rss', read: 'feed', section: 'models', weight: 0.8, primary: true },
  { id: 'hf-blog', name: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', read: 'feed', section: 'models', weight: 0.6, primary: true },
  { id: 'meta-ai', name: 'Meta AI Blog', url: 'https://ai.meta.com/blog/', read: 'page', match: '^/blog/[\\w-]+$', section: 'models', weight: 0.75, primary: true },
  // models and benchmarks
  { id: 'hf-papers', name: 'Hugging Face Papers', url: 'https://huggingface.co/api/daily_papers', read: 'hf-papers', min: 25, section: 'research', weight: 0.6, primary: true },
  { id: 'epoch', name: 'Epoch AI', url: 'https://epochai.substack.com/feed', read: 'feed', section: 'models', weight: 0.8, primary: true },
  { id: 'metr', name: 'METR', url: 'https://metr.substack.com/feed', read: 'feed', section: 'research', weight: 0.8, primary: true },
  // harnesses and coding tools
  { id: 'claude-code', name: 'Claude Code', url: 'https://code.claude.com/docs/en/changelog/rss.xml', read: 'feed', section: 'harness', weight: 0.95, primary: true },
  { id: 'claude-code-gh', name: 'Claude Code (GitHub)', url: 'https://github.com/anthropics/claude-code/releases.atom', read: 'github', section: 'harness', weight: 0.9, primary: true },
  { id: 'codex', name: 'OpenAI Codex', url: 'https://github.com/openai/codex/releases.atom', read: 'github', section: 'harness', weight: 0.85, primary: true },
  { id: 'gemini-cli', name: 'Gemini CLI', url: 'https://github.com/google-gemini/gemini-cli/releases.atom', read: 'github', section: 'harness', weight: 0.75, primary: true },
  { id: 'opencode', name: 'OpenCode', url: 'https://github.com/sst/opencode/releases.atom', read: 'github', section: 'harness', weight: 0.7, primary: true },
  { id: 'cursor', name: 'Cursor Changelog', url: 'https://cursor.com/changelog', read: 'page', match: '^/changelog/[\\w-]+$', section: 'harness', weight: 0.85, primary: true },
  { id: 'openai-api', name: 'OpenAI API changelog', url: 'https://developers.openai.com/api/docs/changelog.md', read: 'page', section: 'harness', weight: 0.8, primary: true },
  // skills, agents and their specs
  { id: 'mcp-blog', name: 'MCP Blog', url: 'https://blog.modelcontextprotocol.io/index.xml', read: 'feed', section: 'skills', weight: 0.9, primary: true },
  { id: 'mcp-spec', name: 'MCP specification', url: 'https://github.com/modelcontextprotocol/modelcontextprotocol/releases.atom', read: 'github', section: 'skills', weight: 0.9, primary: true },
  { id: 'agent-skills', name: 'Agent Skills spec', url: 'https://github.com/agentskills/agentskills/commits/main.atom', read: 'feed', section: 'skills', weight: 0.6, primary: true },
  { id: 'anthropic-skills', name: 'Anthropic skills', url: 'https://github.com/anthropics/skills/commits/main.atom', read: 'feed', section: 'skills', weight: 0.55, primary: true },
  // newsletters and researchers
  { id: 'simonw', name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', read: 'feed', section: 'harness', weight: 0.75, primary: false },
  { id: 'import-ai', name: 'Import AI', url: 'https://importai.substack.com/feed', read: 'feed', section: 'research', weight: 0.7, primary: false },
  { id: 'interconnects', name: 'Interconnects', url: 'https://www.interconnects.ai/feed', read: 'feed', section: 'models', weight: 0.7, primary: true },
  { id: 'latent-space', name: 'Latent Space', url: 'https://www.latent.space/feed', read: 'feed', section: 'skills', weight: 0.65, primary: false },
  { id: 'ahead-of-ai', name: 'Ahead of AI', url: 'https://magazine.sebastianraschka.com/feed', read: 'feed', section: 'research', weight: 0.65, primary: true },
  // beyond the list: any site, once many developers vote it up; the link kept is the site's own (primary), never HN's
  { id: 'hn', name: 'Hacker News', url: 'https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points%3E150&hitsPerPage=100', read: 'hn', min: 150, section: 'models', weight: 0.45, primary: true },
];

export const DEFAULT_SOURCES: readonly NewsSource[] = DEFS.map(d => ({ ...d, on: d.on ?? true, builtin: true }));

/** A source the user pastes: GitHub repositories read their releases, the known APIs their reader, anything else is
 *  sniffed at its first reading (feed, Markdown or page: service.ts). */
export function sourceFromUrl(url: string, name?: string): Omit<NewsSource, 'id'> {
  const u = new URL(url);
  const gh = u.hostname === 'github.com' ? /^\/([\w.-]+)\/([\w.-]+)\/?(releases(\.atom)?)?\/?$/.exec(u.pathname) : null;
  let read: NewsRead = 'feed';
  let href = u.toString();
  if (gh) { read = 'github'; href = `https://github.com/${gh[1]}/${gh[2]}/releases.atom`; }
  else if (u.hostname === 'hn.algolia.com') read = 'hn';
  else if (u.hostname === 'huggingface.co' && u.pathname.startsWith('/api/daily_papers')) read = 'hf-papers';
  else if (!/(rss|atom|feed|\.xml)/i.test(u.pathname + u.search)) read = 'page';
  const section: NewsSection = read === 'github' ? 'harness' : read === 'hf-papers' ? 'research' : 'models';
  return { name: (name?.trim() || (gh ? `${gh[2]}` : u.hostname.replace(/^www\./, ''))).slice(0, 60), url: href, read, section, weight: 0.7, primary: true, on: true, builtin: false };
}
