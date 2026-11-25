// A report written as text (ADR 0356, owner 2026-11-25: «se l'agente incolla il report in JSON valido nell'ultimo
// messaggio, l'app lo legge come un agent_report, con gli stessi controlli e i criteri compilati»). Seen on 2026-11-25:
// an Antigravity child whose engine had dropped agent_report pasted the report's JSON in its answer, and the app closed
// it «senza agent_report», every criterion «non riportato». Pure: the last answer in, the tool's arguments out (or
// null); ChatManager (manager-delegation.ts owedReport) calls the real agent_report with them, so every check of the
// tool holds. Tests: test/unit/chats/text-report.test.ts.

const OUTCOMES = new Set(['done', 'partial', 'blocked']);
const MAX_TEXT = 200_000;

/** The agent_report arguments a message carries as JSON: a ```json block, the whole text, or the last balanced {…};
 *  also wrapped as { "agent_report": {…} } or a tool call { "name": "agent_report", "arguments": {…} }. Null when no
 *  object with an outcome (done | partial | blocked) and a summary is there. */
export function reportInText(text: string): Record<string, unknown> | null {
  const t = String(text ?? '').slice(0, MAX_TEXT);
  const candidates: string[] = [];
  for (const m of t.matchAll(/```(?:json|JSON)?\s*\n([\s\S]*?)```/g)) candidates.push(m[1]!);
  candidates.push(t.trim());
  candidates.push(...balancedObjects(t).reverse());
  for (const c of candidates) {
    const found = asReport(parse(c));
    if (found) return found;
  }
  return null;
}

function parse(s: string): unknown {
  try { return JSON.parse(s.trim()); } catch { return undefined; }
}

function asReport(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.agent_report && typeof o.agent_report === 'object') return asReport(o.agent_report);
  if (typeof o.name === 'string' && /agent_report$/.test(o.name) && o.arguments && typeof o.arguments === 'object') return asReport(o.arguments);
  if (typeof o.outcome !== 'string' || !OUTCOMES.has(o.outcome) || typeof o.summary !== 'string') return null;
  return { ...o, ...(o.output === undefined ? { output: o.summary } : {}) };
}

/** The top-level balanced {…} spans of a text, quotes respected, in order. */
function balancedObjects(t: string): string[] {
  const out: string[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { if (depth > 0) inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}' && depth > 0) { depth--; if (depth === 0 && start >= 0) { out.push(t.slice(start, i + 1)); start = -1; } }
  }
  return out;
}
