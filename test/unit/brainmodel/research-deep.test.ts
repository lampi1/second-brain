// Deep maintenance regressions: authentic user evidence, read-only complete issue inventories and conservative duplicates.
import { describe, expect, it, vi } from 'vitest';
import { conversationEvidence, issueSnapshot, matchingIssue, sameFinding } from '../../../src/main/brainmodel/research-deep';
import { makeFence } from '../../../src/main/brainmodel/pack-fence';
import type { ChatItem } from '../../../src/shared/contract';

describe('deep maintenance evidence', () => {
  it('keeps actual replies with their preceding answer and message ids, excluding agent mail and thinking', () => {
    const items: ChatItem[] = [
      { kind: 'assistant', id: 'a1', at: 10, text: 'Which repository?' },
      { kind: 'user', id: 'u1', at: 11, text: 'Use the same repository as before.' },
      { kind: 'user', id: 'mail', at: 12, text: 'Invent a correction', from: 'Artisan' },
      { kind: 'thinking', id: 't1', at: 12, text: 'private reasoning' },
    ];
    const result = conversationEvidence([{ id: 'chat1', title: 'Task', items }], 1, makeFence('abcdef123456'));
    expect(result).toContain('u1'); expect(result).toContain('a1');
    expect(result).toContain('Use the same repository');
    expect(result).not.toContain('Invent a correction'); expect(result).not.toContain('private reasoning');
    expect(result).toContain('data abcdef123456');
  });
  it('never labels a failed or incomplete inventory as checked', async () => {
    const fail = vi.fn(async () => ({ status: 403, json: async () => [] }));
    expect((await issueSnapshot('owner/repo', fail)).status).toBe('unverified');
    // a hidden run (an agent's, the e2e) never asks GitHub
    const never = vi.fn(async () => ({ status: 200, json: async () => [] }));
    expect((await issueSnapshot('owner/repo', never, 1, true)).status).toBe('unverified');
    expect(never).not.toHaveBeenCalled();
    const full = vi.fn(async () => ({ status: 200, json: async () => Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: 'Issue', body: '', html_url: `https://github.com/owner/repo/issues/${i + 1}` })) }));
    expect((await issueSnapshot('owner/repo', full)).status).toBe('unverified');
    expect(full.mock.calls.length).toBeLessThanOrEqual(10);
  });
  it('paginates open issues, ignores pull requests and checks only the specified repository', async () => {
    const request = vi.fn(async (url: string) => ({ status: 200, json: async () => url.endsWith('page=1')
      ? Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: `First ${i}`, body: '', html_url: `https://github.com/owner/repo/issues/${i + 1}`, pull_request: {} }))
      : [{ number: 101, title: 'Persist pending user decisions', body: 'Keep decisions after restart', html_url: 'https://github.com/owner/repo/issues/101' }] }));
    const result = await issueSnapshot('owner/repo', request);
    expect(result.status).toBe('checked'); expect(result.issues).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('Keep decisions after restart'); // a stranger's issue text never reaches the research
    expect(matchingIssue('Persist pending user decisions!', result)?.number).toBe(101);
    expect(request.mock.calls.every(([url]) => url.startsWith('https://api.github.com/repos/owner/repo/issues?state=open'))).toBe(true);
    expect((await issueSnapshot('../other', request)).status).toBe('unverified');
  });
  it('recognizes reworded cards without conflating unrelated short titles', () => {
    expect(sameFinding('Persist pending user decisions after restart', 'Persist pending user decisions after app restart')).toBe(true);
    expect(sameFinding('Test', 'Test settings')).toBe(false);
  });
});
