// Credential masking for brain text that leaves main or is copied by the app: every line that may hold a credential
// (password=, keys, tokens, connection strings with a password, a URL with user:password, a private key) is replaced.
// Used by agents/analytics.ts (usage evidence), brain/scripts.ts and brain/changelog.ts (ADR 0076) and brainmodel/procedure-sources.ts (the one-time migration of former
// runbook sections into skills, ADR 0077). Unit tests: test/unit/brain/mask.test.ts.

/** What a masked line shows instead (Italian UI). */
export const MASK = '‹riga nascosta: può contenere una credenziale›';

// ── secrets ────────────────────────────────────────────────────────────────────────────────────────────────────────
// A value that is a placeholder or a reference is not a secret, only when it is the whole value: <x>, $env:X, ${x},
// %X%, {x}, ***, …. Anything else is masked, a "$…" value too (it may be a password starting with $): better hide more.
const PLACEHOLDER = String.raw`(?:<[^>\n]*>|\$env:\w+|\$\{\w+\}|%\w+%|\{\{?\w*\}?\}|\*{3,}|…|\.{3})(?=[\s"'\`;,*]|$)`;
// (the quotes and markers before the value are taken atomically: no backtracking around the placeholder check)
const VALUE = String.raw`(?=(?<lead>[\s"'\`*_]*))\k<lead>(?!${PLACEHOLDER})[^\s"'\`;,*]{4,}`;
// keyword, then quotes or bold markers ("password": …, **Password:** …), then the separator
const KEY = String.raw`(?:password|passwd|pwd|passphrase|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?key|account[_-]?key|shared[_-]?access[_-]?key|subscription[_-]?key|sas[_-]?token|auth[_-]?token|access[_-]?token|refresh[_-]?token|token)`;
const SECRET_LINE: RegExp[] = [
  // password=…, "api_key": …, **Password:** …, AccountKey=…, Ocp-Apim-Subscription-Key: … (connection strings included)
  new RegExp(String.raw`\b${KEY}\b["'*_]*\s*[:=]${VALUE}`, 'i'),
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/,
  /\bBasic\s+[A-Za-z0-9+/=]{12,}/,                                   // base64 user:password
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}/,                            // a JWT
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{16,}/,               // GitHub tokens
  /\bsk-[A-Za-z0-9_-]{20,}/,                                          // API secret keys
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,                                   // chat bot tokens
  /\bAKIA[0-9A-Z]{16}\b/,                                             // cloud access key ids
  /[?&]sig=[A-Za-z0-9%+/=]{16,}/,                                     // a signed URL
  /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@<$%{]+@/i,                   // a URL with user:password@
  // password flags: sqlcmd -P …, --password …, --client-secret=…, --token …, --api-key …
  new RegExp(String.raw`(?:^|\s)(?:-P|--password|--client-secret|--secret|--account-key|--sas-token|--connection-string|--token|--access-token|--auth-token|--api-key|--apikey|--pat|--personal-access-token)(?:\s+|=)${VALUE}`),
  // PowerShell parameters (any case): Invoke-Sqlcmd -Password …, -Token …, -ApiKey …
  new RegExp(String.raw`(?:^|\s)-(?:Password|Passwd|Pwd|ClientSecret|Secret|Token|AccessToken|ApiKey|Pat|PersonalAccessToken)(?:\s+|:)${VALUE}`, 'i'),
  // a login with -p: az login … -p …, docker login -u x -p …
  new RegExp(String.raw`\blogin\b.*\s-p\s+${VALUE}`, 'i'),
  // mysql -pSECRET (the password glued to the flag)
  new RegExp(String.raw`\bmysql\w*(?:\.exe)?\b.*\s-p(?![\s=])${VALUE}`, 'i'),
  // curl -u user:password, --user user:password
  new RegExp(String.raw`(?:^|\s)(?:-u|--user)(?:\s+|=)["']?[^\s:"']+:${VALUE}`),
  // an environment variable or shell variable named like a credential, assigned a value: export GITHUB_TOKEN=…,
  // $env:ADO_PAT = "…", set DB_PASSWORD=…, $apiKey = '…' (PAT only as a whole _-separated part: PATH is not one)
  new RegExp(String.raw`(?:(?<![\w.-])|(?<=\benv\.))(?:\w*(?:pass|token|secret|key)\w*|(?:\w+_)?pat(?:_\w*)?)\s*=(?!=)${VALUE}`, 'i'),
  new RegExp(String.raw`\bConvertTo-SecureString\s+(?:-String\s+)?["']${VALUE}`, 'i'),
];
// a table column whose header names a credential: its cells are masked (the row, as a whole)
const SECRET_HEAD = /pass|pwd|secret|segret|token|api.?key|account.?key|access.?key|subscription.?key/i;
const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
const isTableRule = (l: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l) && l.includes('-');
const placeholderCell = (c: string) => !c || c === '-' || new RegExp(String.raw`^[\`"']*${PLACEHOLDER}`).test(c);

/** Replaces every line that may hold a credential (and whole private key blocks). Returns the text and the count. */
export function maskSecrets(text: string): { text: string; masked: number } {
  let masked = 0, inKey = false;
  let secretCols: number[] = [];
  const lines = text.split(/\r?\n/);
  const out = lines.map((l, i) => {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(l)) inKey = true;
    if (inKey) {
      if (/-----END [A-Z ]*PRIVATE KEY-----/.test(l)) inKey = false;
      masked++;
      return MASK;
    }
    if (!/^\s*\|/.test(l)) secretCols = [];
    else if (isTableRule(l) && i > 0) {
      secretCols = cells(lines[i - 1]!).flatMap((c, j) => (SECRET_HEAD.test(c) ? [j] : []));
      return l;
    }
    const row = secretCols.length > 0 && !isTableRule(l) && secretCols.some(j => !placeholderCell(cells(l)[j] ?? ''));
    if (row || SECRET_LINE.some(re => re.test(l))) { masked++; return `${l.match(/^\s*(?:[-*]\s+|\d+[.)]\s+)?/)?.[0] ?? ''}${MASK}`; }
    return l;
  });
  return { text: out.join('\n'), masked };
}
