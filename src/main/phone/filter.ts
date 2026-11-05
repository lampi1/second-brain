// The ONE filter on every text that leaves the PC for Telegram (design §9): replies, questions, options, the voice echo,
// /stato, notices, button labels. outbound.ts is the only sender and calls it on every text, so no path skips it.
// What it does, in order: invisible and control characters removed (and NFKC, so look-alike wide letters become plain);
// fenced code blocks, inline code and command lines → "[comando: eseguilo dal PC]"; markdown tables and query-result-like
// rows dropped (one placeholder); credentials masked (maskSecrets of src/main/brain/mask.ts, then redact of
// src/main/log.ts); bot tokens; links reduced to their domain (paths and titles can name a customer); local paths;
// license-like codes (ODENTAIRC…, PDENTAIR…, XXXX-XXXX-XXXX keys), emails, Italian codici fiscali, IBANs, GUIDs, Db_…
// names and long digit runs masked. Chat titles never reach it: callers pass role + neutral label.
// Known limit (design §9): a customer or patient name in plain prose passes. Idempotent.
// Used by outbound.ts, condense.ts, buttons.ts, commands.ts, voice.ts; adversarial tests: test/unit/phone/filter.test.ts.
import { maskSecrets } from '../brain/mask';
import { redact } from '../log';

export const CODE_PLACEHOLDER = '[comando: eseguilo dal PC]';
export const TABLE_PLACEHOLDER = '[tabella: vedila sul PC]';
export const ROWS_PLACEHOLDER = '[risultato di query: vedilo sul PC]';
/** longer input is cut before filtering (a reply is condensed to ~600 characters anyway) */
export const FILTER_INPUT_MAX = 20_000;

const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0E\uFEFF\uFFA0]/g;
/** U+FE0F (emoji presentation) is kept only right after a pictograph, so the warning sign stays an emoji on the phone */
const STRAY_VS16 = /(?<!\p{Extended_Pictographic})\uFE0F/gu;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

const FENCE = /^\s*(`{3,}|~{3,})/;
/** a line that is a shell or PowerShell command (a prompt, or a known command word first) */
const COMMAND_LINE = /^\s*(?:(?:PS [^>\n]*>|\$|#|>{1,2})\s*)?(?:git|npm|npx|node|az|sqlcmd|bcp|powershell|pwsh|cmd|curl|wget|docker|kubectl|dotnet|ssh|scp|sudo|bash|sh|python|py|pip|winget|choco|[A-Z][a-z]+-[A-Z][A-Za-z]+)(?:\.exe)?\s+\S/;
const TABLE_LINE = /^\s*\|.*\|\s*$/;
const isRowLike = (l: string) =>
  (l.match(/\t/g)?.length ?? 0) >= 2 ||
  /^\s*-{2,}(?:\s+-{2,})+\s*$/.test(l) ||
  /^\s*\(\d+ (?:rows?|righe?|record) (?:affected|interessat[ae])\)\s*$/i.test(l) ||
  /\S {2,}\S.*\S {2,}\S/.test(l);

function dropFences(text: string): string {
  const out: string[] = [];
  let open: string | null = null;
  for (const line of text.split('\n')) {
    const m = FENCE.exec(line);
    if (open === null) {
      if (m) { open = m[1]!; out.push(CODE_PLACEHOLDER); } else out.push(line);
    } else if (m && m[1]![0] === open[0] && m[1]!.length >= open.length && line.trim() === m[1]) {
      open = null;
    }
  }
  return out.join('\n');
}

/** Tables, query rows and command lines, each block → one placeholder line. */
function dropBlocks(text: string): string {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const ph = TABLE_LINE.test(line) ? TABLE_PLACEHOLDER : isRowLike(line) ? ROWS_PLACEHOLDER : COMMAND_LINE.test(line) ? CODE_PLACEHOLDER : null;
    if (ph === null) out.push(line);
    else if (out[out.length - 1] !== ph) out.push(ph);
  }
  return out.join('\n');
}

/** A URL → its host, with "/…" when it had a path or query; unparseable → "[link]". */
export function domainOnly(raw: string): string {
  try {
    const u = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw);
    if (!u.hostname) return '[link]';
    const more = (u.pathname && u.pathname !== '/') || u.search || u.hash;
    return `${u.hostname}${more ? '/...' : ''}`;
  } catch { return '[link]'; }
}

const RULES: [RegExp, string | ((m: string, ...g: string[]) => string)][] = [
  [/\b\d{6,12}:[A-Za-z0-9_-]{30,}/g, '[redacted]'],                                             // a bot token
  [/\bmailto:[^\s<>"')\]]+/gi, '[email]'],
  [/[\w.+%-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  [/!?\[([^\]\n]*)\]\(\s*([^)\s]+)[^)\n]*\)/g, (_m: string, _t: string, url: string) => domainOnly(url)], // [title](url): title dropped
  [/\b(?:https?|ftp|wss?):\/\/[^\s<>"'`)\]]+/gi, m => domainOnly(m)],
  [/\bfile:\/\/[^\s<>"')\]]+/gi, '[percorso]'],
  [/\bwww\.[^\s<>"')\]]+/gi, m => domainOnly(m)],
  [/(?:\b[A-Za-z]:\\|\\\\[\w.$-]+\\)[^\s"'<>|]*/g, '[percorso]'],                                // C:\…, \\server\…
  [/(?:^|(?<=\s))(?:~|\/(?:Users|home|var|etc|opt|mnt|srv))\/[^\s"'<>]*/g, '[percorso]'],
  [/\b(?:ODENTAIR|PDENTAIR|ORISDENTAIR|POWERDENTAIR)[A-Z0-9_-]*/gi, '[codice]'],
  [/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{4,}(?:-[A-Z0-9]{4,}){2,}\b/g, '[codice]'],        // XXXX-XXXX-XXXX keys
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[guid]'],
  [/\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/gi, '[codice fiscale]'],
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, '[iban]'],
  [/\bDb_[\w.-]+/gi, '[db]'],
  [/\b\d{11,}\b/g, '[numero]'],
];

/** The outgoing filter: every text sent to Telegram goes through it, once or more (it is idempotent). */
export function filterOutgoing(input: string): string {
  let t = String(input ?? '').slice(0, FILTER_INPUT_MAX).replace(/\r\n?/g, '\n').normalize('NFKC').replace(INVISIBLE, '').replace(STRAY_VS16, '').replace(CONTROL, '');
  t = dropFences(t);
  t = t.replace(/`+[^`\n]*`+/g, CODE_PLACEHOLDER).replace(/`/g, '');
  t = dropBlocks(t);
  t = maskSecrets(t).text;
  t = redact(t);
  for (const [re, to] of RULES) t = typeof to === 'string' ? t.replace(re, to) : t.replace(re, to as (m: string, ...g: string[]) => string);
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
