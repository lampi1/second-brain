// The demo's News (ADR 0264): no network and no engine. A few real stories (titles, links and the sources' own first
// words, as read live on 2026-11-10; dates moved to be relative to the demo's clock) are served as the sources' own
// formats (RSS, a news page, the Hacker News and Hugging Face Papers APIs), so «Aggiorna» runs the real pipeline
// (parse, dedup, rank); every other source answers with an empty list. The AI pass is a fake that returns the
// summaries written here, with a fixed token count. Used by demo-wiring.ts; tested through test/unit/news-service.test.ts.
import { createHash } from 'node:crypto';
import type { Lang } from '@shared/contract';
import { DEFAULT_SOURCES } from './sources';
import { canonicalUrl } from './dedup';
import type { NewsAi, NewsFetch } from './service';

const H = 3_600_000;

interface DemoStory {
  source: string;
  title: string;
  url: string;
  hoursAgo: number;
  snippet: string;
  /** Hacker News points or paper votes */
  signal?: number;
  summary: { it: string; en: string };
  why: { it: string; en: string };
  fit: number;
  section: 'models' | 'harness' | 'skills' | 'research';
}

const S: DemoStory[] = [
  { source: 'anthropic-news', title: 'Introducing Claude Fable 5.2 and Claude Mythos 5.2', url: 'https://www.anthropic.com/claude-fable-and-mythos-5-2', hoursAgo: 37,
    snippet: 'Our most capable models for daunting technical work, Claude Fable 5.2 and Claude Mythos 5.2 set a new bar in coding, finance, and the sciences.',
    summary: { it: 'Anthropic presenta Claude Fable 5.2 e Claude Mythos 5.2, i suoi modelli più capaci per il lavoro tecnico lungo: codice, finanza e scienze. Fable 5.2 diventa il modello Fable predefinito.', en: 'Anthropic introduces Claude Fable 5.2 and Claude Mythos 5.2, its most capable models for long technical work: coding, finance and science. Fable 5.2 becomes the default Fable model.' },
    why: { it: 'Cambia il modello predefinito dei tuoi agenti: vale la pena confrontare costo e qualità sui tuoi run.', en: 'It changes your agents\' default model: worth comparing cost and quality on your own runs.' }, fit: 3, section: 'models' },
  { source: 'hn', title: 'Claude Fable 5.2 and Claude Mythos 5.2', url: 'https://www.anthropic.com/claude-fable-and-mythos-5-2', hoursAgo: 36, snippet: '', signal: 1240,
    summary: { it: '', en: '' }, why: { it: '', en: '' }, fit: 3, section: 'models' },
  { source: 'claude-code', title: 'Claude Code 2.1.322', url: 'https://code.claude.com/docs/en/changelog#2-1-322', hoursAgo: 10,
    snippet: 'Added fast mode on Vertex in the global, us and eu regions, falling back to standard speed if Vertex refuses it.',
    summary: { it: 'La 2.1.322 porta la modalità veloce su Vertex (regioni global, us ed eu), con ritorno alla velocità normale se Vertex la rifiuta.', en: '2.1.322 brings fast mode to Vertex (global, us and eu regions), falling back to standard speed when Vertex refuses it.' },
    why: { it: 'Utile solo se usi Claude Code tramite Vertex.', en: 'Useful only if you run Claude Code through Vertex.' }, fit: 1, section: 'harness' },
  { source: 'claude-code', title: 'Claude Code 2.1.321', url: 'https://code.claude.com/docs/en/changelog#2-1-321', hoursAgo: 17,
    snippet: 'Added Claude Fable 5.2 (claude-fable-5-2), now the default Fable model — 1M context, $8/$40 per Mtok with $0.20/Mtok cache reads.',
    summary: { it: 'Claude Code 2.1.321 aggiunge Fable 5.2 come modello Fable predefinito: contesto da 1M token, 8/40 $ per milione di token, 0,20 $ per le letture dalla cache.', en: 'Claude Code 2.1.321 adds Fable 5.2 as the default Fable model: 1M-token context, $8/$40 per million tokens, $0.20 for cache reads.' },
    why: { it: 'I prezzi nuovi entrano subito nei costi dei tuoi agenti: controlla i limiti di spesa.', en: 'The new prices go straight into your agents\' costs: check your spending caps.' }, fit: 3, section: 'harness' },
  { source: 'deepmind', title: 'Introducing AlphaProof Code: a breakthrough in verifying complex software at depth', url: 'https://deepmind.google/blog/introducing-alphaproof-code/', hoursAgo: 1,
    snippet: 'AlphaProof Code agents wrote three million lines of proofs in Lean to verify Signal\'s core encryption.',
    summary: { it: 'Google DeepMind presenta AlphaProof Code: agenti che hanno scritto tre milioni di righe di dimostrazioni in Lean per verificare il cuore della cifratura di Signal.', en: 'Google DeepMind introduces AlphaProof Code: agents that wrote three million lines of Lean proofs to verify the core of Signal\'s encryption.' },
    why: { it: 'Un esempio di agenti che verificano il codice invece di scriverlo: un\'idea per i controlli dei tuoi run.', en: 'Agents that verify code instead of writing it: an idea for your own run checks.' }, fit: 2, section: 'research' },
  { source: 'simonw', title: 'Introducing Our Smallest, Most Efficient Model: Muse Ember', url: 'https://simonwillison.net/2026/Nov/10/muse-ember/', hoursAgo: 19,
    snippet: 'Meta AI just launched their entry in the Claude Haiku/GPT Luna category: Muse Ember.',
    summary: { it: 'Meta lancia Muse Ember, il suo modello più piccolo ed efficiente, nella fascia di Claude Haiku e GPT Luna. Simon Willison lo prova e ne riporta i primi risultati.', en: 'Meta launches Muse Ember, its smallest and most efficient model, in the Claude Haiku / GPT Luna tier. Simon Willison tries it and reports first results.' },
    why: { it: 'Un candidato economico per i passi semplici degli agenti, da confrontare con Haiku.', en: 'A cheap candidate for simple agent steps, to compare with Haiku.' }, fit: 2, section: 'models' },
  { source: 'simonw', title: 'Hide your slop PR descriptions behind <details>', url: 'https://simonwillison.net/2026/Nov/9/details-summary/', hoursAgo: 33,
    snippet: 'Most of the changes I make to my projects these days come in the form of PRs opened for me by Claude Code or Codex. The PR is my unit of work.',
    summary: { it: 'Simon Willison propone di mettere le lunghe descrizioni scritte dagli agenti dentro un blocco <details>, lasciando in vista un riassunto umano breve.', en: 'Simon Willison suggests putting long agent-written PR descriptions inside a <details> block, keeping a short human summary in view.' },
    why: { it: 'Tocca direttamente le PR che aprono i tuoi agenti: un formato più leggibile per chi revisiona.', en: 'It touches the PRs your agents open: a format easier on reviewers.' }, fit: 3, section: 'harness' },
  { source: 'openai-news', title: 'CodeRabbit scales agentic software development and ships 20x more', url: 'https://openai.com/index/coderabbit-codex-daybreak', hoursAgo: 29,
    snippet: 'CodeRabbit uses OpenAI models to govern and trust AI-generated code and Codex to ship 20 times more software with the same engineering team.',
    summary: { it: 'Caso d\'uso di OpenAI: CodeRabbit usa i modelli OpenAI per controllare il codice scritto dall\'AI e Codex per rilasciare 20 volte più software con lo stesso team.', en: 'An OpenAI case study: CodeRabbit uses OpenAI models to review AI-written code and Codex to ship 20 times more software with the same team.' },
    why: { it: 'Un racconto di marketing, ma mostra come altri organizzano revisione e agenti.', en: 'Marketing, but it shows how others organise review around agents.' }, fit: 1, section: 'harness' },
  { source: 'hf-papers', title: 'Reframe: Observation-Aligned Multi-Teacher On-Policy Distillation for Agentic Visual Reasoning', url: 'https://huggingface.co/papers/2611.12886', hoursAgo: 42, signal: 61,
    snippet: 'Reframe is a two-stage post-training framework that aligns visual agents\' observation states through evidence-aware reinforcement learning.',
    summary: { it: 'Reframe è un metodo di post-training in due fasi per agenti visivi: allinea ciò che l\'agente osserva con l\'apprendimento per rinforzo e la distillazione da più modelli insegnanti.', en: 'Reframe is a two-stage post-training method for visual agents: it aligns what the agent observes through reinforcement learning and distillation from several teacher models.' },
    why: { it: 'Ricerca di base: interessante ma lontana dal tuo lavoro di oggi.', en: 'Basic research: interesting but far from your work today.' }, fit: 1, section: 'research' },
  { source: 'anthropic-engineering', title: 'The components of agent memory', url: 'https://www.anthropic.com/research/components-of-agent-memory', hoursAgo: 109,
    snippet: 'What an agent needs to remember across sessions, and how to split it into parts that can be read, written and forgotten.',
    summary: { it: 'Anthropic scompone la memoria di un agente in parti: cosa ricordare tra una sessione e l\'altra, come scriverlo e come dimenticarlo.', en: 'Anthropic breaks an agent\'s memory into parts: what to remember across sessions, how to write it and how to forget it.' },
    why: { it: 'Riguarda da vicino la memoria del tuo cervello e degli agenti.', en: 'Close to how your brain and agents keep memory.' }, fit: 3, section: 'skills' },
  { source: 'hn', title: 'Claude Code\'s "Don\'t Ask Again" exposes passwords in 1,122 public GitHub files', url: 'https://apiiro.com/blog/coding-agents-leaking-secrets-github-dont-ask-again', hoursAgo: 64, snippet: '', signal: 540,
    summary: { it: 'Apiiro ha trovato 1.122 file pubblici su GitHub con password finite nelle regole «Non chiedere più» di Claude Code, salvate nei file di impostazioni del progetto.', en: 'Apiiro found 1,122 public GitHub files with passwords saved in Claude Code\'s "Don\'t ask again" rules, inside project settings files.' },
    why: { it: 'Controlla che le impostazioni dei tuoi agenti non finiscano nei repository.', en: 'Check that your agents\' settings never end up in repositories.' }, fit: 3, section: 'harness' },
  { source: 'hn', title: 'Agent memory needs its OpenTelemetry moment', url: 'https://www.lorekit.io/blog/open-agent-memory-format', hoursAgo: 52, snippet: '', signal: 320,
    summary: { it: 'Un articolo propone un formato aperto e comune per la memoria degli agenti, come OpenTelemetry ha fatto per le tracce.', en: 'A post proposes an open, shared format for agent memory, as OpenTelemetry did for traces.' },
    why: { it: 'Se nascerà uno standard, la memoria del tuo cervello potrebbe esportarsi e importarsi.', en: 'If a standard emerges, your brain\'s memory could be exported and imported.' }, fit: 2, section: 'skills' },
  { source: 'anthropic-news', title: 'Donating Agent Skills to the Agentic AI Foundation', url: 'https://www.anthropic.com/news/donating-agent-skills-to-the-agentic-ai-foundation', hoursAgo: 469,
    snippet: 'We\'re donating Agent Skills, the open standard that gives AI agents specialized knowledge and workflows, to the Agentic AI Foundation.',
    summary: { it: 'Anthropic dona lo standard aperto Agent Skills all\'Agentic AI Foundation, che ne curerà le versioni future insieme ad altre aziende.', en: 'Anthropic donates the open Agent Skills standard to the Agentic AI Foundation, which will steward its future versions with other companies.' },
    why: { it: 'Le skill dei tuoi agenti seguono questo standard: le prossime versioni arriveranno da lì.', en: 'Your agents\' skills follow this standard: its next versions will come from there.' }, fit: 3, section: 'skills' },
];

const idOf = (url: string) => createHash('sha1').update(canonicalUrl(url)).digest('hex').slice(0, 12);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function rss(items: DemoStory[], now: number): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>demo</title>${items.map(i =>
    `<item><title>${esc(i.title)}</title><link>${esc(i.url)}</link><pubDate>${new Date(now - i.hoursAgo * H).toUTCString()}</pubDate><description>${esc(i.snippet)}</description></item>`).join('')}</channel></rss>`;
}
function page(items: DemoStory[], now: number): string {
  return `<html><body>${items.map(i => `<a href="${esc(i.url.startsWith('/') ? i.url : new URL(i.url).pathname)}"><h3>${esc(i.title)}</h3><p>${esc(i.snippet)}</p><time datetime="${new Date(now - i.hoursAgo * H).toISOString()}"></time></a>`).join('')}</body></html>`;
}

/** The demo's network: the stories above in each source's own format, an empty list for the rest. */
export function demoNewsFetch(now: () => number): NewsFetch {
  return async url => {
    const src = DEFAULT_SOURCES.find(s => s.url === url);
    const mine = S.filter(i => i.source === src?.id);
    const n = now();
    if (src?.read === 'hn') return { status: 200, contentType: 'application/json', text: JSON.stringify({ hits: mine.map((i, k) => ({ objectID: String(46100000 + k), title: i.title, url: i.url, points: i.signal ?? 0, created_at: new Date(n - i.hoursAgo * H).toISOString() })) }) };
    if (src?.read === 'hf-papers') return { status: 200, contentType: 'application/json', text: JSON.stringify(mine.map(i => ({ title: i.title, publishedAt: new Date(n - i.hoursAgo * H).toISOString(), paper: { id: i.url.split('/').pop(), title: i.title, upvotes: i.signal ?? 0, ai_summary: i.snippet } }))) };
    // a page with nothing new still lists its archive (older than the paper keeps, so it adds nothing)
    if (src?.read === 'page' && !mine.length && url.endsWith('.md')) return { status: 200, contentType: 'text/markdown', text: '### September 1, 2026\n\nOlder notes.\n' };
    if (src?.read === 'page') return { status: 200, contentType: 'text/html', text: mine.length ? page(mine, n) : page([{ ...S[0]!, title: `${src.name} archive 2026`, url: `${new URL(url).pathname.replace(/\/+$/, '')}/archive-2026`, hoursAgo: 60 * 24, snippet: '' }], n) };
    if (src?.read === 'github') return { status: 200, contentType: 'application/atom+xml', text: '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>demo</title></feed>' };
    return { status: 200, contentType: 'application/rss+xml', text: rss(mine, n) };
  };
}

/** The demo's AI pass: the summaries above for the ids asked, a fixed measured cost. */
export function demoNewsAi(lang: () => Lang): NewsAi {
  const byId = new Map(S.filter(i => i.summary.en).map(i => [idOf(i.url), i]));
  return async prompt => {
    const ids = [...prompt.matchAll(/"id":\s*"([0-9a-f]{12})"/g)].map(m => m[1]!);
    const l = lang() === 'it' ? 'it' : 'en';
    const out = ids.map(id => {
      const s = byId.get(id);
      return s ? { id, summary: s.summary[l], why: s.why[l], fit: s.fit, section: s.section } : { id, summary: '', why: '', fit: 1, section: 'models' };
    });
    return { ok: true, text: JSON.stringify(out), tokens: 900 + ids.length * 410, costUsd: Math.round((900 + ids.length * 410) * 0.0000062 * 1000) / 1000 };
  };
}
