// What the user wants to learn, read from the one field of Impara's start (ADR 0204; owner, 2026-10-30, report «Impara
// v3» I1: «il tipo si capisce da solo: un link PR diventa PR, testo lungo incollato diventa testo, altrimenti
// argomento»): a GitHub or Azure DevOps pull request link anywhere in it makes a PR lesson (the rest of the field is
// the ask); a long text (LONG_CHARS characters or LONG_LINES lines) is a text to explain; anything else is a topic.
// The user may force a kind (`force`); `startOf` builds the LessonStart fields from it. Used by the renderer's
// components/impara/ImparaStart.tsx; tests: test/unit/impara-start.test.ts.
import type { LessonKind } from './lesson';

export const LONG_CHARS = 600;
export const LONG_LINES = 8;

const GITHUB_PR = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d{1,7}\b[^\s]*/i;
const DEVOPS_PR = /https:\/\/(?:dev\.azure\.com\/[\w.-]+|[\w-]+\.visualstudio\.com)\/[^\s]*?\/pullrequest\/\d{1,9}\b[^\s]*/i;

export interface Detected { kind: LessonKind; prUrl?: string; pr?: { provider: 'github' | 'devops'; number: number } }

/** The PR link in a text, if any (the first; trailing punctuation dropped). */
export function prLinkIn(text: string): Detected['pr'] & { url: string } | null {
  for (const [re, provider] of [[GITHUB_PR, 'github'], [DEVOPS_PR, 'devops']] as const) {
    const m = re.exec(text);
    if (!m) continue;
    const url = m[0].replace(/[).,;:!?»"']+$/, '');
    const n = /\/(?:pull|pullrequest)\/(\d+)/i.exec(url);
    return { url, provider, number: Number(n?.[1] ?? 0) };
  }
  return null;
}

/** The kind the field asks for, by itself. */
export function detectKind(text: string): Detected {
  const pr = prLinkIn(text);
  if (pr) return { kind: 'pr', prUrl: pr.url, pr: { provider: pr.provider, number: pr.number } };
  const t = text.trim();
  if (t.length >= LONG_CHARS || t.split('\n').length >= LONG_LINES) return { kind: 'text' };
  return { kind: 'topic' };
}

/** The start request's own fields from the field, the kind (detected or forced), and a pasted text that came from
 *  another page (it is the text to explain; the field is then the ask). Null when it cannot start yet. */
export function startOf(field: string, force: LessonKind | null, opts: { pasted?: string; hasFiles?: boolean; filesAsk: string } ): { kind: LessonKind; ask: string; prUrl?: string; text?: string } | null {
  const d = detectKind(field);
  const kind = force ?? (opts.pasted ? 'text' : d.kind);
  const t = field.trim();
  if (kind === 'pr') {
    const url = d.prUrl ?? prLinkIn(field)?.url;
    if (!url) return null;
    return { kind, prUrl: url, ask: t.replace(url, '').trim().slice(0, 600) };
  }
  if (kind === 'text') {
    if (opts.pasted) return { kind, text: opts.pasted, ask: t.slice(0, 600) };
    return t ? { kind, text: t, ask: '' } : null;
  }
  if (!t && opts.hasFiles) return { kind, ask: opts.filesAsk };
  return t ? { kind, ask: t.slice(0, 600) } : null;
}
