// A work thread follows a chat that goes on in another one (workflows/service.ts followChat, ADR 0356): the new chat
// joins every thread that is not done, once; a done thread is left as it was.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workflows } from '../../../src/main/workflows/service';

const roots: string[] = [];
afterEach(() => { for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

it('adds the chat that goes on to the open threads of the old one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-follow-')); roots.push(dir);
  const w = new Workflows(path.join(dir, 'work.json'));
  const open = w.create({ title: 'Aperto', profile: 'investigation', priority: 'normal', chatIds: ['a'] });
  const other = w.create({ title: 'Altro', profile: 'investigation', priority: 'normal', chatIds: ['x'] });
  w.followChat('a', 'b');
  w.followChat('a', 'b');
  const rows = w.list();
  expect(rows.find(r => r.id === open.id)!.chatIds).toEqual(['a', 'b']);
  expect(rows.find(r => r.id === other.id)!.chatIds).toEqual(['x']);
});
