// feedback-log: the hooks' side of ai-wins.md ({{OWNER}}, 2026-10-09: "vorrei anche quelli positivi, senza appesantire").
// When {{OWNER}}'s message is explicit praise (positiveKind in signals-regex.mjs) the hook itself appends one line to
// ai-wins.md: no injected context, no model tokens. Shared by the thin adapters .claude/hooks/correction-catch.mjs
// (Claude, prompt submit) and harness/cursor/correction-log.mjs (Cursor, end of turn).
// Line: `- AAAA-MM-GG HH:MM · harness · chat · area · positivo|parziale · parole: "…" · consegnato: …`
// Never throws to the caller (a hook must never block); writes the MAIN checkout (BRAIN_WINS_FILE overrides, for tests).
import fs from 'node:fs';
import path from 'node:path';
import { positiveKind } from './signals-regex.mjs';
import { originField } from './event-origin.mjs';

export const WINS = process.env.BRAIN_WINS_FILE || '{{BRAIN}}/ai-wins.md';
const AREAS = ['Orchestrator', 'Prod', 'B', 'A', 'OS', 'Pers'];
const rome = o => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', ...o }).format(new Date());

// Secrets never reach the file: everything after a password/credential/token-like word ("la password è X", "pw: X",
// "Credenziali: utente / X"), bearer tokens, long tokens, e-mails.
export const mask = s => String(s ?? '')
  .replace(/\b(password|passwort|pwd|pw|credenziali|credentials|token|secret|apikey|api[-_ ]?key|connectionstring|sharedaccesskey|accountkey)\b[\s\S]*$/i, '$1 ***')
  .replace(/\bBearer\s+\S+/gi, 'Bearer ***')
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '***@***')
  .replace(/(?<![\w\\/-])[A-Za-z0-9+/_=~-]{32,}(?![\w\\/-])/g, '***');
// One field of the line: one line, no " · " (the separator), cut to n chars.
const field = (s, n) => {
  const t = mask(s).replace(/<pasted_content[\s\S]*?(<\/pasted_content>|$)/g, '[incollato]').replace(/\s+/g, ' ')
    .replace(/ ·(?= )/g, ' /').trim(); // " · · " too: the separator never survives inside a field
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
// {{OWNER}}'s words: the first 15, quoted.
export const quote = text => {
  const words = field(text, 400).split(' ');
  return `"${words.slice(0, 15).join(' ').replace(/"/g, "'")}${words.length > 15 ? '…' : ''}"`;
};
// What was just delivered: the first meaningful line of the last assistant text, markdown stripped.
export const delivered = text => {
  const line = String(text ?? '').split('\n').map(l => l.replace(/[*_`#>|]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim())
    .find(l => l.length > 3 && !/^[-=]+$/.test(l));
  return line ? field(line, 120) : '?';
};
// Area: the "<Area> · <cosa>" prefix of the chat title, the Orchestrator, else the repo folder of the cwd.
export const areaOf = (chat, cwd) => {
  const t = String(chat ?? '');
  if (/^orchestrator\b/i.test(t)) return 'Orchestrator';
  const pre = AREAS.find(a => t.toLowerCase().startsWith(`${a.toLowerCase()} ·`));
  if (pre) return pre;
  const p = String(cwd ?? '').replace(/\\/g, '/');
  if (/\/{{BRAIN_NAME}}(\/|$)/i.test(p)) return 'OS';
  const repo = p.match(/\/source\/repos\/([^/]+)/i);
  return repo ? repo[1] : '?';
};

// Appends the line when the message is praise; returns the line (or null). Never throws.
export function logPositive({ harness, chat, cwd, text, lastAssistant, file = WINS }) {
  try {
    const kind = positiveKind(text);
    if (!kind) return null;
    const line = `- ${rome({ year: 'numeric', month: '2-digit', day: '2-digit' })} ${rome({ hour: '2-digit', minute: '2-digit' })} · ` +
      `${harness} · ${field(chat || '?', 60)} · ${field(areaOf(chat, cwd), 30)} · ${kind} · parole: ${quote(text)} · consegnato: ${delivered(lastAssistant)} · event-origin: ${originField({ kind: 'human' })}`;
    let before = '';
    try { before = fs.readFileSync(file, 'utf8'); } catch { /* first line ever: the file comes with the brain */ }
    const month = `## ${line.slice(2, 9)}`;
    const lastMonth = before.split(/\r?\n/).reverse().find(l => /^## \d{4}-\d{2}/.test(l));
    const sep = before && !before.endsWith('\n') ? '\n' : '';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${sep}${lastMonth === month ? '' : `\n${month}\n\n`}${line}\n`);
    return line;
  } catch { return null; }
}
