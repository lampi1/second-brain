// Impara's file-driven web research (ADR 0206, amends ADR 0188): the files research names a few public topics worth
// searching (standards, specifications, libraries with their version, protocols) and this file decides, at zero tokens
// and the same way every time, which of them may ever reach the web run. The web run reads untrusted pages and has the
// web tools: what it sees must hold nothing private ("lethal trifecta"), so a query passes only when every word of it is
// plainly public (a positive rule): at most 8 words and 80 characters, an allow-list of characters, each word a known
// public name, a common technical word or a word of the user's own ask (which the web run sees anyway), no URL but a
// well-known public documentation host, and at most 2 numbers, each a version or a standard's number right after a
// standards body or a public name (never an IP address, a long number, a PIN). Paths, file names, e-mails, hex and
// tokens never pass; a name of the user's files never passes, even from the ask. In doubt, a query is dropped. The topic's reason and the file it comes from stay in the app (shown to the user, never sent to the web).
// Shared by main/learn/service.ts (filter, parse) and the renderer (components/impara/ImparaPrep.tsx, ImparaSources.tsx);
// pinned by test/unit/web-topics.test.ts.
import { parseFacts, type LessonFact } from './lesson';

/** One public topic the files research proposes: q = the query that may go to the web; why and ref stay local. */
export interface WebTopic { id: string; q: string; why: string; ref: string }
/** The topics of a lesson being prepared: proposed (wait: they start by themselves at `at`, ms of the real clock),
 *  searching (go), searched (done), or none left (skip); dropped = how many the filter left out. */
export interface LessonTopics { list: WebTopic[]; state: 'wait' | 'go' | 'done' | 'skip'; at?: number; dropped?: number }

export const TOPICS_MAX = 8;
/** how long the proposed topics wait for the user (✕ to drop one, «Cerca ora») before they start by themselves */
export const TOPIC_WAIT_MS = 5000;
const Q_MAX_CHARS = 80;
const Q_MAX_WORDS = 8;
/** numbers a query may carry (versions, standards' numbers): «OAuth 2.0 RFC 6749» */
const MAX_NUMBERS = 2;

/** Documentation hosts a query may name as a URL (a host or any subdomain of it). */
export const PUBLIC_DOC_HOSTS: readonly string[] = [
  'ietf.org', 'rfc-editor.org', 'w3.org', 'whatwg.org', 'owasp.org', 'iso.org', 'nist.gov', 'ecma-international.org', 'iana.org',
  'developer.mozilla.org', 'learn.microsoft.com', 'docs.github.com', 'nodejs.org', 'expressjs.com', 'electronjs.org', 'react.dev',
  'docs.python.org', 'peps.python.org', 'typescriptlang.org', 'oauth.net', 'openid.net', 'json-schema.org', 'semver.org',
  'kubernetes.io', 'docs.docker.com', 'postgresql.org', 'sqlite.org', 'git-scm.com', 'cwe.mitre.org', 'cve.org', 'unicode.org',
];

/** Prefixes of a standard's id (RFC 6749, ISO 27001, CWE-79, PEP 8, ES2022, SHA-256, UTF-8, HTTP/2…). */
const STD_PREFIX = ['rfc', 'iso', 'iec', 'ieee', 'nist', 'sp', 'cwe', 'cve', 'ecma', 'es', 'pep', 'jsr', 'fips', 'tls', 'ssl', 'http', 'sha', 'utf', 'ipv', 'oauth', 'wcag', 'pci', 'owasp', 'asvs', 'html', 'css', 'aes', 'rsa', 'ecdsa', 'ed', 'x', 'h', 'iso/iec'];

/** Public names a query may use even when they look like names: bodies, protocols, formats, languages, libraries. */
const VOCAB = new Set(`
rfc iso iec ieee nist sp w3c whatwg owasp ecma ietf iana cwe cve mitre pci dss gdpr hipaa soc wcag aria asvs fips pep jsr
oauth openid oidc saml jwt jws jwe jwk jose pkce mfa totp hotp webauthn fido fido2 passkey passkeys ldap kerberos sso scim cas
http https http/2 http/3 tcp udp tcp/ip ip ipv4 ipv6 dns tls ssl ssh sftp ftp smtp imap pop3 mqtt amqp grpc rest graphql soap websocket websockets webrtc quic cors csrf xss csp hsts sri ssrf xxe sqli idor cookie cookies samesite
json yaml toml xml csv html css svg png jpeg webp pdf markdown utf-8 utf utf8 unicode ascii base64 uuid url uri urn mime protobuf avro parquet
api apis sdk cli gui ui ux ci cd ci/cd i/o io os vm cpu gpu ram ssd orm sql nosql acid crud mvc mvvm spa ssr csr pwa dom bom ast jit gc ipc rpc
javascript typescript ecmascript js ts node node.js nodejs deno bun npm yarn pnpm python java kotlin swift rust go golang c c++ c# .net dotnet asp.net php ruby rails perl scala elixir erlang haskell lua bash powershell zsh
react vue vue.js angular svelte next.js nextjs nuxt remix vite webpack esbuild rollup babel jest vitest mocha playwright cypress puppeteer selenium storybook tailwind bootstrap redux zustand mobx rxjs
express express.js fastify koa nestjs hapi django flask fastapi spring laravel symfony electron tauri chromium chrome firefox safari webkit v8
postgres postgresql mysql mariadb sqlite mongodb redis memcached elasticsearch opensearch kafka rabbitmq nats cassandra dynamodb firestore supabase prisma sequelize typeorm drizzle knex
docker kubernetes k8s helm terraform ansible nginx apache caddy envoy istio linux windows macos ubuntu debian alpine wsl git github gitlab bitbucket azure aws gcp devops jenkins
iso/iec openapi swagger asyncapi json-schema semver oauth2 sha sha-1 sha-256 sha256 sha-512 md5 aes rsa ecdsa ed25519 hmac pbkdf2 bcrypt scrypt argon2 x.509 x509 pki csr acme letsencrypt
llm mcp ai ml rag gpt claude anthropic openai mermaid d3 fsrs anki
`.trim().split(/\s+/));

/** Common technical and English words: a query word that is one of these is fine even if the user's files use it. */
const COMMON = new Set(`
a an the of for and or in on to with without by from at as is vs via how what why when best practices practice guide guides tutorial reference spec specification specifications standard standards
error errors handling handler handlers exception exceptions session sessions management manager cookie token tokens refresh access grant grants flow flows code authorization authentication auth login logout password passwords hashing hash salt
security secure threat threats model modeling vulnerability vulnerabilities injection validation input output encoding escaping sanitization sanitizing cheat sheet top ten
cache caching invalidation rate limit limiting limiter retry retries backoff timeout timeouts idempotency idempotent concurrency lock locks locking transaction transactions isolation level levels migration migrations schema schemas index indexes
middleware routing router routes route request requests response responses header headers status codes body stream streams streaming event events loop async await promise promises callback callbacks thread threads worker workers process processes
api design pattern patterns architecture testing test tests unit integration end e2e mock mocks logging log logs monitoring metrics tracing observability performance memory leak leaks garbage collection
server client browser frontend backend database databases query queries storage file files upload uploads download type types typing generics interface interfaces class classes module modules import export package packages dependency dependencies version versions versioning release releases
configuration config environment variables variable secret secrets key keys certificate certificates encryption decryption signature signatures signing verification verify public private
permission permissions role roles policy policies scope scopes consent claim claims audience issuer expiry expiration revocation rotation lifetime
web page pages content origin same cross site resource sharing forgery scripting clickjacking frame frames redirect redirects uri url urls path parameter parameters
data structure structures algorithm algorithms tree graph queue stack list map set hash table search sort sorting binary
lifecycle hooks hook state props component components render rendering virtual reconciliation context store reducer reducers selector selectors effect effects
container containers image images volume volumes network networking port ports proxy reverse load balancing balancer dns domain domains certificate tls handshake
accessibility keyboard focus contrast screen reader readers semantic semantics landmark landmarks label labels
control controls compliance requirements requirement recommendations guidelines checklist visibility automatic batching debounce debouncing throttle throttling scheduling animation frame rate refresh asynchronous synchronous messages message channel channels
new old latest stable major minor patch breaking changes change changelog upgrade upgrading deprecation deprecated support supported official documentation docs overview introduction basics advanced
`.trim().split(/\s+/));

const ALLOWED = /^[\p{L}\p{N} .\-+#/:()'·,]+$/u;
const isUrl = (t: string) => /^https?:\/\//i.test(t);
const trimPunct = (t: string) => t.replace(/^[('"]+|[)'",.]+$/g, '');
/** a version: 5, 2.0, v18, 3.11.2 */
const isVersion = (t: string) => /^v?\d{1,5}(?:\.\d{1,5}){0,3}x?$/i.test(t) && t.replace(/\D/g, '').length <= 8;
/** a standard's id in one token: ES2022, SHA-256, CWE-79, UTF-8, HTTP/2, ISO27001, PEP8 */
const isStdId = (t: string) => { const m = /^([a-z]{1,6})[-/]?(\d{1,5})$/i.exec(t); return !!m && STD_PREFIX.includes(m[1]!.toLowerCase()); };
/** a standard's number after its body: 6749, 27001, 800-63B */
const isStdNum = (t: string) => /^\d{1,5}(?:-\d{1,5})?[a-z]?$/i.test(t);
const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(w => w.toLowerCase());

function publicUrl(t: string): boolean {
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (u.username || u.password || u.port || u.search || u.hash) return false;
    const host = u.hostname.toLowerCase();
    return PUBLIC_DOC_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
  } catch { return false; }
}

/** What the filter knows of the user's private material: its words, and the names of its files and folders. */
export interface PrivateWords { words: Set<string>; names: Set<string>; ask: Set<string> }

/** The private words from the texts the files research saw or wrote (the material, its answer without the queries,
 *  the file names), and the words of the ask (public: the web run sees the ask anyway). */
export function privateWords(texts: readonly string[], ask: string): PrivateWords {
  const all = new Set<string>(), names = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const w of words(t)) all.add(w);
    // file and folder names: every path segment, with and without its extension
    for (const m of t.matchAll(/[\p{L}\p{N}_.-]*[\\/][\p{L}\p{N}_./\\-]+|[\p{L}\p{N}_-]+\.[a-z][a-z0-9]{0,5}\b/giu)) {
      for (const seg of m[0].split(/[\\/]/)) {
        const s = seg.toLowerCase().replace(/:\d+.*$/, '');
        if (!s) continue;
        names.add(s);
        names.add(s.replace(/\.[^.]*$/, ''));
      }
    }
  }
  return { words: all, names, ask: new Set(words(ask)) };
}

/** A query the web run may see, cleaned (spaces folded), or null when any part of it might be private. */
export function safeQuery(raw: unknown, priv: PrivateWords): string | null {
  if (typeof raw !== 'string') return null;
  const q = raw.normalize('NFC').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().replace(/^["'«]+|["'»]+$/g, '').trim();
  if (q.length < 2 || q.length > Q_MAX_CHARS || !/\p{L}/u.test(q)) return null;
  if (/@/.test(q) || !ALLOWED.test(q)) return null;
  const tokens = q.split(' ').filter(t => t && t !== '·' && t !== '-');
  if (!tokens.length || tokens.length > Q_MAX_WORDS) return null;
  let numbers = 0, prev = '';
  for (const raw0 of tokens) {
    if (isUrl(raw0)) { if (!publicUrl(raw0)) return null; prev = ''; continue; }
    const t = trimPunct(raw0);
    if (!t) continue;
    const low = t.toLowerCase(), after = prev;
    prev = low;
    if (VOCAB.has(low)) continue;
    // a number (a version, a standard's number) only right after a standards body or a known public name, at most
    // MAX_NUMBERS a query: never a PIN, a phone number, an IP address, a ticket
    if (isVersion(t) || isStdNum(t) || isStdId(t)) {
      if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(t) || /\d{6,}/.test(t)) return null;
      if (++numbers > MAX_NUMBERS) return null;
      if (!isStdId(t) && !VOCAB.has(after)) return null;
      continue;
    }
    // any other digit, a path, a drive, a file name, a dotfile: never
    if (/\d/.test(t) || /[\\/:]/.test(t) || /^\.|\.[\p{L}]{1,6}$/u.test(t)) return null;
    // a name of the user's files or folders, even when the ask names it (an extra guard over the rule below)
    if (priv.names.has(low) && !COMMON.has(low)) return null;
    // the positive rule: a word passes only when it is a common technical word or a word of the user's own ask (the
    // web run sees the ask anyway); anything else, private or merely unknown, is dropped with its query
    if (COMMON.has(low) || priv.ask.has(low)) continue;
    return null;
  }
  return tokens.join(' ');
}

/** The topics of a files research answer ({"topics": [{"q", "why", "ref"}]}), each query filtered; at most 8, no two
 *  the same. dropped = the ones the filter left out. */
export function parseTopics(v: unknown, priv: PrivateWords): { topics: WebTopic[]; dropped: number } {
  const list = v && typeof v === 'object' && Array.isArray((v as { topics?: unknown }).topics) ? (v as { topics: unknown[] }).topics : [];
  const out: WebTopic[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const x of list.slice(0, 3 * TOPICS_MAX)) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const q = safeQuery(o.q ?? o.query, priv);
    if (!q) { dropped++; continue; }
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    if (out.length >= TOPICS_MAX) break;
    seen.add(key);
    const why = typeof o.why === 'string' ? o.why.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
    const ref = typeof o.ref === 'string' ? o.ref.trim().slice(0, 200) : '';
    out.push({ id: `t${out.length + 1}`, q, why, ref });
  }
  return { topics: out, dropped };
}

/** The facts of the topics' web run: web facts (a page each, as parseFacts) that name the topic they were searched for
 *  ("topic": its id or its query); one that names none of the topics is left out. Ids from `start`. */
export function parseTopicFacts(v: unknown, topics: readonly WebTopic[], start = 1): LessonFact[] {
  const list = v && typeof v === 'object' && Array.isArray((v as { facts?: unknown }).facts) ? (v as { facts: unknown[] }).facts : [];
  const out: LessonFact[] = [];
  for (const x of list.slice(0, 24)) {
    if (!x || typeof x !== 'object') continue;
    const name = String((x as Record<string, unknown>).topic ?? '').trim().toLowerCase();
    const topic = topics.find(t => t.id === name || t.q.toLowerCase() === name);
    if (!topic) continue;
    const [f] = parseFacts({ facts: [x] }, true, start + out.length);
    if (f) out.push({ ...f, topic: topic.q });
  }
  return out;
}
