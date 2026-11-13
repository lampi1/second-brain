// Reading a Claude transcript back into tile items (src/main/chats/transcript.ts), read-only and lenient.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cwdSlug, findTranscript, readHistory } from '../../../src/main/chats/transcript';
import { tmp } from './helpers';

const SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const line = (o: object) => JSON.stringify({ timestamp: '2026-10-11T07:24:42.487Z', uuid: Math.random().toString(16).slice(2), isSidechain: false, ...o });

function writeTranscript(home: string, dir: string, lines: string[]): string {
  const f = path.join(home, 'projects', dir, `${SID}.jsonl`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${lines.join('\n')}\n`);
  return f;
}

describe('transcript', () => {
  it('slugs a cwd like Claude Code', () => {
    const win = ['C:', 'Users', 'someone.x', 'my-brain'].join('\\'); // built at runtime: no user paths in the sources
    expect(cwdSlug(win)).toBe('C--Users-someone-x-my-brain');
  });

  it('finds a transcript by slug, by case-insensitive slug, then anywhere; refuses odd ids', () => {
    const home = tmp('home');
    const f = writeTranscript(home, 'c--Repo-x', []).toLowerCase(); // Windows: same file whatever the case
    const find = (cwd: string | null) => findTranscript(SID, cwd, home)?.toLowerCase();
    expect(find('c:\\Repo\\x')).toBe(f);
    expect(find('C:\\Repo\\x')).toBe(f);
    expect(find('D:\\other')).toBe(f);
    expect(find(null)).toBe(f);
    expect(findTranscript('../../etc/passwd', null, home)).toBeNull();
    expect(findTranscript('bbbbbbbb-0000-4000-8000-000000000000', null, home)).toBeNull();
    expect(findTranscript(SID, null, path.join(home, 'nope'))).toBeNull();
  });

  it('rebuilds user, assistant, thinking and tool rows; skips sidechains, meta and junk', () => {
    const home = tmp('home');
    const cwd = path.resolve('/w');
    const f = writeTranscript(home, cwdSlug(cwd), [
      JSON.stringify({ type: 'custom-title', customTitle: 'Titolo vero', sessionId: SID }),
      line({ type: 'user', message: { role: 'user', content: 'ciao <system-reminder>secret context</system-reminder>' } }),
      line({ type: 'user', isMeta: true, message: { role: 'user', content: 'meta' } }),
      line({ type: 'user', message: { role: 'user', content: '<command-name>/stato</command-name><command-args>tutto</command-args>' } }),
      line({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'thinking', thinking: '' }] } }),
      line({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] } }),
      line({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: path.join(cwd, 'n.txt'), content: 'x\ny' } }] } }),
      line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'written' }] }, toolUseResult: { type: 'create', structuredPatch: [] } }),
      line({ type: 'assistant', isSidechain: true, message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'subagent' }] } }),
      'not json at all',
      line({ type: 'assistant', message: { id: 'm3', role: 'assistant', content: [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'ls' } }] } }),
      line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
      line({ type: 'assistant', message: { id: 'm4', role: 'assistant', content: [{ type: 'text', text: 'Riga uno\nFatto.' }] } }),
      line({ type: 'system', subtype: 'stop_hook_summary' }),
      JSON.stringify({ type: 'cost-state', totalCostUSD: 0.42 }),
    ]);
    const h = readHistory(f, { cwd });
    expect(h.title).toBe('Titolo vero');
    expect(h.costTotalUsd).toBe(0.42);
    expect(h.lastText).toBe('Fatto.');
    expect(h.items.map(i => i.kind)).toEqual(['user', 'user', 'thinking', 'tool', 'tool', 'system', 'assistant']);
    expect(h.items[0]).toMatchObject({ kind: 'user', text: 'ciao' });
    expect(h.items[1]).toMatchObject({ kind: 'user', text: '/stato tutto' });
    expect(h.items[3]).toMatchObject({ kind: 'tool', id: 't-tu1', summary: 'Write: n.txt', status: 'ok', output: 'written', diff: [{ path: 'n.txt', added: 2, removed: 0 }] });
    expect(h.items[4]).toMatchObject({ kind: 'tool', summary: 'Bash: ls', status: 'error', output: 'senza risultato' });
    expect(h.items[5]).toMatchObject({ kind: 'system', code: 'interrupted' });
  });

  it('a pasted screenshot (one huge base64 line) does not push the conversation out of the history', () => {
    const home = tmp('home');
    const before = Array.from({ length: 30 }, (_, i) => line({ type: 'assistant', message: { id: `m${i}`, role: 'assistant', content: [{ type: 'text', text: `msg ${i}` }] } }));
    const shotLine = line({ type: 'user', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(3_500_000) } }, { type: 'text', text: 'guarda' }] } });
    const f = writeTranscript(home, 'x', [...before, shotLine, line({ type: 'assistant', message: { id: 'z', role: 'assistant', content: [{ type: 'text', text: 'visto' }] } })]);
    const h = readHistory(f);
    expect(h.items[0]).toMatchObject({ text: 'msg 0' });
    expect(h.items.find(i => i.kind === 'user')).toMatchObject({ text: 'guarda', images: 1 });
    expect(h.items.at(-1)).toMatchObject({ text: 'visto' });
  });

  it('keeps only the newest items and reads only the tail of big files', () => {
    const home = tmp('home');
    const lines = Array.from({ length: 50 }, (_, i) => line({ type: 'assistant', message: { id: `m${i}`, role: 'assistant', content: [{ type: 'text', text: `msg ${i}` }] } }));
    const f = writeTranscript(home, 'x', lines);
    const h = readHistory(f, { maxItems: 10 });
    expect(h.items).toHaveLength(10);
    expect(h.items.at(-1)).toMatchObject({ text: 'msg 49' });
    const tail = readHistory(f, { maxBytes: 600 });
    expect(tail.items.length).toBeGreaterThan(0);
    expect(tail.items.length).toBeLessThan(50);
    expect(readHistory(path.join(home, 'missing.jsonl')).items).toEqual([]);
  });
});
