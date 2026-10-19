// The `run-report` block every role ends its run with (AGENTS-DESIGN §3 preamble): a fenced block tagged `run-report`
// holding one JSON object {"outcome":"done|partial|blocked","verified":"yes|partial|no","summary":"…", ...role fields}.
// Pure: ChatManager reads it from the assistant's reply when a turn of a run ends; metrics read the parsed fields only.
import type { AgentRunReport } from '../../shared/agents';

/** a longer block is not a report: it is never parsed */
export const REPORT_MAX = 20_000;
export const SUMMARY_MAX = 140;
const FENCE = /^[ \t]*```[ \t]*run-report[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*$/gm;
const OUTCOMES = ['done', 'partial', 'blocked'] as const;
const VERIFIED = ['yes', 'partial', 'no'] as const;
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

export type ParsedReport = { status: 'missing' } | { status: 'garbage'; reason: string } | { status: 'ok'; report: AgentRunReport };

/** The last `run-report` block of a reply (an agent may quote an earlier one), read strictly: the common fields must be
 *  there and valid; the Reviewer's `findings` / `blocking` must be counts when present; other role fields are ignored. */
export function parseRunReport(text: string, at: number): ParsedReport {
  const blocks = [...text.matchAll(FENCE)];
  const body = blocks.at(-1)?.[1];
  if (body === undefined) return { status: 'missing' };
  if (body.length > REPORT_MAX) return { status: 'garbage', reason: 'too long' };
  let v: unknown;
  try { v = JSON.parse(body); } catch { return { status: 'garbage', reason: 'not JSON' }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { status: 'garbage', reason: 'not an object' };
  const o = v as Record<string, unknown>;
  if (!OUTCOMES.includes(o.outcome as never)) return { status: 'garbage', reason: 'outcome' };
  if (!VERIFIED.includes(o.verified as never)) return { status: 'garbage', reason: 'verified' };
  if (typeof o.summary !== 'string' || !o.summary.trim()) return { status: 'garbage', reason: 'summary' };
  for (const k of ['findings', 'blocking'] as const) if (o[k] !== undefined && !count(o[k])) return { status: 'garbage', reason: k };
  if (count(o.findings) && count(o.blocking) && o.blocking > o.findings) return { status: 'garbage', reason: 'blocking > findings' };
  const summary = o.summary.replace(/\s+/g, ' ').trim();
  return { status: 'ok', report: {
    at, outcome: o.outcome as typeof OUTCOMES[number], verified: o.verified as typeof VERIFIED[number],
    summary: summary.length > SUMMARY_MAX ? `${summary.slice(0, SUMMARY_MAX - 1)}…` : summary,
    ...(count(o.findings) ? { findings: o.findings } : {}), ...(count(o.blocking) ? { blocking: o.blocking } : {}),
  } };
}

/** What a run keeps from a reply: the parsed report, or nothing (no block, or one out of shape). */
export function reportOf(text: string, at: number): AgentRunReport | null {
  const p = parseRunReport(text, at);
  return p.status === 'ok' ? p.report : null;
}
