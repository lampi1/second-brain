// Unit tests of the main-side notification policy (src/main/brain/live.ts, 2026-10-13): kinds' default priorities,
// the end of an app chat's turn (no event for a Regia, "chat-failed" on an error) and playbook events only when the
// content changed (a touch or a re-save with the same text is no event).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { doneEvent, KINDS, Live } from '../../src/main/brain/live';

describe('live feed policy', () => {
  it('kinds: chat-failed urgent, chat-done and the bookkeeping kinds quiet', () => {
    expect(KINDS['chat-failed']?.priority).toBe('urgent');
    for (const k of ['chat-done', 'now', 'done', 'decision', 'proposal', 'mail', 'sync-ok', 'playbook']) expect(KINDS[k]?.priority).toBe('quiet');
  });

  it('a turn end: nothing for a Regia, chat-failed on an error, chat-done otherwise', () => {
    const c = { id: 'a', title: 'Fix', isRegia: false };
    expect(doneEvent(undefined)).toBeNull();
    expect(doneEvent({ ...c, isRegia: true })).toBeNull();
    expect(doneEvent({ ...c, lastResult: { at: 1, isError: false } })).toMatchObject({ kind: 'chat-done', chatId: 'a', title: 'Fix' });
    expect(doneEvent({ ...c, lastResult: { at: 1, isError: false, interrupted: true } })?.kind).toBe('chat-done');
    expect(doneEvent({ ...c, lastResult: { at: 1, isError: true } })).toMatchObject({ kind: 'chat-failed', chatId: 'a' });
    // the CLI died mid-turn: chat-failed with its error, even after a good last turn; never for a Regia
    expect(doneEvent({ ...c, lastResult: { at: 1, isError: false } }, 'fatal: boom')).toMatchObject({ kind: 'chat-failed', chatId: 'a', detail: expect.stringContaining('fatal: boom') });
    expect(doneEvent({ ...c, isRegia: true }, 'fatal: boom')).toBeNull();
  });

  it('playbooks: an event only when the content hash changes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-live-'));
    fs.mkdirSync(path.join(root, 'playbooks'));
    const f = path.join(root, 'playbooks', 'qa.md');
    fs.writeFileSync(f, 'one');
    const live = new Live({ root, stateFile: path.join(root, 'state.json'), node: { exe: process.execPath } as never, onEvents: () => {} });
    (live as unknown as { hashPlaybooks(): void }).hashPlaybooks();
    expect(live.playbookEvent('playbooks/qa.md')).toEqual([]);           // touched, same text
    fs.writeFileSync(f, 'two');
    expect(live.playbookEvent('playbooks/qa.md')).toMatchObject([{ kind: 'playbook', title: 'qa', file: 'playbooks/qa.md' }]);
    expect(live.playbookEvent('playbooks/qa.md')).toEqual([]);           // saved again, same text
    fs.writeFileSync(path.join(root, 'playbooks', 'new.md'), 'x');
    expect(live.playbookEvent('playbooks/new.md')).toHaveLength(1);      // a new playbook
    expect(live.playbookEvent('playbooks/gone.md')).toEqual([]);         // deleted: nothing
  });
});
