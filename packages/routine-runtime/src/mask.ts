// Secret masking for the routine runtime (ADR 0175, 0176): the exact values a run holds (site passwords, a DevOps PAT,
// API keys the host registered) and token-shaped strings never reach a log line, a transcript, a step result or a
// report. `redact` is the app log's form ([redacted]); a Masker is the run folder's form (***), seeded with the run's
// own secret values. Moved from src/main/log.ts, which re-exports redact/addRedaction for the rest of the app.

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk-[A-Za-z0-9_-]{16,})\b/g,                       // API keys
  /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})\b/g, // JWTs
  /(authorization["']?\s*[:=]\s*["']?)(bearer\s+|basic\s+)?[^\s"',}]+/gi,
  /([?&](?:token|access_token|code|password|pwd)=)[^&\s"]+/gi,
  /(\/mcp\/chat\/[^/\s"]+\/)[A-Za-z0-9_-]{8,}/g,          // per-chat MCP endpoint tokens
  /("(?:password|passwd|secret|apiKey|api_key|token|pat)"\s*:\s*")[^"]*(?=")/gi,
  /\b([a-z][a-z0-9+.-]{0,15}:\/\/)[^/\s:@"']{1,256}:[^/\s@"']{0,256}(?=@)/gi,  // user:password@ in URLs (bounded: no backtracking blow-up)
];

/** The forms a secret value takes in text: as is, URL-encoded, inside a JSON string, and base64 with a Basic prefix. */
export function secretForms(value: string): string[] {
  if (!value) return [];
  const forms = new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]);
  forms.add(Buffer.from(`:${value}`).toString('base64'));
  return [...forms].filter(Boolean);
}

/** Every value the process registered: replaced in the app log whatever its shape. */
const known = new Set<string>();

/** Redacts this exact value from every later log line (an API key the app stores or reads). */
export function addRedaction(value: string, force = false): void {
  if (!value || (!force && value.length < 8)) return; // too short to be a key: redacting it would blank ordinary words
  known.add(value);
  known.add(JSON.stringify(value).slice(1, -1));
}

function patterns(s: string, mark: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m, p1?: string) => (typeof p1 === 'string' && m.startsWith(p1) && p1 !== m ? `${p1}${mark}` : mark));
  return out;
}

export function redact(s: string): string {
  let out = s;
  for (const k of known) if (out.includes(k)) out = out.split(k).join('[redacted]');
  return patterns(out, '[redacted]');
}

/** Masks a run's text before it is written anywhere: its own secrets, the process-wide ones and token shapes → ***. */
export interface Masker {
  /** Adds one secret value (all its text forms) to this masker. */
  add(value: string): void;
  mask(text: string): string;
  /** JSON-serialises a value with every string masked and secret-named keys blanked. */
  json(value: unknown, indent?: number): string;
}

export function createMasker(values: Iterable<string> = []): Masker {
  const own = new Set<string>();
  const add = (value: string) => { for (const form of secretForms(value)) if (form.length >= 3) own.add(form); };
  for (const value of values) add(value);
  const mask = (text: string): string => {
    let out = text;
    // longest first: a value containing another is replaced whole
    for (const k of [...own, ...known].sort((a, b) => b.length - a.length)) if (out.includes(k)) out = out.split(k).join('***');
    return patterns(out, '***');
  };
  return {
    add, mask,
    json: (value, indent = 2) => mask(JSON.stringify(value, (key, v: unknown) => /^(password|passwd|secret|apiKey|api_key|token|pat)$/i.test(key) && typeof v === 'string' ? '***' : v, indent)),
  };
}
