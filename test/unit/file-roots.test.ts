// Unit tests of main/file-roots.ts and file-view.ts rootFor (ADR 0316): a relative path in a message is looked for in
// the chat's folder, then its delegated chats', the maps', the other chats' (latest first), the brain and one level above
// each; the viewer opens the first folder where it is a file, and an absolute path keeps its own place.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FILE_ROOTS_MAX, fileRoots } from '../../src/main/file-roots';
import { readFileView, rootFor } from '../../src/main/file-view';

const chat = (id: string, cwd: string, updatedAt: number, parentId?: string) => ({ id, cwd, updatedAt, ...(parentId ? { parentId } : {}) });

describe('fileRoots', () => {
  it('orders the folders best first, without repeats, then their parents', () => {
    const chats = [chat('orc', 'C:\\brain', 9), chat('old', 'C:\\work\\old', 1), chat('kid', 'C:\\work\\air', 2, 'orc'), chat('grand', 'C:\\work\\air\\mcp', 3, 'kid'), chat('new', 'C:\\work\\new', 8)];
    const roots = fileRoots({ chatId: 'orc', chats, mapRoots: ['C:\\work\\shop', undefined], brainRoot: 'C:\\Brain' }, 'win32');
    expect(roots.slice(0, 7)).toEqual(['C:\\brain', 'C:\\work\\air\\mcp', 'C:\\work\\air', 'C:\\work\\shop', 'C:\\work\\new', 'C:\\work\\old', 'C:\\']);
    expect(roots).toContain('C:\\work');
    expect(new Set(roots.map(r => r.toLowerCase())).size).toBe(roots.length);
  });
  it('no chat: the brain first; relative or empty folders are left out; capped', () => {
    const many = Array.from({ length: 100 }, (_, i) => chat(`c${i}`, `/w/p${i}/src`, i));
    const roots = fileRoots({ chats: [...many, chat('x', 'relative/dir', 200), chat('y', '', 300)], mapRoots: [], brainRoot: '/brain' }, 'linux');
    expect(roots[0]).toBe('/brain');
    expect(roots[1]).toBe('/w/p99/src');
    expect(roots).toHaveLength(FILE_ROOTS_MAX);
    expect(roots.every(r => r.startsWith('/'))).toBe(true);
  });
});

describe('rootFor', () => {
  const temporary: string[] = [];
  afterEach(() => { for (const d of temporary.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
  it('opens a relative path from the folder where it is a file', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-roots-'));
    temporary.push(base);
    const brain = path.join(base, 'brain'), proj = path.join(base, 'air');
    fs.mkdirSync(brain); fs.mkdirSync(path.join(proj, 'air_mcp'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'air_mcp', 'tools.py'), 'def run():\n    pass\n');
    const roots = [brain, proj];
    expect(rootFor('air_mcp/tools.py:2', roots)).toBe(proj);
    expect(await readFileView('air_mcp/tools.py', { cwd: rootFor('air_mcp/tools.py', roots) })).toMatchObject({ kind: 'text', text: 'def run():\n    pass\n' });
    expect(rootFor('nowhere.py', roots)).toBe(brain);
    expect(rootFor(path.join(proj, 'air_mcp', 'tools.py'), roots)).toBe(brain); // absolute: its own place
    expect(rootFor('../air/air_mcp/tools.py', roots)).toBe(brain); // never out of a folder
    expect(rootFor('x', [])).toBeUndefined();
  });
});
