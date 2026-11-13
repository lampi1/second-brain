// The «Giornale» (ADR 0265, editions ADR 0279): the app's ready-made editions and how a pasted source is recognised.
// A clean install has no edition; «AI per chi costruisce agenti» is the one template: its sections, key words and the
// sources chosen and justified in ADR 0265 (each opened on 2026-11-10). A template is data: once the user starts from
// it the edition is theirs (they pause, remove or add sources; «Ripristina» brings the template's list back). weight:
// how much a story from a source counts; primary: the lab, the project or the researcher who did the work (wins the
// deduplication over a newsletter or a link site); pin: its section wins over a story's words.
// Used by service.ts; tests: test/unit/news-service.test.ts.
import { NEWS_AI_EDITION, NEWS_FRONT_CAP, type NewsEdition, type NewsRead, type NewsSource } from '@shared/news';

type Def = Omit<NewsSource, 'on' | 'builtin' | 'edition'> & { on?: boolean };
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

/** The template's sources: a harness or research source keeps its section whatever a story's words say. */
export const DEFAULT_SOURCES: readonly NewsSource[] = DEFS.map(d => ({ ...d, edition: NEWS_AI_EDITION, ...(d.section === 'harness' || d.section === 'research' ? { pin: true } : {}), on: d.on ?? true, builtin: true }));

export interface NewsTemplate { id: string; edition: Omit<NewsEdition, 'createdAt'>; names: Record<'it' | 'en' | 'de', { name: string; interest: string; sections: Record<string, string> }>; sources: readonly NewsSource[] }

/** «AI per chi costruisce agenti»: the words of that work (agents, harnesses, skills, MCP at the core; models, evals
 *  and coding near), four sections. */
const AI: NewsTemplate = {
  id: NEWS_AI_EDITION,
  edition: {
    id: NEWS_AI_EDITION, name: 'AI per chi costruisce agenti', template: NEWS_AI_EDITION, cap: NEWS_FRONT_CAP,
    interest: 'Costruisco agenti AI, skill e harness (Claude Code, Cursor, Codex, OpenCode, server MCP) e un\'app che li fa lavorare: voglio sapere cosa cambia per questo lavoro e imparare.',
    core: ['agent', 'agentic', 'sub-agent', 'subagent', 'harness', 'claude code', 'codex', 'cursor', 'opencode', 'gemini cli', 'skill', 'mcp', 'model context protocol', 'tool use', 'tool-use', 'tool calling', 'computer use', 'context window', 'context engineering', 'compaction', 'memory', 'orchestrat', 'workflow', 'hook', 'sdk', 'coding agent', 'autonom', 'self-improv', 'self improv'],
    near: ['claude', 'fable', 'opus', 'sonnet', 'haiku', 'mythos', 'gpt', 'gemini', 'llama', 'mistral', 'qwen', 'deepseek', 'model', 'benchmark', 'eval', 'swe-bench', 'swebench', 'leaderboard', 'reasoning', 'prompt', 'api', 'release', 'changelog', 'open weight', 'open-weight', 'fine-tun', 'finetun', 'post-training', 'inference', 'latency', 'pricing', 'token'],
    sections: [
      { id: 'skills', name: 'Skill e agenti', words: ['skill', 'mcp', 'model context protocol', 'agent skills', 'sub-agent', 'subagent', 'multi-agent', 'agent sdk', 'a2a'] },
      { id: 'harness', name: 'Harness e tool', words: ['claude code', 'codex', 'codex cli', 'cursor', 'opencode', 'gemini cli', 'copilot', 'cli', 'ide', 'harness', 'changelog', 'release notes'] },
      { id: 'research', name: 'Ricerca', words: ['paper', 'arxiv', 'study', 'we find', 'we show', 'interpretability', 'alignment', 'theorem', 'dataset'] },
      { id: 'models', name: 'Modelli e benchmark', words: ['model', 'benchmark', 'eval', 'leaderboard', 'swe-bench', 'swebench', 'open weight', 'open-weight', 'gpt', 'gemini', 'llama', 'qwen', 'deepseek', 'fable', 'opus', 'sonnet', 'haiku', 'mythos', 'system card'] },
    ],
  },
  names: {
    it: { name: 'AI per chi costruisce agenti', interest: 'Costruisco agenti AI, skill e harness (Claude Code, Cursor, Codex, OpenCode, server MCP) e un\'app che li fa lavorare: voglio sapere cosa cambia per questo lavoro e imparare.', sections: { skills: 'Skill e agenti', harness: 'Harness e tool', research: 'Ricerca', models: 'Modelli e benchmark' } },
    en: { name: 'AI for agent builders', interest: 'I build AI agents, skills and harnesses (Claude Code, Cursor, Codex, OpenCode, MCP servers) and an app that runs them: I want to know what changes for this work, and to learn.', sections: { skills: 'Skills and agents', harness: 'Harnesses and tools', research: 'Research', models: 'Models and benchmarks' } },
    de: { name: 'KI für Agenten-Entwickler', interest: 'Ich baue KI-Agenten, Skills und Harnesses (Claude Code, Cursor, Codex, OpenCode, MCP-Server) und eine App, die sie arbeiten lässt: Ich will wissen, was sich für diese Arbeit ändert, und dazulernen.', sections: { skills: 'Skills und Agenten', harness: 'Harnesses und Tools', research: 'Forschung', models: 'Modelle und Benchmarks' } },
  },
  sources: DEFAULT_SOURCES,
};
export const NEWS_TEMPLATES: readonly NewsTemplate[] = [AI];
export const templateOf = (id: string | undefined): NewsTemplate | undefined => NEWS_TEMPLATES.find(t => t.id === id);
/** A template's edition in the user's language. */
export function editionFromTemplate(t: NewsTemplate, lang: 'it' | 'en' | 'de', now: number): NewsEdition {
  const n = t.names[lang] ?? t.names.it;
  return { ...t.edition, name: n.name, interest: n.interest, sections: t.edition.sections.map(s => ({ ...s, name: n.sections[s.id] ?? s.name, words: [...s.words] })), core: [...t.edition.core], near: [...t.edition.near], createdAt: now };
}

/** A source the user pastes: GitHub repositories read their releases, the known APIs their reader, anything else is
 *  sniffed at its first reading (feed, Markdown or page: service.ts). */
export function sourceFromUrl(url: string, name?: string): Omit<NewsSource, 'id' | 'edition'> {
  const u = new URL(url);
  const gh = u.hostname === 'github.com' ? /^\/([\w.-]+)\/([\w.-]+)\/?(releases(\.atom)?)?\/?$/.exec(u.pathname) : null;
  let read: NewsRead = 'feed';
  let href = u.toString();
  if (gh) { read = 'github'; href = `https://github.com/${gh[1]}/${gh[2]}/releases.atom`; }
  else if (u.hostname === 'hn.algolia.com') read = 'hn';
  else if (u.hostname === 'huggingface.co' && u.pathname.startsWith('/api/daily_papers')) read = 'hf-papers';
  else if (!/(rss|atom|feed|\.xml)/i.test(u.pathname + u.search)) read = 'page';
  return { name: (name?.trim() || (gh ? `${gh[2]}` : u.hostname.replace(/^www\./, ''))).slice(0, 60), url: href, read, section: '', weight: 0.7, primary: true, on: true, builtin: false };
}
