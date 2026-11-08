// Deep maintenance evidence and issue inventories: bounded read-only inputs, authentic replies and conservative
// duplicate detection. ResearchService supplies the trusted repository; remote text is data, never authority.
import type { ChatItem } from '../../shared/contract';
import type { Fence } from './pack-fence';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface Conversation { id: string; title: string; items: readonly ChatItem[] }
export interface OpenIssue { number: number; title: string; body: string; url: string }
export interface IssueSnapshot { repo: string | null; status: 'checked' | 'unverified'; at: number; note: string; issues: OpenIssue[] }
type Request = (url: string) => Promise<{ status: number; json(): Promise<unknown> }>;
const request: Request = url => fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/vnd.github+json' } });

/** A complete inventory is necessary for a checked receipt. PRs count towards pagination, never towards issues. */
export async function issueSnapshot(repo: string | null, get: Request = request, now = Date.now()): Promise<IssueSnapshot> {
  const result: IssueSnapshot = { repo, status: 'unverified', at: now, note: 'dedup da verificare: repository non disponibile', issues: [] };
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || repo.split('/').some(x => x === '.' || x === '..')) return result;
  try {
    for (let page = 1; page <= 10; page++) {
      const response = await get(`https://api.github.com/repos/${repo}/issues?state=open&per_page=100&page=${page}`);
      if (response.status !== 200) throw new Error(`GitHub HTTP ${response.status}`);
      const data: unknown = await response.json();
      if (!Array.isArray(data) || data.length > 100) throw new Error('Invalid issue inventory');
      for (const raw of data) {
        const issue = raw as Record<string, unknown>;
        if (!issue || typeof issue !== 'object') throw new Error('Invalid issue');
        if (issue.pull_request) continue;
        if (!Number.isSafeInteger(issue.number) || Number(issue.number) < 1 || typeof issue.title !== 'string' ||
            (issue.body !== null && typeof issue.body !== 'string') || issue.html_url !== `https://github.com/${repo}/issues/${issue.number}`) throw new Error('Invalid issue');
        result.issues.push({ number: Number(issue.number), title: issue.title, body: String(issue.body ?? '').slice(0, 8000), url: String(issue.html_url) });
      }
      if (data.length < 100) return { ...result, status: 'checked', note: 'Open issue inventory read completely; compare meaning as well as titles.' };
    }
    throw new Error('Issue inventory exceeds 1000 entries');
  } catch (error) {
    result.note = `dedup da verificare: ${error instanceof Error ? error.message : 'issue inventory unavailable'}`;
    return result;
  }
}

const words = (text: string): Set<string> => new Set(text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
/** This is a conservative lexical check, not a claim of semantic equivalence. The model also sees the inventory. */
export function sameFinding(a: string, b: string): boolean {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return false;
  const overlap = [...x].filter(w => y.has(w)).length;
  return overlap === x.size && overlap === y.size || Math.min(x.size, y.size) >= 5 && overlap / Math.max(x.size, y.size) >= 0.8;
}
export const matchingIssue = (title: string, snapshot: IssueSnapshot): OpenIssue | undefined => snapshot.issues.find(i => sameFinding(title, i.title));

/** Only named context files; no recursive scan, symlink escape or unlimited error journal read. */
export async function brainEvidence(root: string, fence: Fence, clean: (s: string) => string): Promise<string> {
  const lines = [fence.note];
  for (const name of ['me.md', 'ai-errors.md']) {
    try {
      const base = await fs.realpath(root), file = await fs.realpath(path.join(base, name));
      if (path.dirname(file) !== base || (await fs.stat(file)).size > 2_000_000) throw new Error('Outside brain or oversized');
      const text = (await fs.readFile(file, 'utf8')).split('\n');
      const start = name === 'ai-errors.md' ? Math.max(0, text.length - 100) : 0;
      const excerpt = text.slice(start, start + 200).map((line, n) => `${name}:${start + n + 1} ${line}`).join('\n');
      lines.push(`${name}: sampled lines ${start + 1}-${Math.min(text.length, start + 200)} of ${text.length}\n${fence.wrap(clean(excerpt).slice(0, 18000))}`);
    } catch { lines.push(`${name}: unavailable (not evidence of absence)`); }
  }
  return lines.join('\n');
}

/** Bounded samples explicitly retain the question/answer context and count only direct user replies, never agent mail. */
export function conversationEvidence(chats: readonly Conversation[], since: number, fence: Fence): string {
  const lines = [fence.note, 'Conversation sample (not complete history). References are chat/item IDs; timestamps are milliseconds.'];
  let chars = lines.join('\n').length, shown = 0, available = 0;
  for (const chat of chats) {
    let previous: Extract<ChatItem, { kind: 'assistant' }> | undefined;
    for (const item of chat.items) {
      if (item.kind === 'assistant') previous = item;
      if (item.kind !== 'user' || item.from || item.at < since || /^\[(?:App-supplied|Messaggio di un agente|Message from|evento app|Battito)/i.test(item.text)) continue;
      available++;
      const bounded = (text: string) => text.length > 1800 ? `${text.slice(0, 1800)} [truncated]` : text;
      const line = `${chat.id}/${item.id} @${item.at} ${fence.wrap(chat.title)}\n${previous ? `preceding answer ${previous.id}: ${fence.wrap(bounded(previous.text))}\n` : ''}user: ${fence.wrap(bounded(item.text))}`;
      if (chars + line.length > 24000) continue;
      lines.push(line); chars += line.length; shown++;
    }
  }
  lines.splice(1, 0, `Coverage: ${shown}/${available} direct replies from ${chats.length} sampled chats. Omitted or unavailable messages are not evidence of absence.`);
  return lines.join('\n');
}
